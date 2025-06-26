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
 */
import { AuctionConstraints } from '../src/constraints'
import { AuctionConstraintsConfig, AuctionValidator, AuctionData } from '../src/types'
import { ineligibleValidatorAggDefaults } from '../src/utils'
import { Debug } from '../src/debug'

const BASE_CONSTRAINTS: AuctionConstraintsConfig = {
  totalCountryStakeCapSol:              Infinity,
  totalAsoStakeCapSol:                  Infinity,
  marinadeCountryStakeCapSol:           Infinity,
  marinadeAsoStakeCapSol:               Infinity,
  marinadeValidatorStakeCapSol:         Infinity,
  spendRobustReputationMult:            null,
  minBondBalanceSol:                    0,
  minMaxStakeWanted:                    0,
  minBondEpochs:                        0,
  idealBondEpochs:                      0,
  spendRobustReputationBondBoostCoef:   0,
  unprotectedValidatorStakeCapSol:   0,
  minUnprotectedStakeToDelegateSol: 0,
  unprotectedFoundationStakeDec:   1,
  unprotectedDelegatedStakeDec:   1,
}

function mkConstraints (overrides: Partial<AuctionConstraintsConfig> = {}) {
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
  } as AuctionValidator

  return { ...base, ...overrides }
}

describe('clipBondStakeCap()', () => {
  const c = mkConstraints({ minBondBalanceSol: 1000 })

  it('returns 0 if balance < 0.8 * minBondBalanceSol', () => {
    const v = makeValidator({ bondBalanceSol: 0.5 * 1000 })
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
  const c = mkConstraints({
    marinadeValidatorStakeCapSol: 1e9,
    minBondBalanceSol:           1,
    minBondEpochs:               1,
    idealBondEpochs:             2,
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
      },
    })
    expect(c.bondStakeCapSam(v)).toBeCloseTo(1000 / (25 / 1000), 6)
  })

  it('when marinadeActivatedStakeSol is between ideal and min, cap=marinadeActivatedStakeSol', () => {
    const c2 = mkConstraints({ minBondEpochs: 1, idealBondEpochs: 2 })
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 70000,
      revShare: { inflationPmpe:0, mevPmpe:0, bidPmpe:0, totalPmpe:0,
        auctionEffectiveBidPmpe:0, effParticipatingBidPmpe:0,
        expectedMaxEffBidPmpe:5, bidTooLowPenaltyPmpe:0 },
    })
    expect(c2.bondStakeCapSam(v)).toBe(70000)
  })

  it('when marinadeActivatedStakeSol > minLimit, cap=minLimit', () => {
    const c3 = mkConstraints({ minBondEpochs: 1, idealBondEpochs: 1 })
    const v = makeValidator({
      bondBalanceSol: 1000,
      marinadeActivatedStakeSol: 200000,
      revShare: { inflationPmpe:0, mevPmpe:0, bidPmpe:0, totalPmpe:0,
        auctionEffectiveBidPmpe:0, effParticipatingBidPmpe:0,
        expectedMaxEffBidPmpe:5, bidTooLowPenaltyPmpe:0 },
    })
    expect(c3.bondStakeCapSam(v)).toBeCloseTo(100000, 0)
  })
})

describe('bondStakeCapMnde()', () => {
  const c = mkConstraints({ minBondBalanceSol: 1 })

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
  const c = mkConstraints({ spendRobustReputationMult: 2.5 })

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
    const c2 = mkConstraints({ spendRobustReputationMult: null })
    const v = makeValidator({})
    expect(c2.reputationStakeCap(v)).toBe(Infinity)
  })
})

