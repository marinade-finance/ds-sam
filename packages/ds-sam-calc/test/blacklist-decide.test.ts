import { BlacklistRowSource, decideBlacklist, ExemptRule, renderBlacklistCsv } from '../src/blacklist/decide'
import { BlacklistRuleId } from '../src/blacklist/types'

import type { BlacklistExempt, BlacklistRow, CurrentBlacklist } from '../src/blacklist/decide'
import type { BlacklistHit } from '../src/blacklist/types'

const A = 1085

const hit = (voteAccount: string, rule = BlacklistRuleId.SANDWICH, epochs = [A - 1]): BlacklistHit => ({
  voteAccount,
  rule,
  code: rule === BlacklistRuleId.SANDWICH ? `MALICIOUS_SM_${epochs.at(-1)}` : `SLOW_SLOTS_${epochs.at(-1)}`,
  epochs,
  evidence: { epochs: {} },
})

const row = (
  voteAccount: string,
  code: string,
  source = BlacklistRowSource.LEGACY,
  auctionEpoch: number | null = null,
): BlacklistRow => ({ voteAccount, code, source, auctionEpoch })

const exempt = (voteAccount: string, rule: ExemptRule, untilEpoch: number | null = null): BlacklistExempt => ({
  voteAccount,
  rule,
  untilEpoch,
})

const current = (rows: BlacklistRow[], exemptions: BlacklistExempt[] = []): CurrentBlacklist => ({
  rows,
  exempt: exemptions,
})

const accounts = (hits: BlacklistHit[]) => hits.map(h => h.voteAccount)

describe('decideBlacklist', () => {
  it('keeps every current row and adds new hits', () => {
    const decision = decideBlacklist(current([row('old', 'BLACKLIST_COMMISSION_RUG')]), [hit('new')], A, 10)
    expect([...decision.blacklist].sort()).toEqual(['new', 'old'])
    expect(accounts(decision.added)).toEqual(['new'])
    expect(decision.held).toEqual([])
  })

  it('an active row of the same rule suppresses a second one', () => {
    const decision = decideBlacklist(current([row('v', 'MALICIOUS_SM_1080')]), [hit('v')], A, 10)
    expect(decision.added).toEqual([])
    expect(decision.blacklist).toEqual(new Set(['v']))
  })

  it('a row of another rule does not suppress the hit', () => {
    const decision = decideBlacklist(current([row('v', 'SLOW_SLOTS_1080')]), [hit('v')], A, 10)
    expect(accounts(decision.added)).toEqual(['v'])
  })

  it('a permanent exemption suppresses its rule or all', () => {
    const hits = [hit('a'), hit('b'), hit('c', BlacklistRuleId.SLOW_SLOTS, [A - 2, A - 1])]
    const decision = decideBlacklist(
      current([], [exempt('a', ExemptRule.ALL), exempt('b', ExemptRule.SANDWICH), exempt('c', ExemptRule.SANDWICH)]),
      hits,
      A,
      10,
    )
    expect(accounts(decision.added)).toEqual(['c'])
  })

  it('a legacy exemption does not suppress a rule hit', () => {
    const decision = decideBlacklist(current([], [exempt('a', ExemptRule.LEGACY)]), [hit('a')], A, 10)
    expect(accounts(decision.added)).toEqual(['a'])
  })

  it('until epoch ignores only evidence up to it', () => {
    const exemption = [exempt('v', ExemptRule.SLOW_SLOTS, 1083)]
    const suppressed = decideBlacklist(
      current([], exemption),
      [hit('v', BlacklistRuleId.SLOW_SLOTS, [1083, 1084])],
      A,
      10,
    )
    const kept = decideBlacklist(current([], exemption), [hit('v', BlacklistRuleId.SLOW_SLOTS, [1084, 1085])], A, 10)
    expect(suppressed.added).toEqual([])
    expect(accounts(kept.added)).toEqual(['v'])
  })

  it('adds new accounts up to the limit', () => {
    const decision = decideBlacklist(current([]), [hit('a'), hit('b')], A, 2)
    expect(accounts(decision.added)).toEqual(['a', 'b'])
    expect(decision.held).toEqual([])
  })

  it('holds every hit back above the limit', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [hit('a'), hit('b'), hit('c')], A, 2)
    expect(decision.added).toEqual([])
    expect(accounts(decision.held)).toEqual(['a', 'b', 'c'])
    expect(decision.blacklist).toEqual(new Set(['old']))
  })

  it('a hit of an already listed account is not a new account', () => {
    const decision = decideBlacklist(
      current([row('a', 'SLOW_SLOTS_1080'), row('b', 'SLOW_SLOTS_1080')]),
      [hit('a'), hit('b'), hit('c')],
      A,
      1,
    )
    expect(accounts(decision.added)).toEqual(['a', 'b', 'c'])
  })

  it('a re-run of the auction judges its own rows again', () => {
    const rows = [row('v', 'MALICIOUS_SM_1084', BlacklistRowSource.AUCTION, A)]
    const rerun = decideBlacklist(current(rows), [hit('v')], A, 10)
    expect(accounts(rerun.added)).toEqual(['v'])
    const dropped = decideBlacklist(current(rows), [], A, 10)
    expect(dropped.blacklist).toEqual(new Set())
  })

  it('an auction row of another epoch counts as listed', () => {
    const rows = [row('v', 'MALICIOUS_SM_1083', BlacklistRowSource.AUCTION, A - 1)]
    const decision = decideBlacklist(current(rows), [hit('v')], A, 10)
    expect(decision.added).toEqual([])
    expect(decision.blacklist).toEqual(new Set(['v']))
  })
})

describe('renderBlacklistCsv', () => {
  it('sorts and deduplicates the rows under a header', () => {
    expect(renderBlacklistCsv([hit('b'), hit('a'), hit('b')])).toBe(
      'vote_account,code\na,MALICIOUS_SM_1084\nb,MALICIOUS_SM_1084\n',
    )
    expect(renderBlacklistCsv([])).toBe('vote_account,code\n')
  })
})
