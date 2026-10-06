import Decimal from 'decimal.js'

import type { AggregatedValidator, EpochStats } from '@marinade.finance/ds-sam-calc'

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

// Migration epoch: the one epoch with both tower credits and vote rewards
export function epochUptimeType(validators: AggregatedValidator[], epoch: number): EpochUptimeType {
  const stats = validators.map(v => findEpochStats(v, epoch))
  const hasCredits = stats.some(es => es?.voteCredits != null)
  const hasRewards = stats.some(es => es?.voteRewardLamports != null)
  if (hasCredits && hasRewards) {
    return EpochUptimeType.MIGRATION
  }
  if (hasRewards) {
    return EpochUptimeType.ALPENGLOW
  }
  if (hasCredits) {
    return EpochUptimeType.TOWER
  }
  throw new Error(`Validator credits and vote rewards data for epoch ${epoch} not available`)
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

// GEN-8948: w = stake/S + leader_slots/N, uptime = (reward/w) / (Σreward/Σw), over validators with a vote reward
function alpenglowScores(validators: AggregatedValidator[], epoch: number): Map<string, number> {
  const admitted = validators.flatMap(validator => {
    const es = findEpochStats(validator, epoch)
    return es?.voteRewardLamports != null
      ? [
          {
            voteAccount: validator.voteAccount,
            stake: es.totalActivatedStake,
            leaderSlots: es.leaderSlots,
            reward: es.voteRewardLamports,
          },
        ]
      : []
  })
  const totalStake = Decimal.sum(0, ...admitted.map(({ stake }) => stake))
  const totalLeaderSlots = admitted.reduce((sum, { leaderSlots }) => sum + leaderSlots, 0)
  const weighted = admitted.map(entry => {
    const stakeShare = totalStake.isZero() ? new Decimal(0) : entry.stake.div(totalStake)
    const leaderShare = totalLeaderSlots === 0 ? 0 : entry.leaderSlots / totalLeaderSlots
    return { ...entry, weight: stakeShare.add(leaderShare) }
  })
  const totalWeight = Decimal.sum(0, ...weighted.map(({ weight }) => weight))
  const totalReward = Decimal.sum(0, ...weighted.map(({ reward }) => reward))
  if (totalReward.isZero() || totalWeight.isZero()) {
    throw new Error(`Validator vote rewards for epoch ${epoch} sum to zero`)
  }
  const meanRewardPerWeight = totalReward.div(totalWeight)
  const scores = new Map<string, number>()
  for (const { voteAccount, reward, weight } of weighted) {
    if (!weight.isZero()) {
      scores.set(voteAccount, new Decimal(reward).div(weight).div(meanRewardPerWeight).toNumber())
    }
  }
  return scores
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

// GEN-8947: a null value is unknown and skips the epoch; a missing epoch record still fails
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
      return (
        es.voteCredits == null || (!!epochUptime.creditsThreshold && es.voteCredits >= epochUptime.creditsThreshold)
      )
    }
    const score = epochUptime.scores.get(validator.voteAccount)
    return score === undefined || score >= thresholdDec
  })
}
