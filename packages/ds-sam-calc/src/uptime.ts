import { alpenglowExpectedCredits } from '@marinade.finance/ts-common/dist/src/browser'
import Decimal from 'decimal.js'

import type { AggregatedValidator, EpochStats } from './types'

export enum EpochUptimeType {
  TOWER = 'TOWER',
  MIGRATION = 'MIGRATION',
  ALPENGLOW = 'ALPENGLOW',
}

export type EpochUptime =
  | { epoch: number; type: EpochUptimeType.TOWER; creditsThreshold: number }
  // No uptime check: every validator passes
  | { epoch: number; type: EpochUptimeType.MIGRATION }
  // Only validators with a known score are keyed; a score is relative to the cluster, 1 = on par
  | { epoch: number; type: EpochUptimeType.ALPENGLOW; scores: Map<string, number> }

const findEpochStats = ({ epochStats }: AggregatedValidator, epoch: number): EpochStats | undefined =>
  epochStats.find(es => es.epoch === epoch)

// Agave skipped each validator's first leader window of these epochs (agave#16302)
const FIRST_LEADER_WINDOW_SKIP_EPOCHS = new Set<number>([1065, 1066, 1067])
const NUM_CONSECUTIVE_LEADER_SLOTS = 4n

const withoutFirstWindow = (leaderSlots: bigint, epoch: number): bigint => {
  if (!FIRST_LEADER_WINDOW_SKIP_EPOCHS.has(epoch)) {
    return leaderSlots
  }
  return leaderSlots > NUM_CONSECUTIVE_LEADER_SLOTS ? leaderSlots - NUM_CONSECUTIVE_LEADER_SLOTS : 0n
}

// Cluster-wide: whether any validator of the epoch has credits, and whether any has a vote reward
export function uptimeTypeOf(hasCredits: boolean, hasRewards: boolean): EpochUptimeType | undefined {
  // Only the migration epoch has both
  if (hasCredits && hasRewards) {
    return EpochUptimeType.MIGRATION
  }
  if (hasRewards) {
    return EpochUptimeType.ALPENGLOW
  }
  if (hasCredits) {
    return EpochUptimeType.TOWER
  }
  return undefined
}

export function epochUptimeType(validators: AggregatedValidator[], epoch: number): EpochUptimeType {
  const stats = validators.map(v => findEpochStats(v, epoch))
  const type = uptimeTypeOf(
    stats.some(es => es?.voteCredits != null),
    stats.some(es => es?.voteRewardLamports != null),
  )
  if (type === undefined) {
    throw new Error(`Validator credits and vote rewards data for epoch ${epoch} not available`)
  }
  return type
}

function meanTowerCredits(validators: AggregatedValidator[], epoch: number): Decimal {
  let weightedCredits = new Decimal(0)
  let weight = new Decimal(0)
  for (const validator of validators) {
    const es = findEpochStats(validator, epoch)
    if (es?.voteCredits == null) {
      continue
    }
    weightedCredits = weightedCredits.add(es.totalActivatedStake.mul(es.voteCredits))
    weight = weight.add(es.totalActivatedStake)
  }
  return weightedCredits.div(weight)
}

function toCount(value: Decimal.Value, label: string): bigint {
  const count = new Decimal(value)
  if (!count.isInteger() || count.lt(0)) {
    throw new Error(`Validator ${label} must be a non-negative integer, got ${value.toString()}`)
  }
  return BigInt(count.toFixed())
}

function alpenglowScores(validators: AggregatedValidator[], epoch: number): Map<string, number> {
  // S and N sum only over validators with a vote reward and an epoch stake
  const admitted = validators.flatMap(validator => {
    const es = findEpochStats(validator, epoch)
    return es?.voteRewardLamports != null && es.epochStake != null
      ? [
          {
            voteAccount: validator.voteAccount,
            stake: toCount(es.epochStake, `${validator.voteAccount} epoch ${epoch} stake`),
            leaderSlots: withoutFirstWindow(
              toCount(es.leaderSlots, `${validator.voteAccount} epoch ${epoch} leader slots`),
              epoch,
            ),
            credits: toCount(es.voteRewardLamports, `${validator.voteAccount} epoch ${epoch} vote reward`),
          },
        ]
      : []
  })
  if (admitted.length === 0) {
    throw new Error(`No validator with a vote reward for epoch ${epoch} has an epoch stake`)
  }
  const results = alpenglowExpectedCredits(admitted, {
    totalStake: admitted.reduce((sum, { stake }) => sum + stake, 0n),
    totalSlots: admitted.reduce((sum, { leaderSlots }) => sum + leaderSlots, 0n),
  })
  // Every uptime is null exactly when the reward or the weight sums to zero
  if (results.every(({ uptime }) => uptime === null)) {
    throw new Error(`Validator vote rewards for epoch ${epoch} sum to zero`)
  }
  return new Map(
    results.flatMap(({ voteAccount, uptime }) => (uptime === null ? [] : [[voteAccount, uptime.toNumber()] as const])),
  )
}

export function epochUptimes(
  validators: AggregatedValidator[],
  minEpoch: number,
  maxEpoch: number,
  thresholdDec: number,
): EpochUptime[] {
  const result: EpochUptime[] = []
  for (let epoch = minEpoch; epoch <= maxEpoch; epoch++) {
    const type = epochUptimeType(validators, epoch)
    if (type === EpochUptimeType.TOWER) {
      const creditsThreshold = meanTowerCredits(validators, epoch).mul(thresholdDec).toNumber()
      result.push({ epoch, type, creditsThreshold })
    } else if (type === EpochUptimeType.MIGRATION) {
      result.push({ epoch, type })
    } else {
      result.push({ epoch, type, scores: alpenglowScores(validators, epoch) })
    }
  }
  return result
}

export function passesUptime(validator: AggregatedValidator, epochs: EpochUptime[], thresholdDec: number): boolean {
  return epochs.every(epochUptime => {
    if (epochUptime.type === EpochUptimeType.MIGRATION) {
      return true
    }
    const es = findEpochStats(validator, epochUptime.epoch)
    if (!es) {
      return false
    }
    if (epochUptime.type === EpochUptimeType.TOWER) {
      // Null credits: the account cast no vote in this epoch
      return es.voteCredits != null && !!epochUptime.creditsThreshold && es.voteCredits >= epochUptime.creditsThreshold
    }
    // No score: null vote reward or epoch stake, no data, the epoch is skipped
    const score = epochUptime.scores.get(validator.voteAccount)
    return score === undefined || score >= thresholdDec
  })
}
