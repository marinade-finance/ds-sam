/**
 * Tests cover:
 *  1) clipBondStakeCap: hysteresis bands (< 0.8x, 0.8x-1x, >= 1x)
 *  2) bondStakeCapSam: PMPE formula, ideal/min cap selection
 *  3) unprotectedStakeCap: threshold, delegated stake, foundation weight
 *  4) getMinCapForEvenDistribution: country/aso constraints, clamping
 *  5) findCapForValidator: lastCapConstraint, positive vs zero cap
 *  6) constraint selection: COUNTRY, ASO, WANT, BOND as binding
 *  7) minCapFromConstraint: affectedValidators=0, negative leftToCap
 *  8) bondStakeCapSam edge: zero PMPE, zero bond, negative limit
 *  9) SAM uses BOND constraint, backstop uses RISK
 * 10) negative maxStakeWanted, fractional coefficients
 */
import assert from 'node:assert'

import { calcBondRiskFee, AuctionConstraintType, minCapFromConstraint } from '@marinade.finance/ds-sam-calc'

import { Auction } from '../src/auction'
import { Debug } from '../src/debug'
import {
  buildRevShare,
  makeAuction,
  makeConstraints,
  makeUnitValidator as makeValidator,
} from './helpers/auction-test-utils'

import type { AuctionConstraint } from '@marinade.finance/ds-sam-calc'

describe('clipBondStakeCap()', () => {
  const minBondBalanceSol = 1000
  const c = makeConstraints({ minBondBalanceSol })

  it('returns 0 if balance < 0.8 * minBondBalanceSol', () => {
    const v = makeValidator({ bondBalanceSol: 0.5 * minBondBalanceSol })
    expect(c.clipBondStakeCap(v, 9999)).toBe(0)
  })

  it('clips to existing stake if balance < minBond but ≥ 0.8*min', () => {
    const v = makeValidator({
      bondBalanceSol: 0.9 * 1000,
      marinadeActivatedStakeSol: 1234,
    })
    expect(c.clipBondStakeCap(v, 10000)).toBe(1234)
  })

  it('returns raw limit when balance ≥ minBondBalanceSol', () => {
    const v = makeValidator({
      bondBalanceSol: 2000,
      marinadeActivatedStakeSol: 50,
    })
    expect(c.clipBondStakeCap(v, 777)).toBe(777)
  })

  it('clips to existing stake at exactly 0.8 * minBondBalanceSol (middle branch)', () => {
    const v = makeValidator({
      bondBalanceSol: 0.8 * minBondBalanceSol,
      marinadeActivatedStakeSol: 500,
    })
    expect(c.clipBondStakeCap(v, 10000)).toBe(500)
  })

  it('returns raw limit at exactly 1.0 * minBondBalanceSol (third branch)', () => {
    const v = makeValidator({
      bondBalanceSol: 1.0 * minBondBalanceSol,
      marinadeActivatedStakeSol: 50,
    })
    expect(c.clipBondStakeCap(v, 777)).toBe(777)
  })
})

