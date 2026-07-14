// Tests for computeBidPenalty, bidTooLowPenaltySol, blacklistPenaltySol:
// penalty coefficient, no-history sentinel, zero/negative bid changes, edge cases.
import { computeBidPenalty, bidTooLowPenaltySol, blacklistPenaltySol } from '../src/bid-penalty'
import { bidTooLowPenaltyCoef } from '../src/calculations'

import type { AuctionValidator, DsSamConfig } from '../src'

const CONFIG = {
  bidTooLowPenaltyHistoryEpochs: 5,
  bidTooLowPenaltyPermittedDeviationPmpe: 0,
} as unknown as DsSamConfig

function makeValidator(overrides: Record<string, unknown> = {}): AuctionValidator {
  return {
    voteAccount: 'v1',
    marinadeActivatedStakeSol: 10000,
    revShare: {
      bidPmpe: 5,
      effParticipatingBidPmpe: 5,
      bondObligationPmpe: 3,
      bidTooLowPenaltyPmpe: 0,
      blacklistPenaltyPmpe: 0,
    },
    auctions: [
      { bidPmpe: 5, effParticipatingBidPmpe: 5 },
      { bidPmpe: 5, effParticipatingBidPmpe: 5 },
    ],
    ...overrides,
  } as unknown as AuctionValidator
}

describe('computeBidPenalty — isNegativeBiddingChange', () => {
  it('bid unchanged → isNegativeBiddingChange false, penaltyCoef 0', () => {
    const v = makeValidator()
    const r = computeBidPenalty(v, CONFIG, 10)
    expect(r.isNegativeBiddingChange).toBe(false)
    expect(r.penaltyCoef).toBe(0)
    expect(r.penaltyPmpe).toBe(0)
    expect(r.penaltySol).toBe(0)
  })

  it('bid raised → isNegativeBiddingChange false, no penalty', () => {
    const v = makeValidator({
      revShare: {
        bidPmpe: 8,
        effParticipatingBidPmpe: 8,
        bondObligationPmpe: 3,
      },
    })
    const r = computeBidPenalty(v, CONFIG, 10)
    expect(r.isNegativeBiddingChange).toBe(false)
    expect(r.penaltySol).toBe(0)
  })

  it('bid dropped below TOL threshold → isNegativeBiddingChange true', () => {
    // last epoch was 10, this epoch is 1 (far below 0.99999 * 10 threshold)
    const v = makeValidator({
      revShare: {
        bidPmpe: 1,
        effParticipatingBidPmpe: 1,
        bondObligationPmpe: 0,
      },
      auctions: [{ bidPmpe: 10, effParticipatingBidPmpe: 10 }],
    })
    const r = computeBidPenalty(v, CONFIG, 10)
    expect(r.isNegativeBiddingChange).toBe(true)
    expect(r.penaltyCoef).toBeGreaterThan(0)
    expect(r.penaltySol).toBeGreaterThan(0)
  })
})

describe('computeBidPenalty — shortfall logic', () => {
  it('bondObligationPmpe >= adjustedLimit → shortfall 0, no penalty', () => {
    // effParticipatingBid=5, bond=10 (covers), bid dropped hard
    const v = makeValidator({
      revShare: {
        bidPmpe: 1,
        effParticipatingBidPmpe: 5,
        bondObligationPmpe: 10,
      },
      auctions: [{ bidPmpe: 10, effParticipatingBidPmpe: 5 }],
    })
    const r = computeBidPenalty(v, CONFIG, 10)
    // shortfall = max(0, 5 - 10) = 0
    expect(r.shortfall).toBe(0)
    expect(r.penaltyCoef).toBe(0)
  })

  it('bondObligationPmpe < adjustedLimit AND bid dropped → penaltyCoef in (0, 1]', () => {
    const v = makeValidator({
      revShare: {
        bidPmpe: 1,
        effParticipatingBidPmpe: 5,
        bondObligationPmpe: 0,
      },
      auctions: [{ bidPmpe: 10, effParticipatingBidPmpe: 5 }],
    })
    const r = computeBidPenalty(v, CONFIG, 10)
    expect(r.shortfall).toBeGreaterThan(0)
    expect(r.penaltyCoef).toBeGreaterThan(0)
    expect(r.penaltyCoef).toBeLessThanOrEqual(1)
  })
})

describe('computeBidPenalty — no history sentinel', () => {
  it('no auctions → worstHistoricalPmpe falls back to effParticipatingBidPmpe', () => {
    const v = makeValidator({ auctions: [] })
    const r = computeBidPenalty(v, CONFIG, 10)
    // isNegativeBiddingChange: thisEpoch(5) vs lastEpoch(0) — 5 >= 0*TOL → false
    expect(r.isNegativeBiddingChange).toBe(false)
    expect(r.worstHistoricalPmpe).toBe(r.effParticipatingBidPmpe)
  })

  it('missing auctions field → treats as empty, no crash', () => {
    const v = makeValidator({ auctions: undefined })
    const r = computeBidPenalty(v, CONFIG, 10)
    expect(r.penaltySol).toBe(0)
  })
})

