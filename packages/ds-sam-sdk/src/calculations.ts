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
