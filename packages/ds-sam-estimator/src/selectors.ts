import type { ProtectedEventSettlement, SettlementReason } from './types'

type WithEpoch = { epoch: number }

export const isProtectedEvent = (reason: SettlementReason): reason is ProtectedEventSettlement =>
  typeof reason === 'object' && 'ProtectedEvent' in reason

// Anything at or below this epoch is settled, so an estimate for it would bill the operator twice.
export const selectLatestProcessedEpoch = (settlements: WithEpoch[]): number =>
  settlements.reduce((max, e) => Math.max(e.epoch, max), 0)

export const selectUnsettledEstimates = <T extends WithEpoch>(estimates: T[], latestProcessedEpoch: number): T[] =>
  estimates.filter(e => e.epoch > latestProcessedEpoch)

// A null live epoch returns nothing rather than risk re-billing a settled epoch.
export const selectCurrentEpochEstimates = <T extends WithEpoch>(
  estimates: T[],
  networkEpoch: number | null,
  latestProcessedEpoch: number,
): T[] =>
  networkEpoch === null
    ? []
    : selectUnsettledEstimates(estimates, latestProcessedEpoch).filter(e => e.epoch === networkEpoch)
