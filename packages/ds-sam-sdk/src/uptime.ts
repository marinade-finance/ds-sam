import Decimal from 'decimal.js'

import type { AggregatedValidator } from '@marinade.finance/ds-sam-calc'

export enum EpochUptimeType {
  TOWER = 'TOWER',
  MIGRATION = 'MIGRATION',
  ALPENGLOW = 'ALPENGLOW',
}

export type EpochUptime =
  | { epoch: number; type: EpochUptimeType.TOWER; creditsThreshold: number }
  | { epoch: number; type: EpochUptimeType.MIGRATION }
  // Only validators with a known uptime are keyed
  | { epoch: number; type: EpochUptimeType.ALPENGLOW; uptimes: Map<string, number> }

export function epochUptimeType(validators: AggregatedValidator[], epoch: number): EpochUptimeType {
  let hasCredits = false
  let hasRewards = false
  for (const { epochStats } of validators) {
    const es = epochStats.find(es => es.epoch === epoch)
    hasCredits ||= es?.voteCredits != null
    hasRewards ||= es?.voteRewardLamports != null
  }
  if (hasCredits && hasRewards) {
    return EpochUptimeType.MIGRATION
  }
  if (hasCredits) {
    return EpochUptimeType.TOWER
  }
  if (hasRewards) {
    return EpochUptimeType.ALPENGLOW
  }
  throw new Error(`Validator credits data for epoch ${epoch} not available`)
}

function towerCreditsThreshold(validators: AggregatedValidator[], epoch: number, thresholdDec: number): number {
  let weightedCredits = new Decimal(0)
  let weight = new Decimal(0)
  for (const { epochStats } of validators) {
    const es = epochStats.find(es => es.epoch === epoch)
    if (es?.voteCredits == null) {
      continue
    }
    weightedCredits = weightedCredits.add(es.totalActivatedStake.mul(es.voteCredits))
    weight = weight.add(es.totalActivatedStake)
  }
  return weightedCredits.div(weight).mul(thresholdDec).toNumber()
}

// GEN-8948: w = stake/S + leader_slots/N, uptime = (reward/w) / (Σreward/Σw), over validators with a vote reward
function alpenglowUptimes(validators: AggregatedValidator[], epoch: number): Map<string, number> {
  const admitted = validators.flatMap(({ voteAccount, epochStats }) => {
    const es = epochStats.find(es => es.epoch === epoch)
    return es?.voteRewardLamports != null
      ? [{ voteAccount, stake: es.totalActivatedStake, leaderSlots: es.leaderSlots, reward: es.voteRewardLamports }]
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
  const uptimes = new Map<string, number>()
  for (const { voteAccount, reward, weight } of weighted) {
    if (!weight.isZero()) {
      uptimes.set(voteAccount, new Decimal(reward).div(weight).div(meanRewardPerWeight).toNumber())
    }
  }
  return uptimes
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
    switch (type) {
      case EpochUptimeType.TOWER:
        result.push({ epoch, type, creditsThreshold: towerCreditsThreshold(validators, epoch, thresholdDec) })
        break
      case EpochUptimeType.MIGRATION:
        result.push({ epoch, type })
        break
      case EpochUptimeType.ALPENGLOW:
        result.push({ epoch, type, uptimes: alpenglowUptimes(validators, epoch) })
        break
    }
  }
  return result
}

// GEN-8947: a null value is unknown and skips the epoch; a missing epoch record still fails
export function passesUptime(
  { voteAccount, epochStats }: AggregatedValidator,
  epochs: EpochUptime[],
  thresholdDec: number,
): boolean {
  return epochs.every(epochUptime => {
    const es = epochStats.find(es => es.epoch === epochUptime.epoch)
    if (!es) {
      return false
    }
    if (epochUptime.type === EpochUptimeType.TOWER) {
      return (
        es.voteCredits == null || (!!epochUptime.creditsThreshold && es.voteCredits >= epochUptime.creditsThreshold)
      )
    }
    if (epochUptime.type === EpochUptimeType.ALPENGLOW) {
      const uptime = epochUptime.uptimes.get(voteAccount)
      return uptime === undefined || uptime >= thresholdDec
    }
    return true
  })
}
