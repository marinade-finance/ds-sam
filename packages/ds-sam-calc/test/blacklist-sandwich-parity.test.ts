import fs from 'fs'
import path from 'path'

import { DEFAULT_SANDWICH_PARAMS, sandwichHit, sandwichPopulation } from '../src/blacklist/sandwich'

// Byte-identical copy in delegation-strategy-2 store/tests/fixtures; a rule change updates both
type Case = {
  name: string
  floor_pct: number
  rows: { vote_account: string; blocks_produced: number; blocks_with_sandwiches: number; sandwich_rate_30d: number }[]
  expected: { median: number | null; pooled: number | null; hits: { vote_account: string; p_value: number }[] }
}

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sandwich-parity.json')).toString()) as {
  cases: Case[]
}

const close = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= 1e-12 * Math.max(Math.abs(actual), Math.abs(expected))

describe('sandwich parity with delegation-strategy-2', () => {
  it('has the shared cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8)
  })

  it.each(cases.map(c => [c.name, c] as const))('%s', (_, { floor_pct, rows, expected }) => {
    const params = { ...DEFAULT_SANDWICH_PARAMS, ratePct: floor_pct }
    const population = sandwichPopulation(
      rows.map(r => ({
        rate: r.sandwich_rate_30d,
        blocksProduced: r.blocks_produced,
        blocksWithSandwiches: r.blocks_with_sandwiches,
      })),
      params.minBlocks,
    )
    const hits = population
      ? rows.flatMap(r => {
          const p = sandwichHit(r.sandwich_rate_30d, r.blocks_produced, r.blocks_with_sandwiches, population, params)
          return p === null ? [] : [{ voteAccount: r.vote_account, p }]
        })
      : []

    expect(population?.medianRate ?? null).toBe(expected.median)
    expect(population && close(population.pooledRate, expected.pooled ?? NaN)).toBe(expected.pooled !== null || null)
    expect(hits.map(h => h.voteAccount)).toEqual(expected.hits.map(h => h.vote_account))
    expect(hits.map((hit, i) => close(hit.p, expected.hits[i]?.p_value ?? NaN))).toEqual(hits.map(() => true))
  })
})
