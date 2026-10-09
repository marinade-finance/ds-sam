import Decimal from 'decimal.js'

import { calculateProtectedEventEstimates } from '../src'

import type {
  CommissionSamIncreaseSettlementConfig,
  DowntimeRevenueImpactSettlementConfig,
  PsrValidatorMeta,
  SettlementConfig,
} from '../src'
import type { PastValidatorCommissions, RevenueValidatorInput } from '@marinade.finance/ds-sam-calc'

const STAKE = 100_000_000_000n // 100 SOL, the stake of the validator-bonds generators tests.rs vectors

const downtimeConfig = (
  overrides: Partial<DowntimeRevenueImpactSettlementConfig> = {},
): DowntimeRevenueImpactSettlementConfig => ({
  type: 'DowntimeRevenueImpactSettlement',
  meta: { funder: 'ValidatorBond' },
  min_settlement_lamports: 0,
  grace_downtime_bps: null,
  covered_range_bps: [0, 5000],
  ...overrides,
})

const commissionConfig = (
  overrides: Partial<CommissionSamIncreaseSettlementConfig> = {},
): CommissionSamIncreaseSettlementConfig => ({
  type: 'CommissionSamIncreaseSettlement',
  meta: { funder: 'ValidatorBond' },
  min_settlement_lamports: 0,
  grace_increase_bps: null,
  covered_range_bps: [0, 10000],
  extra_penalty_threshold_bps: 5000,
  base_markup_bps: 1000,
  penalty_markup_bps: 2000,
  ...overrides,
})

const meta = (
  vote_account: string,
  credits: bigint | null,
  overrides: Partial<PsrValidatorMeta> = {},
): PsrValidatorMeta => ({
  vote_account,
  commission: 5,
  stake: STAKE,
  credits,
  vote_reward_lamports: null,
  leader_slots: 0n,
  ...overrides,
})

const WINNING_TOTAL_PMPE = 2
const REWARDS = { inflationPmpe: 1, mevPmpe: 0.25 }
const PAST: PastValidatorCommissions = { inflation: 0.03, mev: 0.03 }

// all non-bid PMPE sits in inflationPmpe, so expected/actual non-bid PMPE are the literal nonBidPmpe values
const validator = (
  voteAccount: string,
  {
    nonBidPmpe = 1,
    totalPmpe = WINNING_TOTAL_PMPE,
    ...overrides
  }: Partial<RevenueValidatorInput> & {
    nonBidPmpe?: number
    totalPmpe?: number
  } = {},
): RevenueValidatorInput => ({
  voteAccount,
  inflationCommissionDec: 0.05,
  mevCommissionDec: 0.05,
  maxStakeWanted: null,
  revShare: { inflationPmpe: nonBidPmpe, mevPmpe: 0, totalPmpe, auctionEffectiveBidPmpe: 0 },
  ...overrides,
})

// a winner at SAM time, so the past commissions only fill the payload
const revenue = (before: RevenueValidatorInput[], after: RevenueValidatorInput[] = before) => ({
  samRun: { winningTotalPmpe: WINNING_TOTAL_PMPE, validators: before },
  currentValidators: after,
  pastCommissions: new Map(before.map(v => [v.voteAccount, PAST])),
  rewards: REWARDS,
})

// 'down' earns 5000 credits against a stake-weighted mean of 10000, so uptime is 0.5
const downtimeInput = (settlementConfigs: SettlementConfig[], marinadeStake = STAKE) => ({
  epoch: 100,
  validatorMetas: [meta('down', 5000n), meta('peer', 15000n)],
  ...revenue([validator('down'), validator('peer')]),
  marinadeStakeLamports: new Map([['down', marinadeStake]]),
  settlementConfigs,
})

