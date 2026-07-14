import { computeBondCoverage } from './bond-coverage'

import type { BondCoverage } from './bond-coverage'
import type { DsSamConfig } from './config'
import type { AuctionValidator } from './types'

// Runway window between the penalty threshold and the red chip.
// Validators not paying yet but within this many epochs of the threshold
// get the red "top up urgently" pill.
export const BOND_URGENT_EPOCHS = 3

// Runway clamped to 0 when the bond is below the SDK minimum (no stake
// coverage at all). Single source for sam-table and validator-detail.
export function effectiveBondRunway(v: AuctionValidator, config: DsSamConfig): number {
  if ((v.bondBalanceSol ?? 0) < config.minBondBalanceSol) return 0
  return Math.max(0, v.bondGoodForNEpochs ?? 0)
}

// Utilization 0..100 relative to the SDK-required minBondEpochs runway.
// 100 when bond is missing/empty OR minBondEpochs is misconfigured.
export function bondUtilizationPct(v: AuctionValidator, minBondEpochs: number): number {
  if ((v.bondBalanceSol ?? 0) <= 0) return 100
  if (minBondEpochs <= 0) return 100
  const runway = v.bondGoodForNEpochs ?? 0
  const used = 1 - runway / minBondEpochs
  return Math.max(0, Math.min(100, used * 100))
}

// Four tiers driving the bond chip color and the page-level CTA:
//   no-bond  → no bond posted at all (red)
//   critical → fee charging now, coverage shortfall, OR runway ≤ minBondEpochs + BOND_URGENT_EPOCHS (red)
//   watch    → runway between urgent threshold and idealBondEpochs (yellow)
//   healthy  → runway above idealBondEpochs (green)
export type BondHealthState = 'no-bond' | 'critical' | 'watch' | 'healthy'

export function bondHealthFromAuction(
  v: AuctionValidator,
  config: DsSamConfig,
  winningTotalPmpe: number,
  // Optional precomputed coverage. Callers that already computed it (e.g.
  // tip-engine's bondCta) can pass it through instead of forcing a second
  // call here — computeBondCoverage runs per row of the SAM table, so the
  // duplicate adds up.
  precomputedCoverage?: BondCoverage,
): BondHealthState {
  const bondBalance = v.bondBalanceSol ?? 0
  if (bondBalance <= 0) return 'no-bond'
  // Below the SDK minimum the validator can win no stake regardless of bid
  // (clipBondStakeCap → 0). Runway-vs-tiny-stake looks huge, so the
  // coverage-based diagnosis below would mislabel it healthy — gate it red here.
  if (bondBalance < config.minBondBalanceSol) return 'critical'
  if (v.values.bondRiskFeeSol > 0) return 'critical'
  if (!v.auctionStake.marinadeSamTargetSol && !v.marinadeActivatedStakeSol) {
    return 'healthy'
  }
  const coverage = precomputedCoverage ?? computeBondCoverage(v, config, winningTotalPmpe)
  if (coverage.bondRiskFeeShortfall > 0) return 'critical'
  const runway = v.bondGoodForNEpochs ?? 0
  if (runway <= config.minBondEpochs + BOND_URGENT_EPOCHS) return 'critical'
  if (runway < config.idealBondEpochs) return 'watch'
  return 'healthy'
}
