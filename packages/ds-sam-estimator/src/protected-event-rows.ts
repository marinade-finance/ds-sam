import { LAMPORTS_PER_SOL } from '@marinade.finance/ds-sam-calc'

import { selectLatestProcessedEpoch, selectUnsettledEstimates } from './selectors'

import type {
  AuctionPenaltyInput,
  ProtectedEvent,
  ProtectedEventRow,
  ScoringEntry,
  SettlementReason,
  ValidatorWithEpochs,
} from './types'

export type AuctionPenaltyEstimatesInput = {
  validators: ValidatorWithEpochs[]
  scoring: ScoringEntry[]
  auctionValidators: AuctionPenaltyInput[]
  latestProcessedEpoch: number
}

const penaltyEvents = (
  voteAccount: string,
  epoch: number,
  stakeLamports: number,
  entry: AuctionPenaltyInput,
): ProtectedEvent[] => {
  const penalties: [number, SettlementReason][] = [
    [Math.round((stakeLamports * entry.revShare.bidTooLowPenaltyPmpe) / 1000), 'BidTooLowPenalty'],
    [Math.round((stakeLamports * entry.revShare.blacklistPenaltyPmpe) / 1000), 'BlacklistPenalty'],
    [Math.round(LAMPORTS_PER_SOL * (entry.values?.bondRiskFeeSol ?? 0)), 'BondRiskFee'],
  ]
  return penalties
    .filter(([amount]) => amount > 0)
    .map(([amount, reason]) => ({
      epoch,
      amount,
      vote_account: voteAccount,
      meta: { funder: 'ValidatorBond' },
      reason,
    }))
}

// Unsettled scoring epochs come from `scoring`; the live epoch comes from the current auction.
export const estimateAuctionPenalties = ({
  validators,
  scoring,
  auctionValidators,
  latestProcessedEpoch,
}: AuctionPenaltyEstimatesInput): ProtectedEvent[] => {
  const validatorsMap = new Map(validators.map(v => [v.vote_account, v]))

  let maxStatsEpoch = -Infinity
  for (const validator of validators) {
    for (const stat of validator.epoch_stats) {
      maxStatsEpoch = Math.max(maxStatsEpoch, stat.epoch)
    }
  }

  let maxScoredEpoch = 0
  for (const entry of scoring) {
    maxScoredEpoch = Math.max(entry.epoch, maxScoredEpoch)
  }

  const events: ProtectedEvent[] = []
  const auctionCoversCurrentEpoch =
    auctionValidators.length > 0 && maxStatsEpoch >= maxScoredEpoch && maxStatsEpoch > latestProcessedEpoch
  for (const entry of scoring) {
    if (entry.epoch <= latestProcessedEpoch) continue
    if (auctionCoversCurrentEpoch && entry.epoch === maxStatsEpoch) continue
    const epochStats = validatorsMap.get(entry.voteAccount)?.epoch_stats.find(({ epoch }) => epoch === entry.epoch)
    if (epochStats == null) continue
    const stake = Number(epochStats.marinade_native_stake) + Number(epochStats.marinade_stake)
    events.push(...penaltyEvents(entry.voteAccount, entry.epoch, stake, entry))
  }

  if (auctionCoversCurrentEpoch) {
    for (const entry of auctionValidators) {
      const v = validatorsMap.get(entry.voteAccount)
      const stake = Number(v?.marinade_native_stake) + Number(v?.marinade_stake)
      events.push(...penaltyEvents(entry.voteAccount, maxStatsEpoch, stake, entry))
    }
  }

  return events
}

export type ProtectedEventRowsInput<V extends ValidatorWithEpochs> = {
  validators: V[]
  settlements: ProtectedEvent[]
  estimates: ProtectedEvent[]
  scoring: ScoringEntry[]
  auctionValidators: AuctionPenaltyInput[]
  lastDryrunEpoch: number // live bonds pipeline: 608
}

// Settled facts, then unsettled estimates, then auction penalty estimates, each joined to its validator.
export const buildProtectedEventRows = <V extends ValidatorWithEpochs>({
  validators,
  settlements,
  estimates,
  scoring,
  auctionValidators,
  lastDryrunEpoch,
}: ProtectedEventRowsInput<V>): ProtectedEventRow<V>[] => {
  const validatorsMap = new Map(validators.map(v => [v.vote_account, v]))
  const withValidator = (protectedEvent: ProtectedEvent) => validatorsMap.get(protectedEvent.vote_account) ?? null
  const latestProcessedEpoch = selectLatestProcessedEpoch(settlements)

  const rows: ProtectedEventRow<V>[] = settlements.map(protectedEvent => ({
    status: protectedEvent.epoch > lastDryrunEpoch ? 'fact' : 'dryrun',
    protectedEvent,
    validator: withValidator(protectedEvent),
  }))
  const estimated = [
    ...selectUnsettledEstimates(estimates, latestProcessedEpoch),
    ...estimateAuctionPenalties({ validators, scoring, auctionValidators, latestProcessedEpoch }),
  ]
  for (const protectedEvent of estimated) {
    rows.push({ status: 'estimate', protectedEvent, validator: withValidator(protectedEvent) })
  }
  return rows
}
