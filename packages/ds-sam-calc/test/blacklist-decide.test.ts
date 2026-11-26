import { BlacklistRowSource, decideBlacklist, ExemptRule, renderBlacklistCsv } from '../src/blacklist/decide'
import { BlacklistRuleId } from '../src/blacklist/types'

import type { BlacklistExempt, BlacklistRow, CurrentBlacklist } from '../src/blacklist/decide'
import type { BlacklistHit } from '../src/blacklist/types'

const A = 1085
const NONE = new Set<string>()

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
    const decision = decideBlacklist(current([row('old', 'BLACKLIST_COMMISSION_RUG')]), [hit('new')], A, 10, NONE)
    expect([...decision.blacklist].sort()).toEqual(['new', 'old'])
    expect(accounts(decision.added)).toEqual(['new'])
    expect(decision.held).toEqual([])
  })

  it('an active row of the same rule suppresses a second one', () => {
    const decision = decideBlacklist(current([row('v', 'MALICIOUS_SM_1080')]), [hit('v')], A, 10, NONE)
    expect(decision.added).toEqual([])
    expect(decision.blacklist).toEqual(new Set(['v']))
  })

  it('a row of another rule does not suppress the hit', () => {
    const decision = decideBlacklist(current([row('v', 'SLOW_SLOTS_1080')]), [hit('v')], A, 10, NONE)
    expect(accounts(decision.added)).toEqual(['v'])
  })

  it('a permanent exemption suppresses its rule or all', () => {
    const hits = [hit('a'), hit('b'), hit('c', BlacklistRuleId.SLOW_SLOTS, [A - 2, A - 1])]
    const decision = decideBlacklist(
      current([], [exempt('a', ExemptRule.ALL), exempt('b', ExemptRule.SANDWICH), exempt('c', ExemptRule.SANDWICH)]),
      hits,
      A,
      10,
      NONE,
    )
    expect(accounts(decision.added)).toEqual(['c'])
  })

  it('a legacy exemption does not suppress a rule hit', () => {
    const decision = decideBlacklist(current([], [exempt('a', ExemptRule.LEGACY)]), [hit('a')], A, 10, NONE)
    expect(accounts(decision.added)).toEqual(['a'])
  })

  it('until epoch exempts hits whose code epoch is at or below it', () => {
    const exemption = [exempt('v', ExemptRule.SLOW_SLOTS, 1084)]
    const suppressed = decideBlacklist(
      current([], exemption),
      [hit('v', BlacklistRuleId.SLOW_SLOTS, [1083, 1084])],
      A,
      10,
      NONE,
    )
    const kept = decideBlacklist(
      current([], exemption),
      [hit('v', BlacklistRuleId.SLOW_SLOTS, [1084, 1085])],
      A,
      10,
      NONE,
    )
    expect(suppressed.added).toEqual([])
    expect(accounts(kept.added)).toEqual(['v'])
  })

  it('until epoch below the code epoch does not exempt a window that starts at it', () => {
    const decision = decideBlacklist(
      current([], [exempt('v', ExemptRule.SLOW_SLOTS, 1083)]),
      [hit('v', BlacklistRuleId.SLOW_SLOTS, [1083, 1084])],
      A,
      10,
      NONE,
    )
    expect(accounts(decision.added)).toEqual(['v'])
  })

  it('adds new accounts up to the limit', () => {
    const decision = decideBlacklist(current([]), [hit('a'), hit('b')], A, 2, NONE)
    expect(accounts(decision.added)).toEqual(['a', 'b'])
    expect(decision.held).toEqual([])
  })

  it('holds every hit back above the limit', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [hit('a'), hit('b'), hit('c')], A, 2, NONE)
    expect(decision.added).toEqual([])
    expect(accounts(decision.held)).toEqual(['a', 'b', 'c'])
    expect(decision.blacklist).toEqual(new Set(['old']))
  })

  it('a limit of 0 holds every hit, also of an account listed under another rule', () => {
    const decision = decideBlacklist(current([row('v', 'SLOW_SLOTS_1080')]), [hit('v'), hit('k')], A, 0, new Set(['k']))
    expect(decision.added).toEqual([])
    expect(accounts(decision.held)).toEqual(['v', 'k'])
    expect(decision.blacklist).toEqual(new Set(['v', 'k']))
  })

  it('a hit of an already listed account is not a new account', () => {
    const decision = decideBlacklist(
      current([row('a', 'SLOW_SLOTS_1080'), row('b', 'SLOW_SLOTS_1080')]),
      [hit('a'), hit('b'), hit('c')],
      A,
      1,
      NONE,
    )
    expect(accounts(decision.added)).toEqual(['a', 'b', 'c'])
  })

  it('a re-run of the auction judges its own rows again', () => {
    const rows = [row('v', 'MALICIOUS_SM_1084', BlacklistRowSource.AUCTION, A)]
    const rerun = decideBlacklist(current(rows), [hit('v')], A, 10, NONE)
    expect(accounts(rerun.added)).toEqual(['v'])
    const dropped = decideBlacklist(current(rows), [], A, 10, NONE)
    expect(dropped.blacklist).toEqual(new Set())
  })

  it('an auction row of another epoch counts as listed', () => {
    const rows = [row('v', 'MALICIOUS_SM_1083', BlacklistRowSource.AUCTION, A - 1)]
    const decision = decideBlacklist(current(rows), [hit('v')], A, 10, NONE)
    expect(decision.added).toEqual([])
    expect(decision.blacklist).toEqual(new Set(['v']))
  })
})

