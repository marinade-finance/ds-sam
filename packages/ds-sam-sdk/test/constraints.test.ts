/**
 * Test plan — high-level overview
 *
 * We exercise every exported “cap” helper in constraints.ts:
 *
 * 1a) clipBondStakeCap exact boundary values:
 *     - bondBalanceSol === 0.8*minBondBalanceSol → hits the “hysteresis” branch
 *     - bondBalanceSol === minBondBalanceSol → returns raw limit
 *
 * 1) clipBondStakeCap()
 *    - When bondBalanceSol < 0.8 * minBondBalanceSol → returns 0
 *    - When 0.8*minBondBalanceSol ≤ bondBalanceSol < minBondBalanceSol
 *      → returns at most marinadeActivatedStakeSol
 *    - When bondBalanceSol ≥ minBondBalanceSol
 *      → returns the raw limit argument
 *
 * 2a) bondStakeCapSam extra scenarios:
 *    - marinadeActivatedStakeSol > idealLimit but < minLimit → cap = marinadeActivatedStakeSol
 *    - marinadeActivatedStakeSol > minLimit → cap = minLimit
 *
 * 2) bondStakeCapSam()
 *    - Uses cfg.minBondEpochs and cfg.idealBondEpochs
 *    - Compute minCoef = inf+mev+(minEpochs+1)*expMaxEffBidPmpe,
 *      idealCoef = inf+mev+(idealEpochs+1)*expMaxEffBidPmpe
 *    - raw limits = bondBalanceSol / (coef/1000)
 *    - final limit = min(minLimit, max(idealLimit, marinadeActivatedStakeSol))
 *
 * 3) bondStakeCapMnde()
 *    - downtimeProtectionPerStake = 0 → raw limit = Infinity
 *    - When bondBalanceSol < 0.8*minBond → returns 0
 *    - When bondBalanceSol ≥ minBond → returns very large (Infinity)
 *
 * 4) reputationStakeCap()
 *    - If spendRobustReputationMult is null → returns Infinity
 *    - Else → max(adjMaxSpendRobustDelegation, marinadeActivatedStakeSol)
 *
 * 5) getMinCapForEvenDistribution()
 *    - Builds concentration constraints (country, aso, etc.)
 *    - Takes a set of voteAccounts:
 *      • calculates totalLeftToCapSol & marinadeLeftToCapSol
 *      • per-validator cap = max(0, min(totalLeftToCapSol, marinadeLeftToCapSol)/N)
 *    - Negative caps clamp to 0
 *    - Error if no constraints at all
 *
 * 6) findCapForValidator()
 *    - Wrapper around getMinCapForEvenDistribution({single})
 *    - Also populates validator.lastCapConstraint if cap < EPSILON
 *
 * We make minimal AuctionValidator stubs via the same defaults you use elsewhere,
 * then override only the fields each function reads.
 *
 * Additional concentration‐constraint branches to cover:
 *
 * 7) ASO constraint as the binding one.
 * 8) WANT constraint (clipped maxStakeWanted) wins.
 * 9) REPUTATION constraint wins (adjMaxSpendRobustDelegation floor).
 * 10) Sam‐BOND constraint wins (buildSamBondConstraints).
 * 11) MNDE constraint wins in the Mnde pipeline (buildMndeVoteConstraints).
 * 12) Error path when no constraints exist (empty voteAccounts set).
 */
import { AuctionConstraints } from '../src/constraints'
import { AuctionConstraintsConfig, AuctionValidator, AuctionData } from '../src/types'
import { ineligibleValidatorAggDefaults } from '../src/utils'
import { Debug } from '../src/debug'
import { on } from 'events'

