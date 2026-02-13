import { AuctionConstraints } from '../src/constraints'
import { Debug } from '../src/debug'
import { computeConstraintDiagnostics } from '../src/diagnostics'
import { AuctionConstraintType } from '../src/types'
import { ineligibleValidatorAggDefaults } from '../src/utils'

import type {
  AuctionConstraintsConfig,
  AuctionValidator,
  AuctionData,
  ConstraintDiagnostic,
  RevShare,
} from '../src/types'

function findDiag(diagnostics: ConstraintDiagnostic[], type: AuctionConstraintType): ConstraintDiagnostic {
  const diag = diagnostics.find(d => d.constraintType === type)
  if (!diag) {
    throw new Error(`Expected diagnostic of type ${type} not found`)
  }
  return diag
}

const BASE_CONSTRAINTS: AuctionConstraintsConfig = {
  totalCountryStakeCapSol: Infinity,
  totalAsoStakeCapSol: Infinity,
  marinadeCountryStakeCapSol: Infinity,
  marinadeAsoStakeCapSol: Infinity,
  marinadeValidatorStakeCapSol: Infinity,
  minBondBalanceSol: 0,
  minMaxStakeWanted: 0,
  minBondEpochs: 0,
  idealBondEpochs: 0,
  unprotectedValidatorStakeCapSol: 0,
  minUnprotectedStakeToDelegateSol: 0,
  unprotectedFoundationStakeDec: 1,
  unprotectedDelegatedStakeDec: 1,
  bondObligationSafetyMult: 1,
}

function makeConstraints(overrides: Partial<AuctionConstraintsConfig> = {}) {
  return new AuctionConstraints({ ...BASE_CONSTRAINTS, ...overrides }, new Debug(new Set()))
}

function buildRevShare(overrides: Partial<RevShare> = {}): RevShare {
  return {
    totalPmpe: 0,
    inflationPmpe: 0,
    mevPmpe: 0,
    bidPmpe: 0,
    blockPmpe: 0,
    onchainDistributedPmpe: 0,
    bondObligationPmpe: 0,
    auctionEffectiveStaticBidPmpe: 0,
    auctionEffectiveBidPmpe: 0,
    bidTooLowPenaltyPmpe: 0,
    effParticipatingBidPmpe: 0,
    expectedMaxEffBidPmpe: 0,
    blacklistPenaltyPmpe: 0,
    ...overrides,
  }
}

function makeValidator(overrides: Partial<AuctionValidator>): AuctionValidator {
  const base = {
    ...ineligibleValidatorAggDefaults(),
    voteAccount: 'v',
    country: 'C',
    aso: 'A',
    totalActivatedStakeSol: 0,
    auctionStake: {
      externalActivatedSol: 0,
      marinadeSamTargetSol: 0,
    },
    marinadeActivatedStakeSol: 0,
    bondBalanceSol: 0,
    lastBondBalanceSol: null,
    revShare: buildRevShare(),
    values: {
      paidUndelegationSol: 0,
      bondRiskFeeSol: 0,
    },
    samEligible: true,
    samBlocked: false,
    stakePriority: NaN,
    unstakePriority: NaN,
    maxBondDelegation: NaN,
    lastMarinadeActivatedStakeSol: null,
    selfStakeSol: 0,
    foundationStakeSol: 0,
  } as unknown as AuctionValidator

  return { ...base, ...overrides }
}

