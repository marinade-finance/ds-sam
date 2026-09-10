import type { AuctionValidator, AuctionConstraint, AuctionConstraintType, CommissionDetails } from './types'

// "Not known", as opposed to "keeps everything": nothing on chain resolved and no override supplied a rate.
// Single source of truth so the auction gate and the bond-obligation math cannot disagree.
export const isInflationCommissionUnresolved = (commissions: CommissionDetails): boolean =>
  commissions.inflationCommissionOnchainDec == null && commissions.inflationCommissionOverrideDec == null

// Coercion for validator data that may be absent on rehydrated objects. Not for caller-supplied
// invariants — those assert instead, so a wiring bug cannot read as a confident 0.
export const finite = (x: number | null | undefined): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

export const ineligibleValidatorAggDefaults = () => ({
  samEligible: false,
  backstopEligible: false,
  ...validatorAggDefaults(),
})

export const validatorAggDefaults = () => ({
  lastCapConstraint: null,
  stakePriority: NaN,
  unstakePriority: NaN,
  bidTooLowPenalty: {
    coef: 0,
    base: 0,
  },
  bondForcedUndelegation: {
    coef: 0,
    base: 0,
    value: 0,
  },
  samBlocked: false,
  maxBondDelegation: NaN,
  bondSamStakeCapSol: NaN,
  unprotectedStakeCapSol: NaN,
  unprotectedStakeSol: NaN,
  minBondPmpe: NaN,
  idealBondPmpe: NaN,
  minUnprotectedReserve: NaN,
  idealUnprotectedReserve: NaN,
  bondGoodForNEpochs: NaN,
  bondSamHealth: NaN,
})

export const validatorTotalAuctionStakeSol = (validator: AuctionValidator): number =>
  validator.auctionStake.externalActivatedSol + validator.auctionStake.marinadeSamTargetSol

export const zeroStakeConcentration = (
  type: AuctionConstraintType,
  name: string,
  caps: { totalSol: number; marinadeSol: number },
): AuctionConstraint => ({
  constraintType: type,
  constraintName: name,
  totalStakeSol: 0,
  totalLeftToCapSol: caps.totalSol,
  marinadeStakeSol: 0,
  marinadeLeftToCapSol: caps.marinadeSol,
  validators: [],
})

export const minCapFromConstraint = (
  constraint: AuctionConstraint,
  voteAccounts: Set<string>,
): { cap: number; affectedValidators: number } => {
  const affectedValidators = constraint.validators.reduce(
    (sum, { voteAccount }) => (voteAccounts.has(voteAccount) ? sum + 1 : sum),
    0,
  )
  return {
    affectedValidators,
    cap: Math.max(0, Math.min(constraint.totalLeftToCapSol, constraint.marinadeLeftToCapSol)) / affectedValidators,
  }
}

export const formatLastCapConstraint = (constraint: AuctionConstraint | null) =>
  constraint ? `${constraint.constraintType} (${constraint.constraintName})` : 'NULL'

/**
 * Determines effective commissions by applying the bond-caps-onchain rule.
 * All inputs and outputs are in decimal (0–1) scale.
 *
 * Inflation: bond wins when it's lower (Math.min).
 * MEV: bond wins only when strictly less than on-chain.
 */
export function effectiveCommissions(
  inflationOnchainDec: number | null,
  inflationBondDec: number | null,
  mevOnchainDec: number | null,
  mevBondDec: number | null,
): { inflationDec: number | null; mevDec: number | null } {
  // null is "not known", never "keeps everything" — a rate that is absent must not cap the other one
  const inflationCandidates = [inflationOnchainDec, inflationBondDec].filter((dec): dec is number => dec != null)
  const inflationDec = inflationCandidates.length > 0 ? Math.min(...inflationCandidates) : null

  const mevDec = mevBondDec != null && mevBondDec < (mevOnchainDec ?? 1) ? mevBondDec : mevOnchainDec

  return { inflationDec, mevDec }
}
