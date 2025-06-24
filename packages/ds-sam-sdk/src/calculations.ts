import { BidTooLowPenalty, AuctionValidator, Rewards, RevShare } from './types'

export const calcValidatorRevShare = (
  validator: { bidCpmpe: number | null, mevCommissionDec: number | null, inflationCommissionDec: number },
  rewards: Rewards
): RevShare => {
  const inflationPmpe = Math.max(0, rewards.inflationPmpe * (1 - validator.inflationCommissionDec))
  const mevPmpe = Math.max(0, rewards.mevPmpe * (1 - (validator.mevCommissionDec ?? 1)))
  const bidPmpe = Math.max(0, validator.bidCpmpe ?? 0)
  return {
    totalPmpe: inflationPmpe + mevPmpe + bidPmpe,
    inflationPmpe,
    mevPmpe,
    bidPmpe,
    auctionEffectiveBidPmpe: NaN,
    bidTooLowPenaltyPmpe: NaN,
    effParticipatingBidPmpe: NaN,
    // in case expectedMaxWinningBidRatio = null, expectedMaxEffBidPmpe never gets set and remains equal to bidPmpe
    expectedMaxEffBidPmpe: bidPmpe,
    blacklistPenaltyPmpe: NaN,
  }
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
  const minBondCoef = (revShare.inflationPmpe + revShare.mevPmpe + (cfg.minBondEpochs + 1) * revShare.expectedMaxEffBidPmpe) / 1000
  const riskBondSol = cfg.pendingWithdrawalBondMult * (validator.claimableBondBalanceSol ?? 0) + (1 - cfg.pendingWithdrawalBondMult) * (validator.bondBalanceSol ?? 0)
  if (riskBondSol < projectedActivatedStakeSol * minBondCoef) {
    const idealBondCoef = (revShare.inflationPmpe + revShare.mevPmpe + (cfg.idealBondEpochs + 1) * revShare.expectedMaxEffBidPmpe) / 1000
    const feeCoef = (revShare.inflationPmpe + revShare.mevPmpe + revShare.auctionEffectiveBidPmpe) / 1000
    // always: base >= 0, even with no max, since idealBondCoef >= minBondCoef, since idealBondEpochs >= minBondEpochs
    // and we already ensured that riskBondSol / minBondCoef < projectedActivatedStakeSol above
    // also, if minBondCoef == 0, then we can never get here, in the opposite case, idealBondCoef >= minBondCoef > 0
    const base = Math.max(0, projectedActivatedStakeSol - riskBondSol / idealBondCoef)
    const coef = 1 - feeCoef / idealBondCoef
    let value = coef > 0 ? Math.min(projectedActivatedStakeSol, base / coef) : projectedActivatedStakeSol
    // always: value <= projectedActivatedStakeSol
    if ((projectedActivatedStakeSol - value) * (revShare.inflationPmpe + revShare.mevPmpe + revShare.expectedMaxEffBidPmpe) / 1000 < cfg.minBondBalanceSol) {
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

export const calcEffParticipatingBidPmpe = (
  revShare: {
    inflationPmpe: number,
    mevPmpe: number
  },
  winningTotalPmpe: number
): number =>
  Math.max(0, winningTotalPmpe - revShare.inflationPmpe - revShare.mevPmpe)

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
  const penaltyCoef = limit > 0
    ? Math.min(1, Math.sqrt(scale_coef * Math.max(0, (limit - revShare.bidPmpe) / limit)))
    : 0
  const bidTooLowPenaltyValue = {
    base: winningTotalPmpe + revShare.effParticipatingBidPmpe,
    coef: revShare.bidPmpe < tol_coef * (auctions.find(({ bidPmpe }) => bidPmpe)?.bidPmpe ?? 0)
      ? penaltyCoef
      : 0
  }
  const bidTooLowPenaltyPmpe = bidTooLowPenaltyValue.coef * bidTooLowPenaltyValue.base
  const auctionPmpe = revShare.inflationPmpe + revShare.mevPmpe + revShare.effParticipatingBidPmpe
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