describe('computeBidPenalty — permittedDeviation guard', () => {
  it('permittedDeviationPmpe undefined → treated as 0 (no NaN)', () => {
    const cfg = { bidTooLowPenaltyHistoryEpochs: 5 } as unknown as DsSamConfig
    const v = makeValidator({
      revShare: {
        bidPmpe: 1,
        effParticipatingBidPmpe: 5,
        bondObligationPmpe: 0,
      },
      auctions: [{ bidPmpe: 10, effParticipatingBidPmpe: 5 }],
    })
    const r = computeBidPenalty(v, cfg, 10)
    expect(Number.isNaN(r.penaltySol)).toBe(false)
    expect(Number.isFinite(r.penaltySol)).toBe(true)
  })
})

describe('bidTooLowPenaltyCoef — permittedBidDeviation guard', () => {
  const base = {
    effParticipatingBidPmpe: 5,
    worstHistoricalPmpe: 5,
    bondObligationPmpe: 0,
    isNegativeBiddingChange: true,
  }
  it('throws when permittedBidDeviation is outside [0, 1]', () => {
    expect(() => bidTooLowPenaltyCoef({ ...base, permittedBidDeviation: 1.5 })).toThrow(
      'permittedBidDeviation has to be in [0, 1]',
    )
    expect(() => bidTooLowPenaltyCoef({ ...base, permittedBidDeviation: -0.1 })).toThrow(
      'permittedBidDeviation has to be in [0, 1]',
    )
  })
  it('accepts the [0, 1] boundaries', () => {
    expect(() => bidTooLowPenaltyCoef({ ...base, permittedBidDeviation: 0 })).not.toThrow()
    expect(() => bidTooLowPenaltyCoef({ ...base, permittedBidDeviation: 1 })).not.toThrow()
  })
})

describe('computeBidPenalty — winningTotalPmpe = 0 edge case', () => {
  it('winningTotalPmpe=0, no bid drop → zero penalty', () => {
    const v = makeValidator()
    const r = computeBidPenalty(v, CONFIG, 0)
    expect(r.penaltySol).toBe(0)
  })
})

describe('computeBidPenalty — penaltySol scaling', () => {
  it('penaltySol scales proportionally with marinadeActivatedStakeSol', () => {
    const v1 = makeValidator({
      marinadeActivatedStakeSol: 10000,
      revShare: {
        bidPmpe: 1,
        effParticipatingBidPmpe: 5,
        bondObligationPmpe: 0,
      },
      auctions: [{ bidPmpe: 10, effParticipatingBidPmpe: 5 }],
    })
    const v2 = makeValidator({
      marinadeActivatedStakeSol: 20000,
      revShare: {
        bidPmpe: 1,
        effParticipatingBidPmpe: 5,
        bondObligationPmpe: 0,
      },
      auctions: [{ bidPmpe: 10, effParticipatingBidPmpe: 5 }],
    })
    const r1 = computeBidPenalty(v1, CONFIG, 10)
    const r2 = computeBidPenalty(v2, CONFIG, 10)
    expect(r2.penaltySol).toBeCloseTo(r1.penaltySol * 2, 9)
  })
})

describe('bidTooLowPenaltySol', () => {
  it('delegates to computeBidPenalty.penaltySol', () => {
    const v = makeValidator({
      revShare: {
        bidPmpe: 1,
        effParticipatingBidPmpe: 5,
        bondObligationPmpe: 0,
      },
      auctions: [{ bidPmpe: 10, effParticipatingBidPmpe: 5 }],
    })
    const direct = computeBidPenalty(v, CONFIG, 10).penaltySol
    expect(bidTooLowPenaltySol(v, CONFIG, 10)).toBeCloseTo(direct, 12)
  })
})

describe('blacklistPenaltySol', () => {
  it('zero blacklistPenaltyPmpe → 0 SOL', () => {
    const v = makeValidator()
    expect(blacklistPenaltySol(v)).toBe(0)
  })

  it('non-zero blacklistPenaltyPmpe → scales with stake', () => {
    const v = makeValidator({
      marinadeActivatedStakeSol: 5000,
      revShare: {
        bidPmpe: 5,
        effParticipatingBidPmpe: 5,
        bondObligationPmpe: 3,
        blacklistPenaltyPmpe: 10,
      },
    })
    // (10/1000) * 5000 = 50
    expect(blacklistPenaltySol(v)).toBeCloseTo(50, 9)
  })
})
