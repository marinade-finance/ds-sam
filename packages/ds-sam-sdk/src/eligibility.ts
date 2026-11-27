import { epochUptimes, isInflationCommissionUnresolved, passesUptime } from '@marinade.finance/ds-sam-calc'
import semver from 'semver'

import type {
  AggregatedData,
  AggregatedValidator,
  DsSamConfig,
  EpochUptime,
  Rewards,
  RevShare,
  SamIneligibilityGate,
} from '@marinade.finance/ds-sam-calc'

export type { SamIneligibilityGate }

export type SamEligibilityThresholds = {
  uptimeEpochs: EpochUptime[]
  minEffectiveRevSharePmpe: number
  minSamRevSharePmpe: number
}

export const computeSamEligibilityThresholds = (
  { validators, rewards }: Pick<AggregatedData, 'validators' | 'rewards'>,
  config: DsSamConfig,
): SamEligibilityThresholds => {
  const maxEpoch = validators.reduce(
    (max, { epochStats }) => epochStats.reduce((m, { epoch }) => Math.max(m, epoch), max),
    0,
  )
  const minEpoch = maxEpoch - config.validatorsUptimeEpochsCount + 1
  const uptimeEpochs = epochUptimes(validators, minEpoch, maxEpoch, config.validatorsUptimeThresholdDec)

  const minEffectiveRevSharePmpe = Math.max(0, rewards.inflationPmpe * (1 - config.validatorsMaxEffectiveCommissionDec))
  const minSamRevSharePmpe = Math.max(
    0,
    rewards.inflationPmpe + rewards.mevPmpe + (config.minEligibleFeePmpe ?? -Infinity),
  )

  return { uptimeEpochs, minEffectiveRevSharePmpe, minSamRevSharePmpe }
}

/** Every gate that refuses the validator, in gate order; empty when none does. */
export const samIneligibilityGates = (
  validator: AggregatedValidator,
  blacklist: Set<string>,
  thresholds: SamEligibilityThresholds,
  config: DsSamConfig,
): Exclude<SamIneligibilityGate, 'revShareBelowFloor'>[] => {
  const gates: Exclude<SamIneligibilityGate, 'revShareBelowFloor'>[] = []
  if (blacklist.has(validator.voteAccount)) {
    gates.push('blacklist')
  }
  if (
    !semver.satisfies(validator.clientVersion, config.validatorsClientVersionSemverExpr, {
      includePrerelease: true,
    })
  ) {
    gates.push('clientVersion')
  }
  if (!passesUptime(validator, thresholds.uptimeEpochs, config.validatorsUptimeThresholdDec)) {
    gates.push('uptime')
  }
  if (isInflationCommissionUnresolved(validator.values.commissions)) {
    gates.push('unresolvedCommission')
  }
  if (validator.vatEligible === false) {
    gates.push('vatIneligible')
  }
  if (validator.bondBalanceSol === null || validator.bondBalanceSol <= config.noBondBalanceSol) {
    gates.push('noBond')
  }
  return gates
}

export const samIneligibilityGate = (
  validator: AggregatedValidator,
  blacklist: Set<string>,
  thresholds: SamEligibilityThresholds,
  config: DsSamConfig,
): Exclude<SamIneligibilityGate, 'revShareBelowFloor'> | null =>
  samIneligibilityGates(validator, blacklist, thresholds, config)[0] ?? null

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
