import { BID_TOO_LOW_TOL_COEF, bidTooLowPenaltyCoef } from './calculations'
import { pmpeToSol } from './constants'
import { finite } from './format'

import type { DsSamConfig } from './config'
import type { AuctionValidator } from './types'

export type BidPenalty = {
  historyEpochs: number
  lastEpochBidPmpe: number
  thisEpochBidPmpe: number
  isNegativeBiddingChange: boolean
  effParticipatingBidPmpe: number
  worstHistoricalPmpe: number
  limit: number
  adjustedLimit: number
  bondObligationPmpe: number
  shortfall: number
  penaltyCoef: number
  base: number
  penaltyPmpe: number
  penaltySol: number
  marinadeActivatedStakeSol: number
  winningTotalPmpe: number
}

export function computeBidPenalty(v: AuctionValidator, dsSamConfig: DsSamConfig, winningTotalPmpe: number): BidPenalty {
  const historyEpochs = dsSamConfig.bidTooLowPenaltyHistoryEpochs
  // SDK auction.js:202 passes this field as permittedBidDeviation ∈ [0,1].
  // Falls back to 0 if missing — the SDK's `calcBidTooLowPenalty` defaults
  // the same way; without this, `1 - undefined` poisons every downstream
  // value with NaN (badge, banner, payments row).
  const permittedDeviation = dsSamConfig.bidTooLowPenaltyPermittedDeviationPmpe ?? 0

  const auctions = v.auctions ?? []
  const pastAuction = auctions[0]
  const lastEpochBidPmpe = finite(pastAuction?.bidPmpe)
  const thisEpochBidPmpe = finite(v.revShare.bidPmpe)
  const threshold = BID_TOO_LOW_TOL_COEF * lastEpochBidPmpe
  const isNegativeBiddingChange = thisEpochBidPmpe < threshold

  const effParticipatingBidPmpe = finite(v.revShare.effParticipatingBidPmpe)
  // ?? not ||, so a real 0 stays 0 (only missing values fall back to Infinity).
  const worstHistoricalPmpe = auctions
    .slice(0, historyEpochs)
    .reduce((acc, a) => Math.min(acc, a.effParticipatingBidPmpe ?? Infinity), Infinity)
  const limit = Math.min(effParticipatingBidPmpe, worstHistoricalPmpe)
  const adjustedLimit = limit * (1 - permittedDeviation)

  const bondObligationPmpe = finite(v.revShare.bondObligationPmpe)
  const shortfall = Math.max(0, adjustedLimit - bondObligationPmpe)
  // Single source for the coefficient — shared with the SDK auction path so the
  // displayed penalty can never drift from the one the auction actually charges.
  const penaltyCoef = bidTooLowPenaltyCoef({
    effParticipatingBidPmpe,
    worstHistoricalPmpe,
    bondObligationPmpe,
    permittedBidDeviation: permittedDeviation,
    isNegativeBiddingChange,
  })

  const base = winningTotalPmpe + effParticipatingBidPmpe
  const penaltyPmpe = penaltyCoef * base
  const penaltySol = pmpeToSol(penaltyPmpe, v.marinadeActivatedStakeSol)

  return {
    historyEpochs,
    lastEpochBidPmpe,
    thisEpochBidPmpe,
    isNegativeBiddingChange,
    effParticipatingBidPmpe,
    // With no history `worstHistoricalPmpe` stays `Infinity` and `limit`
    // collapses to `effParticipatingBidPmpe` (the min(eff, ∞) above). Mirror
    // that on the displayed value so the breakdown's "Historical bid limit"
    // row doesn't read 0 while the math actually used the eff bid.
    worstHistoricalPmpe: Number.isFinite(worstHistoricalPmpe) ? worstHistoricalPmpe : effParticipatingBidPmpe,
    limit,
    adjustedLimit,
    bondObligationPmpe,
    shortfall,
    penaltyCoef,
    base,
    penaltyPmpe,
    penaltySol,
    marinadeActivatedStakeSol: v.marinadeActivatedStakeSol,
    winningTotalPmpe,
  }
}

// Single home for the bid-too-low penalty in SOL. Sources from the local
// computeBidPenalty recompute (NOT the SDK-pre-computed
// `revShare.bidTooLowPenaltyPmpe`) so that under simulation — where the SDK
// field is frozen against the original commission/bid — the displayed
// penalty updates with the user's edits. Every surface (tip banner, sam-
// table badge, validator-detail header, Payments breakdown row, Bid Penalty
// breakdown headline) consumes THIS value, so they can never contradict
// each other.
export function bidTooLowPenaltySol(v: AuctionValidator, dsSamConfig: DsSamConfig, winningTotalPmpe: number): number {
  return computeBidPenalty(v, dsSamConfig, winningTotalPmpe).penaltySol
}

// Blacklist penalty in SOL against the validator's active Marinade stake.
export function blacklistPenaltySol(v: AuctionValidator): number {
  return pmpeToSol(v.revShare.blacklistPenaltyPmpe, v.marinadeActivatedStakeSol)
}
