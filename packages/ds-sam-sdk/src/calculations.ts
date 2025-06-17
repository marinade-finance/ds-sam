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
  }
}

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
  bondRiskFee: number
  paidUndelegationSol: number
}

export const calcBondRiskFee = (
  cfg: BondRiskFeeConfig,
  validator: AuctionValidator,
): BondRiskFeeResult | null => {
  const { revShare } = validator
  const projectedActivatedStakeSol = validator.marinadeActivatedStakeSol - validator.values.paidUndelegationSol
  const minBondCoef = (revShare.totalPmpe + cfg.minBondEpochs * revShare.effParticipatingBidPmpe) / 1000
  const bondBalanceSol = validator.bondBalanceSol ?? 0
  if (bondBalanceSol < projectedActivatedStakeSol * minBondCoef) {
    const idealBondCoef = (revShare.totalPmpe + cfg.idealBondEpochs * revShare.effParticipatingBidPmpe) / 1000
    const feePmpe = revShare.inflationPmpe + revShare.mevPmpe + revShare.auctionEffectiveBidPmpe
    // always: base >= 0, since idealBondCoef >= minBondCoef, since idealBondEpochs >= minBondEpochs
    const base = projectedActivatedStakeSol - bondBalanceSol / idealBondCoef
    const coef = 1 - (feePmpe / 1000) / idealBondCoef
    let value = coef > 0 ? Math.min(projectedActivatedStakeSol, base / coef) : projectedActivatedStakeSol
    // always: value <= projectedActivatedStakeSol
    if (projectedActivatedStakeSol - value < cfg.minBondBalanceSol / (revShare.totalPmpe / 1000)) {
      value = projectedActivatedStakeSol
    }
    const bondRiskFee = cfg.bondRiskFeeMult * value * feePmpe / 1000
    const paidUndelegationSol = cfg.bondRiskFeeMult * value
    if (!isFinite(bondRiskFee)) {
      throw new Error(`bondRiskFee has to be finite`)
    }
    return {
      bondForcedUndelegation: { base, coef, value, feePmpe },
      bondRiskFee,
      paidUndelegationSol,
    }
  } else {
    return null
  }
}

export const calcEffParticipatingBidPmpe = (revShare: { inflationPmpe: number, mevPmpe: number }, winningTotalPmpe: number): number => {
  return Math.max(0, winningTotalPmpe - revShare.inflationPmpe - revShare.mevPmpe)
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
  const { bidTooLowPenalty, revShare, auctions } = validator
  const historicalPmpe = auctions.slice(0, bidTooLowPenaltyHistoryEpochs).reduce(
    (acc, { effParticipatingBidPmpe }) => Math.min(acc, effParticipatingBidPmpe ?? Infinity),
    Infinity
  )
  const limit = Math.min(revShare.effParticipatingBidPmpe, historicalPmpe)
  const penaltyCoef = limit > 0 ? Math.min(1, Math.sqrt(1.5 * Math.max(0, (limit - revShare.bidPmpe) / limit))) : 0
  const bidTooLowPenaltyValue = {
    base: winningTotalPmpe + revShare.effParticipatingBidPmpe,
    coef: revShare.bidPmpe < 0.99999 * (auctions.map(({ bidPmpe }) => bidPmpe).find(x => x) ?? 0)
      ? penaltyCoef
      : 0
  }
  const bidTooLowPenaltyPmpe = bidTooLowPenaltyValue.coef * bidTooLowPenaltyValue.base
  const effPmpe = revShare.inflationPmpe + revShare.mevPmpe + revShare.auctionEffectiveBidPmpe
  const paidUndelegationSol = bidTooLowPenaltyPmpe * validator.marinadeActivatedStakeSol / effPmpe
  if (!isFinite(bidTooLowPenaltyPmpe)) {
    throw new Error('bidTooLowPenaltyPmpe has to be finite')
  }
  return {
    bidTooLowPenalty: bidTooLowPenaltyValue,
    bidTooLowPenaltyPmpe,
    paidUndelegationSol,
  }
}
