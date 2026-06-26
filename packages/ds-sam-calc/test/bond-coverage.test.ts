// Tests for computeBondCoverage: floor calculations, stake bases, projection,
// unprotected reserve, and zero-stake edge cases.
import { computeBondCoverage } from '../src/bond-coverage'

import type { AuctionValidator, DsSamConfig } from '../src'

const CONFIG: DsSamConfig = {
  minBondEpochs: 2,
  idealBondEpochs: 10,
  bondRiskFeeMult: 1,
  minBondBalanceSol: 0.01,
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

describe('computeBondCoverage — basic field shapes', () => {
  it('healthy validator → topUpToKeepStake=0 and topUpToIdealKeep=0', () => {
    const v = makeValidator({ minBondPmpe: 1, idealBondPmpe: 6 })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.topUpToKeepStake).toBe(0)
    expect(cov.topUpToIdealKeep).toBe(0)
    expect(cov.bondRiskFeeShortfall).toBe(0)
  })
})

describe('computeBondCoverage — topUpToKeepStake', () => {
  it('claimable < minBondPmpe-based floor → topUpToKeepStake > 0', () => {
    // minBondPmpe=10, stake=10000 → stakeKeepFloor = (10/1000)*10000 = 100
    // claimable=50 → topUpToKeepStake = max(0, 100-50) = 50
    const v = makeValidator({
      minBondPmpe: 10,
      idealBondPmpe: 20,
      claimableBondBalanceSol: 50,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.topUpToKeepStake).toBeCloseTo(50, 9)
  })

  it('claimable exactly equals floor → topUpToKeepStake = 0', () => {
    // minBondPmpe=1, stake=10000 → stakeKeepFloor=(1/1000)*10000=10
    const v = makeValidator({
      minBondPmpe: 1,
      idealBondPmpe: 6,
      claimableBondBalanceSol: 10,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.topUpToKeepStake).toBe(0)
  })
})

describe('computeBondCoverage — topUpToIdealKeep', () => {
  it('bondBalance < idealBondPmpe-based floor → topUpToIdealKeep > 0', () => {
    // idealBondPmpe=10, stake=10000 → stakeIdealFloor=(10/1000)*10000=100
    // bondBalance=50 → topUpToIdealKeep = max(0, 100-50) = 50
    const v = makeValidator({
      minBondPmpe: 1,
      idealBondPmpe: 10,
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.topUpToIdealKeep).toBeCloseTo(50, 9)
  })

  it('bondBalance >= ideal floor → topUpToIdealKeep = 0', () => {
    const v = makeValidator({ minBondPmpe: 1, idealBondPmpe: 6 })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.topUpToIdealKeep).toBe(0)
  })
})

describe('computeBondCoverage — bondRiskFeeShortfall (projected basis)', () => {
  it('no paidUndelegation → projected = current → shortfall matches keep logic', () => {
    // claimable=50, minBondPmpe=10, exposed=10000 → bondRiskFeeFloor=100 → shortfall=50
    const v = makeValidator({
      minBondPmpe: 10,
      idealBondPmpe: 20,
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.bondRiskFeeShortfall).toBeCloseTo(50, 9)
  })

  it('paidUndelegation reduces projected stake → smaller shortfall', () => {
    // paidUndelegationSol=9000 → projectedActivated=1000 → projectedExposed=1000
    // bondRiskFeeFloor=(10/1000)*1000=10; claimable=50 → shortfall=0
    const v = makeValidator({
      minBondPmpe: 10,
      idealBondPmpe: 20,
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
      values: { paidUndelegationSol: 9000, bondRiskFeeSol: 0 },
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.bondRiskFeeShortfall).toBe(0)
  })

  it('zero claimable and non-zero stake → shortfall > 0', () => {
    const v = makeValidator({
      minBondPmpe: 1,
      idealBondPmpe: 6,
      bondBalanceSol: 0,
      claimableBondBalanceSol: 0,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.bondRiskFeeShortfall).toBeGreaterThan(0)
  })
})

describe('computeBondCoverage — unprotected stake reserve', () => {
  it('unprotectedStakeSol reduces currentExposedStakeSol', () => {
    // active=10000, unprotected=2000 → exposed=8000
    const v = makeValidator({
      minBondPmpe: 1,
      idealBondPmpe: 6,
      unprotectedStakeSol: 2000,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.currentExposedStakeSol).toBe(8000)
  })

  it('unprotectedStakeSol > marinadeActivatedStakeSol → exposed clamped at 0', () => {
    const v = makeValidator({
      minBondPmpe: 1,
      idealBondPmpe: 6,
      unprotectedStakeSol: 20000,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.currentExposedStakeSol).toBe(0)
  })

  it('minUnprotectedReserve added to both stake floors', () => {
    const v = makeValidator({
      minBondPmpe: 1,
      idealBondPmpe: 6,
      minUnprotectedReserve: 50,
      idealUnprotectedReserve: 80,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.stakeKeepFloor).toBeCloseTo(50 + (1 / 1000) * 10000, 9)
    expect(cov.stakeIdealFloor).toBeCloseTo(80 + (6 / 1000) * 10000, 9)
  })
})

describe('computeBondCoverage — zero stake', () => {
  it('zero marinadeActivatedStakeSol → all floors are zero', () => {
    const v = makeValidator({
      minBondPmpe: 1,
      idealBondPmpe: 6,
      marinadeActivatedStakeSol: 0,
      bondBalanceSol: 0,
      claimableBondBalanceSol: 0,
    })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.topUpToKeepStake).toBe(0)
    expect(cov.topUpToIdealKeep).toBe(0)
    expect(cov.bondRiskFeeShortfall).toBe(0)
  })
})

describe('computeBondCoverage — minBondEpochs / idealBondEpochs derivation', () => {
  it('minBondEpochs = 1 + config.minBondEpochs, idealBondEpochs = 1 + config.idealBondEpochs', () => {
    const v = makeValidator({ minBondPmpe: 1, idealBondPmpe: 6 })
    const cov = computeBondCoverage(v, CONFIG, 10)
    expect(cov.minBondEpochs).toBe(1 + CONFIG.minBondEpochs)
    expect(cov.idealBondEpochs).toBe(1 + CONFIG.idealBondEpochs)
  })
})
