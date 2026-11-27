import { BlacklistRowSource, ExemptRule } from '../src/blacklist/decide'
import { blacklistRulesEpochs, evaluateBlacklistRules } from '../src/blacklist/evaluate'

import type { BlacklistExempt, BlacklistRow } from '../src/blacklist/decide'
import type { BlacklistRulesData } from '../src/blacklist/evaluate'
import type { SandwichRow } from '../src/blacklist/sandwich'
import type { SlotTimeRow } from '../src/blacklist/slow-slots'
import type { BlacklistHit, SlowSlotsEvidence } from '../src/blacklist/types'
import type { BlacklistRulesConfig } from '../src/config'

const A = 1085
const SLOW_SLOTS = { medianMult: 1.1, consecutiveEpochs: 2 }
const SANDWICH = { ratePct: 4.0 }

// [vote account, slot ms, stake]
type Row = [string, number, number]

const NETWORK: Row[] = [
  ['n1', 200, 100],
  ['n2', 200, 100],
  ['n3', 205, 100],
]
const slow = (voteAccount: string): Row => [voteAccount, 230, 10]
const fast = (voteAccount: string): Row => [voteAccount, 200, 10]

const sandwichRow = (voteAccount: string, sandwiched: number): SandwichRow => ({
  voteAccount,
  blocksProduced: 5000,
  blocksWithSandwiches: sandwiched,
  sandwichRate30d: Math.round((1000 * sandwiched) / 5000) / 10,
  wideSandwichRate30d: null,
})
const BACKGROUND = Array.from({ length: 40 }, (_, i) => sandwichRow(`b${String(i).padStart(2, '0')}`, 38 + (i % 3)))

type Fixture = {
  slots?: [number, Row[]][]
  sandwiches?: [number, SandwichRow[]][]
  rows?: BlacklistRow[]
  exempt?: BlacklistExempt[]
}

const data = ({ slots = [], sandwiches = [], rows = [], exempt = [] }: Fixture): BlacklistRulesData => {
  const slotTimesByEpoch = new Map<number, SlotTimeRow[]>()
  const stakesByEpoch = new Map<number, Map<string, bigint>>()
  for (const [epoch, extra] of slots) {
    const all = [...NETWORK, ...extra]
    slotTimesByEpoch.set(
      epoch,
      all.map(([voteAccount, ms]) => ({ voteAccount, slotDurationMedianMs: ms })),
    )
    stakesByEpoch.set(epoch, new Map(all.map(([voteAccount, , stake]) => [voteAccount, BigInt(stake)])))
  }
  return {
    current: { rows, exempt },
    sandwichesByEpoch: new Map(sandwiches.map(([epoch, extra]) => [epoch, [...BACKGROUND, ...extra]])),
    slotTimesByEpoch,
    stakesByEpoch,
    previousBlacklist: new Set(),
  }
}

const evaluate = (fixture: Fixture, rules: Partial<BlacklistRulesConfig> = { slowSlots: SLOW_SLOTS }, limit = 10) =>
  evaluateBlacklistRules({ maxNewListings: limit, ...rules }, data(fixture), A)

const codes = (hits: BlacklistHit[]) => hits.map(hit => [hit.voteAccount, hit.code])

describe('blacklistRulesEpochs', () => {
  it('reads the windows ending at the last two closed epochs', () => {
    expect(blacklistRulesEpochs({ maxNewListings: 10, sandwich: SANDWICH }, A)).toEqual([1083, 1084])
    expect(blacklistRulesEpochs({ maxNewListings: 10, slowSlots: SLOW_SLOTS }, A)).toEqual([1082, 1083, 1084])
    expect(blacklistRulesEpochs({ maxNewListings: 10, sandwich: SANDWICH, slowSlots: SLOW_SLOTS }, A)).toEqual([
      1082, 1083, 1084,
    ])
  })

  it('reads nothing without a rule', () => {
    expect(blacklistRulesEpochs({ maxNewListings: 10 }, A)).toEqual([])
  })
})

