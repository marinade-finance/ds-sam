import { evaluateBlacklistRules } from '../src/blacklist/evaluate'
import { slowSlotsHits, stakeWeightedMedian, windowEpochs } from '../src/blacklist/slow-slots'

import type { SlotTimeRow } from '../src/blacklist/slow-slots'
import type { BlacklistHit, SlowSlotsEvidence } from '../src/blacklist/types'

const E = 1080
const PARAMS = { medianMult: 1.1, consecutiveEpochs: 2 }

// [vote account, slot ms, stake]
type Row = [string, number, number]

const NETWORK: Row[] = [
  ['n1', 200, 100],
  ['n2', 200, 100],
  ['n3', 205, 100],
]

const epochRows = (extra: Row[]): Row[] => [...NETWORK, ...extra]

const evaluate = (epochs: [number, Row[]][]): BlacklistHit[] => {
  const slotTimes = new Map<number, SlotTimeRow[]>()
  const stakes = new Map<number, Map<string, bigint>>()
  for (const [epoch, rows] of epochs) {
    slotTimes.set(
      epoch,
      rows.map(([voteAccount, ms]) => ({ voteAccount, slotDurationMedianMs: ms })),
    )
    stakes.set(epoch, new Map(rows.filter(([, , stake]) => stake > 0).map(([a, , stake]) => [a, BigInt(stake)])))
  }
  return slowSlotsHits(slotTimes, stakes, E, PARAMS)
}

const accounts = (hits: BlacklistHit[]) => hits.map(hit => hit.voteAccount)

describe('slow slots rule', () => {
  it('the median is weighted by stake', () => {
    expect(
      stakeWeightedMedian([
        { value: 200, stake: 90n },
        { value: 300, stake: 10n },
      ]),
    ).toBe(200)
    expect(
      stakeWeightedMedian([
        { value: 200, stake: 10n },
        { value: 300, stake: 90n },
      ]),
    ).toBe(300)
    expect(stakeWeightedMedian([{ value: 200, stake: 0n }])).toBeNull()
  })

  it('two consecutive epochs over their own bars hit', () => {
    const hits = evaluate([
      [E - 1, epochRows([['slow', 245, 10]])],
      [E, epochRows([['slow', 250, 10]])],
    ])
    expect(accounts(hits)).toEqual(['slow'])
  })

  it('one epoch over the bar does not hit', () => {
    const hits = evaluate([
      [E - 1, epochRows([['slow', 215, 10]])],
      [E, epochRows([['slow', 250, 10]])],
    ])
    expect(hits).toEqual([])
  })

  it('a value at the bar does not hit', () => {
    const rows = epochRows([['edge', 220, 10]])
    expect(
      evaluate([
        [E - 1, rows],
        [E, rows],
      ]),
    ).toEqual([])
  })

  it('a missing prior epoch does not hit', () => {
    expect(evaluate([[E, epochRows([['slow', 250, 10]])]])).toEqual([])
  })

  it('a validator absent in one epoch does not hit', () => {
    const hits = evaluate([
      [E - 1, epochRows([])],
      [E, epochRows([['slow', 250, 10]])],
    ])
    expect(hits).toEqual([])
  })

  it('a validator without stake is judged but not weighted', () => {
    const rows = epochRows([
      ['unstaked', 400, 0],
      ['unstaked2', 400, 0],
    ])
    const hits = evaluate([
      [E - 1, rows],
      [E, rows],
    ])
    expect(accounts(hits)).toEqual(['unstaked', 'unstaked2'])
    expect((hits[0]?.evidence as SlowSlotsEvidence).epochs[String(E)]?.networkMedianMs).toBe(200)
  })

  it('the code carries the evaluated epoch', () => {
    const rows = epochRows([['slow', 250, 10]])
    const hits = evaluate([
      [E - 1, rows],
      [E, rows],
    ])
    expect(hits[0]?.code).toBe('SLOW_SLOTS_1080')
    expect(hits[0]?.epochs).toEqual([E - 1, E])
  })

  it('evidence holds observed values only', () => {
    const rows = epochRows([['slow', 250, 10]])
    const evidence = evaluate([
      [E - 1, rows],
      [E, rows],
    ])[0]?.evidence as SlowSlotsEvidence
    expect(Object.keys(evidence)).toEqual(['epochs'])
    expect(Object.keys(evidence.epochs)).toHaveLength(2)
    for (const value of Object.values(evidence.epochs)) {
      expect(Object.keys(value).sort()).toEqual(['networkMedianMs', 'slotDurationMedianMs'])
    }
  })

  it('the window holds its length of epochs ending at the epoch', () => {
    expect(windowEpochs(1080, 2)).toEqual([1079, 1080])
    expect(windowEpochs(1080, 1)).toEqual([1080])
    expect(windowEpochs(1080, 0)).toEqual([])
    expect(windowEpochs(1, 3)).toEqual([0, 1])
  })

  it('names a window epoch without stake as missing', () => {
    const rows = [...NETWORK, ['slow', 250, 10] as Row].map(([voteAccount, ms]) => ({
      voteAccount,
      slotDurationMedianMs: ms,
    }))
    const stakes = new Map(NETWORK.map(([account, , stake]) => [account, BigInt(stake)]))
    const { decision } = evaluateBlacklistRules(
      { maxNewListings: 10, slowSlots: PARAMS },
      {
        current: { rows: [], exempt: [] },
        sandwichesByEpoch: new Map(),
        slotTimesByEpoch: new Map([
          [E - 1, rows],
          [E, rows],
        ]),
        stakesByEpoch: new Map([[E, stakes]]),
      },
      E + 1,
    )
    expect(decision.missingEpochs).toEqual([E - 1])
    expect(decision.added).toEqual([])
  })
})
