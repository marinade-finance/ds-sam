import { BlacklistRuleId, byVoteAccount } from './types'

import type { BlacklistHit, SandwichObservation } from './types'

export type SandwichParams = {
  // Floor of the 30d sandwich rate, in percent
  ratePct: number
  // The bar is at least this multiple of the cluster median rate
  clusterMultiplier: number
  // The bar is at least this many percentage points above the cluster median rate
  minExcessPp: number
  // Blocks a 30d window needs to count towards the cluster median
  minBlocks: number
  // A sandwich count this unlikely at the cluster's pooled rate is not chance
  significanceP: number
}

export const DEFAULT_SANDWICH_PARAMS: Omit<SandwichParams, 'ratePct'> = {
  clusterMultiplier: 2.0,
  minExcessPp: 1.0,
  minBlocks: 1000,
  significanceP: 1e-4,
}

export type SandwichRow = {
  voteAccount: string
  blocksProduced: number
  blocksWithSandwiches: number
  // Percent, over the 30d window the block counts cover
  sandwichRate30d: number
  wideSandwichRate30d: number | null
}

export type SandwichPopulation = {
  // Both in percent
  medianRate: number
  pooledRate: number
}

/** P(X >= k) for X ~ Binomial(n, p), summed in log space so a large `n` neither under- nor overflows. */
export const binomialUpperTail = (k: number, n: number, p: number): number => {
  if (k === 0) {
    return 1
  }
  if (k > n || p <= 0) {
    return 0
  }
  if (p >= 1) {
    return 1
  }
  const lnP = Math.log(p)
  const lnQ = Math.log1p(-p)
  let lnChoose = 0
  for (let i = 1; i <= k; i++) {
    lnChoose += Math.log(n - k + i) - Math.log(i)
  }
  let term = lnChoose + k * lnP + (n - k) * lnQ
  let total = term
  for (let i = k; i < n; i++) {
    term += Math.log(n - i) - Math.log(i + 1) + lnP - lnQ
    const [high, low] = total >= term ? [total, term] : [term, total]
    total = high + Math.log1p(Math.exp(low - high))
    if (term < total - 40) {
      break
    }
  }
  return Math.min(Math.exp(total), 1)
}

/**
 * The cluster one epoch's rates are judged against: the median over windows of at least `minBlocks`
 * (0 when none has that many) and the pooled rate over all. `null` when no block was produced.
 */
export const sandwichPopulation = (
  rows: { rate: number; blocksProduced: number; blocksWithSandwiches: number }[],
  minBlocks: number,
): SandwichPopulation | null => {
  const rates: number[] = []
  let blocks = 0
  let sandwiched = 0
  for (const { rate, blocksProduced, blocksWithSandwiches } of rows) {
    if (blocksProduced >= minBlocks) {
      rates.push(rate)
    }
    blocks += blocksProduced
    sandwiched += blocksWithSandwiches
  }
  if (blocks === 0) {
    return null
  }
  rates.sort((a, b) => a - b)
  const middle = Math.floor(rates.length / 2)
  const upper = rates[middle] ?? 0
  const medianRate = rates.length % 2 === 0 ? ((rates[middle - 1] ?? 0) + upper) / 2 : upper
  return { medianRate, pooledRate: (100 * sandwiched) / blocks }
}

export const sandwichBar = (medianRate: number, params: SandwichParams): number =>
  Math.max(params.clusterMultiplier * medianRate, medianRate + params.minExcessPp, params.ratePct)

/** The rate clears the bar and the count is not explainable by chance; returns the p-value of a hit. */
export const sandwichHit = (
  ratePct: number,
  blocksProduced: number,
  blocksWithSandwiches: number,
  population: SandwichPopulation,
  params: SandwichParams,
): number | null => {
  if (ratePct < sandwichBar(population.medianRate, params)) {
    return null
  }
  const pValue = binomialUpperTail(blocksWithSandwiches, blocksProduced, population.pooledRate / 100)
  return pValue < params.significanceP ? pValue : null
}

// Upstream publishes only the wide rate; the count is recovered from it for the significance test
const wideCount = (wideRatePct: number, blocksProduced: number): number =>
  Math.round((wideRatePct * blocksProduced) / 100)

const observed = (
  rate30dPct: number,
  blocksProduced: number,
  blocksWithSandwiches: number,
  population: SandwichPopulation,
  pValue: number,
): SandwichObservation => ({
  rate30dPct,
  blocksProduced,
  blocksWithSandwiches,
  clusterMedianPct: population.medianRate,
  clusterPooledPct: population.pooledRate,
  pValue,
})

export const sandwichCode = (epoch: number): string => `MALICIOUS_SM_${epoch}`

/** Hits of one epoch's rows on the single rate, else on the wide rate, sorted by vote account. */
export const sandwichHits = (rows: SandwichRow[], epoch: number, params: SandwichParams): BlacklistHit[] => {
  const singlePopulation = sandwichPopulation(
    rows.map(r => ({
      rate: r.sandwichRate30d,
      blocksProduced: r.blocksProduced,
      blocksWithSandwiches: r.blocksWithSandwiches,
    })),
    params.minBlocks,
  )
  if (!singlePopulation) {
    return []
  }
  const wideRows = rows.flatMap(r =>
    r.wideSandwichRate30d === null
      ? []
      : [
          {
            rate: r.wideSandwichRate30d,
            blocksProduced: r.blocksProduced,
            blocksWithSandwiches: wideCount(r.wideSandwichRate30d, r.blocksProduced),
          },
        ],
  )
  const widePopulation = sandwichPopulation(wideRows, params.minBlocks)

  const hits: BlacklistHit[] = []
  for (const row of rows) {
    const singleP = sandwichHit(
      row.sandwichRate30d,
      row.blocksProduced,
      row.blocksWithSandwiches,
      singlePopulation,
      params,
    )
    const single =
      singleP === null
        ? null
        : observed(row.sandwichRate30d, row.blocksProduced, row.blocksWithSandwiches, singlePopulation, singleP)
    let wide: SandwichObservation | null = null
    if (widePopulation && row.wideSandwichRate30d !== null) {
      const count = wideCount(row.wideSandwichRate30d, row.blocksProduced)
      const wideP = sandwichHit(row.wideSandwichRate30d, row.blocksProduced, count, widePopulation, params)
      if (wideP !== null) {
        wide = observed(row.wideSandwichRate30d, row.blocksProduced, count, widePopulation, wideP)
      }
    }
    if (!single && !wide) {
      continue
    }
    hits.push({
      voteAccount: row.voteAccount,
      rule: BlacklistRuleId.SANDWICH,
      code: sandwichCode(epoch),
      epochs: [epoch],
      evidence: { epoch, single, wide },
    })
  }
  return hits.sort(byVoteAccount)
}