describe('bondStakeCapSam()', () => {
  const c = makeConstraints({
    marinadeValidatorStakeCapSol: 1e9,
    minBondBalanceSol: 1,
    minBondEpochs: 1,
    idealBondEpochs: 2,
  })

  it('calculates the expected limit from PMPE-based formula', () => {
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 50,
      revShare: buildRevShare({
        expectedMaxEffBidPmpe: 5,
        onchainDistributedPmpe: 10,
      }),
    })
    const result = 1000 / (25 / 1000)
    expect(c.bondStakeCapSam(v)).toBeCloseTo(result, 6)
  })

  it('when marinadeActivatedStakeSol is between ideal and min, cap=marinadeActivatedStakeSol', () => {
    const c2 = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2 })
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 70000,
      revShare: buildRevShare({
        expectedMaxEffBidPmpe: 5,
        onchainDistributedPmpe: 0,
      }),
    })
    expect(c2.bondStakeCapSam(v)).toBe(70000)
  })

  it('when marinadeActivatedStakeSol > minLimit, cap=minLimit', () => {
    const c3 = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 1 })
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 200000,
      revShare: buildRevShare({
        auctionEffectiveBidPmpe: 0,
        activatingStakePmpe: 0,
        effParticipatingBidPmpe: 0,
        expectedMaxEffBidPmpe: 5,
        bidTooLowPenaltyPmpe: 0,
        onchainDistributedPmpe: 0,
      }),
    })
    expect(c3.bondStakeCapSam(v)).toBeCloseTo(100000, 0)
  })

  // Shared constraints for regression and related edge cases:
  // bond=550, bid=1, onchain=0, minBondEpochs=4, idealBondEpochs=12, unprotectedCap=30k
  // → idealLimit ≈ 14615, minLimit = 86000
  const c4 = makeConstraints({
    marinadeValidatorStakeCapSol: Infinity,
    minBondBalanceSol: 0,
    minBondEpochs: 4,
    idealBondEpochs: 12,
    unprotectedValidatorStakeCapSol: 30_000,
    unprotectedDelegatedStakeDec: 1,
    minUnprotectedStakeToDelegateSol: 0,
  })
  const IDEAL_LIMIT = (550 - 30_000 * (12 / 1000)) / (13 / 1000)
  const MIN_LIMIT = (550 - 30_000 * (4 / 1000)) / (5 / 1000)

  it('does not exceed marinadeActivatedStakeSol when exposed stake is between idealLimit and minLimit', () => {
    // With unprotectedStakeSol > 0, the formula must use exposed stake (not total) in the max()
    // comparison:
    //   limit = min(minLimit, max(idealLimit, marinadeActivatedStakeSol - unprotectedStakeSol))
    // When exposed is between ideal and min, limit = exposed → cap = marinadeActivatedStakeSol (stable).
    const marinadeActivatedStakeSol = 100_000
    const v = makeValidator({
      bondBalanceSol: 550,
      marinadeActivatedStakeSol,
      totalActivatedStakeSol: marinadeActivatedStakeSol + 30_000, // unprotectedStakeSol = 30k
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    // exposed = 70k; idealLimit ≈ 14.6k; minLimit ≈ 86k → exposed between ideal and min
    // limit = min(86k, max(14.6k, 70k[exposed])) = 70k → cap = 100k = marinadeActivatedStakeSol
    expect(c4.bondStakeCapSam(v)).toBeCloseTo(marinadeActivatedStakeSol, 0)
  })

  it('no unprotected stake: anti-flap sets cap = marinadeActivatedStakeSol', () => {
    // bond=1000, bid=5, onchain=0 → minBondPmpe=10, idealBondPmpe=15
    // minLimit = 1000/(10/1000) = 100k, idealLimit = 1000/(15/1000) ≈ 66.67k
    // exposed = 70k (between ideal and min) → limit = 70k → cap = 70k = marinadeActivated
    const cNoUnprotected = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2, minBondBalanceSol: 0 })
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 70_000,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 0 }),
    })
    expect(cNoUnprotected.bondStakeCapSam(v)).toBeCloseTo(70_000, 0)
  })

  it('exposed below idealLimit: cap = idealLimit + unprotected', () => {
    // marinadeActivated=5k → exposed = max(0, 5k-30k) = 0 < idealLimit≈14.6k
    // limit = min(86k, max(14.6k, 0)) = idealLimit → cap = idealLimit + 30k
    const v = makeValidator({
      bondBalanceSol: 550,
      marinadeActivatedStakeSol: 5_000,
      totalActivatedStakeSol: 35_000, // unprotectedStakeSol = 30k
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    expect(c4.bondStakeCapSam(v)).toBeCloseTo(IDEAL_LIMIT + 30_000, 0)
  })

  it('exposed exactly at idealLimit: cap = idealLimit + unprotected = marinadeActivated', () => {
    // marinadeActivated = idealLimit + 30k → exposed = idealLimit exactly
    // limit = min(86k, max(idealLimit, idealLimit)) = idealLimit → cap = idealLimit + 30k = marinadeActivated
    const marinadeActivatedStakeSol = IDEAL_LIMIT + 30_000
    const v = makeValidator({
      bondBalanceSol: 550,
      marinadeActivatedStakeSol,
      totalActivatedStakeSol: marinadeActivatedStakeSol + 30_000,
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    expect(c4.bondStakeCapSam(v)).toBeCloseTo(marinadeActivatedStakeSol, 0)
  })

  it('exposed above minLimit: cap = minLimit + unprotected', () => {
    // marinadeActivated=120k → exposed = 90k > minLimit=86k
    // limit = min(86k, max(14.6k, 90k)) = 86k → cap = 116k
    const v = makeValidator({
      bondBalanceSol: 550,
      marinadeActivatedStakeSol: 120_000,
      totalActivatedStakeSol: 150_000,
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    expect(c4.bondStakeCapSam(v)).toBeCloseTo(MIN_LIMIT + 30_000, 0)
  })

  it('marinadeActivated=0, unprotected=0: cap >= 0', () => {
    const cZero = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2, minBondBalanceSol: 0 })
    const v = makeValidator({
      bondBalanceSol: 500,
      marinadeActivatedStakeSol: 0,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 0 }),
    })
    expect(cZero.bondStakeCapSam(v)).toBeGreaterThanOrEqual(0)
  })

  it('marinadeActivated = unprotected exactly: all stake is unprotected, limit = idealLimit', () => {
    // marinadeActivated=30k, totalActivated=60k → unprotectedStakeSol=30k, exposed=0
    // limit = min(86k, max(idealLimit, 0)) = idealLimit → cap = idealLimit + 30k
    const marinadeActivatedStakeSol = 30_000
    const v = makeValidator({
      bondBalanceSol: 550,
      marinadeActivatedStakeSol,
      totalActivatedStakeSol: 60_000,
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    expect(c4.bondStakeCapSam(v)).toBeCloseTo(IDEAL_LIMIT + 30_000, 0)
    expect(c4.bondStakeCapSam(v)).toBeLessThan(marinadeActivatedStakeSol + 30_000)
  })

  it('low bond limits unprotectedStakeSol below unprotectedStakeCap via maxUnprotectedStakeSol', () => {
    // bond=10 SOL, expectedMaxEffBidPmpe=1, idealBondEpochs=12
    // → idealBidReservePmpe = 12*1 = 12
    // → maxUnprotectedStakeSol = 10 / (12/1000) ≈ 833.33  (<< unprotectedStakeCap=30k)
    // → unprotectedStakeSol = min(30k, 833.33) ≈ 833.33
    // → idealUnprotectedReserve = 833.33 * (12/1000) = 10.0  (exactly bonds out)
    // → idealLimit = max(0, 10 - 10) / (13/1000) = 0
    // → minUnprotectedReserve = 833.33 * (4/1000) ≈ 3.333
    // → minLimit = max(0, 10 - 3.333) / (5/1000) = 6.667 / 0.005 ≈ 1333.33
    // → marinadeActivated=0: protectedActivated=0, limit = min(1333.33, max(0, 0)) = 0
    // → cap = clipBondStakeCap(v, 0 + 833.33) = 833.33  (bond=10 > minBondBalance=0)
    const cLowBond = makeConstraints({
      marinadeValidatorStakeCapSol: Infinity,
      minBondBalanceSol: 0,
      minBondEpochs: 4,
      idealBondEpochs: 12,
      unprotectedValidatorStakeCapSol: 30_000,
      unprotectedDelegatedStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    const bondBalanceSol = 10
    const idealBidReservePmpe = 12 * 1 // idealBondEpochs * expectedMaxEffBidPmpe
    const maxUnprotectedStakeSol = bondBalanceSol / (idealBidReservePmpe / 1000)
    // maxUnprotectedStakeSol ≈ 833.33, which is less than unprotectedStakeCap=30k
    const v = makeValidator({
      bondBalanceSol,
      marinadeActivatedStakeSol: 0,
      totalActivatedStakeSol: 60_000, // ensures unprotectedStakeCap returns 30k
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    const cap = cLowBond.bondStakeCapSam(v)
    expect(cap).toBeCloseTo(maxUnprotectedStakeSol, 3)
    expect(v.unprotectedStakeSol).toBeCloseTo(maxUnprotectedStakeSol, 3)
    expect(v.unprotectedStakeSol).toBeLessThan(30_000)
  })
})

describe('bondGoodForNEpochs', () => {
  // minBondEpochs=1, expectedMaxEffBidPmpe=5, marinadeActivatedStakeSol=200
  // costPerEpoch = stake * pmpe/1000 = 200 * 5/1000 = 1 SOL/epoch
  // bondBalanceForBids = bondBalanceSol - onchain * stake/1000
  // goodFor = bondBalanceForBids / costPerEpoch - (1 + minBondEpochs)
  // fee threshold bond = (onchain + (1+minBondEpochs)*effBid)/1000*stake = (0 + 2*5)/1000*200 = 2 SOL
  const c = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2, minBondBalanceSol: 1 })

  it.each([
    { label: 'at fee threshold → 0', bondBalanceSol: 2, onchainDistributedPmpe: 0, expected: 0 },
    { label: 'above threshold → positive', bondBalanceSol: 3, onchainDistributedPmpe: 0, expected: 1 },
    { label: 'below threshold → negative', bondBalanceSol: 0.5, onchainDistributedPmpe: 0, expected: -1.5 },
    { label: 'zero bond, no onchain → -(1+minBondEpochs)', bondBalanceSol: 0, onchainDistributedPmpe: 0, expected: -2 },
    {
      label: 'zero bond, onchain debt → below -(1+minBondEpochs)',
      bondBalanceSol: 0,
      onchainDistributedPmpe: 5,
      expected: -3,
    }, // deficit = 200*5/1000 = 1 → goodFor = -1/1 - 2 = -3
    { label: 'onchainDistributedPmpe reduces', bondBalanceSol: 2, onchainDistributedPmpe: 2, expected: -0.4 }, // reserve = 200*2/1000 = 0.4
  ])('$label', ({ bondBalanceSol, onchainDistributedPmpe, expected }) => {
    const v = makeValidator({
      bondBalanceSol,
      marinadeActivatedStakeSol: 200,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe }),
    })
    c.bondStakeCapSam(v)
    expect(v.bondGoodForNEpochs).toBeCloseTo(expected, 6)
  })

  it('unprotected stake present: bondBalanceForBids uses protectedStakeSol not marinadeActivated', () => {
    // marinadeActivated=200, totalActivated=400 (external=200)
    // unprotectedDelegatedStakeDec=1, unprotectedValidatorStakeCapSol=200 → unprotectedStakeCap=200
    // idealBidReservePmpe = idealBondEpochs*5 = 2*5 = 10
    // maxUnprotectedStakeSol = bond / (idealBidReservePmpe/1000) = 100/0.01 = 10000
    // unprotectedStakeSol = min(200, 10000) = 200
    // protectedStakeSol = max(0, 200 - 200) = 0
    // bondBalanceForBids = 100 - (100/1000)*0 = 100   ← correct: uses protectedStakeSol
    // wrong would be:      100 - (100/1000)*200 = 80  ← wrong: would use marinadeActivatedStakeSol
    // costPerEpoch = (5/1000)*200 = 1
    // bondGoodForNEpochs = 100/1 - (1+1) = 98  (wrong formula gives 78 — gap of 20)
    const cu = makeConstraints({
      minBondEpochs: 1,
      idealBondEpochs: 2,
      minBondBalanceSol: 1,
      unprotectedValidatorStakeCapSol: 200,
      unprotectedDelegatedStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    const v = makeValidator({
      bondBalanceSol: 100,
      marinadeActivatedStakeSol: 200,
      totalActivatedStakeSol: 400,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 100 }),
    })
    cu.bondStakeCapSam(v)
    expect(v.bondGoodForNEpochs).toBeCloseTo(98, 6)
  })

  it('zero stake → Infinity (bond never depletes)', () => {
    const v = makeValidator({
      bondBalanceSol: 1,
      marinadeActivatedStakeSol: 0,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 0 }),
    })
    makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2, minBondBalanceSol: 1 }).bondStakeCapSam(v)
    expect(v.bondGoodForNEpochs).toBe(Infinity)
  })
})

