import { BlacklistRuleId, byVoteAccount } from './types'

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
  // Hits whose code epoch is at or below it are exempt; only a null releases listed rows
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
  // Blacklisted in the previous auction and released by an exemption
  removed: string[]
  // This auction's rows of an earlier run, kept while the hits are held
  carried: BlacklistRow[]
  // Candidate accounts counted against maxNewListings
  newAccounts: string[]
  // Current rows, other than this auction's own, of the accounts with a candidate hit
  alreadyListed: BlacklistRow[]
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
 * hold all hits back, and `maxNewListings` 0 holds every hit (a dry run). The rows a previous run of the same auction added are judged again, or carried
 * over when the hits are held. An account of the previous auction's blacklist leaves it only through
 * an exemption without `untilEpoch`.
 */
export const decideBlacklist = (
  current: CurrentBlacklist,
  hits: BlacklistHit[],
  auctionEpoch: number,
  maxNewListings: number,
  previousBlacklist: Set<string>,
): BlacklistDecision => {
  const isOwn = (row: BlacklistRow) => row.source === BlacklistRowSource.AUCTION && row.auctionEpoch === auctionEpoch
  const previous = current.rows.filter(row => !isOwn(row))
  const listed = new Set(previous.map(row => row.voteAccount))
  const listedRules = new Set(previous.map(row => `${row.voteAccount}/${ruleOfCode(row.code) ?? ''}`))

  const candidates = hits.filter(
    hit => !exempted(hit, current.exempt) && !listedRules.has(`${hit.voteAccount}/${hit.rule}`),
  )
  const retained = new Set(
    [...previousBlacklist].filter(
      account => !current.exempt.some(entry => entry.voteAccount === account && entry.untilEpoch === null),
    ),
  )
  const newAccounts = new Set(
    candidates.map(hit => hit.voteAccount).filter(account => !listed.has(account) && !retained.has(account)),
  )
  const hold = newAccounts.size > maxNewListings || (maxNewListings === 0 && candidates.length > 0)
  const added = hold ? [] : candidates
  const carried = hold
    ? current.rows.filter(isOwn).sort((a, b) => byVoteAccount(a, b) || (a.code < b.code ? -1 : 1))
    : []
  const carriedRules = new Set(carried.map(row => `${row.voteAccount}/${ruleOfCode(row.code) ?? ''}`))
  const blacklist = new Set([...listed, ...added.map(hit => hit.voteAccount), ...carried.map(row => row.voteAccount)])
  const kept = [...retained].filter(account => !blacklist.has(account)).sort()
  const removed = [...previousBlacklist].filter(account => !blacklist.has(account) && !retained.has(account)).sort()

  return {
    blacklist: new Set([...blacklist, ...kept]),
    added,
    held: hold ? candidates.filter(hit => !carriedRules.has(`${hit.voteAccount}/${hit.rule}`)) : [],
    kept,
    removed,
    carried,
    newAccounts: [...newAccounts].sort(),
    alreadyListed: previous
      .filter(row => candidates.some(hit => hit.voteAccount === row.voteAccount))
      .sort((a, b) => byVoteAccount(a, b) || (a.code < b.code ? -1 : 1)),
  }
}

/** `vote_account,code` rows, sorted and without duplicates, with the header line. */
export const renderBlacklistCsv = (hits: { voteAccount: string; code: string }[]): string => {
  const lines = [...new Set(hits.map(hit => `${hit.voteAccount},${hit.code}`))].sort()
  return ['vote_account,code', ...lines].join('\n') + '\n'
}
