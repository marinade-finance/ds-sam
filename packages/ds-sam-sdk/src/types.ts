import Decimal from 'decimal.js'

export type AuctionResult = any // TODO

export type AuctionData = Omit<AggregatedData, 'validators'> & {
  validators: AuctionValidator[]
}

export type StakeAmounts = {
  totalSol: number
  externalSol: number
  marinadeTvlSol: number
  marinadeRemainingSol: number
}

export type AggregatedData = {
  validators: AggregatedValidator[]
  rewards: Rewards
  stakeAmounts: StakeAmounts
  blacklist: Set<string>
}

export type EpochStats = {
  epoch: number
  totalActivatedStake: Decimal
  marinadeActivatedStake: Decimal
  voteCredits: number
}

export type AuctionValidator = AggregatedValidator & {
  revShare: RevShare
  mndeEligible: boolean
  samEligible: boolean
  marinadeTargetStake: number
}

export type AggregatedValidator = {
  voteAccount: string
  clientVersion: string
  voteCredits: number
  aso: string | null
  country: string | null
  bondBalance: Decimal | null
  totalActivatedStake: Decimal
  marinadeActivatedStake: Decimal
  inflationCommissionDec: number
  mevCommissionDec: number | null
  bidCpmpe: number | null
  maxStakeWanted: Decimal | null // TODO not yet available
  mndeVotesSolValue: Decimal
  epochStats: EpochStats[]
}

export type Rewards = {
  inflationPmpe: number
  mevPmpe: number
}

export type RevShare = {
  totalPmpe: number
  inflationPmpe: number
  mevPmpe: number
  bidPmpe: number
}

export type AuctionConstraintsConfig = {
  mndeDirectedStakeSol: number
  totalCountryStakeCapSol: number
  totalAsoStakeCapSol: number
  marinadeCountryStakeCapSol: number
  marinadeAsoStakeCapSol: number
  marinadeValidatorStakeCapSol: number
}

export type StakeConcentration = {
  totalStakeSol: number
  totalStakeShareDec: number
  totalLeftToCapSol: number
  marinadeStakeSol: number
  marinadeTvlShareDec: number
  marinadeLeftToCapSol: number
}
