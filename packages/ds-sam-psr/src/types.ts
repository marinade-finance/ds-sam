import type { AuctionValidatorValues, RevShare } from '@marinade.finance/ds-sam-calc'

// Fields of one validators-API `epoch_stats` entry the estimator reads; stakes are lamport strings.
export type ValidatorEpochStats = {
  epoch: number
  credits: number
  commission_advertised: number
  activated_stake: string
  marinade_stake: string
  marinade_native_stake: string
}

// Fields of one validators-API `/validators?epochs=N` row the estimator reads.
export type ValidatorWithEpochs = {
  vote_account: string
  marinade_stake: string
  marinade_native_stake: string
  epoch_stats: ValidatorEpochStats[]
}

// One validators-API `/rewards` entry: `[epoch, rewardsSol, ...]`.
export type EpochRewards = [number, number, ...unknown[]]

// Penalty fields of an auction validator; both `AuctionValidator` and a scoring-API row satisfy it.
export type AuctionPenaltyInput = {
  voteAccount: string
  revShare: Pick<RevShare, 'bidTooLowPenaltyPmpe' | 'blacklistPenaltyPmpe'>
  values?: Pick<AuctionValidatorValues, 'bondRiskFeeSol'>
}

// One scoring-API `/api/v1/scores/sam` row.
export type ScoringEntry = AuctionPenaltyInput & { epoch: number }

export type SettlementFunder = 'ValidatorBond' | 'Marinade'

export type SettlementMeta = {
  funder: SettlementFunder
}

export type ProtectedEventCommissionSamIncrease = {
  vote_account: string
  actual_inflation_commission: number
  expected_inflation_commission: number
  actual_mev_commission: number
  expected_mev_commission: number
  expected_epr: number
  actual_epr: number
  epr_loss_bps: number
  stake: number
}

export type ProtectedEventCommissionIncrease = {
  vote_account: string
  previous_commission: number
  current_commission: number
  expected_epr: number
  actual_epr: number
  epr_loss_bps: number
  stake: number
}

export type ProtectedEventLowCredits = {
  vote_account: string
  expected_credits: number
  actual_credits: number
  commission: number
  expected_epr: number
  actual_epr: number
  epr_loss_bps: number
  stake: number
}

export type ProtectedEventReason =
  | { CommissionIncrease: ProtectedEventCommissionIncrease }
  | { LowCredits: ProtectedEventLowCredits }
  | { DowntimeRevenueImpact: ProtectedEventLowCredits }
  | { CommissionSamIncrease: ProtectedEventCommissionSamIncrease }

export type ProtectedEventSettlement = {
  ProtectedEvent: ProtectedEventReason
}

export type SettlementReason =
  | ProtectedEventSettlement
  | 'Bidding'
  | 'PriorityFee'
  | 'BidTooLowPenalty'
  | 'BlacklistPenalty'
  | 'BondRiskFee'
  | 'InstitutionalPayout'

// A bonds-API `/v1/protected-events` row, or a locally built estimate of one; `amount` is in lamports.
export type ProtectedEvent = {
  epoch: number
  amount: number
  vote_account: string
  meta: SettlementMeta
  reason: SettlementReason
  bond_type?: string
  product?: string
}

export type ProtectedEventStatus = 'dryrun' | 'estimate' | 'fact'

export type ProtectedEventRow<V extends ValidatorWithEpochs> = {
  status: ProtectedEventStatus
  protectedEvent: ProtectedEvent
  validator: V | null
}
