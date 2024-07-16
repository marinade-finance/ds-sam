export type RawMndeVoteDto = {
  amount: string | null
  tokenOwner: string
  validatorVoteAccount: string
}
export type RawMndeVotesResponseDto = {
  voteRecordsCreatedAt: string
  records: RawMndeVoteDto[]
}

export type RawBlacklistResponseDto = string // csv

export type RawTvlResponseDto = {
  total_virtual_staked_sol: number
  marinade_native_stake_sol: number
  // Other properties ignored
}

export type RawBondDto = {
  pubkey: string
  vote_account: string
  authority: string
  cpmpe: string
  funded_amount: string
  effective_amount: string
  remaining_witdraw_request_amount: string
  remainining_settlement_claim_amount: string
  updated_at: string
  epoch: number
  max_stake_wanted: string
}
export type RawBondsResponseDto = {
  bonds: RawBondDto[]
}

export type RawValidatorMevInfoDto = {
  vote_account: string
  mev_commission_bps: number
  epoch: number
}
export type RawMevInfoResponseDto = {
  validators: RawValidatorMevInfoDto[]
}

export type RawRewardsRecordDto = [number, number] // [epoch, SOL]
export type RawRewardsResponseDto = {
  rewards_mev: RawRewardsRecordDto[]
  rewards_inflation_est: RawRewardsRecordDto[]
}

export type RawEpochStatDto = {
  epoch: number
  activated_stake: string
  marinade_stake: string
  marinade_native_stake: string
  version: string | null
  commission_advertised: number | null
  credits: number
  epoch_end_at: string | null
  // Other properties ignored
}
export type RawValidatorDto = {
  identity: string
  vote_account: string
  activated_stake: string
  marinade_stake: string
  marinade_native_stake: string
  dc_country: string | null
  dc_asn: number | null
  dc_aso: string | null
  version: string | null
  commission_effective: number | null
  commission_advertised: number | null
  credits: number
  epoch_stats: RawEpochStatDto[]
  // Other properties ignored
}
export type RawValidatorsResponseDto = {
  validators: RawValidatorDto[]
  // Other properties ignored
}

export type RawSourceData = {
  validators: RawValidatorsResponseDto
  mevInfo: RawMevInfoResponseDto
  bonds: RawBondsResponseDto
  tvlInfo: RawTvlResponseDto
  blacklist: RawBlacklistResponseDto
  mndeVotes: RawMndeVotesResponseDto
  rewards: RawRewardsResponseDto
}
