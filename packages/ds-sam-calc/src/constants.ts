export { LAMPORTS_PER_SOL } from '@marinade.finance/ts-common'

// Agave's pre-SIMD-0525 nominal, only ever a fallback for inputs cached before the API published it.
export const BASELINE_SLOTS_PER_YEAR = 78892314.984

// PMPE = per-mille per epoch: reward per 1000 SOL of stake per epoch (a SOL-scaled ratio, not lamports).
// Output unit follows the stake unit (SOL in → SOL out).
export function pmpeToSol(pmpe: number, stakeSol: number): number {
  return (pmpe / 1000) * stakeSol
}
