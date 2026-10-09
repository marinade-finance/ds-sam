import {
  calcValidatorRevShare,
  DEFAULT_CONFIG,
  EpochUptimeType,
  InputsSource,
  isInflationCommissionUnresolved,
  ineligibleValidatorAggDefaults,
  validatorAggDefaults,
} from '@marinade.finance/ds-sam-calc'

import { Auction } from './auction'
import { AuctionConstraints } from './constraints'
import { DataProvider } from './data-provider/data-provider'
import { Debug } from './debug'
import {
  computeSamEligibilityThresholds,
  isBackstopEligible,
  samIneligibilityGate,
  samPmpeThreshold,
} from './eligibility'
import { buildAuctionConstraintsConfig } from './engine-config'

import type { SourceDataOverrides } from './data-provider/data-provider.dto'
import type {
  DsSamConfig,
  AggregatedData,
  AuctionValidator,
  AuctionData,
  ValidatorAuctionStake,
  AuctionResult,
} from '@marinade.finance/ds-sam-calc'

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

  getAuctionConstraints(data: AggregatedData, debug: Debug): AuctionConstraints {
    const constraints = buildAuctionConstraintsConfig(this.config, data)
    this.debug.pushInfo('auction constraints', JSON.stringify(constraints))
    return new AuctionConstraints(constraints, debug)
  }

  transformValidators({ validators, rewards, blacklist }: AggregatedData): AuctionValidator[] {
    const thresholds = computeSamEligibilityThresholds({ validators, rewards }, this.config)
    this.debug.log('min rev share PMPE', thresholds.minEffectiveRevSharePmpe)
    this.debug.log('rewards', rewards)
    this.debug.log(
      'uptime epochs',
      thresholds.uptimeEpochs.map(e => (e.type === EpochUptimeType.ALPENGLOW ? { epoch: e.epoch, type: e.type } : e)),
    )
    this.debug.pushInfo('min effective rev share', thresholds.minEffectiveRevSharePmpe.toString())
    this.debug.pushInfo('estimated rewards', JSON.stringify(rewards))

    const unresolvedCommission = validators.filter(validator =>
      isInflationCommissionUnresolved(validator.values.commissions),
    )
    // Stake already delegated makes the bond obligation a real charge, and it cannot be derived without the rate
    const stakedUnresolvedCommission = unresolvedCommission.filter(
      ({ marinadeActivatedStakeSol }) => marinadeActivatedStakeSol > 0,
    )
    if (stakedUnresolvedCommission.length > 0) {
      throw new Error(
        `No resolvable on-chain inflation commission for ${stakedUnresolvedCommission.length} validator(s) holding Marinade stake: ` +
          stakedUnresolvedCommission
            .map(({ voteAccount, marinadeActivatedStakeSol }) => `${voteAccount} (${marinadeActivatedStakeSol} SOL)`)
            .join(', '),
      )
    }
    this.debug.pushInfo('validators with unresolved on-chain inflation commission', String(unresolvedCommission.length))

    return validators.map((validator): AuctionValidator => {
      const revShare = calcValidatorRevShare(validator, rewards, this.debug)
      this.debug.pushValidatorInfo(validator.voteAccount, 'revenue share', JSON.stringify(revShare))
      const auctionStake: ValidatorAuctionStake = {
        externalActivatedSol: validator.totalActivatedStakeSol - validator.marinadeActivatedStakeSol,
        marinadeSamTargetSol: 0,
      }
      const gate = samIneligibilityGate(validator, blacklist, thresholds, this.config)
      if (gate !== null && gate !== 'noBond') {
        return {
          ...validator,
          revShare,
          auctionStake,
          ...ineligibleValidatorAggDefaults(),
        }
      }
      const backstopEligible = isBackstopEligible(revShare, rewards, this.config)
      if (gate === 'noBond') {
        return {
          ...validator,
          revShare,
          auctionStake,
          ...ineligibleValidatorAggDefaults(),
          backstopEligible,
        }
      }
      const samEligible = revShare.totalPmpe >= samPmpeThreshold(thresholds)

      return {
        ...validator,
        revShare,
        auctionStake,
        samEligible,
        backstopEligible,
        ...validatorAggDefaults(),
      }
    })
  }

  // all three share objects Auction.evaluate() mutates, so clone before evaluating if you keep any
  async prepareAuctionData(dataOverrides: SourceDataOverrides | null = null): Promise<{
    aggregatedData: AggregatedData
    constraints: AuctionConstraints
    auctionData: AuctionData
  }> {
    const aggregatedData = await this.getAggregatedData(dataOverrides)
    const constraints = this.getAuctionConstraints(aggregatedData, this.debug)
    const auctionData: AuctionData = {
      ...aggregatedData,
      validators: this.transformValidators(aggregatedData),
    }
    return { aggregatedData, constraints, auctionData }
  }

  async auction(dataOverrides: SourceDataOverrides | null = null): Promise<Auction> {
    const { auctionData, constraints } = await this.prepareAuctionData(dataOverrides)
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
