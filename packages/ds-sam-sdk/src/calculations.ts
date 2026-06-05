import Decimal from 'decimal.js'

import { assert } from './utils'

import type { Debug } from './debug'
import type { BidTooLowPenalty, AuctionValidator, Rewards, RevShare, CommissionDetails } from './types'

export const calcValidatorRevShare = (
  validator: {
    voteAccount: string
    inflationCommissionDec: number
    mevCommissionDec: number | null
    blockRewardsCommissionDec: number | null
    bidCpmpe: number | null
    values: {
      commissions: CommissionDetails
    }
  },
  rewards: Rewards,
  debug?: Debug,
): RevShare => {
  // what the validator wants to share with stakers per 1000 SOL staked (of total, including bonds and overrides)
  const inflationPmpe = calculatePmpe(rewards.inflationPmpe, validator.inflationCommissionDec)
  const mevPmpe = calculatePmpe(rewards.mevPmpe, validator.mevCommissionDec)
  const blockPmpe = calculatePmpe(rewards.blockPmpe, validator.blockRewardsCommissionDec)
  const bidPmpe = Math.max(0, validator.bidCpmpe ?? 0)

  const commissions = validator.values.commissions

  // calculating what has already been shared on-chain (overrides redefines everything)
  const onchainDistributedInflationPmpe =
    commissions.inflationCommissionOverrideDec != null
      ? inflationPmpe
      : calculatePmpe(rewards.inflationPmpe, commissions.inflationCommissionOnchainDec)
  const onchainDistributedMevPmpe =
    commissions.mevCommissionOverrideDec != null
      ? mevPmpe
      : calculatePmpe(rewards.mevPmpe, commissions.mevCommissionOnchainDec)

  // here we need to calculate what the validator needs to pay on top of on-chain commissions from bonds claim
  const bondInflationPmpe = calculatePmpe(rewards.inflationPmpe, commissions.inflationCommissionInBondDec)
  const bondsInflationPmpeDiff = Math.max(0, bondInflationPmpe - onchainDistributedInflationPmpe)
  const bondMevPmpe = calculatePmpe(rewards.mevPmpe, commissions.mevCommissionInBondDec)
  const bondsMevPmpeDiff = Math.max(0, bondMevPmpe - onchainDistributedMevPmpe)

  const totalPmpe = inflationPmpe + mevPmpe + bidPmpe + blockPmpe
  assert(totalPmpe >= 0, 'Total PMPE cannot be negative')
  assert(isFinite(totalPmpe), 'Total PMPE has to be finite')

  if (debug) {
    debug.pushInfo(
      'calculations',
      JSON.stringify({
        voteAccount: validator.voteAccount,
        inflationPmpe,
        mevPmpe,
        blockPmpe,
        bidPmpe,
        commissions,
        bondInflationPmpe,
        bondMevPmpe,
        bondsInflationPmpeDiff,
        bondsMevPmpeDiff,
        onchainDistributedInflationPmpe,
        onchainDistributedMevPmpe,
        totalPmpe,
      }),
    )
  }

  return {
    // total value that the validator shares with stakers
    totalPmpe,
    inflationPmpe,
    mevPmpe,
    bidPmpe,
    blockPmpe,
    // what has already been shared via commissions with stakers on-chain
    onchainDistributedPmpe: onchainDistributedInflationPmpe + onchainDistributedMevPmpe,
    // what the validator wants to share through bonds
    bondObligationPmpe: bidPmpe + blockPmpe + bondsInflationPmpeDiff + bondsMevPmpeDiff,
    auctionEffectiveStaticBidPmpe: NaN,
    auctionEffectiveBidPmpe: NaN,
    activatingStakePmpe: NaN,
    bidTooLowPenaltyPmpe: NaN,
    effParticipatingBidPmpe: NaN,
    // in case expectedMaxWinningBidRatio = null, expectedMaxEffBidPmpe never gets set and remains equal to bidPmpe
    expectedMaxEffBidPmpe: bidPmpe,
    blacklistPenaltyPmpe: NaN,
  }
}

/** This method calculates the validator's revenue share with stakers for a given commission,
 *  expressed in PMPE (per mille per epoch).
 *
 *  @param pmpe defines the overall rewards obtained by the validator before commission per 1,000 SOL staked.
 *  @param commissionDec defines the portion of those rewards that the validator retains for itself
 *                       When null, it is treated as 100% commission (i.e., all rewards are gained by validator).
 *  @returns the portion of the rewards that goes to stakers after deducting the commission.
 */
