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
  pendingWithdrawalBondMult: number
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
 * Checks if a validator's bond covers its exposed stake
 * (riskBondSol minus unprotected reserve vs projected exposed
 * stake times minBondPmpe). If underfunded, computes forced
 * undelegation and fee so post-fee bond covers remaining stake:
 *
 *   (riskBondSol - reserve - fee) / idealBondCoef
 *     = projectedExposedStakeSol - forcedUndelegation
 *
 * riskBondSol = weighted blend of claimable + total bond
 *   (pendingWithdrawalBondMult adjusts for pending withdrawals)
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
  const riskBondSol =
    cfg.pendingWithdrawalBondMult * (validator.claimableBondBalanceSol ?? 0) +
    (1 - cfg.pendingWithdrawalBondMult) * (validator.bondBalanceSol ?? 0)
  const unprotectedStakeSol = validator.unprotectedStakeSol ?? 0
  const projectedExposedStakeSol = Math.max(0, projectedActivatedStakeSol - unprotectedStakeSol)
  const minUnprotectedReserve = validator.minUnprotectedReserve ?? 0
  // bond earmarked for unprotected stake; remainder covers exposed stake
  if (riskBondSol - minUnprotectedReserve < projectedExposedStakeSol * (minBondPmpe / 1000)) {
    const feeCoef = (revShare.onchainDistributedPmpe + revShare.auctionEffectiveBidPmpe) / 1000
    const idealUnprotectedReserve = validator.idealUnprotectedReserve ?? 0
    // always: base >= 0, even with no max, since idealBondPmpe >= minBondPmpe, since idealBondEpochs >= minBondEpochs
    // and we already ensured that (riskBondSol - minUnprotectedReserve) / minBondPmpe * 1000 < projectedExposedStakeSol above
    // also, if minBondPmpe == 0, then we can never get here, in the opposite case, idealBondPmpe >= minBondPmpe > 0
    const base = Math.max(
      0,
      projectedExposedStakeSol - (riskBondSol - idealUnprotectedReserve) / (idealBondPmpe / 1000),
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
  // for a better memory, later this comment can be deleted; before introduction of blockPmpe this was the code:
  // return Math.max(0, winningTotalPmpe - revShare.inflationPmpe - revShare.mevPmpe)
  return Math.max(0, winningTotalPmpe - revShare.onchainDistributedPmpe)
}

export type BidTooLowPenaltyResult = {
  bidTooLowPenalty: BidTooLowPenalty
  bidTooLowPenaltyPmpe: number
  paidUndelegationSol: number
}

// Calculates the penalty for lowering the bid (considered whatever static, or dynamic commission)
//  compared to the last epochs - i.e., penalizes validators who reduce their commitment
// cf. https://www.notion.so/marinade/20250416-MRP-2-Stake-Auction-Marketplace-Bid-Penalty-1d7e465715a480cc80cecd86d63ce6af

export const calcBidTooLowPenalty = ({
  historyEpochs,
  winningTotalPmpe,
  validator,
  permittedBidDeviation = 0,
}: {
  historyEpochs: number
  winningTotalPmpe: number
  validator: AuctionValidator
  permittedBidDeviation?: number
}): BidTooLowPenaltyResult => {
  const tolCoef = 0.99999
  const scaleCoef = 1.5
  assert(permittedBidDeviation >= 0 && permittedBidDeviation <= 1, 'permittedBidDeviation has to be in [0, 1]')
  const { revShare, auctions } = validator
  const historicalPmpe = auctions
    .slice(0, historyEpochs)
    .reduce((acc, { effParticipatingBidPmpe }) => Math.min(acc, effParticipatingBidPmpe ?? Infinity), Infinity)
  const limit = Math.min(revShare.effParticipatingBidPmpe, historicalPmpe)
  const adjustedLimit = limit * (1 - permittedBidDeviation)
  const penaltyCoef =
    adjustedLimit > 0
      ? Math.min(1, Math.sqrt(scaleCoef * Math.max(0, (adjustedLimit - revShare.bondObligationPmpe) / adjustedLimit)))
      : 0
  const pastAuction = auctions[0]
  const isNegativeBiddingChange = revShare.bidPmpe < tolCoef * (pastAuction?.bidPmpe ?? 0)
  // Disable commission-based penalty for now; commmissions = validator.values.commissions
  // || tolCoef * commissions.inflationCommissionDec > (pastAuction?.commissions?.inflationCommissionDec ?? Infinity) ||
  // tolCoef * commissions.mevCommissionDec > (pastAuction?.commissions?.mevCommissionDec ?? Infinity) ||
  // tolCoef * commissions.blockRewardsCommissionDec > (pastAuction?.commissions?.blockRewardsCommissionDec ?? Infinity)
  const bidTooLowPenaltyValue = {
    base: winningTotalPmpe + revShare.effParticipatingBidPmpe,
    // did validator lower its bid compared to last epoch; if so how much
    coef: isNegativeBiddingChange ? penaltyCoef : 0,
  }
  const bidTooLowPenaltyPmpe = bidTooLowPenaltyValue.coef * bidTooLowPenaltyValue.base
  const paidUndelegationSol =
    bidTooLowPenaltyPmpe > 0 ? (bidTooLowPenaltyPmpe * validator.marinadeActivatedStakeSol) / winningTotalPmpe : 0
  if (!isFinite(bidTooLowPenaltyPmpe)) {
    throw new Error(`bidTooLowPenaltyPmpe has to be finite # ${JSON.stringify(bidTooLowPenaltyValue)}`)
  }
  if (bidTooLowPenaltyPmpe < 0) {
    throw new Error(`bidTooLowPenaltyPmpe can not be negative # ${JSON.stringify(bidTooLowPenaltyValue)}`)
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
    bidTooLowPenalty: bidTooLowPenaltyValue,
    bidTooLowPenaltyPmpe,
    paidUndelegationSol,
  }
}
