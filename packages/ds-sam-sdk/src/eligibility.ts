import { epochUptimes, isInflationCommissionUnresolved, passesUptime } from '@marinade.finance/ds-sam-calc'
import semver from 'semver'

import type {
  AggregatedData,
  AggregatedValidator,
  DsSamConfig,
  EpochUptime,
  Rewards,
  RevShare,
} from '@marinade.finance/ds-sam-calc'

export type SamEligibilityThresholds = {
  uptimeEpochs: EpochUptime[]
  minEffectiveRevSharePmpe: number
  minSamRevSharePmpe: number
}

export type SamIneligibilityGate = 'blacklist' | 'clientVersion' | 'uptime' | 'unresolvedCommission' | 'noBond'

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
  if (!passesUptime(validator, thresholds.uptimeEpochs, config.validatorsUptimeThresholdDec)) {
    return 'uptime'
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
