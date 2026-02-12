import type { AuctionValidator, AuctionConstraint, AuctionConstraintType } from './types'

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
  bondGoodForNEpochs: NaN,
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

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}