const BASE_CONSTRAINTS: AuctionConstraintsConfig = {
  totalCountryStakeCapSol: Infinity,
  totalAsoStakeCapSol: Infinity,
  marinadeCountryStakeCapSol: Infinity,
  marinadeAsoStakeCapSol: Infinity,
  marinadeValidatorStakeCapSol: Infinity,
  spendRobustReputationMult: null,
  minBondBalanceSol: 0,
  minMaxStakeWanted: 0,
  minBondEpochs: 0,
  idealBondEpochs: 0,
  spendRobustReputationBondBoostCoef: 0,
  unprotectedValidatorStakeCapSol: 0,
  minUnprotectedStakeToDelegateSol: 0,
  unprotectedFoundationStakeDec: 1,
  unprotectedDelegatedStakeDec: 1,
  bondObligationSafetyMult: 1,
}

function makeConstraints (overrides: Partial<AuctionConstraintsConfig> = {}) {
  return new AuctionConstraints(
    { ...BASE_CONSTRAINTS, ...overrides },
    new Debug(new Set())
  )
}

/**
 * Minimal stub factory for AuctionValidator, re-using your ineligibleValidatorAggDefaults
 * and then merging in only the fields the cap functions actually read.
 */
function makeValidator (overrides: any): AuctionValidator {
  const base = {
    ...ineligibleValidatorAggDefaults(),
    voteAccount: 'v',
    country: 'C',
    aso: 'A',
    totalActivatedStakeSol: 0,
    auctionStake: {
      externalActivatedSol: 0,
      marinadeMndeTargetSol: 0,
      marinadeSamTargetSol: 0,
    },
    marinadeActivatedStakeSol: 0,
    bondBalanceSol: 0,
    lastBondBalanceSol: null,
    revShare: {
      inflationPmpe: 0,
      mevPmpe: 0,
      bidPmpe: 0,
      totalPmpe: 0,
      auctionEffectiveBidPmpe: 0,
      effParticipatingBidPmpe: 0,
      expectedMaxEffBidPmpe: 0,
      bidTooLowPenaltyPmpe: 0,
    },
    values: {
      paidUndelegationSol: 0,
      spendRobustReputation: 0,
      adjSpendRobustReputation: 0,
      adjMaxSpendRobustDelegation: 0,
      adjSpendRobustReputationInflationFactor: 1,
      bondRiskFeeSol: 0,
      marinadeActivatedStakeSolUndelegation: 0,
    },
    mndeVotesSolValue: 0,
    mndeStakeCapIncrease: 0,
    samEligible: true,
    mndeEligible: true,
    samBlocked: false,
    stakePriority: NaN,
    unstakePriority: NaN,
    maxBondDelegation: NaN,
    lastMarinadeActivatedStakeSol: null,
    selfStakeSol: 0,
    foundationStakeSol: 0,
  } as AuctionValidator

  return { ...base, ...overrides }
}

function makeAuction (overrides: Partial<AuctionData> = {}): AuctionData {
  const base: AuctionData = {
    epoch: 0,
    validators: [],
    stakeAmounts: {
      networkTotalSol: 0,
      marinadeMndeTvlSol: 0,
      marinadeSamTvlSol: 0,
      marinadeRemainingMndeSol: 0,
      marinadeRemainingSamSol: 0,
    },
    rewards: {
      inflationPmpe: 0,
      mevPmpe: 0,
      blockPmpe: 0,
    },
    blacklist: new Set<string>(),
  }
  return { ...base, ...overrides }
}

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
      revShare: {
        inflationPmpe: 10,
        mevPmpe: 0,
        bidPmpe: 0,
        totalPmpe: 0,
        auctionEffectiveBidPmpe: 0,
        effParticipatingBidPmpe: 0,
        expectedMaxEffBidPmpe: 5,
        bidTooLowPenaltyPmpe: 0,
        onchainDistributedPmpe: 10,
      },
    })
    const result = 1000 / (25 / 1000)
    expect(c.bondStakeCapSam(v)).toBeCloseTo(result, 6)
  })

  it('when marinadeActivatedStakeSol is between ideal and min, cap=marinadeActivatedStakeSol', () => {
    const c2 = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 2 })
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 70000,
      revShare: {
        auctionEffectiveBidPmpe: 0,
        effParticipatingBidPmpe: 0,
        expectedMaxEffBidPmpe: 5,
        bidTooLowPenaltyPmpe: 0,
        onchainDistributedPmpe: 0,
      },
    })
    expect(c2.bondStakeCapSam(v)).toBe(70000)
  })

  it('when marinadeActivatedStakeSol > minLimit, cap=minLimit', () => {
    const c3 = makeConstraints({ minBondEpochs: 1, idealBondEpochs: 1 })
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 200000,
      revShare: {
        auctionEffectiveBidPmpe: 0,
        effParticipatingBidPmpe: 0,
        expectedMaxEffBidPmpe: 5,
        bidTooLowPenaltyPmpe: 0,
        onchainDistributedPmpe: 0,
      },
    })
    expect(c3.bondStakeCapSam(v)).toBeCloseTo(100000, 0)
  })
})

