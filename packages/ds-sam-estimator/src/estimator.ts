import { EpochUptimeType, evaluateRevenueExpectations, uptimeTypeOf } from '@marinade.finance/ds-sam-calc'
import { alpenglowExpectedCredits } from '@marinade.finance/ts-common/dist/src/browser'
import Decimal from 'decimal.js'

import type {
  ProtectedEvent,
  ProtectedEventCommissionSamIncrease,
  ProtectedEventDowntimeRevenueImpact,
  SettlementMeta,
} from './types'
import type {
  PastValidatorCommissions,
  RevenueExpectation,
  RevenueValidatorInput,
  Rewards,
} from '@marinade.finance/ds-sam-calc'

// validator-bonds protected_events.rs / psr_events.rs use rust_decimal: 28 significant digits, half-even
const Dec = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN })

// `settlements[]` entries of validator-bonds settlement-config.yaml
export type DowntimeRevenueImpactSettlementConfig = {
  type: 'DowntimeRevenueImpactSettlement'
  meta: SettlementMeta
  min_settlement_lamports: number
  grace_downtime_bps?: number | null
  covered_range_bps: [number, number]
}

export type CommissionSamIncreaseSettlementConfig = {
  type: 'CommissionSamIncreaseSettlement'
  meta: SettlementMeta
  min_settlement_lamports: number
  grace_increase_bps?: number | null
  covered_range_bps: [number, number]
  extra_penalty_threshold_bps: number
  base_markup_bps: number
  penalty_markup_bps: number
}

export type SettlementConfig = DowntimeRevenueImpactSettlementConfig | CommissionSamIncreaseSettlementConfig

// validator-bonds `ValidatorMeta`: `commission` is the on-chain percent, `stake` the validator's total activated lamports
export type PsrValidatorMeta = {
  vote_account: string
  commission: number
  stake: bigint
  credits: bigint | null
  vote_reward_lamports: bigint | null
  leader_slots: bigint
  // stake in the epoch's Alpenglow reward committee; null is not a member
  epoch_stake: bigint | null
}

export type ProtectedEventEstimatesInput = {
  epoch: number
  validatorMetas: PsrValidatorMeta[]
  // the epoch's SAM run, before any commission change after it
  samRun: { winningTotalPmpe: number; validators: RevenueValidatorInput[] }
  // current state, priced on the same rewards window as the SAM run
  currentValidators: RevenueValidatorInput[]
  // on-chain rates applied in the previous epoch
  pastCommissions: ReadonlyMap<string, PastValidatorCommissions>
  rewards: Pick<Rewards, 'inflationPmpe' | 'mevPmpe'>
  // voteAccount → Marinade stake lamports; stands in for the per-staker groups validator-bonds sums claims over
  marinadeStakeLamports: Map<string, bigint>
  settlementConfigs: readonly SettlementConfig[]
}

type PsrEvent =
  | {
      type: 'DowntimeRevenueImpactSettlement'
      expectedEpr: Decimal
      actualEpr: Decimal
      payload: ProtectedEventDowntimeRevenueImpact
    }
  | {
      type: 'CommissionSamIncreaseSettlement'
      expectedEpr: Decimal
      actualEpr: Decimal
      payload: ProtectedEventCommissionSamIncrease
    }

const bpsToFraction = (bps: number) => new Dec(bps).div(10000)

