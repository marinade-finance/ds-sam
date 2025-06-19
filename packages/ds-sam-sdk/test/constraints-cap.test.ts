/**
 * Test plan — high-level overview
 *
 * We exercise every exported “cap” helper in constraints.ts:
 *
 * 1) clipBondStakeCap()
 *    - When bondBalanceSol < 0.8 * minBondBalanceSol → returns 0
 *    - When 0.8*minBondBalanceSol ≤ bondBalanceSol < minBondBalanceSol
 *      → returns at most marinadeActivatedStakeSol
 *    - When bondBalanceSol ≥ minBondBalanceSol
 *      → returns the raw limit argument
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

/**
 * Minimal stub factory for AuctionValidator, re-using your ineligibleValidatorAggDefaults
 * and then merging in only the fields the cap functions actually read.
 */
function makeValidator(overrides: any): AuctionValidator {
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
      bondRiskFee: 0,
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
  const cfg: AuctionConstraintsConfig = {
    totalCountryStakeCapSol: 0,
    totalAsoStakeCapSol: 0,
    marinadeCountryStakeCapSol: 0,
    marinadeAsoStakeCapSol: 0,
    marinadeValidatorStakeCapSol: 0,
    spendRobustReputationMult: null,
    minBondBalanceSol: 1000,
    minMaxStakeWanted: 0,
    minBondEpochs: 0,
    idealBondEpochs: 0,
  }
  const c = new AuctionConstraints(cfg, new Debug(new Set()))

  it('returns 0 if balance < 0.8 * minBondBalanceSol', () => {
    const v = makeValidator({ bondBalanceSol: 0.5 * cfg.minBondBalanceSol })
    expect(c.clipBondStakeCap(v, 9999)).toBe(0)
  })

  it('clips to existing stake if balance < minBond but ≥ 0.8*min', () => {
    const v = makeValidator({
      bondBalanceSol: 0.9 * cfg.minBondBalanceSol,
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
  const cfg: AuctionConstraintsConfig = {
    totalCountryStakeCapSol: 0,
    totalAsoStakeCapSol: 0,
    marinadeCountryStakeCapSol: 0,
    marinadeAsoStakeCapSol: 0,
    marinadeValidatorStakeCapSol: 1e9,
    spendRobustReputationMult: null,
    minBondBalanceSol: 1,
    minMaxStakeWanted: 0,
    minBondEpochs: 1,
    idealBondEpochs: 2,
  }
  const c = new AuctionConstraints(cfg, new Debug(new Set()))

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
})

describe('bondStakeCapMnde()', () => {
  const cfg: AuctionConstraintsConfig = {
    totalCountryStakeCapSol: 0,
    totalAsoStakeCapSol: 0,
    marinadeCountryStakeCapSol: 0,
    marinadeAsoStakeCapSol: 0,
    marinadeValidatorStakeCapSol: 0,
    spendRobustReputationMult: null,
    minBondBalanceSol: 1,
    minMaxStakeWanted: 0,
    minBondEpochs: 0,
    idealBondEpochs: 0,
  }
  const c = new AuctionConstraints(cfg, new Debug(new Set()))

  it('returns 0 when balance < 0.8*minBond', () => {
    const v = makeValidator({ bondBalanceSol: 0.5, marinadeActivatedStakeSol: 10 })
    expect(c.bondStakeCapMnde(v)).toBe(0)
  })

  it('otherwise returns a very large number (raw Infinity)', () => {
    const v = makeValidator({ bondBalanceSol: 2, marinadeActivatedStakeSol: 10 })
    const cap = c.bondStakeCapMnde(v)
    expect(cap).toBeGreaterThan(1e6)
  })
})

describe('reputationStakeCap()', () => {
  const baseCfg: AuctionConstraintsConfig = {
    totalCountryStakeCapSol: 0,
    totalAsoStakeCapSol: 0,
    marinadeCountryStakeCapSol: 0,
    marinadeAsoStakeCapSol: 0,
    marinadeValidatorStakeCapSol: 0,
    spendRobustReputationMult: 2.5,
    minBondBalanceSol: 0,
    minMaxStakeWanted: 0,
    minBondEpochs: 0,
    idealBondEpochs: 0,
  }
  const c = new AuctionConstraints(baseCfg, new Debug(new Set()))

  it('returns max(adjMaxSpendRobustDelegation, marinadeActivatedStakeSol)', () => {
    const v = makeValidator({
      values: {
        adjMaxSpendRobustDelegation: 77,
        spendRobustReputation: 0,
        adjSpendRobustReputation: 0,
        adjSpendRobustReputationInflationFactor: 1,
        bondRiskFee: 0,
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
    const c2 = new AuctionConstraints({ ...baseCfg, spendRobustReputationMult: null }, new Debug(new Set()))
    const v = makeValidator({})
    expect(c2.reputationStakeCap(v)).toBe(Infinity)
  })
})

describe('getMinCapForEvenDistribution() & findCapForValidator()', () => {
  const cfg: AuctionConstraintsConfig = {
    totalCountryStakeCapSol: 100,
    totalAsoStakeCapSol: 1000,
    marinadeCountryStakeCapSol: 50,
    marinadeAsoStakeCapSol: 1000,
    marinadeValidatorStakeCapSol: 1000,
    spendRobustReputationMult: null,
    minBondBalanceSol: 0,
    minMaxStakeWanted: 0,
    minBondEpochs: 0,
    idealBondEpochs: 0,
    maxMarinadeTvlSharePerValidatorDec: 1,
  }
  const debug = new Debug(new Set(['v1', 'v2']))
  const c = new AuctionConstraints(cfg, debug)

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