describe('calculateProtectedEventEstimates — DowntimeRevenueImpact', () => {
  it('matches validator-bonds test_generate_psr_downtime_basic (50_000_000 lamports)', () => {
    const [event, ...rest] = calculateProtectedEventEstimates(downtimeInput([downtimeConfig()]))
    expect(rest).toEqual([])
    expect(event).toEqual({
      epoch: 100,
      amount: 50_000_000,
      vote_account: 'down',
      meta: { funder: 'ValidatorBond' },
      reason: {
        ProtectedEvent: {
          DowntimeRevenueImpact: {
            vote_account: 'down',
            actual_credits: 5000,
            expected_credits: 10000,
            expected_epr: 0.001,
            actual_epr: 0.0005,
            epr_loss_bps: 5000,
            stake: 100_000_000_000,
          },
        },
      },
    })
  })

  it('matches test_generate_psr_downtime_below_grace_period: 50 bps loss under 100 bps grace is not settled', () => {
    const input = {
      ...downtimeInput([downtimeConfig({ grace_downtime_bps: 100 })]),
      validatorMetas: [meta('down', 9950n), meta('peer', 10050n)],
    }
    expect(calculateProtectedEventEstimates(input)).toEqual([])
  })

  it('matches test_generate_psr_downtime_below_min_settlement: 50_000 lamports under a 100_000 minimum', () => {
    const input = downtimeInput([downtimeConfig({ min_settlement_lamports: 100_000 })], 100_000_000n)
    expect(calculateProtectedEventEstimates(input)).toEqual([])
  })

  it('floors expected credits like the u128 integer division', () => {
    // (1 * 1 + 2 * 2) / 3 floors to 1, so credits 1 is not below expected
    const input = {
      ...downtimeInput([downtimeConfig()]),
      validatorMetas: [meta('down', 1n, { stake: 1n }), meta('peer', 2n, { stake: 2n })],
    }
    expect(calculateProtectedEventEstimates(input)).toEqual([])
  })

  it('skips a 100% commission validator and one without a revenue expectation', () => {
    expect(
      calculateProtectedEventEstimates({
        ...downtimeInput([downtimeConfig()]),
        validatorMetas: [meta('down', 5000n, { commission: 100 }), meta('peer', 15000n)],
      }),
    ).toEqual([])
    expect(calculateProtectedEventEstimates({ ...downtimeInput([downtimeConfig()]), ...revenue([]) })).toEqual([])
  })

  it('settles nothing without Marinade stake', () => {
    const input = { ...downtimeInput([downtimeConfig()]), marinadeStakeLamports: new Map<string, bigint>() }
    expect(calculateProtectedEventEstimates(input)).toEqual([])
  })

  it('counts null credits in a Tower epoch as no vote', () => {
    const [event, ...rest] = calculateProtectedEventEstimates({
      ...downtimeInput([downtimeConfig()]),
      validatorMetas: [meta('down', null), meta('peer', 15000n)],
    })
    expect(rest).toEqual([])
    // full loss, capped by covered_range_bps [0, 5000]
    expect(event?.amount).toBe(50_000_000)
    expect(event?.reason).toMatchObject({
      ProtectedEvent: { DowntimeRevenueImpact: { actual_credits: 0, expected_credits: 7500, epr_loss_bps: 10000 } },
    })
  })

  it('estimates no downtime in the migration epoch or without vote data', () => {
    const migration = [meta('down', 5000n, { vote_reward_lamports: 0n }), meta('peer', 15000n)]
    const noData = [meta('down', null), meta('peer', null)]
    for (const validatorMetas of [migration, noData]) {
      expect(calculateProtectedEventEstimates({ ...downtimeInput([downtimeConfig()]), validatorMetas })).toEqual([])
    }
  })
})

const alpenglowMeta = (vote_account: string, voteReward: bigint | null, leaderSlots: bigint, stake = STAKE) =>
  meta(vote_account, null, { vote_reward_lamports: voteReward, leader_slots: leaderSlots, stake })

// validator-bonds alpenglow_collection: w = s/S + L/N gives A 1000, B 800, C 600 of Σcredits 2400
const ALPENGLOW_COLLECTION = [
  alpenglowMeta('A', 1000n, 3n),
  alpenglowMeta('B', 1000n, 2n),
  alpenglowMeta('C', 400n, 1n),
]

