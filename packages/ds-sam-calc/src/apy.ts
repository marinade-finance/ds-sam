import type { DsSamConfig } from './config'
import type { AuctionValidator } from './types'

export interface ApyBreakdown {
  inflation: number
  mev: number
  blockRewards: number
  bid: number
  total: number
}

// Compound a per-epoch rate over a year: (1 + rate)^epochs − 1. The single
// place this exponentiation lives — compoundApy (pmpe basis) and
// selectProjectedAPY (profit/tvl basis) both route through it.
export function annualize(ratePerEpoch: number, epochsPerYear: number): number {
  return Math.pow(1 + ratePerEpoch, epochsPerYear) - 1
}

export function compoundApy(pmpe: number, epochsPerYear: number): number {
  return annualize(pmpe / 1e3, epochsPerYear)
}

// Gauge scale: 4 × idealBondEpochs — ideal runway lands at 25% fill,
// the critical+watch zone occupies the leftmost quarter.
export function bondGaugeScaleMax(config: DsSamConfig): number {
  return 4 * config.idealBondEpochs
}

// Critical band covers the leftmost half (0–50%) of the scale, making the
// danger zone prominent regardless of absolute epoch values.
export function bondCriticalFrac(config: DsSamConfig): number {
  const max = bondGaugeScaleMax(config)
  return max > 0 ? (2 * config.idealBondEpochs) / max : 0.5
}

// Fraction of block rewards GIVEN to stakers = 1 − commission. Mirrors the
// SDK's calculatePmpe zero condition exactly (null or ≥ 100% commission → the
// validator keeps everything, so blockPmpe is 0): the returned share is > 0 iff
// the SDK credits a non-zero blockPmpe, keeping the "N% shared" label and the
// bar consistent. blockRewardsCommissionDec is the commission KEPT, same
// convention as inflation/MEV — not pre-inverted in the data.
export function blockRewardsSharedFrac(commissionDec: number | null): number {
  if (commissionDec === null || commissionDec >= 1) return 0
  return 1 - commissionDec
}

export function apyBreakdown(validator: AuctionValidator, epochsPerYear: number): ApyBreakdown {
  const rev = validator.revShare
  return {
    inflation: compoundApy(rev.inflationPmpe, epochsPerYear),
    mev: compoundApy(rev.mevPmpe, epochsPerYear),
    blockRewards: compoundApy(rev.blockPmpe ?? 0, epochsPerYear),
    bid: compoundApy(rev.bidPmpe, epochsPerYear),
    total: compoundApy(rev.totalPmpe, epochsPerYear),
  }
}