describe('bondGoodForNEpochs vs calcBondRiskFee threshold', () => {
  // fee threshold: bond = minBondPmpe/1000 * stake = (onchain + (1+minBondEpochs)*effBid)/1000 * stake
  // rearranging: bondGoodForNEpochs = (bond - onchain*stake/1000) / (effBid/1000*stake) - (1+minBondEpochs) = 0
  // so fee triggers ↔ bondGoodForNEpochs < 0
  const minBondEpochs = 1
  const idealBondEpochs = 2
  const effBid = 5
  const onchain = 2
  const stake = 200
  // costPerEpoch = effBid/1000 * stake = 1 SOL
  // bondForBids at threshold = (1+minBondEpochs) * 1 = 2 SOL
  // bond at threshold = onchain/1000 * stake + 2 = 0.4 + 2 = 2.4 SOL
  const feeConfig = { minBondEpochs, idealBondEpochs: 2, minBondBalanceSol: 0, bondRiskFeeMult: 0.1 }
  const c = makeConstraints({ minBondEpochs, idealBondEpochs, minBondBalanceSol: 0 })

  function buildValidatorAndComputeFee(bondBalanceSol: number) {
    const v = makeValidator({
      bondBalanceSol,
      claimableBondBalanceSol: bondBalanceSol,
      marinadeActivatedStakeSol: stake,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: effBid, onchainDistributedPmpe: onchain }),
    })
    c.bondStakeCapSam(v)
    return { goodFor: v.bondGoodForNEpochs, fee: calcBondRiskFee(feeConfig, v) }
  }

  it('exactly at threshold: bondGoodForNEpochs=0, no fee', () => {
    const { goodFor, fee } = buildValidatorAndComputeFee(2.4)
    expect(goodFor).toBeCloseTo(0, 6)
    expect(fee).toBeNull()
  })

  it('just above threshold: bondGoodForNEpochs>0, no fee', () => {
    const { goodFor, fee } = buildValidatorAndComputeFee(2.5)
    expect(goodFor).toBeGreaterThan(0)
    expect(fee).toBeNull()
  })

  it('just below threshold: bondGoodForNEpochs<0, fee generated', () => {
    const { goodFor, fee } = buildValidatorAndComputeFee(2.3)
    expect(goodFor).toBeLessThan(0)
    expect(fee).not.toBeNull()
  })
})

describe('unprotectedStakeCap()', () => {
  // override the defaults so we can test all branches
  const c = makeConstraints({
    unprotectedValidatorStakeCapSol: 100,
    unprotectedDelegatedStakeDec: 1,
    unprotectedFoundationStakeDec: 1,
    minUnprotectedStakeToDelegateSol: 10,
  })

  it('returns 0 if delegated stake <= 0', () => {
    // total 5, self+foundation = 10 → delegated = -5 → clamp to 0
    const v = makeValidator({
      totalActivatedStakeSol: 5,
      selfStakeSol: 6,
      foundationStakeSol: 4,
    })
    expect(c.unprotectedStakeCap(v)).toBe(0)
  })

  it('returns 0 when computed cap is below the min threshold', () => {
    // total 15, self=10, foundation=0 → delegated=5 < min(10)
    const v = makeValidator({
      totalActivatedStakeSol: 15,
      selfStakeSol: 10,
      foundationStakeSol: 0,
    })
    expect(c.unprotectedStakeCap(v)).toBe(0)
  })

  it('returns computed delegated stake when between min threshold and validator cap', () => {
    // total 30, self=10 → delegated=20 → above min(10) and below cap(100)
    const v = makeValidator({
      totalActivatedStakeSol: 30,
      selfStakeSol: 10,
      foundationStakeSol: 0,
    })
    expect(c.unprotectedStakeCap(v)).toBe(20)
  })

  it('caps at unprotectedValidatorStakeCapSol when computed > capSol', () => {
    // total 200, self=50 → delegated=150 → capped to 100
    const v = makeValidator({
      totalActivatedStakeSol: 200,
      selfStakeSol: 50,
      foundationStakeSol: 0,
    })
    expect(c.unprotectedStakeCap(v)).toBe(100)
  })

  it('includes foundationStakeSol at full weight', () => {
    // no delegated stake but 20 foundation stake → computed = 0*1 + 20*1 = 20
    const v = makeValidator({
      totalActivatedStakeSol: 20,
      selfStakeSol: 0,
      foundationStakeSol: 20,
    })
    expect(c.unprotectedStakeCap(v)).toBe(20)
  })
})

