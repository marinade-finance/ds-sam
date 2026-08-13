export { LAMPORTS_PER_SOL } from '@marinade.finance/ts-common'

// PMPE = per-mille per epoch: reward per 1000 SOL of stake per epoch (a SOL-scaled ratio, not lamports).
// Output unit follows the stake unit (SOL in → SOL out).
export function pmpeToSol(pmpe: number, stakeSol: number): number {
  return (pmpe / 1000) * stakeSol
}
