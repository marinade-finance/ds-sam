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

import { calcBondRiskFee } from '../src/calculations'
import { AuctionConstraintType } from '../src/types'
import { minCapFromConstraint } from '../src/utils'
import {
  buildRevShare,
  makeAuction,
  makeConstraints,
  makeUnitValidator as makeValidator,
} from './helpers/auction-test-utils'

import type { AuctionConstraint } from '../src/types'

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
        inflationPmpe: 10,
        mevPmpe: 0,
        bidPmpe: 0,
        totalPmpe: 0,
        auctionEffectiveBidPmpe: 0,
        activatingStakePmpe: 0,
        effParticipatingBidPmpe: 0,
        expectedMaxEffBidPmpe: 5,
        bidTooLowPenaltyPmpe: 0,
        onchainDistributedPmpe: 10,
        bondObligationPmpe: 0,
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
        auctionEffectiveBidPmpe: 0,
        activatingStakePmpe: 0,
        effParticipatingBidPmpe: 0,
        expectedMaxEffBidPmpe: 5,
        bidTooLowPenaltyPmpe: 0,
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
  // idealLimit = (550 - 30k*(12/1000)) / (13/1000) = 190 / 0.013 ≈ 14615
  // minLimit  = (550 - 30k*(4/1000))  / (5/1000)  = 430 / 0.005  = 86000
  const IDEAL_LIMIT = (550 - 30_000 * (12 / 1000)) / (13 / 1000)
  const MIN_LIMIT = (550 - 30_000 * (4 / 1000)) / (5 / 1000)

  it('does not exceed marinadeActivatedStakeSol when exposed stake is between idealLimit and minLimit', () => {
    // Regression: epoch 969→970, fVotEjqpmpQYgyVy.
    // With unprotectedStakeSol > 0, the buggy formula
    //   limit = min(minLimit, max(idealLimit, marinadeActivatedStakeSol))
    // uses total stake (not exposed) in max(), then adds unprotectedStakeSol on top.
    // When exposed is between idealLimit and minLimit, limit pins to minLimit and
    // cap = minLimit + unprotected > marinadeActivatedStakeSol — stake grows beyond current.
    // Bond shrank 6 SOL next epoch; bond risk fee fired.
    //
    // Fix: use exposed stake in the comparison:
    //   limit = min(minLimit, max(idealLimit, marinadeActivatedStakeSol - unprotectedStakeSol))
    // When exposed is between ideal and min, limit = exposed → cap = marinadeActivatedStakeSol (stable).
    const marinadeActivatedStakeSol = 100_000
    const v = makeValidator({
      bondBalanceSol: 550,
      marinadeActivatedStakeSol, // exposed = 70k
      totalActivatedStakeSol: marinadeActivatedStakeSol + 30_000, // unprotectedStakeSol = 30k
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    // exposed = 70k; idealLimit ≈ 14.6k; minLimit ≈ 86k → exposed between ideal and min
    // Bug:  limit = min(86k, max(14.6k, 100k[total])) = 86k → cap = 116k > marinadeActivatedStakeSol
    // Fix:  limit = min(86k, max(14.6k,  70k[exposed])) = 70k → cap = 100k = marinadeActivatedStakeSol
    expect(c4.bondStakeCapSam(v)).toBeCloseTo(marinadeActivatedStakeSol, 0)
  })

  it('unprotected=0: old and new are equivalent; cap = marinadeActivatedStakeSol when anti-flap applies', () => {
    // No unprotected stake → protectedActivated = total activation.
    // Both buggy and fixed formulas produce identical results here.
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
    // Bug gives same result here (5k < idealLimit → max still returns idealLimit).
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
    // Bug gives the same result (minLimit clamps regardless of whether total or exposed is used).
    const v = makeValidator({
      bondBalanceSol: 550,
      marinadeActivatedStakeSol: 120_000,
      totalActivatedStakeSol: 150_000,
      revShare: buildRevShare({ onchainDistributedPmpe: 0, expectedMaxEffBidPmpe: 1 }),
    })
    expect(c4.bondStakeCapSam(v)).toBeCloseTo(MIN_LIMIT + 30_000, 0)
  })

  it('marinadeActivated=0, unprotected=0: cap >= 0', () => {
    // Zero activation and no unprotected stake: protectedActivated=0, limit=idealLimit, cap≥0.
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
    // Bug: limit = min(86k, max(idealLimit, 30k[total])) = 30k → cap = 60k (double-counts unprotected)
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
    // cap should equal maxUnprotectedStakeSol (the whole bond is consumed by unprotected reserve)
    expect(cap).toBeCloseTo(maxUnprotectedStakeSol, 3)
    // unprotectedStakeSol should be capped at maxUnprotectedStakeSol, not the full 30k
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
    // bondBalanceForBids = 100 - (2/1000)*0 = 100   ← correct: uses protectedStakeSol
    // wrong would be:      100 - (2/1000)*200 = 99.6 ← wrong: would use marinadeActivatedStakeSol
    // costPerEpoch = (5/1000)*200 = 1
    // bondGoodForNEpochs = 100/1 - (1+1) = 98
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
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 2 }),
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

  function run(bondBalanceSol: number) {
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
    const { goodFor, fee } = run(2.4)
    expect(goodFor).toBeCloseTo(0, 6)
    expect(fee).toBeNull()
  })

  it('just above threshold: bondGoodForNEpochs>0, no fee', () => {
    const { goodFor, fee } = run(2.5)
    expect(goodFor).toBeGreaterThan(0)
    expect(fee).toBeNull()
  })

  it('just below threshold: bondGoodForNEpochs<0, fee generated', () => {
    const { goodFor, fee } = run(2.3)
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

  it('computes min cap correctly and selects COUNTRY constraint', () => {
    const data = makeAuction({ validators: [v1, v2] })
    c.updateStateForSam(data)
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
    // totalLeft=200-100=100; marinadeLeft=100-20=80; /2=40
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
    data.validators.forEach(val => {
      val.revShare.onchainDistributedPmpe = val.revShare.inflationPmpe + val.revShare.mevPmpe
      val.revShare.bondObligationPmpe = val.revShare.bidPmpe
    })
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
  it('with negative limit returns >= 0', () => {
    const c = makeConstraints({
      minBondEpochs: 1,
      idealBondEpochs: 10,
      unprotectedValidatorStakeCapSol: 10000,
      unprotectedDelegatedStakeDec: 1,
      unprotectedFoundationStakeDec: 1,
      minUnprotectedStakeToDelegateSol: 0,
    })
    const v = makeValidator({
      bondBalanceSol: 10,
      totalActivatedStakeSol: 50000,
      revShare: buildRevShare({
        onchainDistributedPmpe: 100,
        expectedMaxEffBidPmpe: 100,
      }),
    })
    const cap = c.bondStakeCapSam(v)
    expect(cap).toBeGreaterThanOrEqual(0)
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
  it('caps via foundationStakeDec even when delegated stake is negative', () => {
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
  it('marinadeActivatedStakeSol floor: prevents want cap from dropping below current stake', () => {
    // maxStakeWanted=5, but marinadeActivated=100 → clipped cap = max(0, 100, 5) = 100
    // marinadeLeftToCapSol = 100 - 0 (marinadeSamTargetSol) = 100
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
    expect(want.marinadeLeftToCapSol).toBe(100)
  })

  it('minMaxStakeWanted floor: config minimum applies when maxStakeWanted is below it and marinadeActivated=0', () => {
    // maxStakeWanted=50, marinadeActivated=0, minMaxStakeWanted=1000
    // clipped cap = max(1000, 0, 50) = 1000
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

  function run(claimableSol: number) {
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
    expect(run(500)).toBeNull()
  })

  it('fee fires when claimable falls below exposed threshold', () => {
    // claimable=400: 280 < 350 → non-null
    expect(run(400)).not.toBeNull()
  })
})
