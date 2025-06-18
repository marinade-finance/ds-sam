/**
 *
 * Test cases covered:
 * - zero penalty when totalPmpe ≥ winningTotalPmpe
 * - positive penalty when totalPmpe < winningTotalPmpe
 * - clamp coef to 1 when bidPmpe=0
 * - zero penalty when bidPmpe ≥ historicalPmpe
 * - fractional inputs handling
 * - zero limit yields zero penalty
 * - only first N epochs considered for history
 * - zero penalty when bid equals historical minimum
 * - clamp coef at 1 for extreme undervaluation
 * - paidUndelegationSol computes correctly
 *
 */
import { calcBidTooLowPenalty as _nativeCalc } from '../src/calculations'
import type { AuctionValidator } from '../src/types'
  
const calcBidTooLowPenalty = ({
  bidPmpe,
  inflationPmpe,
  mevPmpe,
  winningTotalPmpe,
  pastEffParticipating,
  historyLength
}: {
  bidPmpe: number
  inflationPmpe: number
  mevPmpe: number
  winningTotalPmpe: number
  pastEffParticipating: number[]
  historyLength: number
}) => {
  const eff = (bidPmpe + inflationPmpe + mevPmpe) >= winningTotalPmpe
    ? bidPmpe
    : Math.max(0, winningTotalPmpe - inflationPmpe - mevPmpe)
  const validator = {
    revShare: {
      bidPmpe,
      inflationPmpe,
      mevPmpe,
      effParticipatingBidPmpe: eff,
      auctionEffectiveBidPmpe: 0.9 * eff,
      totalPmpe: NaN,
      bidTooLowPenaltyPmpe: NaN
    },
    auctions: pastEffParticipating.map(e => ({ effParticipatingBidPmpe: e, bidPmpe: e })),
    bidTooLowPenalty: { coef: NaN, base: NaN },
    marinadeActivatedStakeSol: 1000
  } as unknown as AuctionValidator

  const res = _nativeCalc(historyLength, winningTotalPmpe, validator) as any
  return {
    coef: res.bidTooLowPenalty.coef,
    base: res.bidTooLowPenalty.base,
    bidTooLowPenaltyPmpe: res.bidTooLowPenaltyPmpe,
    effParticipatingBidPmpe: eff
  }
}

