import { sandwichParams } from './config'
import { decideBlacklist } from './decide'
import { sandwichHits } from './sandwich'
import { slowSlotsHits, windowStart } from './slow-slots'

import type { CurrentBlacklist } from './decide'
import type { SandwichRow } from './sandwich'
import type { SlotTimeRow } from './slow-slots'
import type { BlacklistHit } from './types'
import type { BlacklistRulesConfig } from '../config'

export type BlacklistRulesData = {
  current: CurrentBlacklist
  sandwichesByEpoch: Map<number, SandwichRow[]>
  slotTimesByEpoch: Map<number, SlotTimeRow[]>
  stakesByEpoch: Map<number, Map<string, bigint>>
}

export type BlacklistAuctionDecision = {
  auctionEpoch: number
  evaluatedEpoch: number
  // Epochs the rules needed that had no data; their rules gave no hits
  missingEpochs: number[]
  added: BlacklistHit[]
  held: BlacklistHit[]
}

/** The epochs of data the configured rules read for an auction: a window ending at the last closed epoch. */
export const blacklistRulesEpochs = (rules: BlacklistRulesConfig, auctionEpoch: number): number[] => {
  const evaluatedEpoch = auctionEpoch - 1
  const window = Math.max(rules.sandwich ? 1 : 0, rules.slowSlots?.consecutiveEpochs ?? 0)
  const epochs: number[] = []
  for (let epoch = windowStart(evaluatedEpoch, window); window > 0 && epoch <= evaluatedEpoch; epoch++) {
    epochs.push(epoch)
  }
  return epochs
}

export const evaluateBlacklistRules = (
  rules: BlacklistRulesConfig,
  data: BlacklistRulesData,
  auctionEpoch: number,
): { blacklist: Set<string>; decision: BlacklistAuctionDecision } => {
  const evaluatedEpoch = auctionEpoch - 1
  const hits: BlacklistHit[] = []
  const missingEpochs = new Set<number>()

  if (rules.sandwich) {
    const rows = data.sandwichesByEpoch.get(evaluatedEpoch) ?? []
    if (rows.length === 0) {
      missingEpochs.add(evaluatedEpoch)
    }
    hits.push(...sandwichHits(rows, evaluatedEpoch, sandwichParams(rules.sandwich)))
  }
  if (rules.slowSlots) {
    const slowSlots = rules.slowSlots
    for (let epoch = windowStart(evaluatedEpoch, slowSlots.consecutiveEpochs); epoch <= evaluatedEpoch; epoch++) {
      if ((data.slotTimesByEpoch.get(epoch) ?? []).length === 0) {
        missingEpochs.add(epoch)
      }
    }
    hits.push(...slowSlotsHits(data.slotTimesByEpoch, data.stakesByEpoch, evaluatedEpoch, slowSlots))
  }

  const { blacklist, added, held } = decideBlacklist(data.current, hits, auctionEpoch, rules.maxNewListings)
  return {
    blacklist,
    decision: {
      auctionEpoch,
      evaluatedEpoch,
      missingEpochs: [...missingEpochs].sort((a, b) => a - b),
      added,
      held,
    },
  }
}