const commissionIncreaseEvents = (
  validatorMetas: PsrValidatorMeta[],
  expectations: Map<string, RevenueExpectation>,
): PsrEvent[] =>
  validatorMetas.flatMap((meta): PsrEvent[] => {
    const expectation = expectations.get(meta.vote_account)
    if (meta.stake <= 0n || !expectation) {
      return []
    }
    const expectedCommissionPmpe = new Dec(expectation.expectedNonBidPmpe).add(
      expectation.beforeSamCommissionIncreasePmpe,
    )
    const actualNonBidPmpe = new Dec(expectation.actualNonBidPmpe)
    if (!actualNonBidPmpe.lt(expectedCommissionPmpe)) {
      return []
    }
    const expectedEpr = expectedCommissionPmpe.div(1000)
    const actualEpr = actualNonBidPmpe.div(1000)
    const eprLossBps = new Dec(10000).mul(expectedCommissionPmpe.sub(actualNonBidPmpe)).div(expectedCommissionPmpe)
    return [
      {
        type: 'CommissionSamIncreaseSettlement',
        expectedEpr,
        actualEpr,
        payload: {
          vote_account: meta.vote_account,
          expected_inflation_commission: expectation.expectedInflationCommission,
          actual_inflation_commission: expectation.actualInflationCommission,
          past_inflation_commission: expectation.pastInflationCommission,
          expected_mev_commission: expectation.expectedMevCommission,
          actual_mev_commission: expectation.actualMevCommission,
          past_mev_commission: expectation.pastMevCommission,
          before_sam_commission_increase_pmpe: expectation.beforeSamCommissionIncreasePmpe,
          expected_epr: expectedEpr.toNumber(),
          actual_epr: actualEpr.toNumber(),
          epr_loss_bps: eprLossBps.trunc().toNumber(),
          stake: Number(meta.stake),
        },
      },
    ]
  })

type CreditsOutcome = { meta: PsrValidatorMeta; actual: bigint; expected: bigint }

const towerCredits = (validatorMetas: PsrValidatorMeta[]): CreditsOutcome[] => {
  const totalStake = validatorMetas.reduce((sum, { stake }) => sum + stake, 0n)
  if (totalStake === 0n) {
    return []
  }
  // validators-api writes null for a Tower validator that cast no vote
  const towerMetas = validatorMetas.map(meta => ({ meta, actual: meta.credits ?? 0n }))
  const expected = towerMetas.reduce((sum, { meta, actual }) => sum + actual * meta.stake, 0n) / totalStake
  return towerMetas.map(({ meta, actual }) => ({ meta, actual, expected }))
}

const alpenglowCredits = (validatorMetas: PsrValidatorMeta[]): CreditsOutcome[] => {
  // validator-bonds weighs only reward-committee members and counts a missing vote reward as 0
  const members = validatorMetas.flatMap(meta =>
    meta.epoch_stake == null ? [] : [{ meta, epochStake: meta.epoch_stake }],
  )
  const results = alpenglowExpectedCredits(
    members.map(({ meta, epochStake }) => ({
      voteAccount: meta.vote_account,
      stake: epochStake,
      leaderSlots: meta.leader_slots,
      credits: meta.vote_reward_lamports ?? 0n,
    })),
    {
      totalStake: members.reduce((sum, { epochStake }) => sum + epochStake, 0n),
      totalSlots: members.reduce((sum, { meta }) => sum + meta.leader_slots, 0n),
    },
  )
  return members.flatMap(({ meta }, i) => {
    const result = results[i]
    return result ? [{ meta, actual: result.actual, expected: result.expected }] : []
  })
}

const creditsOutcomes = (validatorMetas: PsrValidatorMeta[]): CreditsOutcome[] => {
  const epochType = uptimeTypeOf(
    validatorMetas.some(({ credits }) => credits != null),
    validatorMetas.some(({ vote_reward_lamports }) => vote_reward_lamports != null),
  )
  if (epochType === EpochUptimeType.TOWER) {
    return towerCredits(validatorMetas)
  }
  if (epochType === EpochUptimeType.ALPENGLOW) {
    return alpenglowCredits(validatorMetas)
  }
  // validator-bonds settles no downtime in the migration epoch
  return []
}