describe('getMinCapForEvenDistribution() & findCapForValidator()', () => {
  const c = makeConstraints({
    totalCountryStakeCapSol: 100,
    totalAsoStakeCapSol: 1000,
    marinadeCountryStakeCapSol: 50,
    marinadeAsoStakeCapSol: 1000,
    marinadeValidatorStakeCapSol: 1000,
  })

  const v1 = makeValidator({
    voteAccount: 'v1',
    country: 'C',
    aso: 'A',
    auctionStake: {
      externalActivatedSol: 60,
      marinadeSamTargetSol: 5,
    },
  })
  const v2 = makeValidator({
    voteAccount: 'v2',
    country: 'C',
    aso: 'A',
    auctionStake: {
      externalActivatedSol: 60,
      marinadeSamTargetSol: 5,
    },
  })

  beforeEach(() => {
    const data = makeAuction({ validators: [v1, v2] })
    c.updateStateForSam(data)
  })

  it('computes min cap correctly and selects COUNTRY constraint', () => {
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v1', 'v2']))
    expect(cap).toBe(0)
    expect(constraint.constraintType).toBe('COUNTRY')
  })

  it('findCapForValidator wraps and sets lastCapConstraint when cap < EPSILON', () => {
    const singleCap = c.findCapForValidator(v1)
    expect(singleCap).toBe(0)
    expect(v1.lastCapConstraint?.constraintType).toBe('COUNTRY')
  })
})

describe('getMinCapForEvenDistribution positive scenarios', () => {
  const cpos = makeConstraints({
    totalCountryStakeCapSol: 200,
    totalAsoStakeCapSol: 1000,
    marinadeCountryStakeCapSol: 100,
    marinadeAsoStakeCapSol: 1000,
    marinadeValidatorStakeCapSol: 1000,
  })

  const x1 = makeValidator({
    voteAccount: 'x1',
    country: 'Z',
    aso: 'A1',
    auctionStake: {
      externalActivatedSol: 50,
      marinadeSamTargetSol: 10,
    },
  })
  const x2 = makeValidator({
    voteAccount: 'x2',
    country: 'Z',
    aso: 'A1',
    auctionStake: {
      externalActivatedSol: 30,
      marinadeSamTargetSol: 10,
    },
  })
  it('returns positive cap = min(totalLeft,marinadeLeft)/2', () => {
    const data = makeAuction({ validators: [x1, x2] })
    cpos.updateStateForSam(data)
    // x1: externalActivatedSol=50 + marinadeSamTargetSol=10 = 60; x2: 30+10=40; consumed=100; totalLeft=200-100=100; marinadeLeft=100-20=80; /2=40
    const { cap, constraint } = cpos.getMinCapForEvenDistribution(new Set(['x1', 'x2']))
    expect(cap).toBe(40)
    expect(constraint.constraintType).toBe('COUNTRY')
  })

  it('selects the actual minimal constraint (COUNTRY) when ASO is less binding', () => {
    const c2 = makeConstraints({
      totalCountryStakeCapSol: 1000000,
      marinadeCountryStakeCapSol: 100,
    })
    const y1 = makeValidator({
      voteAccount: 'y1',
      country: 'Q',
      aso: 'B1',
      auctionStake: {
        externalActivatedSol: 20,
        marinadeSamTargetSol: 10,
      },
    })
    const data2 = makeAuction({ validators: [y1] })
    c2.updateStateForSam(data2)
    const { cap, constraint } = c2.getMinCapForEvenDistribution(new Set(['y1']))
    expect(cap).toBe(90)
    expect(constraint.constraintType).toBe('COUNTRY')
  })
})

describe('findCapForValidator when cap > EPSILON', () => {
  const c = makeConstraints({
    totalCountryStakeCapSol: 100,
    totalAsoStakeCapSol: 100,
    marinadeCountryStakeCapSol: 50,
    marinadeAsoStakeCapSol: 100,
    marinadeValidatorStakeCapSol: 100,
  })
  const z1 = makeValidator({
    voteAccount: 'z1',
    country: 'Z',
    aso: 'A',
    auctionStake: {
      externalActivatedSol: 1,
      marinadeSamTargetSol: 0,
    },
  })
  it('does not set lastCapConstraint when cap is positive', () => {
    c.updateStateForSam(makeAuction({ validators: [z1] }))
    const cap = c.findCapForValidator(z1)
    expect(cap).toBeGreaterThan(0)
    expect(z1.lastCapConstraint).toBeNull()
  })
})

describe('getMinCapForEvenDistribution – ASO wins', () => {
  const c = makeConstraints({
    totalCountryStakeCapSol: 1e6,
    marinadeCountryStakeCapSol: 1e6,
    totalAsoStakeCapSol: 10,
    marinadeAsoStakeCapSol: 2,
  })

  const v1 = makeValidator({
    voteAccount: 'v1',
    country: 'X',
    aso: 'Z',
    auctionStake: {
      externalActivatedSol: 3,
      marinadeSamTargetSol: 1,
    },
  })
  const v2 = makeValidator({
    voteAccount: 'v2',
    country: 'X',
    aso: 'Z',
    auctionStake: {
      externalActivatedSol: 3,
      marinadeSamTargetSol: 1,
    },
  })

  it('picks ASO when it is the tightest cap', () => {
    const data = makeAuction({ validators: [v1, v2] })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v1', 'v2']))
    expect(cap).toBe(0)
    expect(constraint.constraintType).toBe('ASO')
  })
})

describe('getMinCapForEvenDistribution – WANT wins', () => {
  const c = makeConstraints({
    totalCountryStakeCapSol: Infinity,
    marinadeCountryStakeCapSol: Infinity,
    totalAsoStakeCapSol: Infinity,
    marinadeAsoStakeCapSol: Infinity,
    minMaxStakeWanted: 0,
  })

  const v = makeValidator({
    voteAccount: 'v',
    maxStakeWanted: 5,
    auctionStake: {
      externalActivatedSol: 100,
      marinadeSamTargetSol: 0,
    },
  })

  it('picks WANT when maxStakeWanted is the binding cap', () => {
    const data = makeAuction({ validators: [v] })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v']))
    expect(cap).toBe(5)
    expect(constraint.constraintType).toBe('WANT')
  })
})

