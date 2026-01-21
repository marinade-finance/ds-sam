import type { AuctionHistoryStats } from './data-provider/data-provider.dto'
import type Decimal from 'decimal.js'

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
  backstopEligible: boolean
  samBlocked: boolean
  auctionStake: ValidatorAuctionStake
  lastCapConstraint: AuctionConstraint | null
  stakePriority: number
  unstakePriority: number
  maxBondDelegation: number
  bondSamStakeCapSol: number
  unprotectedStakeCapSol: number
  unprotectedStakeSol: number
}

export type AggregatedValidator = {
  voteAccount: string
  clientVersion: string
  voteCredits: number
  aso: string
  country: string
  bondBalanceSol: number | null
  claimableBondBalanceSol: number | null
  lastBondBalanceSol: number | null
  totalActivatedStakeSol: number
  marinadeActivatedStakeSol: number
  lastMarinadeActivatedStakeSol: number | null
  lastSamBlacklisted: boolean | null
  inflationCommissionDec: number
  mevCommissionDec: number | null
  blockRewardsCommissionDec: number | null
  bidCpmpe: number | null
  maxStakeWanted: number | null
  mndeStakeCapIncrease: number
  mndeVotesSolValue: number
  foundationStakeSol: number
  selfStakeSol: number
  epochStats: EpochStats[]
  auctions: AuctionHistoryStats[]
  values: AuctionValidatorValues
}

export type AuctionValidatorValues = {
  bondBalanceSol: number | null
  marinadeActivatedStakeSol: number
  bondRiskFeeSol: number
  paidUndelegationSol: number
  samBlacklisted: boolean
  commissions: CommissionDetails
}

export type CommissionDetails = {
  // values used to calculate total PMPE
  inflationCommissionDec: number
  mevCommissionDec: number
  blockRewardsCommissionDec: number
  // detailed breakdown of commission settings
  inflationCommissionOnchainDec: number
  inflationCommissionInBondDec: number | null
  inflationCommissionOverrideDec?: number
  mevCommissionOnchainDec: number | null
  mevCommissionInBondDec: number | null
  mevCommissionOverrideDec?: number
  blockRewardsCommissionInBondDec: number | null
  blockRewardsCommissionOverrideDec?: number
  bidCpmpeInBondDec?: number | null
  bidCpmpeOverrideDec?: number
  minimalCommissionDec?: number
}

export type Rewards = {
  inflationPmpe: number
  mevPmpe: number
  blockPmpe: number
}

export type RevShare = {
  // total value that the validator shares with stakers
  totalPmpe: number
  // particles of totalPmpe per type
  inflationPmpe: number
  mevPmpe: number
  bidPmpe: number
  blockPmpe: number
  // what has already been shared on-chain via commissions
  onchainDistributedPmpe: number
  // assumption what the validator will share through bonds
  bondObligationPmpe: number
  // what is the PMPE to be charged directly from the bond as static bidding PMPE taken from bonds' CPMPE argument
  auctionEffectiveStaticBidPmpe: number
  auctionEffectiveBidPmpe: number
  bidTooLowPenaltyPmpe: number
  effParticipatingBidPmpe: number
  expectedMaxEffBidPmpe: number
  blacklistPenaltyPmpe: number
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
  unprotectedValidatorStakeCapSol: number
  minBondBalanceSol: number
  minMaxStakeWanted: number
  minBondEpochs: number
  idealBondEpochs: number
  minUnprotectedStakeToDelegateSol: number
  unprotectedDelegatedStakeDec: number
  unprotectedFoundationStakeDec: number
  bondObligationSafetyMult: number
}

export enum AuctionConstraintType {
  COUNTRY = 'COUNTRY',
  ASO = 'ASO',
  VALIDATOR = 'VALIDATOR',
  BOND = 'BOND',
  MNDE = 'MNDE',
  WANT = 'WANT',
  RISK = 'RISK',
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
