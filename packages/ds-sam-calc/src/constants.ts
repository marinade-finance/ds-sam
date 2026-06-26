// Solana epoch = 432000 slots × 0.4s/slot = 172800s = 48h exactly.
export const EPOCH_DURATION_MS = 48 * 60 * 60 * 1000
export const EPOCHS_PER_YEAR = (365.25 * 24 * 3600 * 1000) / EPOCH_DURATION_MS

export const LAMPORTS_PER_SOL = 1e9

// PMPE = per-mille per epoch: lamports per 1000 SOL per epoch.
// Output unit follows the stake unit (SOL in → SOL out).
export function pmpeToSol(pmpe: number, stakeSol: number): number {
  return (pmpe / 1000) * stakeSol
}