describe('decideBlacklist previous auction', () => {
  it('keeps a previous account missing from the list', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [], A, 10, new Set(['gone']))
    expect(decision.blacklist).toEqual(new Set(['old', 'gone']))
    expect(decision.kept).toEqual(['gone'])
    expect(decision.added).toEqual([])
  })

  it('sorts kept accounts', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [], A, 10, new Set(['b', 'a']))
    expect(decision.kept).toEqual(['a', 'b'])
  })

  it.each([ExemptRule.ALL, ExemptRule.SANDWICH, ExemptRule.SLOW_SLOTS, ExemptRule.LEGACY])(
    'an exempt entry of any rule without until epoch releases the account (%s)',
    rule => {
      const decision = decideBlacklist(current([row('old', 'X')], [exempt('gone', rule)]), [], A, 10, new Set(['gone']))
      expect(decision.kept).toEqual([])
      expect(decision.removed).toEqual(['gone'])
      expect(decision.blacklist.has('gone')).toBe(false)
    },
  )

  it.each([ExemptRule.ALL, ExemptRule.SANDWICH, ExemptRule.SLOW_SLOTS, ExemptRule.LEGACY])(
    'an exempt entry with until epoch does not release the account (%s)',
    rule => {
      const decision = decideBlacklist(
        current([row('old', 'X')], [exempt('gone', rule, A + 10)]),
        [],
        A,
        10,
        new Set(['gone']),
      )
      expect(decision.kept).toEqual(['gone'])
      expect(decision.removed).toEqual([])
      expect(decision.blacklist.has('gone')).toBe(true)
    },
  )

  it('a kept account with a fresh hit does not count against maxNewListings', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [hit('a'), hit('b')], A, 1, new Set(['a']))
    expect(accounts(decision.added)).toEqual(['a', 'b'])
    expect(decision.held).toEqual([])
    expect(decision.kept).toEqual([])
    expect(decision.blacklist).toEqual(new Set(['old', 'a', 'b']))
  })

  it('removes nothing when every previous account stays listed', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [], A, 10, new Set(['old', 'gone']))
    expect(decision.removed).toEqual([])
  })

  it('an exempt entry of another account does not release', () => {
    const decision = decideBlacklist(
      current([row('old', 'X')], [exempt('other', ExemptRule.ALL)]),
      [],
      A,
      10,
      new Set(['gone']),
    )
    expect(decision.kept).toEqual(['gone'])
  })

  it('a listed or newly added account is not kept', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [hit('new')], A, 10, new Set(['old', 'new']))
    expect(decision.kept).toEqual([])
    expect(decision.blacklist).toEqual(new Set(['old', 'new']))
  })

  it('no previous auction keeps nothing', () => {
    expect(decideBlacklist(current([row('old', 'X')]), [], A, 10, NONE).kept).toEqual([])
  })

  it('kept accounts do not count against maxNewListings', () => {
    const decision = decideBlacklist(current([row('old', 'X')]), [hit('new')], A, 1, new Set(['k1', 'k2']))
    expect(accounts(decision.added)).toEqual(['new'])
    expect(decision.held).toEqual([])
    expect(decision.kept).toEqual(['k1', 'k2'])
  })

  it('a re-judged row that lost its hit is kept when the previous auction listed it', () => {
    const rows = [row('v', 'MALICIOUS_SM_1084', BlacklistRowSource.AUCTION, A)]
    const decision = decideBlacklist(current(rows), [], A, 10, new Set(['v']))
    expect(decision.kept).toEqual(['v'])
    expect(decision.blacklist).toEqual(new Set(['v']))
  })
})