describe('getMinCapForEvenDistribution() & findCapForValidator()', () => {
  const debug = new Debug(new Set(['v1', 'v2']))
  const c = mkConstraints({
    totalCountryStakeCapSol:         100,
    totalAsoStakeCapSol:             1000,
    marinadeCountryStakeCapSol:      50,
    marinadeAsoStakeCapSol:          1000,
    marinadeValidatorStakeCapSol:    1000,
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
    const data: AuctionData = {
      epoch: 0,
      validators: [v1, v2],
      stakeAmounts: {
        networkTotalSol: 0,
        marinadeMndeTvlSol: 0,
        marinadeSamTvlSol: 0,
        marinadeRemainingMndeSol: 0,
        marinadeRemainingSamSol: 0,
      },
      rewards: { inflationPmpe: 0, mevPmpe: 0 },
      blacklist: new Set(),
    }
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
  const cpos = mkConstraints({
    totalCountryStakeCapSol:         200,
    totalAsoStakeCapSol:             1000,
    marinadeCountryStakeCapSol:      100,
    marinadeAsoStakeCapSol:          1000,
    marinadeValidatorStakeCapSol:    1000,
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
    const data: AuctionData = {
      epoch: 0,
      validators: [x1,x2],
      stakeAmounts: { networkTotalSol:0, marinadeMndeTvlSol:0, marinadeSamTvlSol:0,
        marinadeRemainingMndeSol:0, marinadeRemainingSamSol:0 },
      rewards:{ inflationPmpe:0, mevPmpe:0 },
      blacklist: new Set(),
    }
    cpos.updateStateForSam(data)
    // totalLeft=200-80=120; marinadeLeft=100-20=80; /2=40
    const { cap, constraint } = cpos.getMinCapForEvenDistribution(new Set(['x1','x2']))
    expect(cap).toBe(40)
    expect(constraint.constraintType).toBe('COUNTRY')
  })

  it('selects the actual minimal constraint (COUNTRY) when ASO is less binding', () => {
    const c2 = mkConstraints({ totalCountryStakeCapSol: 1000000 })
    const y1 = makeValidator({
      voteAccount: 'y1', country: 'Q', aso: 'B1',
      auctionStake: { externalActivatedSol: 20, marinadeMndeTargetSol:5, marinadeSamTargetSol:5 },
    })
    const data2: AuctionData = {
      epoch: 0, validators: [y1],
      stakeAmounts: { networkTotalSol:0, marinadeMndeTvlSol:0, marinadeSamTvlSol:0,
        marinadeRemainingMndeSol:0, marinadeRemainingSamSol:0 },
      rewards:{ inflationPmpe:0, mevPmpe:0 }, blacklist:new Set(),
    }
    c2.updateStateForSam(data2)
    const { cap, constraint } = c2.getMinCapForEvenDistribution(new Set(['y1']))
    expect(cap).toBe(90)
    expect(constraint.constraintType).toBe('COUNTRY')
  })
})

describe('findCapForValidator when cap > EPSILON', () => {
  const debug = new Debug(new Set(['z1']))
  const c = mkConstraints({
    totalCountryStakeCapSol:         100,
    totalAsoStakeCapSol:             100,
    marinadeCountryStakeCapSol:      50,
    marinadeAsoStakeCapSol:          100,
    marinadeValidatorStakeCapSol:    100,
  })
  const z1 = makeValidator({
    voteAccount: 'z1', country:'Z', aso:'A',
    auctionStake: { externalActivatedSol:1, marinadeMndeTargetSol:0, marinadeSamTargetSol:0 },
  })
  it('does not set lastCapConstraint when cap is positive', () => {
    c.updateStateForSam({ epoch:0, validators:[z1],
      stakeAmounts:{ networkTotalSol:0,marinadeMndeTvlSol:0,marinadeSamTvlSol:0,
        marinadeRemainingMndeSol:0, marinadeRemainingSamSol:0 },
      rewards:{ inflationPmpe:0,mevPmpe:0 }, blacklist:new Set() })
    const cap = c.findCapForValidator(z1)
    expect(cap).toBeGreaterThan(0)
    expect(z1.lastCapConstraint).toBeNull()
  })
})