describe('bondStakeCapMnde()', () => {
  const c = makeConstraints({ minBondBalanceSol: 1 })

  it('returns 0 when balance < 0.8*minBond', () => {
    const v = makeValidator({ bondBalanceSol: 0.5, marinadeActivatedStakeSol: 10 })
    expect(c.bondStakeCapMnde(v)).toBe(0)
  })

  it('otherwise returns a very large number (raw Infinity)', () => {
    const v = makeValidator({ bondBalanceSol: 2, marinadeActivatedStakeSol: 10 })
    const cap = c.bondStakeCapMnde(v)
    expect(cap).toBe(Infinity)
  })
})

describe('reputationStakeCap()', () => {
  const c = makeConstraints({ spendRobustReputationMult: 2.5 })

  it('returns max(adjMaxSpendRobustDelegation, marinadeActivatedStakeSol)', () => {
    const v = makeValidator({
      values: {
        adjMaxSpendRobustDelegation: 77,
        spendRobustReputation: 0,
        adjSpendRobustReputation: 0,
        adjSpendRobustReputationInflationFactor: 1,
        bondRiskFeeSol: 0,
        paidUndelegationSol: 0,
        marinadeActivatedStakeSolUndelegation: 0,
      },
      marinadeActivatedStakeSol: 50,
    })
    expect(c.reputationStakeCap(v)).toBe(77)
    v.values.adjMaxSpendRobustDelegation = 25
    expect(c.reputationStakeCap(v)).toBe(50)
  })

  it('returns Infinity when spendRobustReputationMult is null', () => {
    const c2 = makeConstraints({ spendRobustReputationMult: null })
    const v = makeValidator({})
    expect(c2.reputationStakeCap(v)).toBe(Infinity)
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
  const debug = new Debug(new Set(['v1', 'v2']))
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
    auctionStake: { externalActivatedSol: 60, marinadeMndeTargetSol: 5, marinadeSamTargetSol: 5 },
  })
  const v2 = makeValidator({
    voteAccount: 'v2',
    country: 'C',
    aso: 'A',
    auctionStake: { externalActivatedSol: 60, marinadeMndeTargetSol: 5, marinadeSamTargetSol: 5 },
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
    expect(v1.lastCapConstraint!.constraintType).toBe('COUNTRY')
  })
})

