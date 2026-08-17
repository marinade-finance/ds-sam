import { assert, SECONDS_PER_YEAR } from '@marinade.finance/ts-common'

import type { SlotParams } from './types'

export { LAMPORTS_PER_SOL } from '@marinade.finance/ts-common'

// Agave's pre-SIMD-0525 nominal, only ever a fallback for inputs cached before the API published it.
export const BASELINE_SLOTS_PER_YEAR = 78892314.984

// Duplicates ts-common until its next release; SIMD-0525 moves slot time, never slots per epoch.
export const SLOTS_PER_EPOCH = 432_000

// Duplicates ts-common's epochDurationSecondsFromSlotsPerYear until its next release.
export function epochDurationSeconds({ slotsPerYear }: SlotParams): number {
  assert(slotsPerYear > 0, `epochDurationSeconds: slotsPerYear must be positive, got ${slotsPerYear}`)
  return (SECONDS_PER_YEAR * SLOTS_PER_EPOCH) / slotsPerYear
}
