import { BlacklistRuleId, byVoteAccount } from './types'

import type { BlacklistHit, SlowSlotsEvidence } from './types'

export type SlowSlotsParams = {
  // A validator is slow above this multiple of the stake-weighted network median
  medianMult: number
  // Closed epochs in a row the validator has to be slow in, each against its own median
  consecutiveEpochs: number
}

export type SlotTimeRow = {
  voteAccount: string
  slotDurationMedianMs: number
}

/** The first epoch of a window of `window` epochs that ends at `epoch`. */
export const windowStart = (epoch: number, window: number): number => Math.max(0, epoch - Math.max(0, window - 1))

/** The value at which half of the stake sits at or below; `null` without any stake. */
export const stakeWeightedMedian = (values: { value: number; stake: bigint }[]): number | null => {
  const staked = values.filter(({ stake }) => stake > 0n).sort((a, b) => a.value - b.value)
  const total = staked.reduce((sum, { stake }) => sum + stake, 0n)
  if (total === 0n) {
    return null
  }
  let cumulative = 0n
  for (const { value, stake } of staked) {
    cumulative += stake
    if (2n * cumulative >= total) {
      return value
    }
  }
  return null
}

export const slowSlotsCode = (epoch: number): string => `SLOW_SLOTS_${epoch}`

/**
 * Validators of `epoch` slower than `medianMult` × the stake-weighted network median in every epoch
 * of the window. A window epoch without slot times or stake gives no hits at all.
 */
export const slowSlotsHits = (
  slotTimesByEpoch: Map<number, SlotTimeRow[]>,
  stakesByEpoch: Map<number, Map<string, bigint>>,
  epoch: number,
  params: SlowSlotsParams,
): BlacklistHit[] => {
  const epochs: number[] = []
  for (let e = windowStart(epoch, params.consecutiveEpochs); e <= epoch; e++) {
    epochs.push(e)
  }

  const medians: number[] = []
  const perEpoch: Map<string, number>[] = []
  for (const e of epochs) {
    const slotTimes = slotTimesByEpoch.get(e)
    if (!slotTimes) {
      return []
    }
    const stakes = stakesByEpoch.get(e) ?? new Map<string, bigint>()
    const median = stakeWeightedMedian(
      slotTimes.map(row => ({ value: row.slotDurationMedianMs, stake: stakes.get(row.voteAccount) ?? 0n })),
    )
    if (median === null) {
      return []
    }
    medians.push(median)
    perEpoch.push(new Map(slotTimes.map(row => [row.voteAccount, row.slotDurationMedianMs])))
  }

  const hits: BlacklistHit[] = []
  for (const { voteAccount } of slotTimesByEpoch.get(epoch) ?? []) {
    const evidence: SlowSlotsEvidence = { epochs: {} }
    const slow = epochs.every((e, i) => {
      const value = perEpoch[i]?.get(voteAccount)
      const median = medians[i] ?? 0
      if (value === undefined || value <= params.medianMult * median) {
        return false
      }
      evidence.epochs[String(e)] = { slotDurationMedianMs: value, networkMedianMs: median }
      return true
    })
    if (slow) {
      hits.push({
        voteAccount,
        rule: BlacklistRuleId.SLOW_SLOTS,
        code: slowSlotsCode(epoch),
        epochs: [...epochs],
        evidence,
      })
    }
  }
  return hits.sort(byVoteAccount)
}
