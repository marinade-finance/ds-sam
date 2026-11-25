import { sandwichParams } from './config'
import { decideBlacklist } from './decide'
import { sandwichHits } from './sandwich'
import { hasStakedSlotTimes, slowSlotsHits, windowEpochs } from './slow-slots'

import type { BlacklistRow, CurrentBlacklist } from './decide'
import type { SandwichRow } from './sandwich'
import type { SlotTimeRow } from './slow-slots'
import type { BlacklistHit } from './types'
import type { BlacklistRulesConfig } from '../config'

export type BlacklistRulesData = {
  current: CurrentBlacklist
  sandwichesByEpoch: Map<number, SandwichRow[]>
  slotTimesByEpoch: Map<number, SlotTimeRow[]>
  stakesByEpoch: Map<number, Map<string, bigint>>
  previousBlacklist: Set<string>
}

export type BlacklistAuctionDecision = {
  auctionEpoch: number
  evaluatedEpoch: number
  // Epochs a rule window needed that had no data or no stake; the windows holding them gave no hits
  missingEpochs: number[]
  maxNewListings: number
  added: BlacklistHit[]
  held: BlacklistHit[]
  kept: string[]
  removed: string[]
  carried: BlacklistRow[]
}

/**
 * The epochs of data the configured rules read for an auction: the windows ending at the last closed
 * epoch and at the one before it.
 */
export const blacklistRulesEpochs = (rules: BlacklistRulesConfig, auctionEpoch: number): number[] => {
  const window = Math.max(rules.sandwich ? 1 : 0, rules.slowSlots?.consecutiveEpochs ?? 0)
  return window === 0 ? [] : windowEpochs(auctionEpoch - 1, window + 1)
}

const windowHits = (
  rules: BlacklistRulesConfig,
  data: BlacklistRulesData,
  end: number,
  missingEpochs: Set<number>,
): BlacklistHit[] => {
  const hits: BlacklistHit[] = []
  if (rules.sandwich) {
    const rows = data.sandwichesByEpoch.get(end) ?? []
    if (rows.length === 0) {
      missingEpochs.add(end)
    }
    hits.push(...sandwichHits(rows, end, sandwichParams(rules.sandwich)))
  }
  if (rules.slowSlots) {
    const slowSlots = rules.slowSlots
    for (const epoch of windowEpochs(end, slowSlots.consecutiveEpochs)) {
      if (!hasStakedSlotTimes(data.slotTimesByEpoch.get(epoch) ?? [], data.stakesByEpoch.get(epoch))) {
        missingEpochs.add(epoch)
      }
    }
    hits.push(...slowSlotsHits(data.slotTimesByEpoch, data.stakesByEpoch, end, slowSlots))
  }
  return hits
}

export const evaluateBlacklistRules = (
  rules: BlacklistRulesConfig,
  data: BlacklistRulesData,
  auctionEpoch: number,
): { blacklist: Set<string>; decision: BlacklistAuctionDecision } => {
  const evaluatedEpoch = auctionEpoch - 1
  const missingEpochs = new Set<number>()
  const seen = new Set<string>()
  // Newest window first: an account and rule keep the newest window's hit only
  const hits = [evaluatedEpoch, evaluatedEpoch - 1]
    .flatMap(end => windowHits(rules, data, end, missingEpochs))
    .filter(hit => {
      const key = `${hit.voteAccount}/${hit.rule}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

  const { blacklist, added, held, kept, removed, carried } = decideBlacklist(
    data.current,
    hits,
    auctionEpoch,
    rules.maxNewListings,
    data.previousBlacklist,
  )
  return {
    blacklist,
    decision: {
      auctionEpoch,
      evaluatedEpoch,
      missingEpochs: [...missingEpochs].sort((a, b) => a - b),
      maxNewListings: rules.maxNewListings,
      added,
      held,
      kept,
      removed,
      carried,
    },
  }
}