describe('getMinCapForEvenDistribution positive scenarios', () => {
  const debug = new Debug(new Set(['x1','x2']))
  const cpos = makeConstraints({
    totalCountryStakeCapSol: 200,
    totalAsoStakeCapSol: 1000,
    marinadeCountryStakeCapSol: 100,
    marinadeAsoStakeCapSol: 1000,
    marinadeValidatorStakeCapSol: 1000,
  })

  const x1 = makeValidator({
    voteAccount: 'x1', country: 'Z', aso: 'A1',
    auctionStake: { externalActivatedSol: 50, marinadeMndeTargetSol:5, marinadeSamTargetSol:5 },
  })
  const x2 = makeValidator({
    voteAccount: 'x2', country: 'Z', aso: 'A1',
    auctionStake: { externalActivatedSol: 30, marinadeMndeTargetSol:5, marinadeSamTargetSol:5 },
  })
  it('returns positive cap = min(totalLeft,marinadeLeft)/2', () => {
    const data = makeAuction({ validators: [x1, x2] })
    cpos.updateStateForSam(data)
    // totalLeft=200-80=120; marinadeLeft=100-20=80; /2=40
    const { cap, constraint } = cpos.getMinCapForEvenDistribution(new Set(['x1','x2']))
    expect(cap).toBe(40)
    expect(constraint.constraintType).toBe('COUNTRY')
  })

  it('selects the actual minimal constraint (COUNTRY) when ASO is less binding', () => {
    const c2 = makeConstraints({
      totalCountryStakeCapSol: 1000000,
      marinadeCountryStakeCapSol: 100,
    })
    const y1 = makeValidator({
      voteAccount: 'y1', country: 'Q', aso: 'B1',
      auctionStake: { externalActivatedSol: 20, marinadeMndeTargetSol: 5, marinadeSamTargetSol: 5 },
    })
    const data2 = makeAuction({ validators: [y1] })
    c2.updateStateForSam(data2)
    const { cap, constraint } = c2.getMinCapForEvenDistribution(new Set(['y1']))
    expect(cap).toBe(90)
    expect(constraint.constraintType).toBe('COUNTRY')
  })
})

describe('findCapForValidator when cap > EPSILON', () => {
  const debug = new Debug(new Set(['z1']))
  const c = makeConstraints({
    totalCountryStakeCapSol: 100,
    totalAsoStakeCapSol: 100,
    marinadeCountryStakeCapSol: 50,
    marinadeAsoStakeCapSol: 100,
    marinadeValidatorStakeCapSol: 100,
  })
  const z1 = makeValidator({
    voteAccount: 'z1', country:'Z', aso:'A',
    auctionStake: { externalActivatedSol:1, marinadeMndeTargetSol: 0, marinadeSamTargetSol: 0 },
  })
  it('does not set lastCapConstraint when cap is positive', () => {
    c.updateStateForSam(makeAuction({ validators: [z1] }))
    const cap = c.findCapForValidator(z1)
    expect(cap).toBeGreaterThan(0)
    expect(z1.lastCapConstraint).toBeNull()
  })
})

describe('getMinCapForEvenDistribution – ASO wins', () => {
  const debug = new Debug(new Set(['v1','v2']))
  const c = makeConstraints({
    totalCountryStakeCapSol: 1e6,
    marinadeCountryStakeCapSol: 1e6,
    totalAsoStakeCapSol: 10,
    marinadeAsoStakeCapSol: 2,
  })

  const v1 = makeValidator({
    voteAccount: 'v1', country: 'X', aso: 'Z',
    auctionStake: { externalActivatedSol: 3, marinadeMndeTargetSol: 0, marinadeSamTargetSol: 1 },
  })
  const v2 = makeValidator({
    voteAccount: 'v2', country: 'X', aso: 'Z',
    auctionStake: { externalActivatedSol: 3, marinadeMndeTargetSol: 0, marinadeSamTargetSol: 1 },
  })

  it('picks ASO when it is the tightest cap', () => {
    const data = makeAuction({ validators: [v1, v2] })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v1','v2']))
    expect(cap).toBe(0)
    expect(constraint.constraintType).toBe('ASO')
  })
})

describe('getMinCapForEvenDistribution – WANT wins', () => {
  const debug = new Debug(new Set(['v']))
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
    auctionStake: { externalActivatedSol: 100, marinadeMndeTargetSol: 0, marinadeSamTargetSol: 0 },
  })

  it('picks WANT when maxStakeWanted is the binding cap', () => {
    const data = makeAuction({ validators: [v] })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v']))
    expect(cap).toBe(5)
    expect(constraint.constraintType).toBe('WANT')
  })
})