const calculatePmpe = (pmpe: number | null, commissionDec: number | null): number => {
  if (pmpe === null || pmpe <= 0) {
    return 0
  }
  if (commissionDec === null || commissionDec >= 1) {
    return 0
  }
  // Negative commission means validator subsidizes stakers
  const result = new Decimal(pmpe).mul(new Decimal(1).minus(commissionDec))
  assert(result.gte(0), 'Calculated PMPE after commission cannot be negative')
  return result.toNumber()
}

// cf. https://www.notion.so/marinade/20250527-MRP-4-Stake-Auction-Marketplace-Re-balance-Dynamics-1e4e465715a480589819c33ab013c697
export type BondRiskFeeConfig = {
  minBondEpochs: number
  idealBondEpochs: number
  minBondBalanceSol: number
  bondRiskFeeMult: number
}

export type BondRiskFeeResult = {
  bondForcedUndelegation: {
    base: number
    coef: number
    value: number
    feePmpe: number
  }
  bondRiskFeeSol: number
  paidUndelegationSol: number
}

/**
 * Checks if a validator's claimable bond covers its exposed
 * stake. If underfunded, computes forced
 * undelegation and fee so post-fee bond covers remaining stake:
 *
 *   (claimableBond - reserve - fee) / idealBondCoef
 *     = projectedExposedStakeSol - forcedUndelegation
 *
 * idealBondCoef = idealBondPmpe / 1000
 * fee = forcedUndelegation * effPmpe / 1000
 */
export const calcBondRiskFee = (cfg: BondRiskFeeConfig, validator: AuctionValidator): BondRiskFeeResult | null => {
  const { revShare } = validator
  const projectedActivatedStakeSol = Math.max(
    0,
    validator.marinadeActivatedStakeSol - validator.values.paidUndelegationSol,
  )
  const minBondPmpe = validator.minBondPmpe ?? 0
  const idealBondPmpe = validator.idealBondPmpe ?? 0
  // claimable (funded - pending_settlement_claims) >= effective_amount always.
  // Using claimable avoids stacking the fee on top of a withdrawal already in progress:
  // effective_amount drops when a withdrawal is requested, but funded still backs the obligations.
  const claimableBondSol = validator.claimableBondBalanceSol ?? 0
  const unprotectedStakeSol = validator.unprotectedStakeSol ?? 0
  const projectedExposedStakeSol = Math.max(0, projectedActivatedStakeSol - unprotectedStakeSol)
  const minUnprotectedReserve = validator.minUnprotectedReserve ?? 0
  // bond earmarked for unprotected stake; remainder covers exposed stake
  if (claimableBondSol - minUnprotectedReserve < projectedExposedStakeSol * (minBondPmpe / 1000)) {
    const feeCoef = (revShare.onchainDistributedPmpe + revShare.auctionEffectiveBidPmpe) / 1000
    const idealUnprotectedReserve = validator.idealUnprotectedReserve ?? 0
    // always: base >= 0, even with no max, since idealBondPmpe >= minBondPmpe, since idealBondEpochs >= minBondEpochs
    // and we already ensured that (claimableBondSol - minUnprotectedReserve) / minBondPmpe * 1000 < projectedExposedStakeSol above
    // also, if minBondPmpe == 0, then we can never get here, in the opposite case, idealBondPmpe >= minBondPmpe > 0
    const base = Math.max(
      0,
      projectedExposedStakeSol - (claimableBondSol - idealUnprotectedReserve) / (idealBondPmpe / 1000),
    )
    const coef = 1 - feeCoef / (idealBondPmpe / 1000)
    let value = coef > 0 ? Math.min(projectedExposedStakeSol, base / coef) : projectedExposedStakeSol
    // always: value <= projectedExposedStakeSol
    if (
      ((projectedExposedStakeSol - value) * (revShare.onchainDistributedPmpe + revShare.expectedMaxEffBidPmpe)) / 1000 <
      cfg.minBondBalanceSol
    ) {
      value = projectedExposedStakeSol
    }
    const bondRiskFeeSol = cfg.bondRiskFeeMult * value * feeCoef
    const paidUndelegationSol = Math.min(1, cfg.bondRiskFeeMult) * value
    if (!isFinite(bondRiskFeeSol)) {
      throw new Error('bondRiskFeeSol has to be finite')
    }
    if (bondRiskFeeSol < 0) {
      throw new Error('bondRiskFeeSol can not be negative')
    }
    return {
      bondForcedUndelegation: { base, coef, value, feePmpe: 1000 * feeCoef },
      bondRiskFeeSol,
      paidUndelegationSol,
    }
  } else {
    return null
  }
}

