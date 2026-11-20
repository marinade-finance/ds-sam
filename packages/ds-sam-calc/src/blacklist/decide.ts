import { BlacklistRuleId } from './types'

import type { BlacklistHit } from './types'

export enum BlacklistRowSource {
  LEGACY = 'legacy',
  MANUAL = 'manual',
  AUCTION = 'auction',
}

export enum ExemptRule {
  ALL = 'all',
  SANDWICH = 'sandwich',
  SLOW_SLOTS = 'slow_slots',
  LEGACY = 'legacy',
}

export type BlacklistRow = {
  voteAccount: string
  code: string
  source: BlacklistRowSource
  // The auction that listed the row, for auction rows only
  auctionEpoch: number | null
}

export type BlacklistExempt = {
  voteAccount: string
  rule: ExemptRule
  // Hits whose code epoch is at or below it are exempt, as ds2 holds it against listed codes
  untilEpoch: number | null
}

/** The list as ds2 serves it: active rows and the exemptions from its config. */
export type CurrentBlacklist = {
  rows: BlacklistRow[]
  exempt: BlacklistExempt[]
}

export type BlacklistDecision = {
  // Vote accounts blacklisted in this auction
  blacklist: Set<string>
  added: BlacklistHit[]
  held: BlacklistHit[]
  // Blacklisted in the previous auction, missing from the current list and not exempt
  kept: string[]
}

const CODE_PREFIXES: [string, BlacklistRuleId][] = [
  ['MALICIOUS_SM_', BlacklistRuleId.SANDWICH],
  ['SLOW_SLOTS_', BlacklistRuleId.SLOW_SLOTS],
]

export const ruleOfCode = (code: string): BlacklistRuleId | null =>
  CODE_PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? null

const exempted = (hit: BlacklistHit, exempt: BlacklistExempt[]): boolean =>
  exempt.some(entry => {
    const until = entry.untilEpoch
    return (
      entry.voteAccount === hit.voteAccount &&
      (entry.rule === ExemptRule.ALL || (entry.rule as string) === (hit.rule as string)) &&
      (until === null || Math.max(...hit.epochs) <= until)
    )
  })

/**
 * The blacklist of auction `auctionEpoch`: the current list plus the rule hits that are neither
 * exempted nor already listed under the same rule. More than `maxNewListings` newly listed accounts
 * hold all hits back. The rows a previous run of the same auction added are judged again. An account
 * of the previous auction's blacklist leaves it only through an exemption.
 */
export const decideBlacklist = (
  current: CurrentBlacklist,
  hits: BlacklistHit[],
  auctionEpoch: number,
  maxNewListings: number,
  previousBlacklist: Set<string>,
): BlacklistDecision => {
  const previous = current.rows.filter(
    row => !(row.source === BlacklistRowSource.AUCTION && row.auctionEpoch === auctionEpoch),
  )
  const listed = new Set(previous.map(row => row.voteAccount))
  const listedRules = new Set(previous.map(row => `${row.voteAccount}/${ruleOfCode(row.code) ?? ''}`))

  const candidates = hits.filter(
    hit => !exempted(hit, current.exempt) && !listedRules.has(`${hit.voteAccount}/${hit.rule}`),
  )
  const newAccounts = new Set(candidates.map(hit => hit.voteAccount).filter(account => !listed.has(account)))
  const hold = newAccounts.size > maxNewListings
  const added = hold ? [] : candidates
  const blacklist = new Set([...listed, ...added.map(hit => hit.voteAccount)])
  const kept = [...previousBlacklist]
    .filter(account => !blacklist.has(account) && !current.exempt.some(entry => entry.voteAccount === account))
    .sort()

  return {
    blacklist: new Set([...blacklist, ...kept]),
    added,
    held: hold ? candidates : [],
    kept,
  }
}

/** `vote_account,code` rows of the hits, sorted and without duplicates, with the header line. */
export const renderBlacklistCsv = (hits: BlacklistHit[]): string => {
  const lines = [...new Set(hits.map(hit => `${hit.voteAccount},${hit.code}`))].sort()
  return ['vote_account,code', ...lines].join('\n') + '\n'
}