describe('getMinCapForEvenDistribution – REPUTATION wins', () => {
  const debug = new Debug(new Set(['v']))
  const c = makeConstraints({
    totalCountryStakeCapSol: Infinity,
    marinadeCountryStakeCapSol: Infinity,
    totalAsoStakeCapSol: Infinity,
    marinadeAsoStakeCapSol: Infinity,
    spendRobustReputationMult: 1,
  })

  const v = makeValidator({
    voteAccount: 'v',
    values: {
      adjMaxSpendRobustDelegation: 7,
      spendRobustReputation: 0,
      adjSpendRobustReputation: 0,
      adjSpendRobustReputationInflationFactor: 1,
      bondRiskFeeSol: 0,
      paidUndelegationSol: 0,
      marinadeActivatedStakeSolUndelegation: 0,
    },
    auctionStake: { externalActivatedSol: 0, marinadeMndeTargetSol: 0, marinadeSamTargetSol: 0 },
  })

  it('picks REPUTATION when adjMaxSpendRobustDelegation is smallest', () => {
    const data = makeAuction({ validators: [v] })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v']))
    expect(cap).toBe(7)
    expect(constraint.constraintType).toBe('REPUTATION')
  })
})

describe('getMinCapForEvenDistribution – Sam‐BOND wins', () => {
  const debug = new Debug(new Set(['v']))
  const c = makeConstraints({
    totalCountryStakeCapSol: Infinity,
    marinadeCountryStakeCapSol: Infinity,
    totalAsoStakeCapSol: Infinity,
    marinadeAsoStakeCapSol: Infinity,
    minBondEpochs: 0,
    idealBondEpochs: 0,
    spendRobustReputationBondBoostCoef: 0,
  })

  const v = makeValidator({
    voteAccount: 'v',
    bondBalanceSol: 1000,
    revShare: {
      inflationPmpe: 0,
      mevPmpe: 0,
      bidPmpe: 0,
      totalPmpe: 0,
      auctionEffectiveBidPmpe: 0,
      effParticipatingBidPmpe: 0,
      expectedMaxEffBidPmpe: 1000,
      bidTooLowPenaltyPmpe: 0,
    },
  })

  it('picks BOND when its per‐validator bond cap is smallest', () => {
    const data = makeAuction({ validators: [v] })
    data.validators.forEach((val) => {
      val.revShare.onchainDistributedPmpe = val.revShare.inflationPmpe + val.revShare.mevPmpe
      val.revShare.bondObligationPmpe = val.revShare.bidPmpe
    })
    c.updateStateForSam(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v']))
    expect(cap).toBeCloseTo(1000, 6)
    expect(constraint.constraintType).toBe('BOND')
  })
})

describe('getMinCapForEvenDistribution – MNDE wins (Mnde pipeline)', () => {
  const debug = new Debug(new Set(['v']))
  const c = makeConstraints({
    minBondBalanceSol: 0,
  })

  const v = makeValidator({
    voteAccount: 'v',
    mndeVotesSolValue: 3,
    auctionStake: { externalActivatedSol: 0, marinadeMndeTargetSol: 0, marinadeSamTargetSol: 0 },
  })

  it('picks MNDE when mndeVotesSolValue is the tightest', () => {
    const data = makeAuction({ validators: [v] })
    c.updateStateForMnde(data)
    const { cap, constraint } = c.getMinCapForEvenDistribution(new Set(['v']))
    expect(cap).toBe(3)
    expect(constraint.constraintType).toBe('MNDE')
  })
})

describe('getMinCapForEvenDistribution – no constraints', () => {
  const c = makeConstraints()
  it('throws if voteAccounts set is empty', () => {
    expect(() => c.getMinCapForEvenDistribution(new Set())).toThrow(/Failed to find/)
  })
})
