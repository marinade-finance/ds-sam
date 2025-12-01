import assert from 'assert'
import { BidTooLowPenalty, AuctionValidator, Rewards, RevShare, CommissionDetails } from './types'
import Decimal from 'decimal.js'

export const calcValidatorRevShare = (
  validator: {
    inflationCommissionDec: number,
    mevCommissionDec: number | null,
    blockRewardsCommissionDec: number | null,
    bidCpmpe: number | null,
    values: {
      commissions: CommissionDetails
    }
  },
  rewards: Rewards
): RevShare => {
  // what the validator wants to share with stakers per 1000 SOL staked (of total, including bonds and overrides)
  const inflationPmpe = calculatePmpe(rewards.inflationPmpe, validator.inflationCommissionDec)
  const mevPmpe = calculatePmpe(rewards.mevPmpe, validator.mevCommissionDec)
  const blockPmpe = calculatePmpe(rewards.blockPmpe, validator.blockRewardsCommissionDec)
  const bidPmpe = Math.max(0, validator.bidCpmpe ?? 0)

  const commissions = validator.values.commissions
  // here we need to calculate what the validator needs to pay on top of on-chain commissions from bonds claim
  const bondInflationPmpe = calculatePmpe(rewards.inflationPmpe, commissions.inflationCommissionInBondsDec)
  const bondMevPmpe = calculatePmpe(rewards.mevPmpe, commissions.mevCommissionInBondsDec)
  const bondsInflationPmpeDiff = Math.max(0, bondInflationPmpe - inflationPmpe)
  const bondsMevPmpeDiff = Math.max(0, bondMevPmpe - mevPmpe)

  // calculating what has already been shared on-chain (overrides redefines everything)
  const onchainDistributedInflationPmpe = commissions.inflationCommissionOverrideDec !== null ? inflationPmpe : calculatePmpe(rewards.inflationPmpe, commissions.inflationCommissionOnchainDec)
  const onchainDistributedMevPmpe = commissions.mevCommissionOverrideDec !== null ? mevPmpe : calculatePmpe(rewards.mevPmpe, commissions.mevCommissionOnchainDec)

  const totalPmpe = inflationPmpe + mevPmpe + bidPmpe + blockPmpe
  assert(totalPmpe >= 0, 'Total PMPE cannot be negative')
  assert(isFinite(totalPmpe), 'Total PMPE has to be finite')

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
 *
 * Calculates whether a validator's bond is sufficient to safely cover its active stake.
 * and if not:
 *
 *  Determines how much stake must be force-undelegated this epoch and,
 *  a fee so that the resulting stake after undelegation is covered by the
 *  remaining bond after the fee is charged on top of it.
 *
 *  This means that the forcedUndelegation and bondRiskFeeSol satisfy
 *
 *   (bondBalanceSol - bondRiskFeeSol) / idealBondCoef
 *     = projectedActivatedStakeSol - forcedUndelegation
 *
 * where
 *
 *   idealBondCoef = (totalPmpe + idealBondEpochs * effParticipatingBidPmpe) / 1000
 *   bondRiskFeeSol    = forcedUndelegation * effPmpe / 1000
 *
 */
export const calcBondRiskFee = (
  cfg: BondRiskFeeConfig,
  validator: AuctionValidator,
): BondRiskFeeResult | null => {
  const { revShare } = validator
  const projectedActivatedStakeSol = Math.max(0, validator.marinadeActivatedStakeSol - validator.values.paidUndelegationSol)
  const minBondCoef = (revShare.inflationPmpe + revShare.mevPmpe + revShare.blockPmpe + (cfg.minBondEpochs + 1) * revShare.expectedMaxEffBidPmpe) / 1000
  const riskBondSol = cfg.pendingWithdrawalBondMult * (validator.claimableBondBalanceSol ?? 0) + (1 - cfg.pendingWithdrawalBondMult) * (validator.bondBalanceSol ?? 0)
  if (riskBondSol < projectedActivatedStakeSol * minBondCoef) {
    const idealBondCoef = (revShare.inflationPmpe + revShare.mevPmpe + revShare.blockPmpe + (cfg.idealBondEpochs + 1) * revShare.expectedMaxEffBidPmpe) / 1000
    const feeCoef = (revShare.onchainDistributedPmpe + revShare.auctionEffectiveBidPmpe) / 1000
    // always: base >= 0, even with no max, since idealBondCoef >= minBondCoef, since idealBondEpochs >= minBondEpochs
    // and we already ensured that riskBondSol / minBondCoef < projectedActivatedStakeSol above
    // also, if minBondCoef == 0, then we can never get here, in the opposite case, idealBondCoef >= minBondCoef > 0
    const base = Math.max(0, projectedActivatedStakeSol - riskBondSol / idealBondCoef)
    const coef = 1 - feeCoef / idealBondCoef
    let value = coef > 0 ? Math.min(projectedActivatedStakeSol, base / coef) : projectedActivatedStakeSol
    // always: value <= projectedActivatedStakeSol
    if ((projectedActivatedStakeSol - value) * (revShare.inflationPmpe + revShare.mevPmpe + revShare.blockPmpe + revShare.expectedMaxEffBidPmpe) / 1000 < cfg.minBondBalanceSol) {
      value = projectedActivatedStakeSol
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
    inflationPmpe: number,
    mevPmpe: number,
    onchainDistributedPmpe: number,
  },
  winningTotalPmpe: number
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

export const calcBidTooLowPenalty = (
  bidTooLowPenaltyHistoryEpochs: number,
  winningTotalPmpe: number,
  validator: AuctionValidator
): BidTooLowPenaltyResult => {
  const tol_coef = 0.99999
  const scale_coef = 1.5
  const { revShare, auctions } = validator
  const historicalPmpe = auctions.slice(0, bidTooLowPenaltyHistoryEpochs).reduce(
    (acc, { effParticipatingBidPmpe }) => Math.min(acc, effParticipatingBidPmpe ?? Infinity),
    Infinity
  )
  const limit = Math.min(revShare.effParticipatingBidPmpe, historicalPmpe)
  // TODO: idea is that the penalty is calculated only from bidPmpe, as of the static bidding model
  const penaltyCoef = limit > 0
    ? Math.min(1, Math.sqrt(scale_coef * Math.max(0, (limit - revShare.bidPmpe) / limit)))
    : 0
  const bidTooLowPenaltyValue = {
    base: winningTotalPmpe + revShare.effParticipatingBidPmpe,
    coef: revShare.bidPmpe < tol_coef * (auctions[0]?.bidPmpe ?? 0)
      ? penaltyCoef
      : 0
  }
  const bidTooLowPenaltyPmpe = bidTooLowPenaltyValue.coef * bidTooLowPenaltyValue.base
  const auctionPmpe = winningTotalPmpe
  const paidUndelegationSol = bidTooLowPenaltyPmpe > 0
    ? bidTooLowPenaltyPmpe * validator.marinadeActivatedStakeSol / auctionPmpe
    : 0
  if (!isFinite(bidTooLowPenaltyPmpe)) {
    throw new Error(`bidTooLowPenaltyPmpe has to be finite # ${JSON.stringify(bidTooLowPenaltyValue)}`)
  }
  if (bidTooLowPenaltyPmpe < 0) {
    throw new Error(`bidTooLowPenaltyPmpe can not be negative # ${JSON.stringify(bidTooLowPenaltyValue)}`)
  }
  if (!isFinite(paidUndelegationSol)) {
    throw new Error(`paidUndelegationSol has to be finite # ${JSON.stringify({ bidTooLowPenaltyPmpe, auctionPmpe })}`)
  }
  if (paidUndelegationSol < 0) {
    throw new Error(`paidUndelegationSol can not be negative # ${JSON.stringify({ bidTooLowPenaltyPmpe, auctionPmpe })}`)
  }
  return {
    bidTooLowPenalty: bidTooLowPenaltyValue,
    bidTooLowPenaltyPmpe,
    paidUndelegationSol,
  }
}
