import { finite, LAMPORTS_PER_SOL } from '@marinade.finance/ds-sam-calc'
import { lamportsToSol } from '@marinade.finance/ts-common'

import type { EpochRewards, ProtectedEvent, SettlementMeta, ValidatorEpochStats, ValidatorWithEpochs } from './types'

export type LowCreditsSettlementConfig = {
  meta: SettlementMeta
  min_settlement_lamports: number
  grace_low_credits_bps: number
  covered_range_bps: [number, number]
}

export type CommissionIncreaseSettlementConfig = {
  meta: SettlementMeta
  min_settlement_lamports: number
  grace_commission_increase: number
  covered_range_bps: [number, number]
}

export const LOW_CREDITS_SETTLEMENT_CONFIGS: readonly LowCreditsSettlementConfig[] = [
  {
    meta: { funder: 'ValidatorBond' },
    min_settlement_lamports: 100_000_000,
    grace_low_credits_bps: 100,
    covered_range_bps: [0, 2000],
  },
  {
    meta: { funder: 'Marinade' },
    min_settlement_lamports: 100_000_000,
    grace_low_credits_bps: 100,
    covered_range_bps: [2000, 10000],
  },
]

export const COMMISSION_INCREASE_SETTLEMENT_CONFIGS: readonly CommissionIncreaseSettlementConfig[] = [
  {
    meta: { funder: 'ValidatorBond' },
    min_settlement_lamports: 100_000_000,
    grace_commission_increase: 1,
    covered_range_bps: [0, 10000],
  },
]

export type EprCalculator = (commission: number) => number

const bpsToFraction = (bps: number) => bps / 1e4

const solOf = (lamports: string) => Number(lamportsToSol(lamports))

const marinadeStakeSol = (epochStat: ValidatorEpochStats) =>
  solOf(epochStat.marinade_native_stake) + solOf(epochStat.marinade_stake)

export const claimAmountInLossRange = (
  coveredRangeBps: [number, number],
  actualEpr: number,
  expectedEpr: number,
  stake: number,
): number => {
  const [lowerBps, upperBps] = coveredRangeBps

  const maxClaimPerStake = bpsToFraction(upperBps) * expectedEpr
  const ignoredClaimPerStake = bpsToFraction(lowerBps) * expectedEpr
  const claimPerStake = Math.min(expectedEpr - actualEpr, maxClaimPerStake) - ignoredClaimPerStake

  return finite(Math.max(stake * claimPerStake, 0))
}

export const calcStakeByEpoch = (validators: ValidatorWithEpochs[]): Map<number, number> => {
  const result: Map<number, number> = new Map()

  for (const validator of validators) {
    for (const epochStat of validator.epoch_stats) {
      const stake = result.get(epochStat.epoch) ?? 0
      result.set(epochStat.epoch, stake + solOf(epochStat.activated_stake))
    }
  }

  return result
}

export const calcTargetCreditsByEpoch = (validators: ValidatorWithEpochs[]): Map<number, number> => {
  const sumOfWeightedCreditsPerEpoch: Map<number, number> = new Map()
  const sumOfWeightsPerEpoch: Map<number, number> = new Map()

  for (const validator of validators) {
    for (const epochStat of validator.epoch_stats) {
      const stake = solOf(epochStat.activated_stake)
      const prevSumOfWeightedCredits = sumOfWeightedCreditsPerEpoch.get(epochStat.epoch) ?? 0
      sumOfWeightedCreditsPerEpoch.set(epochStat.epoch, prevSumOfWeightedCredits + epochStat.credits * stake)

      const prevSumOfWeights = sumOfWeightsPerEpoch.get(epochStat.epoch) ?? 0
      sumOfWeightsPerEpoch.set(epochStat.epoch, prevSumOfWeights + stake)
    }
  }

  const result: Map<number, number> = new Map()
  for (const [epoch, sumOfWeights] of sumOfWeightsPerEpoch) {
    if (sumOfWeights <= 0) continue
    result.set(epoch, Math.round((sumOfWeightedCreditsPerEpoch.get(epoch) ?? 0) / sumOfWeights))
  }
  return result
}

const buildLowCreditsProtectedEvent = (
  config: LowCreditsSettlementConfig,
  eprCalculator: EprCalculator,
  targetCredits: number,
  validator: ValidatorWithEpochs,
  epochStat: ValidatorEpochStats,
): ProtectedEvent | null => {
  if (epochStat.credits > targetCredits) {
    return null
  }

  const expectedEpr = eprCalculator(epochStat.commission_advertised)
  const actualEpr = eprCalculator(epochStat.commission_advertised) * (epochStat.credits / targetCredits)

  const marinadeStake = marinadeStakeSol(epochStat)
  if (marinadeStake === 0) {
    return null
  }

  const expectedRewards = marinadeStake * expectedEpr
  const actualRewards = marinadeStake * actualEpr
  if (expectedRewards <= 0) {
    return null
  }

  const eprLossBps = Math.round(10000 * (1 - actualRewards / expectedRewards))
  if (eprLossBps <= config.grace_low_credits_bps) {
    return null
  }

  const amountSol = claimAmountInLossRange(config.covered_range_bps, actualEpr, expectedEpr, marinadeStake)
  if (LAMPORTS_PER_SOL * amountSol < config.min_settlement_lamports) {
    return null
  }

  return {
    epoch: epochStat.epoch,
    amount: Math.round(LAMPORTS_PER_SOL * amountSol),
    vote_account: validator.vote_account,
    meta: config.meta,
    reason: {
      ProtectedEvent: {
        LowCredits: {
          vote_account: validator.vote_account,
          expected_credits: targetCredits,
          actual_credits: epochStat.credits,
          commission: epochStat.commission_advertised,
          expected_epr: expectedEpr,
          actual_epr: actualEpr,
          epr_loss_bps: eprLossBps,
          stake: Number(epochStat.activated_stake),
        },
      },
    },
  }
}

