import { RevShare, Rewards, AggregatedValidator, AuctionValidator, StakeConcEntity, StakeConcEntityType } from './types'

export const MNDE_VOTE_DELEGATION_STRATEGY = 'MarinadeA1gorithmicDe1egationStrategy111111'

export const calcValidatorRevShare = (validator: AggregatedValidator, rewards: Rewards): RevShare => {
  const inflationPmpe = Math.max(0, rewards.inflationPmpe * (1 - validator.inflationCommissionDec))
  const mevPmpe = Math.max(0, rewards.mevPmpe * (1 - (validator.mevCommissionDec ?? 1)))
  const bidPmpe = Math.max(0, validator.bidCpmpe ?? 0)

  return { totalPmpe: inflationPmpe + mevPmpe + bidPmpe, inflationPmpe, mevPmpe, bidPmpe }
}

export const validatorTotalAuctionStakeSol = (validator: AuctionValidator): number =>
  validator.auctionStake.externalActivatedSol + validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol

export const zeroStakeConcentration = (type: StakeConcEntityType, name: string, caps: { totalSol: number, marinadeSol: number }): StakeConcEntity => ({
  entityType: type,
  entityName: name,
  totalStakeSol: 0,
  totalLeftToCapSol: caps.totalSol,
  marinadeStakeSol: 0,
  marinadeLeftToCapSol: caps.marinadeSol,
  validators: [],
})