const alpenglowInput = (validatorMetas: PsrValidatorMeta[], marinadeStakeOf: string[]) => ({
  epoch: 100,
  validatorMetas,
  ...revenue(validatorMetas.map(({ vote_account }) => validator(vote_account))),
  marinadeStakeLamports: new Map(marinadeStakeOf.map(voteAccount => [voteAccount, STAKE])),
  settlementConfigs: [downtimeConfig()],
})

describe('calculateProtectedEventEstimates — Alpenglow DowntimeRevenueImpact', () => {
  it('matches validator-bonds alpenglow_collection: C earns 400 of the 600 it expects', () => {
    expect(calculateProtectedEventEstimates(alpenglowInput(ALPENGLOW_COLLECTION, ['A', 'B', 'C']))).toEqual([
      {
        epoch: 100,
        // a third of 0.001 epr on 100 SOL, under the 5000 bps cap
        amount: 33_333_333,
        vote_account: 'C',
        meta: { funder: 'ValidatorBond' },
        reason: {
          ProtectedEvent: {
            DowntimeRevenueImpact: {
              vote_account: 'C',
              actual_credits: 400,
              expected_credits: 600,
              expected_epr: 0.001,
              actual_epr: new Decimal(0.001).mul(400).div(600).toNumber(),
              epr_loss_bps: 3333,
              stake: 100_000_000_000,
            },
          },
        },
      },
    ])
  })

  it('skips a null vote reward and keeps it out of S and N', () => {
    const unknown = alpenglowMeta('D', null, 6n, 10n * STAKE)
    const events = calculateProtectedEventEstimates(alpenglowInput([...ALPENGLOW_COLLECTION, unknown], ['C', 'D']))
    expect(events.map(({ vote_account }) => vote_account)).toEqual(['C'])
    expect(events[0]?.reason).toMatchObject({
      ProtectedEvent: { DowntimeRevenueImpact: { actual_credits: 400, expected_credits: 600 } },
    })
  })

  it('charges a zero vote reward as a validator that cast no vote', () => {
    const silent = alpenglowMeta('E', 0n, 1n)
    const [event, ...rest] = calculateProtectedEventEstimates(alpenglowInput([...ALPENGLOW_COLLECTION, silent], ['E']))
    expect(rest).toEqual([])
    // full loss, capped by covered_range_bps [0, 5000]
    expect(event?.amount).toBe(50_000_000)
    expect(event?.reason).toMatchObject({
      ProtectedEvent: { DowntimeRevenueImpact: { vote_account: 'E', actual_credits: 0, epr_loss_bps: 10000 } },
    })
  })

  it('estimates no downtime before any vote reward or leader slot is in', () => {
    const validatorMetas = [alpenglowMeta('A', 0n, 0n), alpenglowMeta('B', 0n, 0n)]
    expect(calculateProtectedEventEstimates(alpenglowInput(validatorMetas, ['A', 'B']))).toEqual([])
  })

  it('still skips a 100% commission validator', () => {
    const validatorMetas = ALPENGLOW_COLLECTION.map(m => (m.vote_account === 'C' ? { ...m, commission: 100 } : m))
    expect(calculateProtectedEventEstimates(alpenglowInput(validatorMetas, ['A', 'B', 'C']))).toEqual([])
  })
})

const commissionInput = (
  after: Parameters<typeof validator>[1],
  settlementConfigs: SettlementConfig[],
  before = validator('rug'),
) => ({
  epoch: 100,
  validatorMetas: [meta('rug', 10000n)],
  ...revenue([before], [validator('rug', { nonBidPmpe: 0.8, ...after })]),
  marinadeStakeLamports: new Map([['rug', STAKE]]),
  settlementConfigs,
})