describe('calcBidTooLowPenalty', () => {
  const historyLength = 3

  it('returns zero penalty when totalPmpe ≥ winningTotalPmpe', () => {
    const result = calcBidTooLowPenalty({
      bidPmpe: 30,
      inflationPmpe: 10,
      mevPmpe: 5,
      winningTotalPmpe: 40,
      pastEffParticipating: [25, 22, 18],
      historyLength,
    })
    expect(result.coef).toBe(0)
    expect(result.bidTooLowPenaltyPmpe).toBe(0)
    expect(result.effParticipatingBidPmpe).toBe(30)
  })

  it('computes positive penalty when totalPmpe < winningTotalPmpe', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 15,
      inflationPmpe: 10,
      mevPmpe: 5,
      winningTotalPmpe: 40,
      pastEffParticipating: [20, 22, 24, 30],
      historyLength,
    })
    const expectedCoef = Math.min(1, Math.sqrt(1.5 * (20 - 15) / 20))
    const expectedBase = 40 + 25
    expect(res.effParticipatingBidPmpe).toBe(25)
    expect(res.coef).toBeCloseTo(expectedCoef)
    expect(res.base).toBe(expectedBase)
    expect(res.bidTooLowPenaltyPmpe).toBeCloseTo(expectedCoef * expectedBase)
  })

  it('clamps coef at 1 when bidPmpe=0', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 0,
      inflationPmpe: 5,
      mevPmpe: 5,
      winningTotalPmpe: 20,
      pastEffParticipating: [10, 12, 14],
      historyLength,
    })
    expect(res.coef).toBe(1)
    expect(res.base).toBe(20 + (20 - 5 - 5))
    expect(res.bidTooLowPenaltyPmpe).toBe(res.base)
  })

  it('yields zero penalty when bidPmpe ≥ historicalPmpe', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 10,
      inflationPmpe: 0,
      mevPmpe: 0,
      winningTotalPmpe: 10,
      pastEffParticipating: [12, 14, 16],
      historyLength,
    })
    expect(res.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('works with fractional inputs', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 1.2345,
      inflationPmpe: 0.5,
      mevPmpe: 0.25,
      winningTotalPmpe: 3.14159,
      pastEffParticipating: [1.8, 2.2, 2.9],
      historyLength,
    })
    expect(res.bidTooLowPenaltyPmpe).toBeGreaterThanOrEqual(0)
    expect(res.effParticipatingBidPmpe + 0.5 + 0.25)
      .toBeCloseTo(
        Math.min(res.effParticipatingBidPmpe + 0.5 + 0.25, 3.14159)
      )
  })

  it('zero limit yields zero penalty', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 0,
      inflationPmpe: 0,
      mevPmpe: 0,
      winningTotalPmpe: 1,
      pastEffParticipating: [1, 0, 0],
      historyLength,
    })
    expect(res.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('limits history to first N epochs', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 1,
      inflationPmpe: 0,
      mevPmpe: 0,
      winningTotalPmpe: 5,
      pastEffParticipating: [5, 3, 8, 2],
      historyLength: 2,
    })
    expect(res.coef).toBe(1)
    expect(res.base).toBe(10)
    expect(res.bidTooLowPenaltyPmpe).toBe(10)
  })

  it('zero penalty when bid equals historical minimum', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 3,
      inflationPmpe: 1,
      mevPmpe: 1,
      winningTotalPmpe: 10,
      pastEffParticipating: [3, 4, 5],
      historyLength,
    })
    expect(res.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('clamps coef at 1 for extreme undervaluation', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 2,
      inflationPmpe: 1,
      mevPmpe: 1,
      winningTotalPmpe: 100,
      pastEffParticipating: [50, 60, 70],
      historyLength,
    })
    expect(res.coef).toBe(1)
    expect(res.base).toBe(198)
    expect(res.bidTooLowPenaltyPmpe).toBe(198)
  })

  it('computes paidUndelegationSol correctly', () => {
    const bidPmpe = 15
    const inflationPmpe = 10
    const mevPmpe = 5
    const winningTotalPmpe = 40
    const pastEffParticipating = [20,22,24,30]
    const historyLength = 3
    const marinadeActivatedStakeSol = 200
    const effParticipatingBidPmpe = (bidPmpe + inflationPmpe + mevPmpe) >= winningTotalPmpe
      ? bidPmpe
      : Math.max(0, winningTotalPmpe - inflationPmpe - mevPmpe)
    const validator = {
      revShare: {
        bidPmpe,
        inflationPmpe,
        mevPmpe,
        effParticipatingBidPmpe,
        auctionEffectiveBidPmpe: 0,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN
      },
      auctions: pastEffParticipating.map(x => ({ effParticipatingBidPmpe: x, bidPmpe: x })),
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol
    } as unknown as AuctionValidator

    const native = _nativeCalc(historyLength, winningTotalPmpe, validator)
    const expectedCoef = Math.min(1, Math.sqrt(1.5 * (20 - 15) / 20))
    const expectedBase = winningTotalPmpe + effParticipatingBidPmpe
    const expectedPmpe = expectedCoef * expectedBase
    const effPmpe = inflationPmpe + mevPmpe + 0
    const expectedPaid = expectedPmpe * marinadeActivatedStakeSol / effPmpe

    expect(native.bidTooLowPenalty.coef).toBeCloseTo(expectedCoef)
    expect(native.bidTooLowPenalty.base).toBe(expectedBase)
    expect(native.bidTooLowPenaltyPmpe).toBeCloseTo(expectedPmpe)
    expect(native.paidUndelegationSol).toBeCloseTo(expectedPaid)
  })

  it('throws on infinite penalty pmpe', () => {
    const validator = {
      revShare: {
        bidPmpe: 0,
        inflationPmpe: 0,
        mevPmpe: 0,
        effParticipatingBidPmpe: Infinity,
        auctionEffectiveBidPmpe: NaN,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN
      },
      auctions: [],
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol: NaN
    } as unknown as AuctionValidator
    expect(() => _nativeCalc(1, 10, validator))
      .toThrow('bidTooLowPenaltyPmpe has to be finite')
  })
})