describe('getMinCapForEvenDistribution – Sam‐BOND wins', () => {
  const c = makeConstraints({
    totalCountryStakeCapSol: Infinity,
    marinadeCountryStakeCapSol: Infinity,
    totalAsoStakeCapSol: Infinity,
    marinadeAsoStakeCapSol: Infinity,
    minBondEpochs: 0,
    idealBondEpochs: 0,
  })

  const v = makeValidator({
    voteAccount: 'v',
    bondBalanceSol: 1000,
    revShare: buildRevShare({
      inflationPmpe: 0,
      mevPmpe: 0,
      bidPmpe: 0,
      totalPmpe: 0,
      auctionEffectiveBidPmpe: 0,
      activatingStakePmpe: 0,
      effParticipatingBidPmpe: 0,
      expectedMaxEffBidPmpe: 1000,
      bidTooLowPenaltyPmpe: 0,
    }),
  })

  it('picks BOND when its per‐validator bond cap is smallest', () => {
    const data = makeAuction({ validators: [v] })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v']))
    expect(cap).toBeCloseTo(1000, 6)
    expect(constraint.constraintType).toBe('BOND')
  })
})

describe('getMinCapForEvenDistribution – no constraints', () => {
  const c = makeConstraints()
  it('throws if voteAccounts set is empty', () => {
    expect(() => c.getMinCapForEvenDistribution(new Set())).toThrow(/Failed to find/)
  })
})

describe('minCapFromConstraint edge cases', () => {
  it('with affectedValidators=0 returns Infinity', () => {
    const constraint: AuctionConstraint = {
      constraintType: AuctionConstraintType.COUNTRY,
      constraintName: 'X',
      totalStakeSol: 0,
      totalLeftToCapSol: 100,
      marinadeStakeSol: 0,
      marinadeLeftToCapSol: 50,
      validators: [makeValidator({ voteAccount: 'other' })],
    }
    const { cap, affectedValidators } = minCapFromConstraint(constraint, new Set(['missing']))
    expect(affectedValidators).toBe(0)
    expect(cap).toBe(Infinity)
  })

  it('clamps negative leftToCap to 0', () => {
    const constraint: AuctionConstraint = {
      constraintType: AuctionConstraintType.COUNTRY,
      constraintName: 'X',
      totalStakeSol: 0,
      totalLeftToCapSol: -10,
      marinadeStakeSol: 0,
      marinadeLeftToCapSol: -5,
      validators: [makeValidator({ voteAccount: 'v' })],
    }
    const { cap } = minCapFromConstraint(constraint, new Set(['v']))
    expect(cap).toBe(0)
  })
})

describe('bondStakeCapSam edge cases', () => {
  it('all-zero PMPE yields Infinity', () => {
    const c = makeConstraints()
    const v = makeValidator({
      bondBalanceSol: 1000,
      revShare: buildRevShare(),
    })
    expect(c.bondStakeCapSam(v)).toBe(Infinity)
  })

  it('bondBalanceSol=0 yields 0', () => {
    const c = makeConstraints()
    const v = makeValidator({
      bondBalanceSol: 0,
      revShare: buildRevShare({
        onchainDistributedPmpe: 100,
        expectedMaxEffBidPmpe: 50,
      }),
    })
    expect(c.bondStakeCapSam(v)).toBe(0)
  })

  it('both bondBalanceSol=0 AND all PMPE=0 yields NaN', () => {
    const c = makeConstraints({
      minBondEpochs: 0,
      idealBondEpochs: 0,
      minBondBalanceSol: 0,
    })
    const v = makeValidator({
      bondBalanceSol: 0,
      marinadeActivatedStakeSol: 0,
      revShare: buildRevShare({
        expectedMaxEffBidPmpe: 0,
        onchainDistributedPmpe: 0,
      }),
    })
    expect(c.bondStakeCapSam(v)).toBeNaN()
  })
})

describe('clipBondStakeCap edge cases', () => {
  it('with negative limit returns 0 (bond below 0.8 * minBondBalanceSol floor)', () => {
    // bondBalanceSol=5 < 0.8*minBondBalanceSol=8 → first branch returns 0 regardless of limit
    const c = makeConstraints({ minBondBalanceSol: 10 })
    const v = makeValidator({
      bondBalanceSol: 5,
      marinadeActivatedStakeSol: 100,
    })
    expect(c.clipBondStakeCap(v, -5)).toBe(0)
  })

  it('hysteresis: bond between 0.8x and 1x', () => {
    const c = makeConstraints({
      minBondBalanceSol: 10,
      minBondEpochs: 0,
      idealBondEpochs: 0,
    })
    const v = makeValidator({
      bondBalanceSol: 9,
      marinadeActivatedStakeSol: 50,
      revShare: buildRevShare({
        expectedMaxEffBidPmpe: 0,
        onchainDistributedPmpe: 0,
      }),
    })
    expect(c.bondStakeCapSam(v)).toBe(50)

    const v2 = makeValidator({
      bondBalanceSol: 7,
      marinadeActivatedStakeSol: 50,
      revShare: buildRevShare({
        expectedMaxEffBidPmpe: 0,
        onchainDistributedPmpe: 0,
      }),
    })
    expect(c.bondStakeCapSam(v2)).toBe(0)
  })
})