function makeAuction(overrides: Partial<AuctionData> = {}): AuctionData {
  const base: AuctionData = {
    epoch: 0,
    validators: [],
    stakeAmounts: {
      networkTotalSol: 0,
      marinadeSamTvlSol: 0,
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

describe('computeConstraintDiagnostics()', () => {
  it('returns diagnostics for all SAM constraint types on an uncapped validator', () => {
    const constraints = makeConstraints({
      totalCountryStakeCapSol: 1000,
      marinadeCountryStakeCapSol: 500,
      totalAsoStakeCapSol: 2000,
      marinadeAsoStakeCapSol: 1000,
      marinadeValidatorStakeCapSol: 200,
      minMaxStakeWanted: 0,
    })

    const v = makeValidator({
      voteAccount: 'v1',
      country: 'US',
      aso: 'AWS',
      bondBalanceSol: 100,
      maxStakeWanted: 300,
      auctionStake: {
        externalActivatedSol: 50,
        marinadeSamTargetSol: 10,
      },
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 10 }),
    })

    const data = makeAuction({ validators: [v] })
    constraints.updateStateForSam(data)

    const diagnostics = computeConstraintDiagnostics(v, constraints)

    // Should have 5 SAM constraint types: COUNTRY, ASO, VALIDATOR, BOND, WANT
    expect(diagnostics.length).toBe(5)
    const types = diagnostics.map(d => d.constraintType)
    expect(types).toContain(AuctionConstraintType.COUNTRY)
    expect(types).toContain(AuctionConstraintType.ASO)
    expect(types).toContain(AuctionConstraintType.VALIDATOR)
    expect(types).toContain(AuctionConstraintType.BOND)
    expect(types).toContain(AuctionConstraintType.WANT)

    // None should be binding since validator isn't capped
    diagnostics.forEach(d => {
      expect(d.isBinding).toBe(false)
    })
  })

  it('identifies the binding constraint when validator is COUNTRY-capped', () => {
    const constraints = makeConstraints({
      totalCountryStakeCapSol: 60, // tight
      marinadeCountryStakeCapSol: 10, // very tight
      totalAsoStakeCapSol: Infinity,
      marinadeAsoStakeCapSol: Infinity,
      marinadeValidatorStakeCapSol: Infinity,
    })

    const v = makeValidator({
      voteAccount: 'v1',
      country: 'US',
      aso: 'AWS',
      bondBalanceSol: 1000,
      auctionStake: {
        externalActivatedSol: 50,
        marinadeSamTargetSol: 10,
      },
      lastCapConstraint: {
        constraintType: AuctionConstraintType.COUNTRY,
        constraintName: 'US',
        totalStakeSol: 60,
        totalLeftToCapSol: 0,
        marinadeStakeSol: 10,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
    })

    const data = makeAuction({ validators: [v] })
    constraints.updateStateForSam(data)

    const diagnostics = computeConstraintDiagnostics(v, constraints)
    const countryDiag = findDiag(diagnostics, AuctionConstraintType.COUNTRY)

    expect(countryDiag.isBinding).toBe(true)
    expect(countryDiag.constraintName).toBe('US')
    expect(countryDiag.advice).toContain('Country US')
  })

  it('identifies BOND as binding when bond is limiting', () => {
    const constraints = makeConstraints({
      totalCountryStakeCapSol: Infinity,
      marinadeCountryStakeCapSol: Infinity,
      totalAsoStakeCapSol: Infinity,
      marinadeAsoStakeCapSol: Infinity,
      marinadeValidatorStakeCapSol: Infinity,
    })

    const v = makeValidator({
      voteAccount: 'v1',
      country: 'US',
      aso: 'AWS',
      bondBalanceSol: 1, // very small bond
      auctionStake: {
        externalActivatedSol: 0,
        marinadeSamTargetSol: 100,
      },
      lastCapConstraint: {
        constraintType: AuctionConstraintType.BOND,
        constraintName: 'v1',
        totalStakeSol: 0,
        totalLeftToCapSol: Infinity,
        marinadeStakeSol: 100,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
      revShare: buildRevShare({
        expectedMaxEffBidPmpe: 5,
        onchainDistributedPmpe: 10,
      }),
    })

    const data = makeAuction({ validators: [v] })
    constraints.updateStateForSam(data)

    const diagnostics = computeConstraintDiagnostics(v, constraints)
    const bondDiag = findDiag(diagnostics, AuctionConstraintType.BOND)

    expect(bondDiag.isBinding).toBe(true)
    expect(bondDiag.advice).toContain('Bond supports')
  })

  it('identifies WANT as binding when maxStakeWanted is limiting', () => {
    const constraints = makeConstraints({
      totalCountryStakeCapSol: Infinity,
      marinadeCountryStakeCapSol: Infinity,
      totalAsoStakeCapSol: Infinity,
      marinadeAsoStakeCapSol: Infinity,
      marinadeValidatorStakeCapSol: Infinity,
      minMaxStakeWanted: 0,
    })

    const v = makeValidator({
      voteAccount: 'v1',
      country: 'US',
      aso: 'AWS',
      bondBalanceSol: 1000,
      maxStakeWanted: 50,
      auctionStake: {
        externalActivatedSol: 0,
        marinadeSamTargetSol: 50,
      },
      lastCapConstraint: {
        constraintType: AuctionConstraintType.WANT,
        constraintName: 'v1',
        totalStakeSol: 0,
        totalLeftToCapSol: Infinity,
        marinadeStakeSol: 50,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 10 }),
    })

    const data = makeAuction({ validators: [v] })
    constraints.updateStateForSam(data)

    const diagnostics = computeConstraintDiagnostics(v, constraints)
    const wantDiag = findDiag(diagnostics, AuctionConstraintType.WANT)

    expect(wantDiag.isBinding).toBe(true)
    expect(wantDiag.advice).toContain('Max stake wanted')
  })

  it('sorts diagnostics by headroom ascending (tightest first)', () => {
    const constraints = makeConstraints({
      totalCountryStakeCapSol: 200,
      marinadeCountryStakeCapSol: 100,
      totalAsoStakeCapSol: 500,
      marinadeAsoStakeCapSol: 300,
      marinadeValidatorStakeCapSol: 50, // tightest
      minMaxStakeWanted: 0,
    })

    const v = makeValidator({
      voteAccount: 'v1',
      country: 'US',
      aso: 'AWS',
      bondBalanceSol: 1000,
      maxStakeWanted: 200,
      auctionStake: {
        externalActivatedSol: 10,
        marinadeSamTargetSol: 20,
      },
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 10 }),
    })

    const data = makeAuction({ validators: [v] })
    constraints.updateStateForSam(data)

    const diagnostics = computeConstraintDiagnostics(v, constraints)

    // Verify sorted by headroom ascending
    diagnostics.reduce((prev, curr) => {
      expect(curr.headroomSol).toBeGreaterThanOrEqual(prev.headroomSol)
      return curr
    })

    // VALIDATOR constraint with cap 50 and 20 used should be tightest (headroom = 30)
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ constraintType: AuctionConstraintType.VALIDATOR })]),
    )
    const first = findDiag(diagnostics, AuctionConstraintType.VALIDATOR)
    expect(first.headroomSol).toBe(diagnostics[0]?.headroomSol)
  })

  it('returns empty array for validator with no constraints', () => {
    const constraints = makeConstraints()
    const v = makeValidator({ voteAccount: 'unknown' })

    // Don't update state — validator won't be in any constraint
    const diagnostics = computeConstraintDiagnostics(v, constraints)
    expect(diagnostics).toEqual([])
  })

  it('computes correct numeric values for COUNTRY constraint', () => {
    const constraints = makeConstraints({
      totalCountryStakeCapSol: 1000,
      marinadeCountryStakeCapSol: 500,
      totalAsoStakeCapSol: Infinity,
      marinadeAsoStakeCapSol: Infinity,
      marinadeValidatorStakeCapSol: Infinity,
    })

    const v1 = makeValidator({
      voteAccount: 'v1',
      country: 'US',
      aso: 'A1',
      bondBalanceSol: 1000,
      auctionStake: {
        externalActivatedSol: 100,
        marinadeSamTargetSol: 50,
      },
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 10 }),
    })

    const v2 = makeValidator({
      voteAccount: 'v2',
      country: 'US',
      aso: 'A2',
      bondBalanceSol: 1000,
      auctionStake: {
        externalActivatedSol: 200,
        marinadeSamTargetSol: 100,
      },
      revShare: buildRevShare({ expectedMaxEffBidPmpe: 5, onchainDistributedPmpe: 10 }),
    })

    const data = makeAuction({ validators: [v1, v2] })
    constraints.updateStateForSam(data)

    const diagnostics = computeConstraintDiagnostics(v1, constraints)
    const countryDiag = findDiag(diagnostics, AuctionConstraintType.COUNTRY)

    // Total used: (100+50) + (200+100) = 450
    expect(countryDiag.totalUsedSol).toBe(450)
    expect(countryDiag.totalCapSol).toBe(1000)
    expect(countryDiag.totalRemainingCapSol).toBe(550)
    // Marinade used: 50 + 100 = 150
    expect(countryDiag.marinadeUsedSol).toBe(150)
    expect(countryDiag.marinadeCapSol).toBe(500)
    expect(countryDiag.marinadeRemainingCapSol).toBe(350)
    // 2 validators in country group
    expect(countryDiag.validatorsInGroup).toBe(2)
    // headroom = min(550, 350) = 350
    expect(countryDiag.headroomSol).toBe(350)
  })
})
