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

const COEF_DEVIATION = 0.95

const calcBidTooLowPenalty = ({
  bidPmpe,
  inflationPmpe,
  mevPmpe,
  blockPmpe,
  winningTotalPmpe,
  pastEffParticipating,
  historyLength,
}: {
  bidPmpe: number
  inflationPmpe: number
  mevPmpe: number
  blockPmpe: number
  winningTotalPmpe: number
  pastEffParticipating: number[]
  historyLength: number
}) => {
  const eff =
    bidPmpe + inflationPmpe + mevPmpe + blockPmpe >= winningTotalPmpe
      ? bidPmpe + blockPmpe // no bonds commission is setup
      : Math.max(0, winningTotalPmpe - inflationPmpe - mevPmpe)
  const validator = {
    revShare: {
      bidPmpe,
      inflationPmpe,
      mevPmpe,
      blockPmpe,
      bondObligationPmpe: bidPmpe + blockPmpe,
      effParticipatingBidPmpe: eff,
      totalPmpe: NaN,
      bidTooLowPenaltyPmpe: NaN,
    },
    auctions: pastEffParticipating.map(e => ({
      effParticipatingBidPmpe: e,
      bidPmpe: e,
    })),
    bidTooLowPenalty: { coef: NaN, base: NaN },
    marinadeActivatedStakeSol: 1000,
    values: {
      commissions: {
        inflationCommissionDec: 1,
        mevCommissionDec: 1,
        blockRewardsCommissionDec: 1,
        inflationCommissionOnchainDec: 1,
        inflationCommissionInBondDec: null,
        mevCommissionOnchainDec: null,
        mevCommissionInBondDec: null,
        blockRewardsCommissionInBondDec: null,
      },
    },
  } as unknown as AuctionValidator

  const res = _nativeCalc({
    historyEpochs: historyLength,
    winningTotalPmpe,
    validator,
    permittedBidDeviation: 0.05,
  })
  return {
    coef: res.bidTooLowPenalty.coef,
    base: res.bidTooLowPenalty.base,
    bidTooLowPenaltyPmpe: res.bidTooLowPenaltyPmpe,
    effParticipatingBidPmpe: eff,
  }
}

