import Decimal from 'decimal.js'
import { AuctionHistoryStats } from './data-provider/data-provider.dto'

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
  epoch: number
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
  bidTooLowPenalty: BidTooLowPenalty
  bondForcedUndelegation: BondForcedUndelegation
  mndeEligible: boolean
  samEligible: boolean
  samBlocked: boolean
  auctionStake: ValidatorAuctionStake
  lastCapConstraint: AuctionConstraint | null
  stakePriority: number
  unstakePriority: number
  maxBondDelegation: number
}

export type AggregatedValidator = {
  voteAccount: string
  clientVersion: string
  voteCredits: number
  aso: string
  country: string
  bondBalanceSol: number | null
  lastBondBalanceSol: number | null
  totalActivatedStakeSol: number
  marinadeActivatedStakeSol: number
  lastMarinadeActivatedStakeSol: number | null
  inflationCommissionDec: number
  mevCommissionDec: number | null
  bidCpmpe: number | null
  maxStakeWanted: number | null
  mndeStakeCapIncrease: number
  mndeVotesSolValue: number
  epochStats: EpochStats[]
  auctions: AuctionHistoryStats[]
  values: AuctionValidatorValues
}

export type AuctionValidatorValues = {
  bondBalanceSol: number | null
  marinadeActivatedStakeSol: number
  spendRobustReputation: number
  adjMaxSpendRobustDelegation: number
  adjSpendRobustReputation: number
  marinadeActivatedStakeSolUndelegation: number
  adjSpendRobustReputationInflationFactor: number
  bondRiskFee: number
  paidUndelegationSol: number
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
  bidTooLowPenaltyPmpe: number
  effParticipatingBidPmpe: number
}

export type BidTooLowPenalty = {
  coef: number
  base: number
}

export type BondForcedUndelegation = {
  coef: number
  base: number
  value: number
}

export type AuctionConstraintsConfig = {
  totalCountryStakeCapSol: number
  totalAsoStakeCapSol: number
  marinadeCountryStakeCapSol: number
  marinadeAsoStakeCapSol: number
  marinadeValidatorStakeCapSol: number
  spendRobustReputationMult: number | null
  minBondBalanceSol: number
  minMaxStakeWanted: number
  bondStakeCapMaxPmpe: number
}

export enum AuctionConstraintType {
  COUNTRY = 'COUNTRY',
  ASO = 'ASO',
  VALIDATOR = 'VALIDATOR',
  BOND = 'BOND',
  MNDE = 'MNDE',
  REPUTATION = 'REPUTATION',
  WANT = 'WANT',
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
