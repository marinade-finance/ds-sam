import { calculateProtectedEventEstimates } from '../src'

import type {
  CommissionSamIncreaseSettlementConfig,
  DowntimeRevenueImpactSettlementConfig,
  PsrValidatorMeta,
  RevenueExpectation,
  SettlementConfig,
} from '../src'

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

const meta = (vote_account: string, credits: bigint, overrides: Partial<PsrValidatorMeta> = {}): PsrValidatorMeta => ({
  vote_account,
  commission: 5,
  stake: STAKE,
  credits,
  ...overrides,
})

const expectation = (voteAccount: string, overrides: Partial<RevenueExpectation> = {}): RevenueExpectation => ({
  voteAccount,
  expectedInflationCommission: 0.05,
  actualInflationCommission: 0.05,
  pastInflationCommission: 0.03,
  expectedMevCommission: 0.05,
  actualMevCommission: 0.05,
  pastMevCommission: 0.03,
  expectedNonBidPmpe: 1,
  actualNonBidPmpe: 1,
  beforeSamCommissionIncreasePmpe: 0,
  ...overrides,
})

// 'down' earns 5000 credits against a stake-weighted mean of 10000, so uptime is 0.5
const downtimeInput = (settlementConfigs: SettlementConfig[], marinadeStake = STAKE) => ({
  epoch: 100,
  validatorMetas: [meta('down', 5000n), meta('peer', 15000n)],
  revenueExpectations: [expectation('down'), expectation('peer')],
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
    expect(calculateProtectedEventEstimates({ ...downtimeInput([downtimeConfig()]), revenueExpectations: [] })).toEqual(
      [],
    )
  })

  it('settles nothing without Marinade stake', () => {
    const input = { ...downtimeInput([downtimeConfig()]), marinadeStakeLamports: new Map<string, bigint>() }
    expect(calculateProtectedEventEstimates(input)).toEqual([])
  })
})

const commissionInput = (actual: Partial<RevenueExpectation>, settlementConfigs: SettlementConfig[]) => ({
  epoch: 100,
  validatorMetas: [meta('rug', 10000n)],
  revenueExpectations: [expectation('rug', { actualNonBidPmpe: 0.8, ...actual })],
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
    const [event] = calculateProtectedEventEstimates(
      commissionInput({ actualMevCommission: 0.6 }, [commissionConfig()]),
    )
    expect(event?.amount).toBe(24_000_000)
  })

  it('adds the before-SAM commission increase to the expected PMPE', () => {
    const [event] = calculateProtectedEventEstimates(
      commissionInput({ actualNonBidPmpe: 1, beforeSamCommissionIncreasePmpe: 0.25 }, [commissionConfig()]),
    )
    // expected_epr 0.00125, loss 0.00025 * 1.1 markup * 100 SOL
    expect(event?.amount).toBe(27_500_000)
  })

  it('emits nothing when actual non-bid PMPE is not below expected', () => {
    expect(calculateProtectedEventEstimates(commissionInput({ actualNonBidPmpe: 1 }, [commissionConfig()]))).toEqual([])
  })

  it('never matches a commission event against a downtime config', () => {
    expect(calculateProtectedEventEstimates(commissionInput({}, [downtimeConfig()]))).toEqual([])
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
      revenueExpectations: [expectation('down', { actualNonBidPmpe: 0.8 }), expectation('peer')],
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
