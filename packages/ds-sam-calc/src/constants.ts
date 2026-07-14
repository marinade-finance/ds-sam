import { EPOCH_DURATION } from '@marinade.finance/ts-common'

export { EPOCHS_PER_YEAR, LAMPORTS_PER_SOL } from '@marinade.finance/ts-common'

// ts-common EPOCH_DURATION is in seconds; DS-SAM APY math works in milliseconds.
export const EPOCH_DURATION_MS = EPOCH_DURATION * 1000

// PMPE = per-mille per epoch: reward per 1000 SOL of stake per epoch (a SOL-scaled ratio, not lamports).
// Output unit follows the stake unit (SOL in → SOL out).
export function pmpeToSol(pmpe: number, stakeSol: number): number {
  return (pmpe / 1000) * stakeSol
}