describe('evaluateBlacklistRules on two windows', () => {
  it('the late epoch leaves the earlier slow-slots window to run', () => {
    const { decision } = evaluate({
      slots: [
        [1082, [slow('x')]],
        [1083, [slow('x')]],
      ],
    })
    expect(codes(decision.added)).toEqual([['x', 'SLOW_SLOTS_1083']])
    expect(decision.added[0]?.epochs).toEqual([1082, 1083])
    expect(decision.missingEpochs).toEqual([1084])
  })

  it('the auction after a late epoch judges the window that was skipped', () => {
    const { decision } = evaluate({
      slots: [
        [1082, [slow('x')]],
        [1083, [slow('x')]],
        [1084, [fast('x')]],
      ],
    })
    expect(codes(decision.added)).toEqual([['x', 'SLOW_SLOTS_1083']])
    expect(decision.missingEpochs).toEqual([])
  })

  it('an account slow in both windows gets the newest code only', () => {
    const { decision } = evaluate({
      slots: [
        [1082, [slow('x')]],
        [1083, [slow('x')]],
        [1084, [slow('x')]],
      ],
    })
    expect(codes(decision.added)).toEqual([['x', 'SLOW_SLOTS_1084']])
    expect(decision.added[0]?.epochs).toEqual([1083, 1084])
    expect(Object.keys((decision.added[0]?.evidence as SlowSlotsEvidence).epochs)).toEqual(['1083', '1084'])
  })

  it('the sandwich rule judges both epochs and keeps the newest code', () => {
    const rules = { sandwich: SANDWICH }
    const both = evaluate(
      {
        sandwiches: [
          [1083, [sandwichRow('s', 400)]],
          [1084, [sandwichRow('s', 400)]],
        ],
      },
      rules,
    )
    expect(codes(both.decision.added)).toEqual([['s', 'MALICIOUS_SM_1084']])

    const earlier = evaluate(
      {
        sandwiches: [
          [1083, [sandwichRow('s', 400)]],
          [1084, [sandwichRow('s', 39)]],
        ],
      },
      rules,
    )
    expect(codes(earlier.decision.added)).toEqual([['s', 'MALICIOUS_SM_1083']])
    expect(earlier.decision.added[0]?.epochs).toEqual([1083])
    expect(earlier.decision.missingEpochs).toEqual([])

    const late = evaluate({ sandwiches: [[1083, [sandwichRow('s', 400)]]] }, rules)
    expect(codes(late.decision.added)).toEqual([['s', 'MALICIOUS_SM_1083']])
    expect(late.decision.missingEpochs).toEqual([1084])
  })

  it("orders the newest window's hits before the earlier window's", () => {
    const { decision } = evaluate({
      slots: [
        [1082, [slow('a'), fast('b')]],
        [1083, [slow('a'), slow('b')]],
        [1084, [fast('a'), slow('b')]],
      ],
    })
    expect(codes(decision.added)).toEqual([
      ['b', 'SLOW_SLOTS_1084'],
      ['a', 'SLOW_SLOTS_1083'],
    ])
  })

  it('names every epoch a window lacked', () => {
    const replay = evaluate({
      slots: [
        [1083, [slow('x')]],
        [1084, [slow('x')]],
      ],
    })
    expect(codes(replay.decision.added)).toEqual([['x', 'SLOW_SLOTS_1084']])
    expect(replay.decision.missingEpochs).toEqual([1082])

    const one = evaluate({ slots: [[1083, [slow('x')]]] })
    expect(one.decision.added).toEqual([])
    expect(one.decision.missingEpochs).toEqual([1082, 1084])

    const none = evaluate({}, { sandwich: SANDWICH, slowSlots: SLOW_SLOTS })
    expect(none.decision.added).toEqual([])
    expect(none.decision.missingEpochs).toEqual([1082, 1083, 1084])
  })

  it('a window already listed by the previous auction adds nothing', () => {
    const rows = [{ voteAccount: 'x', code: 'SLOW_SLOTS_1083', source: BlacklistRowSource.AUCTION, auctionEpoch: 1084 }]
    for (const latest of [fast('x'), slow('x')]) {
      const { blacklist, decision } = evaluate({
        slots: [
          [1082, [slow('x')]],
          [1083, [slow('x')]],
          [1084, [latest]],
        ],
        rows,
      })
      expect(decision.added).toEqual([])
      expect(decision.held).toEqual([])
      expect(blacklist).toEqual(new Set(['x']))
    }
  })

  it('a hit of the earlier window that was held is judged again', () => {
    const dryRun = evaluate(
      {
        slots: [
          [1082, [slow('x')]],
          [1083, [slow('x')]],
          [1084, [fast('x')]],
        ],
      },
      { slowSlots: SLOW_SLOTS },
      0,
    )
    expect(dryRun.decision.added).toEqual([])
    expect(codes(dryRun.decision.held)).toEqual([['x', 'SLOW_SLOTS_1083']])
    expect(dryRun.blacklist).toEqual(new Set())

    const overCap = evaluate(
      {
        slots: [
          [1082, [slow('x'), fast('y')]],
          [1083, [slow('x'), slow('y')]],
          [1084, [fast('x'), slow('y')]],
        ],
      },
      { slowSlots: SLOW_SLOTS },
      1,
    )
    expect(overCap.decision.added).toEqual([])
    expect(codes(overCap.decision.held)).toEqual([
      ['y', 'SLOW_SLOTS_1084'],
      ['x', 'SLOW_SLOTS_1083'],
    ])
    expect(overCap.decision.newAccounts).toEqual(['x', 'y'])
    expect(overCap.decision.alreadyListed).toEqual([])
  })

  it('until epoch exempts the earlier window and not the newer one', () => {
    const until = (untilEpoch: number): BlacklistExempt[] => [
      { voteAccount: 'x', rule: ExemptRule.SLOW_SLOTS, untilEpoch },
    ]
    const earlierOnly = evaluate({
      slots: [
        [1082, [slow('x')]],
        [1083, [slow('x')]],
        [1084, [fast('x')]],
      ],
      exempt: until(1083),
    })
    expect(earlierOnly.decision.added).toEqual([])

    const allSlow: [number, Row[]][] = [
      [1082, [slow('x')]],
      [1083, [slow('x')]],
      [1084, [slow('x')]],
    ]
    expect(codes(evaluate({ slots: allSlow, exempt: until(1083) }).decision.added)).toEqual([['x', 'SLOW_SLOTS_1084']])
    expect(evaluate({ slots: allSlow, exempt: until(1084) }).decision.added).toEqual([])
  })

  it('an account hit in both windows is one new account', () => {
    const slowOnly = evaluate(
      {
        slots: [
          [1082, [slow('x')]],
          [1083, [slow('x')]],
          [1084, [slow('x')]],
        ],
      },
      { slowSlots: SLOW_SLOTS },
      1,
    )
    expect(codes(slowOnly.decision.added)).toEqual([['x', 'SLOW_SLOTS_1084']])
    expect(slowOnly.decision.held).toEqual([])

    const twoRules = evaluate(
      {
        slots: [
          [1082, [fast('x')]],
          [1083, [slow('x')]],
          [1084, [slow('x')]],
        ],
        sandwiches: [
          [1083, [sandwichRow('x', 400)]],
          [1084, [sandwichRow('x', 39)]],
        ],
      },
      { sandwich: SANDWICH, slowSlots: SLOW_SLOTS },
      1,
    )
    expect(codes(twoRules.decision.added)).toEqual([
      ['x', 'SLOW_SLOTS_1084'],
      ['x', 'MALICIOUS_SM_1083'],
    ])
    expect(twoRules.decision.held).toEqual([])
  })
})
