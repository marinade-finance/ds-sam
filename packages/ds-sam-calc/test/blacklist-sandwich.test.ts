import { binomialUpperTail, DEFAULT_SANDWICH_PARAMS, sandwichHits } from '../src/blacklist/sandwich'

import type { SandwichRow } from '../src/blacklist/sandwich'
import type { BlacklistHit, SandwichEvidence } from '../src/blacklist/types'

const E = 1075
const PARAMS = { ...DEFAULT_SANDWICH_PARAMS, ratePct: 4.0 }

const row = (voteAccount: string, blocks: number, sandwiched: number, wide: number | null): SandwichRow => ({
  voteAccount,
  blocksProduced: blocks,
  blocksWithSandwiches: sandwiched,
  sandwichRate30d: Math.round((1000 * sandwiched) / blocks) / 10,
  wideSandwichRate30d: wide,
})

// A cluster at ~0.77 % pooled and 0.8 % median, plus `rows`
const evaluate = (rows: SandwichRow[]): BlacklistHit[] => {
  const background = Array.from({ length: 40 }, (_, i) =>
    row(`n${String(i).padStart(2, '0')}`, 5000, 38 + (i % 3), 0.8),
  )
  return sandwichHits([...background, ...rows], E, PARAMS)
}

const codes = (hits: BlacklistHit[]) => hits.map(hit => [hit.voteAccount, hit.code])

const evidence = (hit: BlacklistHit | undefined) => hit?.evidence as SandwichEvidence

describe('sandwich rule', () => {
  it('a chance count does not hit', () => {
    expect(evaluate([row('thin', 8, 2, null)])).toEqual([])
  })

  it('a significant rate over the floor hits single', () => {
    const hits = evaluate([row('dhoz', 104, 7, null), row('blackmont', 196, 26, null)])
    expect(codes(hits)).toEqual([
      ['blackmont', 'MALICIOUS_SM_1075'],
      ['dhoz', 'MALICIOUS_SM_1075'],
    ])
    expect(hits[0]?.epochs).toEqual([E])
  })

  it('a rate under the floor does not hit', () => {
    expect(evaluate([row('big', 10_000, 390, null)])).toEqual([])
  })

  it('a wide rate hits with the derived count', () => {
    const hits = evaluate([row('wide', 5000, 40, 6.0)])
    expect(codes(hits)).toEqual([['wide', 'MALICIOUS_SM_1075']])
    expect(evidence(hits[0]).wide?.blocksWithSandwiches).toBe(300)
    expect(evidence(hits[0]).single).toBeNull()
  })

  it('single takes precedence over wide and keeps the wide evidence', () => {
    const hits = evaluate([row('both', 5000, 400, 9.0)])
    expect(codes(hits)).toEqual([['both', 'MALICIOUS_SM_1075']])
    expect(evidence(hits[0]).single).not.toBeNull()
    expect(evidence(hits[0]).wide).not.toBeNull()
  })

  it('no wide rows means no wide hits', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`n${i}`, 5000, 40, null))
    expect(sandwichHits(rows, E, PARAMS)).toEqual([])
  })

  it('evidence holds observed values only', () => {
    const single = evidence(evaluate([row('both', 5000, 400, 9.0)])[0]).single
    expect(Object.keys(single ?? {}).sort()).toEqual([
      'blocksProduced',
      'blocksWithSandwiches',
      'clusterMedianPct',
      'clusterPooledPct',
      'pValue',
      'rate30dPct',
    ])
  })

  it('no block produced at all gives no hits', () => {
    expect(
      sandwichHits(
        [row('zero', 0, 0, null)].map(r => ({ ...r, sandwichRate30d: 50 })),
        E,
        PARAMS,
      ),
    ).toEqual([])
  })

  it('a configured significance changes the verdict', () => {
    const rows = [row('dhoz', 104, 7, null)]
    expect(evaluate(rows)).toHaveLength(1)
    const background = Array.from({ length: 40 }, (_, i) =>
      row(`n${String(i).padStart(2, '0')}`, 5000, 38 + (i % 3), 0.8),
    )
    expect(sandwichHits([...background, ...rows], E, { ...PARAMS, significanceP: 1e-12 })).toEqual([])
  })
})

describe('binomialUpperTail', () => {
  it('handles the edges', () => {
    expect(binomialUpperTail(0, 10, 0.5)).toBe(1)
    expect(binomialUpperTail(11, 10, 0.5)).toBe(0)
    expect(binomialUpperTail(1, 10, 0)).toBe(0)
    expect(binomialUpperTail(1, 10, 1)).toBe(1)
  })

  it('matches exact small values', () => {
    // P(X >= 10) for Bin(10, 0.5) = 1/1024; P(X >= 1) for Bin(2, 0.5) = 3/4
    expect(binomialUpperTail(10, 10, 0.5)).toBeCloseTo(1 / 1024, 15)
    expect(binomialUpperTail(1, 2, 0.5)).toBeCloseTo(0.75, 15)
    // Log-space summation carries a few ulps of error
    expect(binomialUpperTail(5, 10, 0.5)).toBeCloseTo(638 / 1024, 14)
  })
})