describe('decideBlacklist held re-run', () => {
  const own = row('v', 'MALICIOUS_SM_1084', BlacklistRowSource.AUCTION, A)

  it('a held re-run keeps and carries the epoch own rows', () => {
    const decision = decideBlacklist(
      current([row('old', 'X'), own]),
      [hit('v'), hit('a'), hit('b'), hit('c')],
      A,
      2,
      NONE,
    )
    expect(decision.added).toEqual([])
    expect(decision.carried).toEqual([own])
    expect(decision.blacklist).toEqual(new Set(['old', 'v']))
    expect(accounts(decision.held)).toEqual(['a', 'b', 'c'])
  })

  it('a held re-run carries a row whose hit is gone', () => {
    const decision = decideBlacklist(current([row('old', 'X'), own]), [hit('a'), hit('b'), hit('c')], A, 2, NONE)
    expect(decision.carried).toEqual([own])
    expect(decision.blacklist.has('v')).toBe(true)
  })

  it('a held re-run does not carry rows of another epoch', () => {
    const earlier = row('w', 'MALICIOUS_SM_1083', BlacklistRowSource.AUCTION, A - 1)
    const decision = decideBlacklist(current([earlier, own]), [hit('a'), hit('b'), hit('c')], A, 2, NONE)
    expect(decision.carried).toEqual([own])
    expect(decision.blacklist).toEqual(new Set(['w', 'v']))
  })

  it('a non-holding re-run carries nothing', () => {
    const decision = decideBlacklist(current([own]), [hit('v')], A, 10, NONE)
    expect(decision.carried).toEqual([])
    expect(accounts(decision.added)).toEqual(['v'])
  })
})

describe('decideBlacklist hits of the earlier window', () => {
  const previous = (code: string) => current([row('v', code, BlacklistRowSource.AUCTION, A - 1)])

  it('a listing of the previous auction suppresses the same window judged again', () => {
    for (const [code, judged] of [
      ['SLOW_SLOTS_1083', hit('v', BlacklistRuleId.SLOW_SLOTS, [1082, 1083])],
      ['MALICIOUS_SM_1083', hit('v', BlacklistRuleId.SANDWICH, [1083])],
    ] as const) {
      const decision = decideBlacklist(previous(code), [judged], A, 10, NONE)
      expect(decision.added).toEqual([])
      expect(decision.held).toEqual([])
      expect(decision.carried).toEqual([])
      expect(decision.blacklist).toEqual(new Set(['v']))
    }
  })

  it('a listing of the previous auction suppresses a newer window of the same rule', () => {
    const decision = decideBlacklist(
      previous('SLOW_SLOTS_1083'),
      [hit('v', BlacklistRuleId.SLOW_SLOTS, [1083, 1084])],
      A,
      10,
      NONE,
    )
    expect(decision.added).toEqual([])
    expect(decision.held).toEqual([])
  })

  it('a hit of the earlier window held by a dry run is judged again', () => {
    const judged = hit('v', BlacklistRuleId.SLOW_SLOTS, [1082, 1083])
    const decision = decideBlacklist(current([row('old', 'X')]), [judged], A, 0, NONE)
    expect(decision.added).toEqual([])
    expect(decision.held).toEqual([judged])
    expect(decision.held[0]?.code).toBe('SLOW_SLOTS_1083')
    expect(decision.blacklist).toEqual(new Set(['old']))
  })

  it('hits of the earlier window count against the limit and are held above it', () => {
    const hits = [
      hit('a', BlacklistRuleId.SANDWICH, [1084]),
      hit('b', BlacklistRuleId.SANDWICH, [1083]),
      hit('c', BlacklistRuleId.SANDWICH, [1083]),
    ]
    const held = decideBlacklist(current([]), hits, A, 2, NONE)
    expect(held.added).toEqual([])
    expect(accounts(held.held)).toEqual(['a', 'b', 'c'])
    const added = decideBlacklist(current([]), hits, A, 3, NONE)
    expect(accounts(added.added)).toEqual(['a', 'b', 'c'])
    expect(added.held).toEqual([])
  })

  it('until epoch at the end of the earlier window exempts its hit', () => {
    const decide = (rule: ExemptRule, untilEpoch: number, judged: BlacklistHit) =>
      accounts(decideBlacklist(current([], [exempt('v', rule, untilEpoch)]), [judged], A, 10, NONE).added)
    expect(decide(ExemptRule.SLOW_SLOTS, 1083, hit('v', BlacklistRuleId.SLOW_SLOTS, [1082, 1083]))).toEqual([])
    expect(decide(ExemptRule.SLOW_SLOTS, 1083, hit('v', BlacklistRuleId.SLOW_SLOTS, [1083, 1084]))).toEqual(['v'])
    expect(decide(ExemptRule.SLOW_SLOTS, 1082, hit('v', BlacklistRuleId.SLOW_SLOTS, [1082, 1083]))).toEqual(['v'])
    expect(decide(ExemptRule.SANDWICH, 1083, hit('v', BlacklistRuleId.SANDWICH, [1083]))).toEqual([])
    expect(decide(ExemptRule.SANDWICH, 1082, hit('v', BlacklistRuleId.SANDWICH, [1083]))).toEqual(['v'])
  })

  it('one account with hits of two rules from two windows is one new account', () => {
    const decision = decideBlacklist(
      current([]),
      [hit('v', BlacklistRuleId.SANDWICH, [1083]), hit('v', BlacklistRuleId.SLOW_SLOTS, [1083, 1084])],
      A,
      1,
      NONE,
    )
    expect(decision.added.map(h => h.code)).toEqual(['MALICIOUS_SM_1083', 'SLOW_SLOTS_1084'])
    expect(decision.held).toEqual([])
    expect(decision.blacklist).toEqual(new Set(['v']))
  })
})