describe('unprotectedStakeCap edge cases', () => {
  it('counts foundation stake when foundation exceeds total activated', () => {
    const c = makeConstraints({
      unprotectedValidatorStakeCapSol: 1000,
      unprotectedDelegatedStakeDec: 1,
      unprotectedFoundationStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    const v = makeValidator({
      totalActivatedStakeSol: 100,
      selfStakeSol: 0,
      foundationStakeSol: 200,
    })
    expect(c.unprotectedStakeCap(v)).toBe(200)
  })

  it('zeroes cap below minimum threshold', () => {
    const c = makeConstraints({
      unprotectedValidatorStakeCapSol: 1000,
      unprotectedDelegatedStakeDec: 1,
      unprotectedFoundationStakeDec: 0,
      minUnprotectedStakeToDelegateSol: 500,
    })
    const v1 = makeValidator({
      totalActivatedStakeSol: 600,
    })
    expect(c.unprotectedStakeCap(v1)).toBe(600)

    const v2 = makeValidator({
      totalActivatedStakeSol: 400,
    })
    expect(c.unprotectedStakeCap(v2)).toBe(0)
  })

  it('with fractional coefficients', () => {
    const c = makeConstraints({
      unprotectedValidatorStakeCapSol: 10_000,
      unprotectedDelegatedStakeDec: 0.5,
      unprotectedFoundationStakeDec: 0,
      minUnprotectedStakeToDelegateSol: 0,
    })
    const v = makeValidator({
      totalActivatedStakeSol: 1000,
      selfStakeSol: 0,
      foundationStakeSol: 0,
    })
    expect(c.unprotectedStakeCap(v)).toBe(500)
  })
})

describe('SAM vs backstop constraint types', () => {
  it('SAM uses BOND constraint, backstop uses RISK', () => {
    const v = makeValidator({
      voteAccount: 'v1',
      country: 'X',
      aso: 'A1',
      bondBalanceSol: 10,
      totalActivatedStakeSol: 500,
      selfStakeSol: 100,
      auctionStake: {
        externalActivatedSol: 100,
        marinadeSamTargetSol: 0,
      },
      revShare: buildRevShare({
        inflationPmpe: 10,
        mevPmpe: 5,
        expectedMaxEffBidPmpe: 5,
        onchainDistributedPmpe: 15,
      }),
    })
    const data = makeAuction({ validators: [v] })

    const cSam = makeConstraints({
      minBondEpochs: 1,
      idealBondEpochs: 2,
      unprotectedValidatorStakeCapSol: 100,
      unprotectedDelegatedStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    cSam.updateStateForSam(data)
    expect(cSam.getMinCapForEvenDistribution(new Set(['v1'])).constraint.constraintType).toBe('BOND')

    const cBack = makeConstraints({
      minBondEpochs: 1,
      idealBondEpochs: 2,
      unprotectedValidatorStakeCapSol: 100,
      unprotectedDelegatedStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    cBack.updateStateForBackstop(data)
    expect(cBack.getMinCapForEvenDistribution(new Set(['v1'])).constraint.constraintType).toBe('RISK')
  })
})

describe('buildSamWantConstraints floors', () => {
  it('no activated-stake floor: maxStakeWanted caps the target even when current stake exceeds it', () => {
    // maxStakeWanted=5, marinadeActivated=100 → clipped cap = max(0, 5) = 5
    // marinadeLeftToCapSol = 5 - 0 (marinadeSamTargetSol) = 5
    const v = makeValidator({
      voteAccount: 'v_floor1',
      maxStakeWanted: 5,
      marinadeActivatedStakeSol: 100,
      auctionStake: { externalActivatedSol: 0, marinadeSamTargetSol: 0 },
    })
    const data = makeAuction({ validators: [v] })
    const c = makeConstraints({ minMaxStakeWanted: 0 })
    c.updateStateForSam(data)
    const constraints = c.getValidatorConstraints('v_floor1')
    assert(constraints)
    const want = constraints.find(x => x.constraintType === AuctionConstraintType.WANT)
    assert(want)
    expect(want.marinadeLeftToCapSol).toBe(5)
  })

  it('minMaxStakeWanted floor: config minimum applies when maxStakeWanted is below it and marinadeActivated=0', () => {
    // maxStakeWanted=50, marinadeActivated=0, minMaxStakeWanted=1000
    // clipped cap = max(1000, 50) = 1000
    // marinadeLeftToCapSol = 1000 - 0 = 1000
    const v = makeValidator({
      voteAccount: 'v_floor2',
      maxStakeWanted: 50,
      marinadeActivatedStakeSol: 0,
      auctionStake: { externalActivatedSol: 0, marinadeSamTargetSol: 0 },
    })
    const data = makeAuction({ validators: [v] })
    const c = makeConstraints({ minMaxStakeWanted: 1000 })
    c.updateStateForSam(data)
    const constraints = c.getValidatorConstraints('v_floor2')
    assert(constraints)
    const want = constraints.find(x => x.constraintType === AuctionConstraintType.WANT)
    assert(want)
    expect(want.marinadeLeftToCapSol).toBe(1000)
  })
})

describe('getMinCapForEvenDistribution – VALIDATOR wins', () => {
  // marinadeValidatorStakeCapSol=50, marinadeSamTargetSol=10 → marinadeLeftToCapSol=40
  // All other caps are Infinity, bond is huge → VALIDATOR is the binding constraint.
  const c = makeConstraints({
    marinadeValidatorStakeCapSol: 50,
    totalCountryStakeCapSol: Infinity,
    marinadeCountryStakeCapSol: Infinity,
    totalAsoStakeCapSol: Infinity,
    marinadeAsoStakeCapSol: Infinity,
    minMaxStakeWanted: 0,
    minBondEpochs: 0,
    idealBondEpochs: 0,
    minBondBalanceSol: 0,
  })

  const v = makeValidator({
    voteAccount: 'v1',
    country: 'US',
    aso: 'A',
    bondBalanceSol: 1e9,
    auctionStake: {
      externalActivatedSol: 0,
      marinadeSamTargetSol: 10,
    },
    revShare: buildRevShare({ expectedMaxEffBidPmpe: 0, onchainDistributedPmpe: 0 }),
  })

  it('picks VALIDATOR when marinadeValidatorStakeCapSol is the binding cap', () => {
    const data = makeAuction({ validators: [v] })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v1']))
    expect(cap).toBe(40)
    expect(constraint.constraintType).toBe('VALIDATOR')
  })
})

describe('buildSamWantConstraints edge cases', () => {
  it('negative maxStakeWanted treated as Infinity', () => {
    const v = makeValidator({
      voteAccount: 'v1',
      maxStakeWanted: -100,
      marinadeActivatedStakeSol: 0,
    })
    const data = makeAuction({ validators: [v] })
    const c = makeConstraints({ minMaxStakeWanted: 0 })
    c.updateStateForSam(data)
    const constraints = c.getValidatorConstraints('v1')
    assert(constraints)
    const want = constraints.find(x => x.constraintType === AuctionConstraintType.WANT)
    assert(want)
    expect(want.marinadeLeftToCapSol).toBe(Infinity)
  })

  it('maxStakeWanted=0 means uncapped (same as negative / unset)', () => {
    // 0 is the API sentinel for "no preference"; the condition `> 0` intentionally collapses it to Infinity.
    const v = makeValidator({
      voteAccount: 'v_zero_want',
      maxStakeWanted: 0,
      marinadeActivatedStakeSol: 0,
      auctionStake: { externalActivatedSol: 0, marinadeSamTargetSol: 0 },
    })
    const data = makeAuction({ validators: [v] })
    const c = makeConstraints({ minMaxStakeWanted: 0 })
    c.updateStateForSam(data)
    const constraints = c.getValidatorConstraints('v_zero_want')
    assert(constraints)
    const want = constraints.find(x => x.constraintType === AuctionConstraintType.WANT)
    assert(want)
    expect(want.marinadeLeftToCapSol).toBe(Infinity)
  })
})

describe('buildBackstopConstraints: negative marinadeLeftToCapSol is clamped to 0', () => {
  // Scenario: marinadeSamTargetSol=100k >> unprotectedStakeCap=30k
  // marinadeLeftToCapSol = 30k - 100k = -70k
  // minCapFromConstraint: Math.max(0, Math.min(Infinity, -70k)) / 1 = 0
  // Expected: RISK cap = 0 (no additional backstop allowed), not negative.
  it('RISK cap is 0 when marinadeSamTargetSol exceeds unprotectedStakeCap', () => {
    const v = makeValidator({
      voteAccount: 'vbig',
      country: 'X',
      aso: 'A',
      totalActivatedStakeSol: 500_000,
      selfStakeSol: 0,
      foundationStakeSol: 0,
      auctionStake: {
        externalActivatedSol: 0,
        marinadeSamTargetSol: 100_000,
      },
    })
    const data = makeAuction({ validators: [v] })
    const c = makeConstraints({
      unprotectedValidatorStakeCapSol: 30_000,
      unprotectedDelegatedStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    c.updateStateForBackstop(data)

    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['vbig']))
    // marinadeLeftToCapSol = 30k - 100k = -70k → clamped to 0 by Math.max(0, ...)
    expect(cap).toBe(0)
    expect(constraint.constraintType).toBe(AuctionConstraintType.RISK)

    // Verify the raw marinadeLeftToCapSol on the RISK constraint is indeed negative
    const constraints = c.getValidatorConstraints('vbig')
    const riskConstraint = constraints?.find(x => x.constraintType === AuctionConstraintType.RISK)
    assert(riskConstraint)
    expect(riskConstraint.marinadeLeftToCapSol).toBe(-70_000)
  })

  it('RISK cap is positive when marinadeSamTargetSol is within unprotectedStakeCap', () => {
    const v = makeValidator({
      voteAccount: 'vsmall',
      country: 'X',
      aso: 'A',
      totalActivatedStakeSol: 500_000,
      selfStakeSol: 0,
      foundationStakeSol: 0,
      auctionStake: {
        externalActivatedSol: 0,
        marinadeSamTargetSol: 10_000,
      },
    })
    const data = makeAuction({ validators: [v] })
    const c = makeConstraints({
      unprotectedValidatorStakeCapSol: 30_000,
      unprotectedDelegatedStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    c.updateStateForBackstop(data)

    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['vsmall']))
    // marinadeLeftToCapSol = 30k - 10k = 20k → cap = 20k
    expect(cap).toBe(20_000)
    expect(constraint.constraintType).toBe(AuctionConstraintType.RISK)
  })
})

describe('buildSamBondConstraints: negative marinadeLeftToCapSol is clamped to 0', () => {
  // Symmetric check: bondStakeCapSam can be less than marinadeSamTargetSol,
  // yielding negative marinadeLeftToCapSol on the BOND constraint.
  // minCapFromConstraint must clamp this to 0.
  it('BOND cap is 0 when marinadeSamTargetSol exceeds bondStakeCapSam', () => {
    // With minBondEpochs=0, idealBondEpochs=0, bond=0 → bondStakeCapSam=0
    // marinadeSamTargetSol=50k → marinadeLeftToCapSol = 0 - 50k = -50k → clamped to 0
    const v = makeValidator({
      voteAccount: 'vbond',
      country: 'X',
      aso: 'A',
      bondBalanceSol: 0,
      totalActivatedStakeSol: 200_000,
      selfStakeSol: 0,
      auctionStake: {
        externalActivatedSol: 0,
        marinadeSamTargetSol: 50_000,
      },
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 0 }),
    })
    const data = makeAuction({ validators: [v] })
    const c = makeConstraints({
      minBondEpochs: 0,
      idealBondEpochs: 0,
      minBondBalanceSol: 0,
    })
    c.updateStateForSam(data)

    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['vbond']))
    expect(cap).toBe(0)
    expect(constraint.constraintType).toBe(AuctionConstraintType.BOND)

    const constraints = c.getValidatorConstraints('vbond')
    const bondConstraint = constraints?.find(x => x.constraintType === AuctionConstraintType.BOND)
    assert(bondConstraint)
    expect(bondConstraint.marinadeLeftToCapSol).toBe(-50_000)
  })
})

describe('calcBondRiskFee uses exposed not total stake', () => {
  // Setup: marinadeActivated=100k, totalActivated=130k (30k external / unprotected)
  // After bondStakeCapSam with minBondEpochs=4, idealBondEpochs=12, expectedMaxEffBidPmpe=1:
  //   idealBidReservePmpe = 12*1 = 12, minBidReservePmpe = 4*1 = 4
  //   minBondPmpe  = 0 + 1 + 4 = 5
  //   idealBondPmpe= 0 + 1 + 12 = 13
  //   bond=500 → maxUnprotectedStakeSol = 500/0.012 ≈ 41667
  //   unprotectedStakeSol = min(30k, 41667) = 30k
  //   minUnprotectedReserve = 30k * (4/1000) = 120
  //   projectedExposedStakeSol = 100k - 30k = 70k
  //
  // Fee condition: claimable - 120 < 70k * (5/1000) = 350  →  claimable < 470
  // Wrong (total):            claimable - 120 < 100k * 0.005 = 500  →  claimable < 620
  //
  // claimable=500: 500-120=380 > 350 (exposed) → NO fee ✓ (would fire if code used total)
  // claimable=400: 400-120=280 < 350 (exposed) → fee fires ✓
  const c = makeConstraints({
    marinadeValidatorStakeCapSol: Infinity,
    minBondBalanceSol: 0,
    minBondEpochs: 4,
    idealBondEpochs: 12,
    unprotectedValidatorStakeCapSol: 30_000,
    unprotectedDelegatedStakeDec: 1,
    minUnprotectedStakeToDelegateSol: 0,
  })
  const feeConfig = { minBondEpochs: 4, idealBondEpochs: 12, minBondBalanceSol: 0, bondRiskFeeMult: 1 }

  function buildValidatorAndComputeFee(claimableSol: number) {
    const v = makeValidator({
      bondBalanceSol: 500,
      claimableBondBalanceSol: claimableSol,
      marinadeActivatedStakeSol: 100_000,
      totalActivatedStakeSol: 130_000,
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1, auctionEffectiveBidPmpe: 1 }),
    })
    c.bondStakeCapSam(v)
    return calcBondRiskFee(feeConfig, v)
  }

  it('no fee when claimable covers exposed but not total stake', () => {
    // claimable=500: exposed threshold 350 < 380 → null
    // If code used total: 500 > 380 → would return non-null
    expect(buildValidatorAndComputeFee(500)).toBeNull()
  })

  it('fee fires when claimable falls below exposed threshold', () => {
    // claimable=400: 280 < 350 → non-null
    expect(buildValidatorAndComputeFee(400)).not.toBeNull()
  })
})