describe('calcBidTooLowPenalty', () => {
  const historyLength = 3

  it('returns zero penalty when totalPmpe ≥ winningTotalPmpe', () => {
    const result = calcBidTooLowPenalty({
      bidPmpe: 30,
      inflationPmpe: 10,
      mevPmpe: 5,
      blockPmpe: 0,
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
      blockPmpe: 0,
      winningTotalPmpe: 40,
      pastEffParticipating: [20, 22, 24, 30],
      historyLength,
    })
    const expectedCoef = Math.min(1, Math.sqrt((1.5 * (20 * COEF_DEVIATION - 15)) / (20 * COEF_DEVIATION)))
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
      blockPmpe: 0,
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
      blockPmpe: 0,
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
      blockPmpe: 0,
      winningTotalPmpe: 3.14159,
      pastEffParticipating: [1.8, 2.2, 2.9],
      historyLength,
    })
    expect(res.bidTooLowPenaltyPmpe).toBeGreaterThanOrEqual(0)
    expect(res.effParticipatingBidPmpe + 0.5 + 0.25).toBeCloseTo(
      Math.min(res.effParticipatingBidPmpe + 0.5 + 0.25, 3.14159),
    )
  })

  it('zero limit yields zero penalty', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 0,
      inflationPmpe: 0,
      mevPmpe: 0,
      blockPmpe: 0,
      winningTotalPmpe: 0,
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
      blockPmpe: 0,
      winningTotalPmpe: 5,
      pastEffParticipating: [5, 3, 8, 2],
      historyLength: 2,
    })
    const historicalPmpe = Math.min(5, 3)
    const adjustedLimit = historicalPmpe * COEF_DEVIATION
    const expectedPenaltyCoef = Math.sqrt((1.5 * (adjustedLimit - 1)) / adjustedLimit)
    expect(res.coef).toBe(expectedPenaltyCoef)
    expect(res.base).toBe(10)
    expect(res.bidTooLowPenaltyPmpe).toBe(expectedPenaltyCoef * 10)
  })

  it('zero penalty when bid equals historical minimum', () => {
    const res = calcBidTooLowPenalty({
      bidPmpe: 3,
      inflationPmpe: 1,
      mevPmpe: 1,
      blockPmpe: 0,
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
      blockPmpe: 0,
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
    const pastEffParticipating = [20, 22, 24, 30]
    const historyLength = 3
    const marinadeActivatedStakeSol = 200
    const effParticipatingBidPmpe =
      bidPmpe + inflationPmpe + mevPmpe >= winningTotalPmpe
        ? bidPmpe
        : Math.max(0, winningTotalPmpe - inflationPmpe - mevPmpe)
    const validator = {
      revShare: {
        bidPmpe,
        inflationPmpe,
        mevPmpe,
        effParticipatingBidPmpe,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN,
        bondObligationPmpe: bidPmpe,
      },
      auctions: pastEffParticipating.map(x => ({
        effParticipatingBidPmpe: x,
        bidPmpe: x,
      })),
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol,
      values: { commissions: null },
    } as unknown as AuctionValidator

    const native = _nativeCalc({
      historyEpochs: historyLength,
      winningTotalPmpe,
      validator,
      permittedBidDeviation: 0.05,
    })
    const expectedCoef = Math.min(1, Math.sqrt((1.5 * (20 * COEF_DEVIATION - 15)) / (20 * COEF_DEVIATION)))
    const expectedBase = winningTotalPmpe + effParticipatingBidPmpe
    const expectedPmpe = expectedCoef * expectedBase
    const effPmpe = inflationPmpe + mevPmpe + effParticipatingBidPmpe
    const expectedPaid = (expectedPmpe * marinadeActivatedStakeSol) / effPmpe

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
        bondObligationPmpe: Infinity,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN,
      },
      auctions: [],
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol: NaN,
      values: {
        commissions: {
          inflationCommissionDec: 1,
          mevCommissionDec: 1,
          blockRewardsCommissionDec: 1,
        },
      },
    } as unknown as AuctionValidator
    expect(() => _nativeCalc({ historyEpochs: 1, winningTotalPmpe: 10, validator })).toThrow(
      'bidTooLowPenaltyPmpe has to be finite',
    )
  })

  it('no penalty when commissions increased in the permitted limits', () => {
    const validator = {
      revShare: {
        bidPmpe: 20,
        // for penalty would be hit we need to see that the effective participating has decreased
        effParticipatingBidPmpe: 16.6,
        // bond obligation has decreased with the effective participating bid has decreased
        bondObligationPmpe: 15.6,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN,
      },
      auctions: [
        {
          effParticipatingBidPmpe: 20,
          bidPmpe: 20,
          commissions: {
            // last auction commissions
            inflationCommissionDec: 0.05,
            mevCommissionDec: 0.05,
            blockRewardsCommissionDec: 0.05,
          },
        },
      ],
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol: 1000,
      values: {
        // current commissions have slightly increased but within permitted deviation
        commissions: {
          inflationCommissionDec: 0.07,
          mevCommissionDec: 0.07,
          blockRewardsCommissionDec: 0.07,
          inflationCommissionOnchainDec: NaN,
          inflationCommissionInBondDec: null,
          mevCommissionOnchainDec: null,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    } as unknown as AuctionValidator

    const res = _nativeCalc({
      historyEpochs: historyLength,
      winningTotalPmpe: 40,
      validator,
      permittedBidDeviation: 0.07,
    })
    // as of permitted deviation the coef is zero
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenalty.base).toBe(56.6) // 40 + 16.6
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
    expect(res.paidUndelegationSol).toBe(0)
  })

  it('we can decrease commission and increase bid and no penalty is applied', () => {
    const validator = {
      revShare: {
        bidPmpe: 20,
        effParticipatingBidPmpe: 16.6,
        bondObligationPmpe: 15.6,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN,
      },
      auctions: [
        {
          // last auction bids (bid pmpe increased from last time)
          effParticipatingBidPmpe: 16.6,
          bidPmpe: 0,
          commissions: {
            // last auction commissions
            inflationCommissionDec: 0.05,
            mevCommissionDec: 0.05,
            blockRewardsCommissionDec: 0.05,
          },
        },
      ],
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol: 1000,
      values: {
        // commissions decreased
        commissions: {
          inflationCommissionDec: -0.1,
          mevCommissionDec: -2.0,
          blockRewardsCommissionDec: -0.8,
          inflationCommissionOnchainDec: 0.05,
          inflationCommissionInBondDec: null,
          mevCommissionOnchainDec: null,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    } as unknown as AuctionValidator

    const res = _nativeCalc({
      historyEpochs: historyLength,
      winningTotalPmpe: 40,
      validator,
      permittedBidDeviation: 0,
    })
    // isNegativeBiddingChange = false (nothing changed)
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
    expect(res.paidUndelegationSol).toBe(0)
  })

  it('uses bondObligationPmpe in penalty calculation', () => {
    const winningTotalPmpe = 40
    const marinadeActivatedStakeSol = 1000
    const validator = {
      revShare: {
        bidPmpe: 15,
        inflationPmpe: 10,
        mevPmpe: 5,
        blockPmpe: 5, // Non-zero block rewards
        bondObligationPmpe: 20, // bidPmpe + blockPmpe = 15 + 5
        effParticipatingBidPmpe: 25,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN,
      },
      auctions: [
        {
          effParticipatingBidPmpe: 25,
          bidPmpe: 20,
          commissions: {
            inflationCommissionDec: 0.05,
            mevCommissionDec: 0.05,
            blockRewardsCommissionDec: 0.05,
          },
        },
        { effParticipatingBidPmpe: 25, bidPmpe: 25, commissions: null },
        { effParticipatingBidPmpe: 25, bidPmpe: 25, commissions: null },
      ],
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol,
      values: {
        commissions: {
          inflationCommissionDec: 0.1,
          mevCommissionDec: 0.05,
          blockRewardsCommissionDec: 0.05,
          inflationCommissionOnchainDec: 0.05,
          inflationCommissionInBondDec: null,
          mevCommissionOnchainDec: null,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    } as unknown as AuctionValidator

    const res = _nativeCalc({
      historyEpochs: historyLength,
      winningTotalPmpe,
      validator,
      permittedBidDeviation: 0.05,
    })

    const adjustedLimit = 25 * COEF_DEVIATION

    const expectedCoef = Math.sqrt((1.5 * (adjustedLimit - 20)) / adjustedLimit)
    const expectedBase = winningTotalPmpe + 25 // 65
    const expectedPenalty = expectedCoef * expectedBase

    expect(res.bidTooLowPenalty.coef).toBeCloseTo(expectedCoef)
    expect(res.bidTooLowPenalty.base).toBe(expectedBase)
    expect(res.bidTooLowPenaltyPmpe).toBeCloseTo(expectedPenalty)
    expect(res.paidUndelegationSol).toBeCloseTo((expectedPenalty * marinadeActivatedStakeSol) / winningTotalPmpe)
  })

  it('handles missing commission history gracefully', () => {
    const validator = {
      revShare: {
        bidPmpe: 19,
        inflationPmpe: 10,
        mevPmpe: 5,
        blockPmpe: 0,
        bondObligationPmpe: 13,
        effParticipatingBidPmpe: 19,
        totalPmpe: NaN,
        bidTooLowPenaltyPmpe: NaN,
      },
      auctions: [
        {
          effParticipatingBidPmpe: 20,
          bidPmpe: 20,
          commissions: null, // No commission history
        },
      ],
      bidTooLowPenalty: { coef: NaN, base: NaN },
      marinadeActivatedStakeSol: 1000,
      values: {
        commissions: {
          inflationCommissionDec: 0.05,
          mevCommissionDec: 0.05,
          blockRewardsCommissionDec: 0.05,
          inflationCommissionOnchainDec: 0.1,
          inflationCommissionInBondDec: null,
          mevCommissionOnchainDec: null,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    } as unknown as AuctionValidator

    const res = _nativeCalc({
      historyEpochs: historyLength,
      winningTotalPmpe: 40,
      validator,
      permittedBidDeviation: 0.05,
    })
    // Should apply penalty based on bidPmpe reduction
    expect(res.bidTooLowPenalty.coef).toBeGreaterThan(0)
  })
})
