import Decimal from 'decimal.js'

export type AuctionResult = {
  auctionData: AuctionData
  winningTotalPmpe: number
}

export type AuctionData = Omit<AggregatedData, 'validators'> & {
  validators: AuctionValidator[]
}

export type StakeAmounts = {
  networkTotalSol: number
  marinadeMndeTvlSol: number
  marinadeSamTvlSol: number
  marinadeRemainingMndeSol: number
  marinadeRemainingSamSol: number
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

export type ValidatorAuctionStake = {
  externalActivatedSol: number
  marinadeMndeTargetSol: number
  marinadeSamTargetSol: number
}

export type AuctionValidator = AggregatedValidator & {
  revShare: RevShare
  mndeEligible: boolean
  samEligible: boolean
  auctionStake: ValidatorAuctionStake
  lastCapConstraint: AuctionConstraint | null
  stakePriority: number
  unstakePriority: number
}

export type AggregatedValidator = {
  voteAccount: string
  clientVersion: string
  voteCredits: number
  aso: string
  country: string
  bondBalanceSol: number | null
  totalActivatedStakeSol: number
  marinadeActivatedStakeSol: number
  inflationCommissionDec: number
  mevCommissionDec: number | null
  bidCpmpe: number | null
  maxStakeWanted: number | null
  mndeVotesSolValue: number
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
  auctionEffectiveBidPmpe: number
}

export type AuctionConstraintsConfig = {
  totalCountryStakeCapSol: number
  totalAsoStakeCapSol: number
  marinadeCountryStakeCapSol: number
  marinadeAsoStakeCapSol: number
  marinadeValidatorSamStakeCapSol: number
}

export enum AuctionConstraintType {
  COUNTRY = 'COUNTRY',
  ASO = 'ASO',
  VALIDATOR = 'VALIDATOR',
  BOND = 'BOND',
  MNDE = 'MNDE',
}

export type AuctionConstraint = {
  constraintType: AuctionConstraintType
  constraintName: string
  totalStakeSol: number
  totalLeftToCapSol: number
  marinadeStakeSol: number
  marinadeLeftToCapSol: number
  validators: AuctionValidator[]
}