describe('decideBlacklist new and already listed accounts', () => {
  it('reports the row of an account listed under another rule and keeps it out of the new accounts', () => {
    const listed = row('v', 'SLOW_SLOTS_1080')
    const decision = decideBlacklist(current([listed, row('other', 'X')]), [hit('v'), hit('n')], A, 0, NONE)
    expect(accounts(decision.held)).toEqual(['v', 'n'])
    expect(decision.newAccounts).toEqual(['n'])
    expect(decision.alreadyListed).toEqual([listed])
  })

  it('an account of the previous auction without a row is neither new nor already listed', () => {
    const decision = decideBlacklist(current([]), [hit('k'), hit('n')], A, 0, new Set(['k']))
    expect(decision.newAccounts).toEqual(['n'])
    expect(decision.alreadyListed).toEqual([])
  })

  it('never reports a row of this auction as already listed', () => {
    const own = row('v', 'MALICIOUS_SM_1084', BlacklistRowSource.AUCTION, A)
    const decision = decideBlacklist(current([own]), [hit('v', BlacklistRuleId.SLOW_SLOTS, [A - 2, A - 1])], A, 0, NONE)
    expect(decision.alreadyListed).toEqual([])
    expect(decision.newAccounts).toEqual(['v'])
  })

  it('sorts the rows of an account by code', () => {
    const rows = [row('v', 'SLOW_SLOTS_1080'), row('v', 'BLACKLIST_COMMISSION_RUG')]
    const decision = decideBlacklist(current(rows), [hit('v')], A, 0, NONE)
    expect(decision.alreadyListed.map(r => r.code)).toEqual(['BLACKLIST_COMMISSION_RUG', 'SLOW_SLOTS_1080'])
  })

  it('counts the same new accounts that the limit compares', () => {
    const hits = [hit('b'), hit('a'), hit('c')]
    const atLimit = decideBlacklist(current([]), hits, A, 3, NONE)
    expect(atLimit.newAccounts).toEqual(['a', 'b', 'c'])
    expect(atLimit.held).toEqual([])
    const aboveLimit = decideBlacklist(current([]), hits, A, 2, NONE)
    expect(aboveLimit.newAccounts).toEqual(['a', 'b', 'c'])
    expect(aboveLimit.added).toEqual([])
  })
})

describe('renderBlacklistCsv', () => {
  it('sorts and deduplicates the rows under a header', () => {
    expect(renderBlacklistCsv([hit('b'), hit('a'), hit('b')])).toBe(
      'vote_account,code\na,MALICIOUS_SM_1084\nb,MALICIOUS_SM_1084\n',
    )
    expect(renderBlacklistCsv([])).toBe('vote_account,code\n')
  })

  it('renders hits and carried rows with their own codes', () => {
    expect(renderBlacklistCsv([hit('b'), row('a', 'MALICIOUS_SM_1083', BlacklistRowSource.AUCTION, A)])).toBe(
      'vote_account,code\na,MALICIOUS_SM_1083\nb,MALICIOUS_SM_1084\n',
    )
  })
})
