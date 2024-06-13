import { RevShare, Rewards, AggregatedValidator, AuctionValidator, StakeConcentration } from './types'

export const calcValidatorRevShare = (validator: AggregatedValidator, rewards: Rewards): RevShare => {
  const inflationPmpe = Math.max(0, rewards.inflationPmpe * (1 - validator.inflationCommissionDec))
  const mevPmpe = Math.max(0, rewards.mevPmpe * (1 - (validator.mevCommissionDec ?? 1)))
  const bidPmpe = Math.max(0, validator.bidCpmpe ?? 0)

  return { totalPmpe: inflationPmpe + mevPmpe + bidPmpe, inflationPmpe, mevPmpe, bidPmpe }
}

export const calcValidatorAuctionStakeSol = (validator: AuctionValidator): number =>
  validator.totalActivatedStake
    .sub(validator.marinadeActivatedStake)
    .add(validator.marinadeTargetStake)
    .div(1e9).toNumber()

export const zeroStakeConcentration = (caps: { total: number, marinade: number }): StakeConcentration => ({
  totalStakeSol: 0,
  totalStakeShareDec: 0,
  totalLeftToCapSol: caps.total,
  marinadeStakeSol: 0,
  marinadeTvlShareDec: 0,
  marinadeLeftToCapSol: caps.marinade,
})

export const zeroEligibilityAndTargetStake = () => ({ samEligible: false, mndeEligible: false, marinadeTargetStake: 0 })