const downtimeRevenueImpactEvents = (
  validatorMetas: PsrValidatorMeta[],
  expectations: Map<string, RevenueExpectation>,
): PsrEvent[] =>
  creditsOutcomes(validatorMetas).flatMap(({ meta, actual, expected }): PsrEvent[] => {
    const expectation = expectations.get(meta.vote_account)
    if (meta.stake <= 0n || !expectation || actual >= expected || meta.commission >= 100) {
      return []
    }
    const uptime = new Dec(actual.toString()).div(expected.toString())
    const expectedEpr = new Dec(expectation.actualNonBidPmpe).div(1000)
    const actualEpr = new Dec(expectation.actualNonBidPmpe).div(1000).mul(uptime)
    return [
      {
        type: 'DowntimeRevenueImpactSettlement',
        expectedEpr,
        actualEpr,
        payload: {
          vote_account: meta.vote_account,
          actual_credits: Number(actual),
          expected_credits: Number(expected),
          expected_epr: expectedEpr.toNumber(),
          actual_epr: actualEpr.toNumber(),
          epr_loss_bps: Number((10000n * (expected - actual)) / expected),
          stake: Number(meta.stake),
        },
      },
    ]
  })

const graceBps = (config: SettlementConfig) =>
  (config.type === 'DowntimeRevenueImpactSettlement' ? config.grace_downtime_bps : config.grace_increase_bps) ?? 0

const claimPerStake = (event: PsrEvent, config: SettlementConfig): Decimal => {
  const base = event.expectedEpr.sub(event.actualEpr)
  if (event.type !== 'CommissionSamIncreaseSettlement' || config.type !== 'CommissionSamIncreaseSettlement') {
    return base
  }
  const threshold = bpsToFraction(config.extra_penalty_threshold_bps)
  const markup =
    new Dec(event.payload.actual_inflation_commission).lte(threshold) &&
    new Dec(event.payload.actual_mev_commission ?? 0).lte(threshold)
      ? config.base_markup_bps
      : config.penalty_markup_bps
  return base.add(base.mul(bpsToFraction(markup)))
}

const claimAmountInLossRange = (event: PsrEvent, config: SettlementConfig, stake: bigint): bigint => {
  const [lowerBps, upperBps] = config.covered_range_bps
  const maxClaimPerStake = bpsToFraction(upperBps).mul(event.expectedEpr)
  const ignoredClaimPerStake = bpsToFraction(lowerBps).mul(event.expectedEpr)
  const perStake = Dec.min(claimPerStake(event, config), maxClaimPerStake).sub(ignoredClaimPerStake)
  return BigInt(Dec.max(new Dec(stake.toString()).mul(perStake), 0).trunc().toFixed())
}

// Settlements validator-bonds would generate for the epoch; amounts are upper bounds, see `marinadeStakeLamports`.
export const calculateProtectedEventEstimates = ({
  epoch,
  validatorMetas,
  samRun,
  currentValidators,
  pastCommissions,
  rewards,
  marinadeStakeLamports,
  settlementConfigs,
}: ProtectedEventEstimatesInput): ProtectedEvent[] => {
  const revenueExpectations = evaluateRevenueExpectations(
    samRun.validators,
    currentValidators,
    samRun.winningTotalPmpe,
    pastCommissions,
    rewards,
  )
  const expectations = new Map(revenueExpectations.map(e => [e.voteAccount, e]))
  const events = [
    ...commissionIncreaseEvents(validatorMetas, expectations),
    ...downtimeRevenueImpactEvents(validatorMetas, expectations),
  ]
  return settlementConfigs.flatMap(config =>
    events
      .filter(event => event.type === config.type && event.payload.epr_loss_bps > graceBps(config))
      .flatMap((event): ProtectedEvent[] => {
        const amount = claimAmountInLossRange(
          event,
          config,
          marinadeStakeLamports.get(event.payload.vote_account) ?? 0n,
        )
        if (amount === 0n || amount < BigInt(config.min_settlement_lamports)) {
          return []
        }
        const reason =
          event.type === 'DowntimeRevenueImpactSettlement'
            ? { DowntimeRevenueImpact: event.payload }
            : { CommissionSamIncrease: event.payload }
        return [
          {
            epoch,
            amount: Number(amount),
            vote_account: event.payload.vote_account,
            meta: config.meta,
            reason: { ProtectedEvent: reason },
          },
        ]
      }),
  )
}
