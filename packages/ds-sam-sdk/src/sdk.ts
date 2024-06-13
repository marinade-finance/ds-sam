import { DEFAULT_CONFIG, DsSamConfig } from './config'
import { DataProvider } from './data-provider/data-provider'
import { AggregatedData, AuctionValidator, AuctionData } from './types'
import semver from 'semver'
import Decimal from 'decimal.js'
import { Auction } from './auction'
import { calcValidatorRevShare, zeroEligibilityAndTargetStake } from './utils'
import { AuctionConstraints } from './constraints'

export class DsSamSDK {
  readonly config: DsSamConfig
  private readonly dataProvider: DataProvider

  constructor (config: Partial<DsSamConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.dataProvider = new DataProvider({ ...this.config }, this.config.inputsSource)
  }

  getAuctionConstraints ({ stakeAmounts }: AggregatedData): AuctionConstraints {
    return new AuctionConstraints({
      mndeDirectedStakeSol: stakeAmounts.marinadeTvlSol * this.config.mndeDirectedStakeShareDec,
      totalCountryStakeCapSol: stakeAmounts.totalSol * this.config.maxNetworkStakeConcentrationPerCountryDec,
      totalAsoStakeCapSol: stakeAmounts.totalSol * this.config.maxNetworkStakeConcentrationPerAsoDec,
      marinadeCountryStakeCapSol: stakeAmounts.marinadeTvlSol * this.config.maxMarinadeStakeConcentrationPerCountryDec,
      marinadeAsoStakeCapSol: stakeAmounts.marinadeTvlSol * this.config.maxMarinadeStakeConcentrationPerAsoDec,
      marinadeValidatorStakeCapSol: stakeAmounts.marinadeTvlSol * this.config.maxMarinadeTvlSharePerValidatorDec,
    })
  }

  transformValidators ({ validators, rewards, blacklist }: AggregatedData): AuctionValidator[] {
    let maxEpoch = 0
    const epochsTotals = validators.reduce((totals, { epochStats }) => {
      epochStats.forEach(({ epoch, totalActivatedStake, voteCredits }) => {
        const currentTotal = totals.get(epoch) ?? { weightedCredits: new Decimal(0), weight: new Decimal(0) }
        totals.set(epoch, {
          weightedCredits: currentTotal.weightedCredits.add(totalActivatedStake.mul(voteCredits)),
          weight: currentTotal.weight.add(totalActivatedStake)
        })
        maxEpoch = Math.max(maxEpoch, epoch)
      })
      return totals
    }, new Map<number, { weightedCredits: Decimal, weight: Decimal }>())

    const epochCreditsThresholds = new Map<number, number>()
    const minEpoch = maxEpoch - this.config.validatorsUptimeEpochsCount + 1
    for (let epoch = minEpoch; epoch <= maxEpoch; epoch++) {
      const epochTotals = epochsTotals.get(epoch)
      if (!epochTotals) {
        throw new Error(`Validator credits data for epoch ${epoch} not available`)
      }
      const threshold = epochTotals.weightedCredits.div(epochTotals.weight).mul(this.config.validatorsUptimeThreshold).toNumber()
      epochCreditsThresholds.set(epoch, threshold)
    }

    const minEffectiveRevSharePmpe = Math.max(0, rewards.inflationPmpe * (1 - this.config.validatorsMaxEffectiveCommissionDec))
    console.log('min rev share PMPE', minEffectiveRevSharePmpe)
    console.log('rewards', rewards)
    console.log('uptime thresholds', epochCreditsThresholds)

    return validators.map((validator): AuctionValidator => {
      const revShare = calcValidatorRevShare(validator, rewards)

      if (blacklist.has(validator.voteAccount)) {
        return { ...validator, revShare, ...zeroEligibilityAndTargetStake() }
      }
      if (!semver.satisfies(validator.clientVersion, this.config.validatorsClientVersionSemverExpr)) {
        return { ...validator, revShare, ...zeroEligibilityAndTargetStake() }
      }
      for (let epoch = minEpoch; epoch <= maxEpoch; epoch++) {
        const es = validator.epochStats.find(es => es.epoch === epoch)
        const threshold = epochCreditsThresholds.get(epoch)
        if (!es || !threshold || es.voteCredits < threshold) {
          return { ...validator, revShare, ...zeroEligibilityAndTargetStake() }
        }
      }
      if (!validator.bondBalance) {
        return { ...validator, revShare, ...zeroEligibilityAndTargetStake() }
      }
      const samEligible = revShare.totalPmpe >= minEffectiveRevSharePmpe
      const mndeEligible = revShare.inflationPmpe + revShare.mevPmpe >= minEffectiveRevSharePmpe

      return { ...validator, revShare, samEligible, mndeEligible, marinadeTargetStake: 0 }
    })
  }

  async dummy () {
    // const sourceData = await this.dataProvider.fetchSourceData()
    // this.dataProvider.cacheSourceData(sourceData)
    const sourceData = this.dataProvider.parseCachedSourceData()
    const aggregatedData = this.dataProvider.aggregateData(sourceData)
    const constraints = this.getAuctionConstraints(aggregatedData)

    const auctionData: AuctionData = { ...aggregatedData, validators: this.transformValidators(aggregatedData) }
    const auction = new Auction(auctionData, constraints)
    return auction.evaluate()
  }
}
