// Tests for bondHealthFromAuction: all four tiers (no-bond, critical, watch,
// healthy), below-min-balance gate, runway ladder, and precomputed coverage path.
import { computeBondCoverage } from '../src/bond-coverage'
import { bondHealthFromAuction, BOND_URGENT_EPOCHS } from '../src/bond-health'

import type { AuctionValidator, DsSamConfig } from '../src'

const CONFIG: DsSamConfig = {
  minBondEpochs: 2,
  idealBondEpochs: 10,
  bondRiskFeeMult: 1,
  minBondBalanceSol: 1,
} as unknown as DsSamConfig

function makeValidator(overrides: Record<string, unknown> = {}): AuctionValidator {
  return {
    voteAccount: 'v1',
    bondBalanceSol: 100,
    claimableBondBalanceSol: 100,
    bondGoodForNEpochs: 20,
    marinadeActivatedStakeSol: 10000,
    unprotectedStakeSol: 0,
    minUnprotectedReserve: 0,
    idealUnprotectedReserve: 0,
    minBondPmpe: 1,
    idealBondPmpe: 6,
    auctionStake: { marinadeSamTargetSol: 10000 },
    revShare: {
      expectedMaxEffBidPmpe: 5,
      onchainDistributedPmpe: 1,
      bidTooLowPenaltyPmpe: 0,
    },
    bondForcedUndelegation: null,
    values: { paidUndelegationSol: 0, bondRiskFeeSol: 0 },
    ...overrides,
  } as unknown as AuctionValidator
}

describe('bondHealthFromAuction — no-bond tier', () => {
  it('bondBalanceSol=0 → "no-bond"', () => {
    const v = makeValidator({ bondBalanceSol: 0, claimableBondBalanceSol: 0 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('no-bond')
  })

  it('bondBalanceSol negative → "no-bond"', () => {
    const v = makeValidator({ bondBalanceSol: -1, claimableBondBalanceSol: 0 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('no-bond')
  })
})

describe('bondHealthFromAuction — below minBondBalanceSol → critical', () => {
  it('bondBalance > 0 but < minBondBalanceSol → "critical"', () => {
    // minBondBalanceSol=1, bondBalance=0.5 → critical before any runway check
    const v = makeValidator({ bondBalanceSol: 0.5 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('critical')
  })

  it('bondBalance exactly equals minBondBalanceSol → NOT below-min, continues to runway check', () => {
    // balance=1 == minBondBalanceSol=1 → passes gate.
    // claimable must cover stakeKeepFloor = (minBondPmpe/1000)*stake = (1/1000)*10000 = 10
    // so set claimable=100 (covers floor) and runway=20 → healthy.
    const v = makeValidator({ bondBalanceSol: 1, claimableBondBalanceSol: 100 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('healthy')
  })
})

describe('bondHealthFromAuction — no stake → healthy early exit', () => {
  it('no target and no active stake → "healthy" (no coverage shortfall possible)', () => {
    const v = makeValidator({
      marinadeActivatedStakeSol: 0,
      auctionStake: { marinadeSamTargetSol: 0 },
    })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('healthy')
  })
})

describe('bondHealthFromAuction — critical tier (coverage shortfall)', () => {
  it('bondRiskFeeShortfall > 0 → "critical"', () => {
    // claimable=0, minBondPmpe=1, stake=10000 → floor=10, shortfall=10
    const v = makeValidator({
      claimableBondBalanceSol: 0,
      bondGoodForNEpochs: 20,
    })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('critical')
  })

  it('bondRiskFeeSol > 0 → "critical" (fee actively charged this epoch)', () => {
    const v = makeValidator({
      values: { paidUndelegationSol: 0, bondRiskFeeSol: 5 },
    })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('critical')
  })
})

describe('bondHealthFromAuction — critical tier (runway)', () => {
  it('runway = minBondEpochs + BOND_URGENT_EPOCHS → "critical" (at boundary)', () => {
    // minBondEpochs=2, BOND_URGENT_EPOCHS=3 → threshold=5 → runway=5 → critical
    const v = makeValidator({
      bondGoodForNEpochs: CONFIG.minBondEpochs + BOND_URGENT_EPOCHS,
    })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('critical')
  })

  it('runway = 0 → "critical"', () => {
    const v = makeValidator({ bondGoodForNEpochs: 0 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('critical')
  })

  it('runway = minBondEpochs + BOND_URGENT_EPOCHS + 1 → not critical (just above threshold)', () => {
    const v = makeValidator({
      bondGoodForNEpochs: CONFIG.minBondEpochs + BOND_URGENT_EPOCHS + 1,
    })
    const h = bondHealthFromAuction(v, CONFIG, 10)
    expect(h).not.toBe('critical')
  })
})

describe('bondHealthFromAuction — watch tier (runway between thresholds)', () => {
  it('runway just above urgent threshold but below idealBondEpochs → "watch"', () => {
    // threshold=5, ideal=10 → runway=7 → watch
    const v = makeValidator({ bondGoodForNEpochs: 7 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('watch')
  })

  it('runway = idealBondEpochs - 1 → "watch"', () => {
    const v = makeValidator({ bondGoodForNEpochs: CONFIG.idealBondEpochs - 1 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('watch')
  })
})

describe('bondHealthFromAuction — healthy tier', () => {
  it('runway >= idealBondEpochs → "healthy"', () => {
    const v = makeValidator({ bondGoodForNEpochs: CONFIG.idealBondEpochs })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('healthy')
  })

  it('very large runway → "healthy"', () => {
    const v = makeValidator({ bondGoodForNEpochs: 1000 })
    expect(bondHealthFromAuction(v, CONFIG, 10)).toBe('healthy')
  })
})

describe('bondHealthFromAuction — precomputed coverage shortcut', () => {
  it('precomputedCoverage with zero shortfall skips internal recompute and returns correct tier', () => {
    const v = makeValidator({ bondGoodForNEpochs: 20 })
    const coverage = computeBondCoverage(v, CONFIG, 10)
    // coverage.bondRiskFeeShortfall should be 0 for this healthy validator
    expect(coverage.bondRiskFeeShortfall).toBe(0)
    expect(bondHealthFromAuction(v, CONFIG, 10, coverage)).toBe('healthy')
  })

  it('precomputedCoverage with shortfall > 0 → "critical" without recomputing', () => {
    const v = makeValidator({ bondGoodForNEpochs: 20 })
    // Inject a fake coverage with a shortfall
    const fakeCoverage = { bondRiskFeeShortfall: 10 } as ReturnType<typeof computeBondCoverage>
    expect(bondHealthFromAuction(v, CONFIG, 10, fakeCoverage)).toBe('critical')
  })
})
