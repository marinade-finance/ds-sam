import { evaluateRevenueExpectations, winningTotalPmpeOf } from '../src'

import type { PastValidatorCommissions, RevenueExpectationLogger, RevenueValidatorInput, Rewards } from '../src'

const REWARDS: Rewards = { inflationPmpe: 0.4, mevPmpe: 0.05, blockPmpe: 0 }
const WINNING_TOTAL_PMPE = 0.45
// totalPmpe below the winning one: the validator lost the auction at SAM time
const LOSING_TOTAL_PMPE = WINNING_TOTAL_PMPE - 0.02
const VOTE_ACCOUNT = 'validator'

const validatorInput = (inflationPmpe: number, mevPmpe: number, totalPmpe: number): RevenueValidatorInput => ({
  voteAccount: VOTE_ACCOUNT,
  inflationCommissionDec: 1 - inflationPmpe / REWARDS.inflationPmpe,
  mevCommissionDec: 1 - mevPmpe / REWARDS.mevPmpe,
  maxStakeWanted: null,
  revShare: { inflationPmpe, mevPmpe, totalPmpe, auctionEffectiveBidPmpe: 0 },
})

const evaluate = (
  samInflationPmpe: number,
  samMevPmpe: number,
  totalPmpe: number,
  pastCommissions: Map<string, PastValidatorCommissions>,
) => {
  const validator = validatorInput(samInflationPmpe, samMevPmpe, totalPmpe)
  const result = evaluateRevenueExpectations([validator], [validator], WINNING_TOTAL_PMPE, pastCommissions, REWARDS)
  expect(result).toHaveLength(1)
  const evaluation = result[0]
  if (evaluation == null) {
    throw new Error('Missing revenue expectation evaluation')
  }
  return evaluation
}

describe('evaluateRevenueExpectations beforeSamCommissionIncreasePmpe', () => {
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
    const before = validatorInput(0.38, 0.05, LOSING_TOTAL_PMPE)
    const after = validatorInput(0.4, 0.05, WINNING_TOTAL_PMPE)
    const result = evaluateRevenueExpectations([before], [after], WINNING_TOTAL_PMPE, past, REWARDS)
    expect(result[0]?.beforeSamCommissionIncreasePmpe).toBeCloseTo(0.02, 12)
  })

  it('does not charge when auction was won at SAM time even if pmpe dropped after the SAM run', () => {
    // won at SAM time thanks to the bid, commission increased after so the after-state would look like a loss
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: null }]])
    const before = validatorInput(0.38, 0.05, WINNING_TOTAL_PMPE)
    const after = validatorInput(0.36, 0.05, WINNING_TOTAL_PMPE - 0.04)
    const result = evaluateRevenueExpectations([before], [after], WINNING_TOTAL_PMPE, past, REWARDS)
    expect(result[0]?.beforeSamCommissionIncreasePmpe).toBe(0)
  })

  it('does not charge when the past epoch applied the same rate the auction priced', () => {
    // past 5% applied rate, SAM priced 5% too
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0.05, mev: null }]])
    const res = evaluate(0.38, 0.05, LOSING_TOTAL_PMPE, past)
    expect(res.beforeSamCommissionIncreasePmpe).toBeCloseTo(0, 12)
  })

  it('does not charge without past snapshot data', () => {
    const res = evaluate(0.38, 0.045, LOSING_TOTAL_PMPE, new Map())
    expect(res.beforeSamCommissionIncreasePmpe).toBe(0)
    expect(res.pastInflationCommission).toBe(0)
    expect(res.pastMevCommission).toBeNull()
  })
})

describe('evaluateRevenueExpectations skips and logging', () => {
  const spyLogger = (): RevenueExpectationLogger & { warn: jest.Mock; debug: jest.Mock } => ({
    warn: jest.fn(),
    debug: jest.fn(),
  })

  it('skips and warns when an inflation commission is unresolved', () => {
    const logger = spyLogger()
    const before = { ...validatorInput(0.38, 0.05, LOSING_TOTAL_PMPE), inflationCommissionDec: null }
    const result = evaluateRevenueExpectations([before], [before], WINNING_TOTAL_PMPE, new Map(), REWARDS, logger)
    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('No resolvable inflation commission, skipping validator', {
      voteAccount: VOTE_ACCOUNT,
      marinadeActivatedStakeSol: undefined,
    })
  })

  it('skips and warns when the validator is missing after the SAM run', () => {
    const logger = spyLogger()
    const before = validatorInput(0.38, 0.05, LOSING_TOTAL_PMPE)
    const result = evaluateRevenueExpectations([before], [], WINNING_TOTAL_PMPE, new Map(), REWARDS, logger)
    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Validator not present in the snapshot!', { voteAccount: VOTE_ACCOUNT })
  })

  it('logs the before-SAM charge at debug level', () => {
    const logger = spyLogger()
    const before = validatorInput(0.38, 0.05, LOSING_TOTAL_PMPE)
    const past = new Map([[VOTE_ACCOUNT, { inflation: 0, mev: null }]])
    evaluateRevenueExpectations([before], [before], WINNING_TOTAL_PMPE, past, REWARDS, logger)
    expect(logger.debug).toHaveBeenCalledTimes(1)
    expect(logger.debug.mock.calls[0]?.[0]).toBe(
      'Validator increased commission before SAM run and has not won auction',
    )
  })

  it('computes the loss fields from before and after', () => {
    const before = validatorInput(0.38, 0.05, LOSING_TOTAL_PMPE)
    const after = validatorInput(0.36, 0.04, LOSING_TOTAL_PMPE)
    const [res] = evaluateRevenueExpectations([before], [after], WINNING_TOTAL_PMPE, new Map(), REWARDS)
    expect(res?.expectedNonBidPmpe).toBeCloseTo(0.43, 12)
    expect(res?.actualNonBidPmpe).toBeCloseTo(0.4, 12)
    expect(res?.lossPerStake).toBeCloseTo(0.03 / 1000, 15)
    expect(res?.samStakeShare).toBe(1)
  })
})

describe('winningTotalPmpeOf', () => {
  const row = (marinadeSamTargetSol: number, totalPmpe: number) => ({ marinadeSamTargetSol, revShare: { totalPmpe } })

  it('takes the lowest totalPmpe among validators that received SAM stake', () => {
    expect(winningTotalPmpeOf([row(100, 0.5), row(0, 0.1), row(50, 0.3)])).toBe(0.3)
  })

  it('is Infinity when nobody won', () => {
    expect(winningTotalPmpeOf([row(0, 0.1)])).toBe(Infinity)
    expect(winningTotalPmpeOf([])).toBe(Infinity)
  })
})
