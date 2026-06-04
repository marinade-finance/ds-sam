import { AnalyzeRevenuesCommand } from '../src/commands/analyze-revenue.cmd'

import type { SnapshotValidatorsCollection } from '../src/commands/analyze-revenue.cmd'
import type { AuctionResult, AuctionValidator, Rewards } from '@marinade.finance/ds-sam-sdk'

const REWARDS: Rewards = { inflationPmpe: 0.4, mevPmpe: 0.05, blockPmpe: 0 }
const WINNING_TOTAL_PMPE = 0.45
// totalPmpe below the winning one: the validator lost the auction at SAM time
const LOSING_TOTAL_PMPE = WINNING_TOTAL_PMPE - 0.02
const VOTE_ACCOUNT = 'validator'

const auctionValidator = (inflationPmpe: number, mevPmpe: number, totalPmpe: number): AuctionValidator =>
  ({
    voteAccount: VOTE_ACCOUNT,
    inflationCommissionDec: 1 - inflationPmpe / REWARDS.inflationPmpe,
    mevCommissionDec: 1 - mevPmpe / REWARDS.mevPmpe,
    maxStakeWanted: null,
    revShare: {
      inflationPmpe,
      mevPmpe,
      totalPmpe,
      auctionEffectiveBidPmpe: 0,
    },
  }) as unknown as AuctionValidator

const auctionResult = { winningTotalPmpe: WINNING_TOTAL_PMPE } as AuctionResult

describe('analyze-revenues beforeSamCommissionIncreasePmpe', () => {
  const cmd = new AnalyzeRevenuesCommand()

  const evaluate = (
    samInflationPmpe: number,
    samMevPmpe: number,
    totalPmpe: number,
    pastCommissions: Map<string, { inflation: number; mev: number | null }>,
  ) => {
    const validator = auctionValidator(samInflationPmpe, samMevPmpe, totalPmpe)
    const result = cmd.evaluateRevenueExpectationForAuctionValidators(
      [validator],
      [validator],
      auctionResult,
      pastCommissions,
      REWARDS,
    )
    expect(result).toHaveLength(1)
    const evaluation = result[0]
    if (evaluation == null) {
      throw new Error('Missing revenue expectation evaluation')
    }
    return evaluation
  }

  it('charges inflation commission increased before the SAM run when auction is lost', () => {
    // last epoch 0% commission, at SAM time 5% (share 0.40 -> 0.38), totalPmpe below winning
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: null }]])
    const res = evaluate(0.38, 0.05, LOSING_TOTAL_PMPE, past)
    expect(res.beforeSamCommissionIncreasePmpe).toBeCloseTo(0.02, 12)
  })

  it('adds MEV commission increase to the charge', () => {
    // inflation 0% -> 5% and MEV 0% -> 10% (share 0.05 -> 0.045)
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: 0 }]])
    const res = evaluate(0.38, 0.045, WINNING_TOTAL_PMPE - 0.025, past)
    expect(res.beforeSamCommissionIncreasePmpe).toBeCloseTo(0.02 + 0.005, 12)
  })

  it('nets a MEV commission decrease against an inflation commission increase', () => {
    // inflation 0% -> 5% (share 0.40 -> 0.38) while MEV 10% -> 0% (share 0.045 -> 0.05)
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: 0.1 }]])
    const res = evaluate(0.38, 0.05, LOSING_TOTAL_PMPE, past)
    expect(res.beforeSamCommissionIncreasePmpe).toBeCloseTo(0.02 - 0.005, 12)
  })

  it('does not charge when a MEV commission decrease outweighs the inflation increase', () => {
    // inflation 5% -> 6% (share 0.38 -> 0.376) while MEV 50% -> 0% (share 0.025 -> 0.05)
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0.05, mev: 0.5 }]])
    const res = evaluate(0.376, 0.05, LOSING_TOTAL_PMPE, past)
    expect(res.beforeSamCommissionIncreasePmpe).toBe(0)
  })

  it('does not charge a validator who won the auction', () => {
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: 0 }]])
    const res = evaluate(0.38, 0.045, WINNING_TOTAL_PMPE, past)
    expect(res.beforeSamCommissionIncreasePmpe).toBe(0)
  })

  it('does not charge when commissions did not increase', () => {
    // last epoch 5%, at SAM time 0% (share 0.38 -> 0.40)
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0.05, mev: null }]])
    const res = evaluate(0.4, 0.05, LOSING_TOTAL_PMPE, past)
    expect(res.beforeSamCommissionIncreasePmpe).toBe(0)
  })

  it('charges when auction was lost at SAM time even if pmpe rose after the SAM run', () => {
    // lost at SAM time, commission decreased after so the after-state would look like a win
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: null }]])
    const before = auctionValidator(0.38, 0.05, LOSING_TOTAL_PMPE)
    const after = auctionValidator(0.4, 0.05, WINNING_TOTAL_PMPE)
    const result = cmd.evaluateRevenueExpectationForAuctionValidators([before], [after], auctionResult, past, REWARDS)
    expect(result[0]?.beforeSamCommissionIncreasePmpe).toBeCloseTo(0.02, 12)
  })

  it('does not charge when auction was won at SAM time even if pmpe dropped after the SAM run', () => {
    // won at SAM time thanks to the bid, commission increased after so the after-state would look like a loss
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: null }]])
    const before = auctionValidator(0.38, 0.05, WINNING_TOTAL_PMPE)
    const after = auctionValidator(0.36, 0.05, WINNING_TOTAL_PMPE - 0.04)
    const result = cmd.evaluateRevenueExpectationForAuctionValidators([before], [after], auctionResult, past, REWARDS)
    expect(result[0]?.beforeSamCommissionIncreasePmpe).toBe(0)
  })

  it('does not charge without past snapshot data', () => {
    const res = evaluate(0.38, 0.045, LOSING_TOTAL_PMPE, new Map())
    expect(res.beforeSamCommissionIncreasePmpe).toBe(0)
    expect(res.pastInflationCommission).toBe(0)
    expect(res.pastMevCommission).toBeNull()
  })
})

describe('analyze-revenues getPastValidatorCommissions', () => {
  const cmd = new AnalyzeRevenuesCommand()

  it('parses commissions with mev_commission in bps', () => {
    const collection = {
      epoch: 100,
      validator_metas: [
        { vote_account: 'a', commission: 5, mev_commission: 500, stake: 0, credits: 0 },
        { vote_account: 'b', commission: 100, mev_commission: 0, stake: 0, credits: 0 },
        { vote_account: 'c', commission: 0, stake: 0, credits: 0 },
      ],
    } as SnapshotValidatorsCollection
    const map = cmd.getPastValidatorCommissions(collection)
    expect(map.get('a')).toEqual({ inflation: 0.05, mev: 0.05 })
    expect(map.get('b')).toEqual({ inflation: 1, mev: 0 })
    expect(map.get('c')).toEqual({ inflation: 0, mev: null })
  })

  it('returns empty map without past collection', () => {
    expect(cmd.getPastValidatorCommissions(null).size).toBe(0)
  })
})
