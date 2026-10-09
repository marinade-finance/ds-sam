import { calculateProtectedEventEstimates, pastCommissionsFromScores, samRunFromScores } from '../src'

import type { CommissionSamIncreaseSettlementConfig, SamScoreRow } from '../src'

type Commissions = NonNullable<NonNullable<SamScoreRow['values']>['commissions']>

const commissions = (overrides: Partial<Commissions> = {}): Commissions => ({
  inflationCommissionDec: 0.05,
  mevCommissionDec: 0.05,
  inflationCommissionOnchainDec: 0.05,
  inflationCommissionInBondDec: null,
  mevCommissionOnchainDec: 0.05,
  mevCommissionInBondDec: null,
  ...overrides,
})

type RowOptions = {
  epoch?: number
  scoringId?: string
  target?: number
  totalPmpe?: number
  nonBidPmpe?: number
  values?: SamScoreRow['values']
}

const row = (
  voteAccount: string,
  {
    epoch = 101,
    scoringId = `${epoch}.500`,
    target = 0,
    totalPmpe = 1,
    nonBidPmpe = 1,
    values = { commissions: commissions() },
  }: RowOptions = {},
): SamScoreRow => ({
  epoch,
  voteAccount,
  marinadeSamTargetSol: target,
  maxStakeWanted: null,
  revShare: { inflationPmpe: nonBidPmpe, mevPmpe: 0, totalPmpe, auctionEffectiveBidPmpe: 0 },
  values,
  metadata: { scoringId },
})

describe('samRunFromScores', () => {
  it('keeps only the highest-slot run of the epoch', () => {
    const run = samRunFromScores(
      [
        row('a', { scoringId: '101.100', target: 10, totalPmpe: 5 }),
        row('a', { scoringId: '101.900', target: 10, totalPmpe: 3 }),
        row('b', { scoringId: '101.900', target: 0, totalPmpe: 1 }),
        row('a', { epoch: 100, target: 10, totalPmpe: 0.5 }),
      ],
      101,
    )
    expect(run.winningTotalPmpe).toBe(3)
    expect(run.validators.map(v => [v.voteAccount, v.revShare.totalPmpe])).toEqual([
      ['a', 3],
      ['b', 1],
    ])
  })

  it('excludes zero-target rows from the clearing price', () => {
    const run = samRunFromScores([row('a', { target: 10, totalPmpe: 2 }), row('b', { target: 0, totalPmpe: 0.1 })], 101)
    expect(run.winningTotalPmpe).toBe(2)
  })

  it('leaves the inflation commission unknown when the row carries no commissions', () => {
    const [validator] = samRunFromScores([row('a', { values: {} })], 101).validators
    expect(validator?.inflationCommissionDec).toBeNull()
    expect(validator?.mevCommissionDec).toBeNull()
  })

  it('restores a null MEV commission the SDK stored as 1', () => {
    const noMev = commissions({ mevCommissionDec: 1, mevCommissionOnchainDec: null, mevCommissionInBondDec: null })
    const bondMev = commissions({ mevCommissionDec: 0.05, mevCommissionOnchainDec: null, mevCommissionInBondDec: 0.05 })
    const run = samRunFromScores(
      [row('none', { values: { commissions: noMev } }), row('bond', { values: { commissions: bondMev } })],
      101,
    )
    expect(run.validators.map(v => [v.voteAccount, v.mevCommissionDec])).toEqual([
      ['none', null],
      ['bond', 0.05],
    ])
  })
})

describe('pastCommissionsFromScores', () => {
  it('maps the on-chain rates of the requested epoch', () => {
    const past = pastCommissionsFromScores(
      [
        row('a', { epoch: 100, values: { commissions: commissions({ inflationCommissionOnchainDec: 0.02 }) } }),
        row('b', { epoch: 101 }),
      ],
      100,
    )
    expect([...past]).toEqual([['a', { inflation: 0.02, mev: 0.05 }]])
  })

  it('leaves out a validator whose applied inflation rate is unknown', () => {
    const unknown = commissions({ inflationCommissionOnchainDec: null })
    expect(pastCommissionsFromScores([row('a', { epoch: 100, values: { commissions: unknown } })], 100).size).toBe(0)
  })

  it('keeps a null on-chain MEV rate as null', () => {
    const noMev = commissions({ mevCommissionOnchainDec: null })
    const past = pastCommissionsFromScores([row('a', { epoch: 100, values: { commissions: noMev } })], 100)
    expect(past.get('a')).toEqual({ inflation: 0.05, mev: null })
  })
})

describe('scoring rows end to end', () => {
  // validator-bonds settlement-config.yaml CommissionSamIncreaseSettlement
  const LIVE_COMMISSION: CommissionSamIncreaseSettlementConfig = {
    type: 'CommissionSamIncreaseSettlement',
    meta: { funder: 'ValidatorBond' },
    min_settlement_lamports: 10_000_000,
    grace_increase_bps: 100,
    covered_range_bps: [0, 10000],
    extra_penalty_threshold_bps: 700,
    base_markup_bps: 0,
    penalty_markup_bps: 0,
  }

  it('settles a before-SAM commission increase from public scoring rows', () => {
    const noMev = commissions({ mevCommissionDec: 1, mevCommissionOnchainDec: null })
    const pastZero = commissions({ inflationCommissionOnchainDec: 0, mevCommissionOnchainDec: 0 })
    const rows = [
      row('rug', { target: 0, totalPmpe: 1, values: { commissions: noMev } }),
      row('winner', { target: 100, totalPmpe: 2 }),
      row('rug', { epoch: 100, values: { commissions: pastZero } }),
    ]
    const events = calculateProtectedEventEstimates({
      epoch: 101,
      validatorMetas: [
        {
          vote_account: 'rug',
          commission: 5,
          stake: 100_000_000_000n,
          credits: 10000n,
          vote_reward_lamports: null,
          leader_slots: 0n,
          epoch_stake: null,
        },
      ],
      samRun: samRunFromScores(rows, 101),
      currentValidators: [
        {
          voteAccount: 'rug',
          inflationCommissionDec: 0.05,
          mevCommissionDec: 0.05,
          maxStakeWanted: null,
          revShare: { inflationPmpe: 1, mevPmpe: 0, totalPmpe: 1, auctionEffectiveBidPmpe: 0 },
        },
      ],
      pastCommissions: pastCommissionsFromScores(rows, 100),
      rewards: { inflationPmpe: 1, mevPmpe: 0.25 },
      marinadeStakeLamports: new Map([['rug', 100_000_000_000n]]),
      settlementConfigs: [LIVE_COMMISSION],
    })
    // lost at 2 with 0% past rates: 1 + 0.25 expected against 1 actual, 0.00025 per staked lamport over 100 SOL
    expect(events).toEqual([
      {
        epoch: 101,
        amount: 25_000_000,
        vote_account: 'rug',
        meta: { funder: 'ValidatorBond' },
        reason: {
          ProtectedEvent: {
            CommissionSamIncrease: {
              vote_account: 'rug',
              expected_inflation_commission: 0.05,
              actual_inflation_commission: 0.05,
              past_inflation_commission: 0,
              expected_mev_commission: null,
              actual_mev_commission: 0.05,
              past_mev_commission: 0,
              before_sam_commission_increase_pmpe: 0.25,
              expected_epr: 0.00125,
              actual_epr: 0.001,
              epr_loss_bps: 2000,
              stake: 100_000_000_000,
            },
          },
        },
      },
    ])
  })
})
