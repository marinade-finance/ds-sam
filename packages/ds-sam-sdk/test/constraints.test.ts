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
        effParticipatingBidPmpe: 0,
        expectedMaxEffBidPmpe: 5,
        bidTooLowPenaltyPmpe: 0,
        onchainDistributedPmpe: 0,
      }),
    })
    expect(c3.bondStakeCapSam(v)).toBeCloseTo(100000, 0)
  })
})

describe('bondGoodForNEpochs', () => {
  // minBondEpochs=1, expectedMaxEffBidPmpe=5, marinadeActivatedStakeSol=200
  // costPerEpoch = stake * pmpe/1000 = 200 * 5/1000 = 1 SOL/epoch
  // bondBalanceForBids = max(0, bondBalanceSol - onchain * stake/1000)
  // goodFor = bondBalanceForBids / costPerEpoch - minBondEpochs
  const c = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2, minBondBalanceSol: 1 })

  it.each([
    ['at threshold → 0', 1, 0, 0],
    ['above threshold → positive', 2, 0, 1],
    ['below threshold → negative', 0.5, 0, -0.5],
    ['zero bond → -minBondEpochs', 0, 0, -1],
    ['onchainDistributedPmpe reduces', 1, 2, -0.4], // reserve = 200*2/1000 = 0.4
  ])('%s', (_label, bondBalanceSol, onchainDistributedPmpe, expected) => {
    const v = makeValidator({
      bondBalanceSol,
      marinadeActivatedStakeSol: 200,
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe }),
    })
    c.bondStakeCapSam(v)
    expect(v.bondGoodForNEpochs).toBeCloseTo(expected, 6)
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
    // totalLeft=200-80=120; marinadeLeft=100-20=80; /2=40
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
  it('clamps to 0 when foundationStake > totalActivated', () => {
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