const buildCommissionIncreaseProtectedEvent = (
  config: CommissionIncreaseSettlementConfig,
  eprCalculator: EprCalculator,
  validator: ValidatorWithEpochs,
  prevEpochStat: ValidatorEpochStats,
  epochStat: ValidatorEpochStats,
): ProtectedEvent | null => {
  if (epochStat.commission_advertised - prevEpochStat.commission_advertised <= config.grace_commission_increase) {
    return null
  }

  const expectedEpr = eprCalculator(prevEpochStat.commission_advertised)
  const actualEpr = eprCalculator(epochStat.commission_advertised)

  const marinadeStake = marinadeStakeSol(epochStat)
  if (marinadeStake === 0) {
    return null
  }

  const expectedRewards = marinadeStake * expectedEpr
  const actualRewards = marinadeStake * actualEpr
  if (expectedRewards <= 0) {
    return null
  }

  const eprLossBps = Math.round(10000 * (1 - actualRewards / expectedRewards))
  if (eprLossBps < config.grace_commission_increase * 100) {
    return null
  }

  const amountSol = claimAmountInLossRange(config.covered_range_bps, actualEpr, expectedEpr, marinadeStake)
  if (LAMPORTS_PER_SOL * amountSol < config.min_settlement_lamports) {
    return null
  }

  return {
    epoch: epochStat.epoch,
    amount: Math.round(LAMPORTS_PER_SOL * amountSol),
    vote_account: validator.vote_account,
    meta: config.meta,
    reason: {
      ProtectedEvent: {
        CommissionIncrease: {
          vote_account: validator.vote_account,
          previous_commission: prevEpochStat.commission_advertised,
          current_commission: epochStat.commission_advertised,
          expected_epr: expectedEpr,
          actual_epr: actualEpr,
          epr_loss_bps: eprLossBps,
          stake: Number(epochStat.activated_stake),
        },
      },
    },
  }
}

export const calculateLowCreditsEstimates = (
  validators: ValidatorWithEpochs[],
  eprCalculators: Map<number, EprCalculator>,
): ProtectedEvent[] => {
  const events: ProtectedEvent[] = []
  const targetCreditsByEpoch = calcTargetCreditsByEpoch(validators)

  for (const validator of validators) {
    for (const epochStat of validator.epoch_stats) {
      const targetCredits = targetCreditsByEpoch.get(epochStat.epoch)
      const eprCalculator = eprCalculators.get(epochStat.epoch)
      if (eprCalculator && targetCredits !== undefined) {
        for (const config of LOW_CREDITS_SETTLEMENT_CONFIGS) {
          const event = buildLowCreditsProtectedEvent(config, eprCalculator, targetCredits, validator, epochStat)
          if (event) {
            events.push(event)
          }
        }
      }
    }
  }

  return events
}

export const calculateCommissionIncreaseEstimates = (
  validators: ValidatorWithEpochs[],
  eprCalculators: Map<number, EprCalculator>,
): ProtectedEvent[] => {
  const events: ProtectedEvent[] = []

  for (const validator of validators) {
    for (const epochStat of validator.epoch_stats) {
      const previousEpochStats = validator.epoch_stats.find(
        someEpochStat => epochStat.epoch === someEpochStat.epoch + 1,
      )
      const eprCalculator = eprCalculators.get(epochStat.epoch)
      if (previousEpochStats && eprCalculator) {
        for (const config of COMMISSION_INCREASE_SETTLEMENT_CONFIGS) {
          const event = buildCommissionIncreaseProtectedEvent(
            config,
            eprCalculator,
            validator,
            previousEpochStats,
            epochStat,
          )
          if (event) {
            events.push(event)
          }
        }
      }
    }
  }

  return events
}

// The epoch after the newest rewards entry reuses that entry's rewards; `<=` keeps it order-independent.
export const buildEprCalculators = (
  stakeByEpoch: Map<number, number>,
  rewards: EpochRewards[],
): Map<number, EprCalculator> => {
  const result: Map<number, EprCalculator> = new Map()
  const currentEpochRewardsEstimate = rewards.reduce<[number, number]>(
    ([accEpoch, accRewards], [epoch, epochRewards]) =>
      accEpoch <= epoch ? [epoch + 1, epochRewards] : [accEpoch, accRewards],
    [0, 0],
  )
  for (const [epoch, epochRewards] of [...rewards, currentEpochRewardsEstimate]) {
    const epochStake = stakeByEpoch.get(epoch) ?? 0
    if (epochStake > 0) {
      result.set(epoch, (commission: number) => ((epochRewards / epochStake) * (100 - commission)) / 100)
    }
  }
  return result
}

export const calculateProtectedEventEstimates = (
  validators: ValidatorWithEpochs[],
  rewardsInflationEst: EpochRewards[],
): ProtectedEvent[] => {
  const stakeByEpoch = calcStakeByEpoch(validators)
  const eprCalculators = buildEprCalculators(stakeByEpoch, rewardsInflationEst)

  return [
    ...calculateLowCreditsEstimates(validators, eprCalculators),
    ...calculateCommissionIncreaseEstimates(validators, eprCalculators),
  ]
}
