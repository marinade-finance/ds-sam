import { isInflationCommissionUnresolved } from '@marinade.finance/ds-sam-calc'
import Decimal from 'decimal.js'
import semver from 'semver'

import type { AggregatedData, AggregatedValidator, DsSamConfig, Rewards, RevShare } from '@marinade.finance/ds-sam-calc'

export type SamEligibilityThresholds = {
  minEpoch: number
  maxEpoch: number
  epochCreditsThresholds: Map<number, number>
  minEffectiveRevSharePmpe: number
  minSamRevSharePmpe: number
}

export type SamIneligibilityGate = 'blacklist' | 'clientVersion' | 'uptime' | 'unresolvedCommission' | 'noBond'

export const computeSamEligibilityThresholds = (
  { validators, rewards }: Pick<AggregatedData, 'validators' | 'rewards'>,
  config: DsSamConfig,
): SamEligibilityThresholds => {
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
  const minEpoch = maxEpoch - config.validatorsUptimeEpochsCount + 1
  for (let epoch = minEpoch; epoch <= maxEpoch; epoch++) {
    const epochTotals = epochsTotals.get(epoch)
    if (!epochTotals) {
      throw new Error(`Validator credits data for epoch ${epoch} not available`)
    }
    const threshold = epochTotals.weightedCredits
      .div(epochTotals.weight)
      .mul(config.validatorsUptimeThresholdDec)
      .toNumber()
    epochCreditsThresholds.set(epoch, threshold)
  }

  const minEffectiveRevSharePmpe = Math.max(0, rewards.inflationPmpe * (1 - config.validatorsMaxEffectiveCommissionDec))
  const minSamRevSharePmpe = Math.max(
    0,
    rewards.inflationPmpe + rewards.mevPmpe + (config.minEligibleFeePmpe ?? -Infinity),
  )

  return { minEpoch, maxEpoch, epochCreditsThresholds, minEffectiveRevSharePmpe, minSamRevSharePmpe }
}

export const samIneligibilityGate = (
  validator: AggregatedValidator,
  blacklist: Set<string>,
  thresholds: SamEligibilityThresholds,
  config: DsSamConfig,
): SamIneligibilityGate | null => {
  if (blacklist.has(validator.voteAccount)) {
    return 'blacklist'
  }
  if (
    !semver.satisfies(validator.clientVersion, config.validatorsClientVersionSemverExpr, {
      includePrerelease: true,
    })
  ) {
    return 'clientVersion'
  }
  for (let epoch = thresholds.minEpoch; epoch <= thresholds.maxEpoch; epoch++) {
    const es = validator.epochStats.find(es => es.epoch === epoch)
    const threshold = thresholds.epochCreditsThresholds.get(epoch)
    if (!es || !threshold || es.voteCredits < threshold) {
      return 'uptime'
    }
  }
  if (isInflationCommissionUnresolved(validator.values.commissions)) {
    return 'unresolvedCommission'
  }
  if (validator.bondBalanceSol === null) {
    return 'noBond'
  }
  return null
}

export const samPmpeThreshold = (
  thresholds: Pick<SamEligibilityThresholds, 'minEffectiveRevSharePmpe' | 'minSamRevSharePmpe'>,
): number => Math.max(thresholds.minEffectiveRevSharePmpe, thresholds.minSamRevSharePmpe)

export const isBackstopEligible = (
  revShare: Pick<RevShare, 'inflationPmpe' | 'mevPmpe'>,
  rewards: Pick<Rewards, 'inflationPmpe' | 'mevPmpe'>,
  config: Pick<DsSamConfig, 'enableZeroCommissionBackstop'>,
): boolean => {
  // Block revenue is off both sides: it is shareable only through a bond, and the backstop admits bondless validators
  const zeroCommissionPmpe = Math.max(0, rewards.inflationPmpe + rewards.mevPmpe)
  return config.enableZeroCommissionBackstop && revShare.inflationPmpe + revShare.mevPmpe >= zeroCommissionPmpe
}
