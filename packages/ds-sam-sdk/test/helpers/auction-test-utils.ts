import { calcValidatorRevShare } from '../../src/calculations'
import { AuctionConstraints } from '../../src/constraints'
import { Debug } from '../../src/debug'
import { effectiveCommissions, ineligibleValidatorAggDefaults } from '../../src/utils'

import type {
  AuctionConstraintsConfig,
  AuctionData,
  AuctionValidator,
  CommissionDetails,
  RevShare,
  Rewards,
} from '../../src/types'

export const BASE_CONSTRAINTS: AuctionConstraintsConfig = {
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
  bondSamHealthMult: 1.1,
}

export function makeConstraints(overrides: Partial<AuctionConstraintsConfig> = {}) {
  return new AuctionConstraints({ ...BASE_CONSTRAINTS, ...overrides }, new Debug(new Set()))
}

export function buildRevShare(overrides: Partial<RevShare> = {}): RevShare {
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
    activatingStakePmpe: 0,
    bidTooLowPenaltyPmpe: 0,
    effParticipatingBidPmpe: 0,
    expectedMaxEffBidPmpe: 0,
    blacklistPenaltyPmpe: 0,
    ...overrides,
  }
}

export function makeUnitValidator(overrides: Partial<AuctionValidator>): AuctionValidator {
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

export function commissionDetailsFor(
  onchainInflationDec: number,
  inBondInflationDec: number | null,
): CommissionDetails {
  const effective = effectiveCommissions(onchainInflationDec, inBondInflationDec, 0, null)
  return {
    inflationCommissionDec: effective.inflationDec,
    mevCommissionDec: effective.mevDec ?? 1,
    blockRewardsCommissionDec: 1,
    inflationCommissionOnchainDec: onchainInflationDec,
    inflationCommissionInBondDec: inBondInflationDec,
    mevCommissionOnchainDec: 0,
    mevCommissionInBondDec: null,
    blockRewardsCommissionInBondDec: null,
  }
}

export function revShareForCommissions(
  rewards: Rewards,
  onchainInflationDec: number,
  inBondInflationDec: number | null,
  bidCpmpe: number,
): RevShare {
  const commissions = commissionDetailsFor(onchainInflationDec, inBondInflationDec)
  return calcValidatorRevShare(
    {
      voteAccount: 'validator',
      inflationCommissionDec: commissions.inflationCommissionDec,
      mevCommissionDec: commissions.mevCommissionDec,
      blockRewardsCommissionDec: commissions.blockRewardsCommissionDec,
      bidCpmpe,
      values: { commissions },
    },
    rewards,
  )
}

export function makeAuction(overrides: Partial<AuctionData> = {}): AuctionData {
  return {
    epoch: 0,
    validators: [],
    stakeAmounts: {
      networkTotalSol: 0,
      marinadeSamTvlSol: 0,
      marinadeRemainingSamSol: 0,
    },
    rewards: { inflationPmpe: 0, mevPmpe: 0, blockPmpe: 0 },
    blacklist: new Set<string>(),
    ...overrides,
  }
}