describe('calculateProtectedEventEstimates — CommissionSamIncrease', () => {
  it('matches validator-bonds test_generate_psr_commission_increase_basic (base markup, 22_000_000 lamports)', () => {
    const [event, ...rest] = calculateProtectedEventEstimates(commissionInput({}, [commissionConfig()]))
    expect(rest).toEqual([])
    expect(event).toEqual({
      epoch: 100,
      amount: 22_000_000,
      vote_account: 'rug',
      meta: { funder: 'ValidatorBond' },
      reason: {
        ProtectedEvent: {
          CommissionSamIncrease: {
            vote_account: 'rug',
            expected_inflation_commission: 0.05,
            actual_inflation_commission: 0.05,
            past_inflation_commission: 0.03,
            expected_mev_commission: 0.05,
            actual_mev_commission: 0.05,
            past_mev_commission: 0.03,
            before_sam_commission_increase_pmpe: 0,
            expected_epr: 0.001,
            actual_epr: 0.0008,
            epr_loss_bps: 2000,
            stake: 100_000_000_000,
          },
        },
      },
    })
  })

  it('applies the penalty markup when a commission exceeds the threshold', () => {
    const [event] = calculateProtectedEventEstimates(commissionInput({ mevCommissionDec: 0.6 }, [commissionConfig()]))
    expect(event?.amount).toBe(24_000_000)
  })

  it('adds the before-SAM commission increase to the expected PMPE', () => {
    // lost at SAM time with 0% past commissions: rewards 1 + 0.25 against the SAM-time 1 gives a 0.25 before-SAM increase
    const input = commissionInput({ nonBidPmpe: 1 }, [commissionConfig()], validator('rug', { totalPmpe: 1 }))
    const [event] = calculateProtectedEventEstimates({
      ...input,
      pastCommissions: new Map([['rug', { inflation: 0, mev: 0 }]]),
    })
    // expected_epr 0.00125, loss 0.00025 * 1.1 markup * 100 SOL
    expect(event?.amount).toBe(27_500_000)
  })

  it('emits nothing when actual non-bid PMPE is not below expected', () => {
    expect(calculateProtectedEventEstimates(commissionInput({ nonBidPmpe: 1 }, [commissionConfig()]))).toEqual([])
  })

  it('never matches a commission event against a downtime config', () => {
    expect(calculateProtectedEventEstimates(commissionInput({}, [downtimeConfig()]))).toEqual([])
  })

  it('still settles a commission increase in an Alpenglow epoch', () => {
    const [event, ...rest] = calculateProtectedEventEstimates({
      ...commissionInput({}, [commissionConfig()]),
      validatorMetas: [meta('rug', null, { vote_reward_lamports: 10000n })],
    })
    expect(rest).toEqual([])
    expect(event?.amount).toBe(22_000_000)
  })
})

describe('calculateProtectedEventEstimates — live settlement-config.yaml', () => {
  // validator-bonds settlement-config.yaml DowntimeRevenueImpactSettlement and CommissionSamIncreaseSettlement
  const LIVE: SettlementConfig[] = [
    downtimeConfig({ min_settlement_lamports: 100_000_000, grace_downtime_bps: 100, covered_range_bps: [0, 10000] }),
    commissionConfig({
      min_settlement_lamports: 10_000_000,
      grace_increase_bps: 100,
      extra_penalty_threshold_bps: 700,
      base_markup_bps: 0,
      penalty_markup_bps: 0,
    }),
  ]

  it('emits one settlement per matching config, in config order', () => {
    const events = calculateProtectedEventEstimates({
      epoch: 100,
      validatorMetas: [meta('down', 5000n), meta('peer', 15000n)],
      ...revenue([validator('down'), validator('peer')], [validator('down', { nonBidPmpe: 0.8 }), validator('peer')]),
      marinadeStakeLamports: new Map([['down', 10n * STAKE]]),
      settlementConfigs: LIVE,
    })
    // downtime uses actual non-bid PMPE: 0.0008 * 0.5 * 1000 SOL; commission: 0.0002 * 1000 SOL
    expect(
      events.map(e => [Object.keys((e.reason as { ProtectedEvent: object }).ProtectedEvent)[0], e.amount]),
    ).toEqual([
      ['DowntimeRevenueImpact', 400_000_000],
      ['CommissionSamIncrease', 200_000_000],
    ])
  })
})
