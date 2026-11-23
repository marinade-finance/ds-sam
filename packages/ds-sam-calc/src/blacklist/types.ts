export enum BlacklistRuleId {
  SANDWICH = 'sandwich',
  SLOW_SLOTS = 'slow_slots',
}

export type SandwichObservation = {
  rate30dPct: number
  blocksProduced: number
  blocksWithSandwiches: number
  clusterMedianPct: number
  clusterPooledPct: number
  pValue: number
}

export type SandwichEvidence = {
  epoch: number
  single: SandwichObservation | null
  wide: SandwichObservation | null
}

export type SlowSlotsEvidence = {
  epochs: Record<string, { slotDurationMedianMs: number; networkMedianMs: number }>
}

// Byte order, as the Rust implementation sorts; localeCompare would fold the base58 case
export const byVoteAccount = (a: { voteAccount: string }, b: { voteAccount: string }): number =>
  a.voteAccount < b.voteAccount ? -1 : a.voteAccount > b.voteAccount ? 1 : 0

export type BlacklistHit = {
  voteAccount: string
  rule: BlacklistRuleId
  code: string
  epochs: number[]
  evidence: SandwichEvidence | SlowSlotsEvidence
}