describe('bondSamHealth boundary analysis', () => {
  // Setup:
  //   minBondEpochs=1, idealBondEpochs=2, expectedMaxEffBidPmpe=5, onchainDistributedPmpe=0
  //   minBondPmpe = 0 + 5 + 1*5 = 10   (= onchain + effBid + minBondEpochs*effBid)
  //   idealBondPmpe = 0 + 5 + 2*5 = 15
  //   bond=1000 → minLimit = 1000 / (10/1000) = 100_000
  //   No unprotected stake (unprotectedStakeCapSol=0)
  //   So minLimit + unprotectedStakeSol = 100_000 = the bond stake cap
  //
  // correction = N/(1+N) where N = max(10000, minMaxStakeWanted)
  // With minMaxStakeWanted=null (default), N=10000
  //   correction = 10000/10001 ≈ 0.99990001
  //
  // health = 100_000 / (1 + marinadeActivated) / correction
  // health = 1 when marinadeActivated = 100_000/correction - 1 ≈ 100_009

  // minMaxStakeWanted=0 → regularMinMaxStakeWanted = max(10000, 0) = 10000 (the floor)
  const c = makeConstraints({
    minBondEpochs: 1,
    idealBondEpochs: 2,
    minBondBalanceSol: 0,
    marinadeValidatorStakeCapSol: Infinity,
  })

  function makeValidatorAtStake(marinadeActivatedStakeSol: number) {
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 0 }),
    })
    c.bondStakeCapSam(v)
    return v
  }

  const N = 10_000
  const mult = 1.1 // bondSamHealthMult default
  const correction = N / (1 + N)
  const minLimit = 100_000 // bond/minBondPmpe*1000 = 1000/(10/1000)
  const healthAtMinLimit = (mult * minLimit) / (1 + minLimit) / correction
  const health1Threshold = (mult * minLimit) / correction - 1 // ≈ 110_010

  it('health is well above 1 when validator is exactly at the bond stake cap (min coverage threshold)', () => {
    // Validator at exact fee threshold: marinadeActivated = minLimit = 100_000
    // health = 1.1 * 100_000 / (1 + 100_000) / correction ≈ 1.1001 (well above 1)
    const v = makeValidatorAtStake(minLimit)
    expect(v.bondSamHealth).toBeCloseTo(healthAtMinLimit, 4)
    expect(v.bondSamHealth).toBeGreaterThan(1)
  })

  it('health crosses 1 at ~10% above the bond stake cap', () => {
    // health=1 threshold: marinadeActivated ≈ 1.1 * minLimit / correction - 1 ≈ 110_010
    // Below this: health > 1 (deemed healthy, excluded from underfunded unstake group)
    // Above this: health < 1 (deemed underfunded, gets priority unstake)
    const justBelow = makeValidatorAtStake(Math.floor(health1Threshold) - 1)
    const justAbove = makeValidatorAtStake(Math.ceil(health1Threshold) + 1)
    expect(justBelow.bondSamHealth).toBeGreaterThan(1)
    expect(justAbove.bondSamHealth).toBeLessThan(1)
    // The crossover is ~10% above minLimit (the grace zone created by bondSamHealthMult=1.1)
    expect(health1Threshold / minLimit).toBeCloseTo(1.1, 2)
  })

  it('health is significantly > 1 when marinadeActivated is at half the bond stake cap', () => {
    // marinadeActivated = 50_000 (half of cap = 100_000)
    // health = 1.1 * 100_000 / (1 + 50_000) / correction ≈ 2.2
    const v = makeValidatorAtStake(50_000)
    const expected = (mult * minLimit) / (1 + 50_000) / correction
    expect(v.bondSamHealth).toBeCloseTo(expected, 4)
    expect(v.bondSamHealth).toBeGreaterThan(1.9)
  })

  it('health is < 1 when marinadeActivated is 20% above the bond stake cap', () => {
    // marinadeActivated = 1.2 * minLimit = 120_000
    // health = 1.1 * 100_000 / (1 + 120_000) / correction ≈ 0.917
    const v = makeValidatorAtStake(1.2 * minLimit)
    const expected = (mult * minLimit) / (1 + 1.2 * minLimit) / correction
    expect(v.bondSamHealth).toBeCloseTo(expected, 4)
    expect(v.bondSamHealth).toBeLessThan(1)
  })

  it('health is large but finite when marinadeActivated = 0 (bond covers infinite epochs)', () => {
    // Without the +1 in denominator this would be division by zero; +1 prevents that.
    // With +1: health = 1.1 * minLimit / 1 / correction (large but finite)
    const v = makeValidatorAtStake(0)
    expect(isFinite(v.bondSamHealth)).toBe(true)
    expect(v.bondSamHealth).toBeGreaterThan(1)
    expect(v.bondSamHealth).toBeCloseTo((mult * minLimit) / 1 / correction, 0)
  })

  it('health < 1 validator gets lower unstakePriority index than healthy validator', () => {
    // Underfunded validator should appear first in the unstake queue (priority = 1)
    // Healthy validator (health >= 1) gets a later priority number
    //
    // Arrange two validators via the Auction class:
    // v_under: marinadeActivated = 1.5 * minLimit → health < 1
    // v_health: marinadeActivated = minLimit → health > 1
    //
    // setStakeUnstakePriorities() assigns unstakePriority=1 to v_under (the underfunded one).
    // v_health ends up with a higher priority number (not in the health<1 bucket).
    const bond = 1000
    const effBid = 5

    function makeValidatorWithBond(voteAccount: string, marinadeActivatedStakeSol: number) {
      const v = makeValidator({
        voteAccount,
        bondBalanceSol: bond,
        marinadeActivatedStakeSol,
        samEligible: true,
        revShare: buildRevShare({ expectedMaxEffBidPmpe: effBid, onchainDistributedPmpe: 0, totalPmpe: 10 }),
      })
      c.bondStakeCapSam(v) // populates bondSamHealth
      return v
    }

    const vUnder = makeValidatorWithBond('v_under', 1.5 * minLimit) // health < 1
    const vHealthy = makeValidatorWithBond('v_healthy', minLimit) // health > 1

    expect(vUnder.bondSamHealth).toBeLessThan(1)
    expect(vHealthy.bondSamHealth).toBeGreaterThan(1)

    const data = makeAuction({ validators: [vUnder, vHealthy] })
    const debug = new Debug(new Set())
    const cAuction = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2, minBondBalanceSol: 0 })
    const auction = new Auction(data, cAuction, {} as never, debug)
    auction.setStakeUnstakePriorities()

    // v_under (health<1) gets the lowest unstakePriority number (first to unstake)
    expect(vUnder.unstakePriority).toBe(1)
    // v_healthy (health>=1) is not in the health<1 bucket, gets a higher number
    expect(vHealthy.unstakePriority).toBeGreaterThan(vUnder.unstakePriority)
  })
})