/**
 * The validator’s PMPE represents the portion to be shared by claiming from bond.
 * Because PMPE is based on estimated rewards for the next epoch, the actual bond claim
 * is recalculated using the real rewards obtained at the end of the epoch.
 */
export const calcEffParticipatingBidPmpe = (
  revShare: {
    inflationPmpe: number
    mevPmpe: number
    onchainDistributedPmpe: number
  },
  winningTotalPmpe: number,
): number => {
  return Math.max(0, winningTotalPmpe - revShare.onchainDistributedPmpe)
}

export type BidTooLowPenaltyResult = {
  bidTooLowPenalty: BidTooLowPenalty
  bidTooLowPenaltyPmpe: number
  paidUndelegationSol: number
}

// How many epochs back to look for the commitment reference; a record missing for an epoch
// (API gap, publish failure) then falls back to the nearest older record instead of a free pass
export const BID_TOO_LOW_PENALTY_HISTORY_EPOCHS = 3

/**
 * Calculates the penalty by comparing the validator's current total PMPE against their own
 * previous auction commitment (commissions + bid) reconstructed at current reward estimates,
 * so the comparison reacts only to setting changes, never to reward estimate drift.
 * Any decommitment path (bid reduction, onchain or in-bond commission increase) is treated equally.
 * cf. GEN-7037
 */
export const calcBidTooLowPenalty = ({
  rewards,
  winningTotalPmpe,
  validator,
}: {
  rewards: Rewards
  winningTotalPmpe: number
  validator: AuctionValidator
}): BidTooLowPenaltyResult => {
  const { revShare, auctions } = validator
  const prevAuction = auctions.slice(0, BID_TOO_LOW_PENALTY_HISTORY_EPOCHS).find(auction => auction.present)
  // newcomers have no present record in the window -> commitment 0 -> never charged; missing commission
  // history defaults to 100% commissions (extractAuctionHistoryStats) -> commitment reduced to the recorded bid
  const prevCommitmentPmpe =
    prevAuction == null
      ? 0
      : calculatePmpe(rewards.inflationPmpe, prevAuction.commissions.inflationCommissionDec) +
        calculatePmpe(rewards.mevPmpe, prevAuction.commissions.mevCommissionDec) +
        calculatePmpe(rewards.blockPmpe, prevAuction.commissions.blockRewardsCommissionDec) +
        Math.max(0, prevAuction.bidPmpe)
  const shortfallPmpe = Math.max(0, prevCommitmentPmpe - revShare.totalPmpe)
  // validators whose offer still clears the auction keep their stake and never pay
  const isWinner = revShare.totalPmpe >= winningTotalPmpe
  const base = winningTotalPmpe + revShare.effParticipatingBidPmpe
  const bidTooLowPenaltyPmpe = isWinner ? 0 : Math.min(shortfallPmpe, base)
  const bidTooLowPenalty: BidTooLowPenalty = {
    base,
    coef: base > 0 ? bidTooLowPenaltyPmpe / base : 0,
    prevCommitmentPmpe,
    shortfallPmpe,
  }
  const paidUndelegationSol =
    bidTooLowPenaltyPmpe > 0 ? (bidTooLowPenaltyPmpe * validator.marinadeActivatedStakeSol) / winningTotalPmpe : 0
  if (!isFinite(bidTooLowPenaltyPmpe)) {
    throw new Error(`bidTooLowPenaltyPmpe has to be finite # ${JSON.stringify(bidTooLowPenalty)}`)
  }
  if (bidTooLowPenaltyPmpe < 0) {
    throw new Error(`bidTooLowPenaltyPmpe can not be negative # ${JSON.stringify(bidTooLowPenalty)}`)
  }
  if (!isFinite(paidUndelegationSol)) {
    throw new Error(
      `paidUndelegationSol has to be finite # ${JSON.stringify({ bidTooLowPenaltyPmpe, winningTotalPmpe })}`,
    )
  }
  if (paidUndelegationSol < 0) {
    throw new Error(
      `paidUndelegationSol can not be negative # ${JSON.stringify({ bidTooLowPenaltyPmpe, winningTotalPmpe })}`,
    )
  }
  return {
    bidTooLowPenalty,
    bidTooLowPenaltyPmpe,
    paidUndelegationSol,
  }
}
