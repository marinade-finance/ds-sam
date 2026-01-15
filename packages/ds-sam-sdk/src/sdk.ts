import Decimal from 'decimal.js'
import semver from 'semver'

import { Auction } from './auction'
import { calcValidatorRevShare } from './calculations'
import { DEFAULT_CONFIG, InputsSource } from './config'
import { AuctionConstraints } from './constraints'
import { DataProvider } from './data-provider/data-provider'
import { Debug } from './debug'
import { ineligibleValidatorAggDefaults, validatorAggDefaults } from './utils'

import type { DsSamConfig } from './config'
import type { SourceDataOverrides } from './data-provider/data-provider.dto'
import type {
  AggregatedData,
  AuctionValidator,
  AuctionData,
  ValidatorAuctionStake,
  AuctionResult,
  AuctionConstraintsConfig,
} from './types'

export const defaultDataProviderBuilder = (config: DsSamConfig) => new DataProvider({ ...config }, config.inputsSource)

export class DsSamSDK {
  readonly config: DsSamConfig
  private readonly debug: Debug
  private readonly dataProvider: DataProvider

  constructor(config: Partial<DsSamConfig> = {}, dataProviderBuilder = defaultDataProviderBuilder) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    DsSamSDK.validateConfig(this.config)
    this.dataProvider = dataProviderBuilder(this.config)
    this.debug = new Debug(new Set(this.config.debugVoteAccounts), this.config.logVerbosity)
  }

  private static validateConfig(config: DsSamConfig) {
    if (config.bondObligationSafetyMult < 1.0 || config.bondObligationSafetyMult > 2.0) {
      throw new Error(
        `Invalid config: bondObligationSafetyMult must be in interval [1.0, 2.0], got ${config.bondObligationSafetyMult}`,
      )
    }
    if (config.bidTooLowPenaltyPermittedDeviationPmpe < 0 || config.bidTooLowPenaltyPermittedDeviationPmpe > 1.0) {
      throw new Error(
        `Invalid config: bidTooLowPenaltyPermittedDeviationPmpe must be in interval [0.0, 1.0], got ${config.bidTooLowPenaltyPermittedDeviationPmpe}`,
      )
    }
  }

  getAuctionConstraints({ stakeAmounts }: AggregatedData, debug: Debug): AuctionConstraints {
    const { networkTotalSol, marinadeMndeTvlSol, marinadeSamTvlSol } = stakeAmounts
    const marinadeTotalTvlSol = marinadeMndeTvlSol + marinadeSamTvlSol
    const constraints: AuctionConstraintsConfig = {
      totalCountryStakeCapSol: networkTotalSol * this.config.maxNetworkStakeConcentrationPerCountryDec,
      totalAsoStakeCapSol: networkTotalSol * this.config.maxNetworkStakeConcentrationPerAsoDec,
      marinadeCountryStakeCapSol: marinadeTotalTvlSol * this.config.maxMarinadeStakeConcentrationPerCountryDec,
      marinadeAsoStakeCapSol: marinadeTotalTvlSol * this.config.maxMarinadeStakeConcentrationPerAsoDec,
      marinadeValidatorStakeCapSol: marinadeTotalTvlSol * this.config.maxMarinadeTvlSharePerValidatorDec,
      minBondBalanceSol: this.config.minBondBalanceSol,
      // if maxStakeWanted == null, disable the limit
      minMaxStakeWanted: this.config.minMaxStakeWanted ?? Infinity,
      minBondEpochs: this.config.minBondEpochs,
      idealBondEpochs: this.config.idealBondEpochs,
      unprotectedValidatorStakeCapSol: marinadeTotalTvlSol * this.config.maxUnprotectedStakePerValidatorDec,
      minUnprotectedStakeToDelegateSol: this.config.minUnprotectedStakeToDelegateSol,
      unprotectedFoundationStakeDec: this.config.unprotectedFoundationStakeDec,
      unprotectedDelegatedStakeDec: this.config.unprotectedDelegatedStakeDec,
      bondObligationSafetyMult: this.config.bondObligationSafetyMult,
    }
    this.debug.pushInfo('auction constraints', JSON.stringify(constraints))
    return new AuctionConstraints(constraints, debug)
  }

  transformValidators({ validators, rewards, blacklist }: AggregatedData): AuctionValidator[] {
    let maxEpoch = 0
    const epochsTotals = validators.reduce((totals, { epochStats }) => {
      epochStats.forEach(({ epoch, totalActivatedStake, voteCredits }) => {
        const currentTotal = totals.get(epoch) ?? {
          weightedCredits: new Decimal(0),
          weight: new Decimal(0),
        }
        totals.set(epoch, {
          weightedCredits: currentTotal.weightedCredits.add(totalActivatedStake.mul(voteCredits)),
          weight: currentTotal.weight.add(totalActivatedStake),
        })
        maxEpoch = Math.max(maxEpoch, epoch)
      })
      return totals
    }, new Map<number, { weightedCredits: Decimal; weight: Decimal }>())

    const epochCreditsThresholds = new Map<number, number>()
    const minEpoch = maxEpoch - this.config.validatorsUptimeEpochsCount + 1
    for (let epoch = minEpoch; epoch <= maxEpoch; epoch++) {
      const epochTotals = epochsTotals.get(epoch)
      if (!epochTotals) {
        throw new Error(`Validator credits data for epoch ${epoch} not available`)
      }
      const threshold = epochTotals.weightedCredits
        .div(epochTotals.weight)
        .mul(this.config.validatorsUptimeThresholdDec)
        .toNumber()
      epochCreditsThresholds.set(epoch, threshold)
    }

    const minEffectiveRevSharePmpe = Math.max(
      0,
      rewards.inflationPmpe * (1 - this.config.validatorsMaxEffectiveCommissionDec),
    )
    const minSamRevSharePmpe = Math.max(
      0,
      rewards.inflationPmpe + rewards.mevPmpe + rewards.blockPmpe + (this.config.minEligibleFeePmpe ?? -Infinity),
    )
    this.debug.log('min rev share PMPE', minEffectiveRevSharePmpe)
    this.debug.log('rewards', rewards)
    this.debug.log('uptime thresholds', epochCreditsThresholds)
    this.debug.pushInfo('min effective rev share', minEffectiveRevSharePmpe.toString())
    this.debug.pushInfo('estimated rewards', JSON.stringify(rewards))

    return validators.map((validator): AuctionValidator => {
      const revShare = calcValidatorRevShare(validator, rewards, this.debug)
      this.debug.pushValidatorInfo(validator.voteAccount, 'revenue share', JSON.stringify(revShare))
      const auctionStake: ValidatorAuctionStake = {
        externalActivatedSol: validator.totalActivatedStakeSol - validator.marinadeActivatedStakeSol,
        marinadeMndeTargetSol: 0,
        marinadeSamTargetSol: 0,
      }
      if (blacklist.has(validator.voteAccount)) {
        return {
          ...validator,
          revShare,
          auctionStake,
          ...ineligibleValidatorAggDefaults(),
        }
      }
      if (!semver.satisfies(validator.clientVersion, this.config.validatorsClientVersionSemverExpr)) {
        return {
          ...validator,
          revShare,
          auctionStake,
          ...ineligibleValidatorAggDefaults(),
        }
      }
      for (let epoch = minEpoch; epoch <= maxEpoch; epoch++) {
        const es = validator.epochStats.find(es => es.epoch === epoch)
        const threshold = epochCreditsThresholds.get(epoch)
        if (!es || !threshold || es.voteCredits < threshold) {
          return {
            ...validator,
            revShare,
            auctionStake,
            ...ineligibleValidatorAggDefaults(),
          }
        }
      }
      const zeroCommissionPmpe = Math.max(0, rewards.inflationPmpe + rewards.mevPmpe)
      const backstopEligible =
        this.config.enableZeroCommissionBackstop &&
        revShare.inflationPmpe + revShare.mevPmpe + revShare.blockPmpe >= zeroCommissionPmpe
      if (validator.bondBalanceSol === null) {
        return {
          ...validator,
          revShare,
          auctionStake,
          ...ineligibleValidatorAggDefaults(),
          backstopEligible,
        }
      }
      const samEligible = revShare.totalPmpe >= Math.max(minEffectiveRevSharePmpe, minSamRevSharePmpe)
      const mndeEligible = revShare.inflationPmpe + revShare.mevPmpe + revShare.blockPmpe >= minEffectiveRevSharePmpe

      return {
        ...validator,
        revShare,
        auctionStake,
        samEligible,
        mndeEligible,
        backstopEligible,
        ...validatorAggDefaults(),
      }
    })
  }

  async auction(dataOverrides: SourceDataOverrides | null = null): Promise<Auction> {
    const aggregatedData = await this.getAggregatedData(dataOverrides)
    const constraints = this.getAuctionConstraints(aggregatedData, this.debug)
    const auctionData: AuctionData = {
      ...aggregatedData,
      validators: this.transformValidators(aggregatedData),
    }
    return new Auction(auctionData, constraints, this.config, this.debug)
  }

  async run(dataOverrides: SourceDataOverrides | null = null): Promise<AuctionResult> {
    const auction = await this.auction(dataOverrides)
    const result = auction.evaluate()
    this.debug.printDebugContent()
    return result
  }

  /**
   * @deprecated Use `run` method instead. Was removed when reputation was taken out of the flow.
   */
  async runFinalOnly(dataOverrides: SourceDataOverrides | null = null): Promise<AuctionResult> {
    return this.run(dataOverrides)
  }

  async getAggregatedData(dataOverrides: SourceDataOverrides | null = null): Promise<AggregatedData> {
    const sourceData =
      this.config.inputsSource === InputsSource.FILES
        ? this.dataProvider.parseCachedSourceData()
        : await this.dataProvider.fetchSourceData()
    return this.dataProvider.aggregateData(sourceData, dataOverrides)
  }
}

/**
 * An SDK utility class method to load the DS-SAM config from the default remote location.
 * This can be used from various 3rd party scripts/tools when a local config file is not available.
 */
export async function loadSamConfig(): Promise<DsSamConfig> {
  const url = 'https://thru.marinade.finance/marinade-finance/ds-sam-pipeline/main/auction-config.json'
  const response = await fetch(url)
  const dataJson = (await response.json()) as DsSamConfig
  return dataJson
}
