import assert from 'node:assert'

import { Auction } from '../src/auction'
import { calcBidTooLowPenalty, calcBondRiskFee, calcValidatorRevShare } from '../src/calculations'
import { DEFAULT_CONFIG } from '../src/config'
import { AuctionConstraints } from '../src/constraints'
import { Debug } from '../src/debug'
import { AuctionConstraintType } from '../src/types'
import { effectiveCommissions, ineligibleValidatorAggDefaults, minCapFromConstraint } from '../src/utils'

import type { AuctionConstraint, AuctionConstraintsConfig, AuctionData, AuctionValidator, RevShare } from '../src/types'

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
  } as AuctionValidator

  return { ...base, ...overrides }
}

describe('edge cases: division-by-zero and boundaries', () => {
  it('minCapFromConstraint with affectedValidators=0', () => {
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

  it('minCapFromConstraint clamps negative leftToCap to 0', () => {
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

  it('bondStakeCapSam with all-zero PMPE yields Infinity', () => {
    const c = makeConstraints()
    const v = makeValidator({
      bondBalanceSol: 1000,
      revShare: buildRevShare(),
    })
    const cap = c.bondStakeCapSam(v)
    expect(cap).toBe(Infinity)
  })

  it('bondStakeCapSam with bondBalanceSol=0 yields 0', () => {
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

  it('calcBidTooLowPenalty with winningTotalPmpe=0 throws', () => {
    const v = makeValidator({
      marinadeActivatedStakeSol: 1000,
      revShare: buildRevShare({
        effParticipatingBidPmpe: 10,
        bondObligationPmpe: 5,
        bidPmpe: 0,
      }),
      auctions: [
        {
          epoch: 999,
          winningTotalPmpe: 100,
          auctionEffectiveBidPmpe: 10,
          effParticipatingBidPmpe: 10,
          bidPmpe: 20,
          totalPmpe: 100,
          bondObligationPmpe: 10,
          commissions: {
            inflationCommissionDec: 0.05,
            mevCommissionDec: 0.08,
            blockRewardsCommissionDec: 0,
            inflationCommissionOnchainDec: 0.05,
            inflationCommissionInBondDec: null,
            mevCommissionOnchainDec: 0.08,
            mevCommissionInBondDec: null,
            blockRewardsCommissionInBondDec: null,
          },
        },
      ],
    })
    expect(() =>
      calcBidTooLowPenalty({
        historyEpochs: 1,
        winningTotalPmpe: 0,
        validator: v,
      }),
    ).toThrow(/paidUndelegationSol has to be finite/)
  })

  it('calcBidTooLowPenalty with empty auctions returns 0', () => {
    const v = makeValidator({
      marinadeActivatedStakeSol: 100,
      revShare: buildRevShare({
        effParticipatingBidPmpe: 10,
        bondObligationPmpe: 5,
        bidPmpe: 0,
      }),
      auctions: [],
    })
    const result = calcBidTooLowPenalty({
      historyEpochs: 1,
      winningTotalPmpe: 100,
      validator: v,
    })
    expect(result.bidTooLowPenaltyPmpe).toBe(0)
    expect(result.paidUndelegationSol).toBe(0)
  })

  it('calcBidTooLowPenalty with permittedBidDeviation=1', () => {
    const v = makeValidator({
      marinadeActivatedStakeSol: 100,
      revShare: buildRevShare({
        effParticipatingBidPmpe: 10,
        bondObligationPmpe: 5,
        bidPmpe: 0,
      }),
      auctions: [
        {
          epoch: 1,
          winningTotalPmpe: 100,
          auctionEffectiveBidPmpe: 10,
          effParticipatingBidPmpe: 10,
          bidPmpe: 20,
          totalPmpe: 100,
          bondObligationPmpe: 10,
          commissions: {
            inflationCommissionDec: 0.05,
            mevCommissionDec: 0.08,
            blockRewardsCommissionDec: 0,
            inflationCommissionOnchainDec: 0.05,
            inflationCommissionInBondDec: null,
            mevCommissionOnchainDec: 0.08,
            mevCommissionInBondDec: null,
            blockRewardsCommissionInBondDec: null,
          },
        },
      ],
    })
    const result = calcBidTooLowPenalty({
      historyEpochs: 1,
      winningTotalPmpe: 100,
      validator: v,
      permittedBidDeviation: 1,
    })
    // adjustedLimit = limit * (1 - 1) = 0, so penaltyCoef = 0
    expect(result.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('clipBondStakeCap with negative limit', () => {
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

  it('calcBondRiskFee: idealBondPmpe=0 division by zero', () => {
    // minBondPmpe > 0 so we enter underfunded branch,
    // but idealBondPmpe = 0 causes division by zero on L176
    const v = makeValidator({
      marinadeActivatedStakeSol: 1000,
      bondBalanceSol: 1,
      claimableBondBalanceSol: 1,
      unprotectedStakeSol: 0,
      minBondPmpe: 10,
      idealBondPmpe: 0,
      minUnprotectedReserve: 0,
      idealUnprotectedReserve: 0,
      revShare: buildRevShare({
        onchainDistributedPmpe: 5,
        auctionEffectiveBidPmpe: 5,
        expectedMaxEffBidPmpe: 5,
      }),
      values: {
        bondBalanceSol: 1,
        marinadeActivatedStakeSol: 1000,
        bondRiskFeeSol: 0,
        paidUndelegationSol: 0,
        samBlacklisted: false,
        commissions: {
          inflationCommissionDec: 0.05,
          mevCommissionDec: 0.08,
          blockRewardsCommissionDec: 0,
          inflationCommissionOnchainDec: 0.05,
          inflationCommissionInBondDec: null,
          mevCommissionOnchainDec: 0.08,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    })
    const result = calcBondRiskFee(
      {
        minBondEpochs: 1,
        idealBondEpochs: 0,
        minBondBalanceSol: 0,
        bondRiskFeeMult: 1,
        pendingWithdrawalBondMult: 1,
      },
      v,
    )
    assert(result)
    // (riskBondSol - idealUnprotectedReserve) / (0/1000) = Inf
    // base = max(0, 1000 - Inf) = 0
    expect(result.bondForcedUndelegation.base).toBe(0)
    // coef = 1 - (10/1000)/(0/1000) = -Inf => else branch
    expect(result.bondForcedUndelegation.coef).toBe(-Infinity)
    expect(result.bondForcedUndelegation.value).toBe(1000)
  })

  it('calcBondRiskFee: coef <= 0 uses full exposed stake', () => {
    // feeCoef >= idealBondPmpe/1000 => coef <= 0 => else branch
    const v = makeValidator({
      marinadeActivatedStakeSol: 500,
      bondBalanceSol: 1,
      claimableBondBalanceSol: 1,
      unprotectedStakeSol: 0,
      minBondPmpe: 10,
      idealBondPmpe: 10,
      minUnprotectedReserve: 0,
      idealUnprotectedReserve: 0,
      revShare: buildRevShare({
        onchainDistributedPmpe: 5,
        auctionEffectiveBidPmpe: 5,
        expectedMaxEffBidPmpe: 5,
      }),
      values: {
        bondBalanceSol: 1,
        marinadeActivatedStakeSol: 500,
        bondRiskFeeSol: 0,
        paidUndelegationSol: 0,
        samBlacklisted: false,
        commissions: {
          inflationCommissionDec: 0.05,
          mevCommissionDec: 0.08,
          blockRewardsCommissionDec: 0,
          inflationCommissionOnchainDec: 0.05,
          inflationCommissionInBondDec: null,
          mevCommissionOnchainDec: 0.08,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    })
    const result = calcBondRiskFee(
      {
        minBondEpochs: 1,
        idealBondEpochs: 1,
        minBondBalanceSol: 0,
        bondRiskFeeMult: 1,
        pendingWithdrawalBondMult: 1,
      },
      v,
    )
    assert(result)
    // coef = 1 - 10/1000 / (10/1000) = 0 => else branch
    expect(result.bondForcedUndelegation.coef).toBe(0)
    expect(result.bondForcedUndelegation.value).toBe(500)
  })

  it('calcBondRiskFee: riskBondSol < minUnprotectedReserve', () => {
    // pending withdrawals reduce riskBondSol below reserve,
    // making riskBondSol - minUnprotectedReserve negative,
    // which always triggers fee path
    const v = makeValidator({
      marinadeActivatedStakeSol: 1000,
      bondBalanceSol: 100,
      claimableBondBalanceSol: 10,
      unprotectedStakeSol: 500,
      minBondPmpe: 10,
      idealBondPmpe: 20,
      minUnprotectedReserve: 50,
      idealUnprotectedReserve: 100,
      revShare: buildRevShare({
        onchainDistributedPmpe: 5,
        auctionEffectiveBidPmpe: 5,
        expectedMaxEffBidPmpe: 5,
      }),
      values: {
        bondBalanceSol: 100,
        marinadeActivatedStakeSol: 1000,
        bondRiskFeeSol: 0,
        paidUndelegationSol: 0,
        samBlacklisted: false,
        commissions: {
          inflationCommissionDec: 0.05,
          mevCommissionDec: 0.08,
          blockRewardsCommissionDec: 0,
          inflationCommissionOnchainDec: 0.05,
          inflationCommissionInBondDec: null,
          mevCommissionOnchainDec: 0.08,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    })
    // pendingWithdrawalBondMult=0.5 =>
    // riskBondSol = 0.5*10 + 0.5*100 = 55, reserve=50
    // riskBondSol - reserve = 5, exposed = 500
    // 5 < 500*(10/1000)=5 is false (equal), no fee
    const noFee = calcBondRiskFee(
      {
        minBondEpochs: 1,
        idealBondEpochs: 2,
        minBondBalanceSol: 0,
        bondRiskFeeMult: 1,
        pendingWithdrawalBondMult: 0.5,
      },
      v,
    )
    expect(noFee).toBeNull()

    // pendingWithdrawalBondMult=0.1 =>
    // riskBondSol = 0.1*10 + 0.9*100 = 91, reserve=50
    // but with claimable=1 instead:
    const v2 = makeValidator({
      ...v,
      claimableBondBalanceSol: 1,
      bondBalanceSol: 20,
    })
    // riskBondSol = 0.1*1 + 0.9*20 = 18.1, reserve=50
    // 18.1 - 50 = -31.9 < 0 < any positive => always fee
    const fee = calcBondRiskFee(
      {
        minBondEpochs: 1,
        idealBondEpochs: 2,
        minBondBalanceSol: 0,
        bondRiskFeeMult: 1,
        pendingWithdrawalBondMult: 0.1,
      },
      v2,
    )
    assert(fee)
    expect(fee.bondRiskFeeSol).toBeGreaterThan(0)
  })

  it('setStakeUnstakePriorities: samBlocked=true filtered', () => {
    const debug = new Debug(new Set())
    const v1 = makeValidator({
      voteAccount: 'v1',
      samEligible: true,
      samBlocked: true,
      revShare: buildRevShare({ totalPmpe: 100 }),
    })
    const v2 = makeValidator({
      voteAccount: 'v2',
      samEligible: true,
      samBlocked: false,
      revShare: buildRevShare({ totalPmpe: 50 }),
    })
    const data: AuctionData = {
      epoch: 1,
      validators: [v1, v2],
      rewards: { inflationPmpe: 10, mevPmpe: 5, blockPmpe: 0 },
      stakeAmounts: {
        networkTotalSol: 1e6,
        marinadeSamTvlSol: 1000,
        marinadeRemainingSamSol: 1000,
      },
      blacklist: new Set(),
    }
    const constraints = makeConstraints()
    const auction = new Auction(data, constraints, DEFAULT_CONFIG, debug)
    // distributeSamStake filters samBlocked validators
    const winningPmpe = auction.distributeSamStake()
    // v1 is blocked, only v2 should receive stake
    expect(v1.auctionStake.marinadeSamTargetSol).toBe(0)
    expect(v2.auctionStake.marinadeSamTargetSol).toBeGreaterThan(0)
    expect(winningPmpe).toBe(50)
  })

  it('setMaxBondDelegations: totalPmpe=0 yields 0', () => {
    const debug = new Debug(new Set())
    const v = makeValidator({
      voteAccount: 'v1',
      bondBalanceSol: 1000,
      revShare: buildRevShare({ totalPmpe: 0 }),
    })
    const data: AuctionData = {
      epoch: 1,
      validators: [v],
      rewards: { inflationPmpe: 10, mevPmpe: 5, blockPmpe: 0 },
      stakeAmounts: {
        networkTotalSol: 1e6,
        marinadeSamTvlSol: 1000,
        marinadeRemainingSamSol: 1000,
      },
      blacklist: new Set(),
    }
    const constraints = makeConstraints()
    const auction = new Auction(data, constraints, DEFAULT_CONFIG, debug)
    auction.setMaxBondDelegations()
    expect(v.maxBondDelegation).toBe(0)
  })

  it('effectiveCommissions: both mev null returns null', () => {
    const result = effectiveCommissions(0.05, null, null, null)
    expect(result.inflationDec).toBe(0.05)
    expect(result.mevDec).toBeNull()
  })

  it('calcValidatorRevShare with commissionDec=1.0', () => {
    const result = calcValidatorRevShare(
      {
        voteAccount: 'v',
        inflationCommissionDec: 1.0,
        mevCommissionDec: 1.0,
        blockRewardsCommissionDec: 1.0,
        bidCpmpe: 0,
        values: {
          commissions: {
            inflationCommissionDec: 1.0,
            mevCommissionDec: 1.0,
            blockRewardsCommissionDec: 1.0,
            inflationCommissionOnchainDec: 1.0,
            inflationCommissionInBondDec: 1.0,
            mevCommissionOnchainDec: 1.0,
            mevCommissionInBondDec: 1.0,
            blockRewardsCommissionInBondDec: 1.0,
          },
        },
      },
      { inflationPmpe: 100, mevPmpe: 50, blockPmpe: 20 },
    )
    expect(result.inflationPmpe).toBe(0)
    expect(result.mevPmpe).toBe(0)
    expect(result.blockPmpe).toBe(0)
    expect(result.totalPmpe).toBe(0)
  })
})
