import { SECONDS_PER_YEAR } from '@marinade.finance/ts-common'

export { LAMPORTS_PER_SOL } from '@marinade.finance/ts-common'

// Agave's pre-SIMD-0525 nominal, only ever a fallback for inputs cached before the API published it.
export const BASELINE_SLOTS_PER_YEAR = SECONDS_PER_YEAR / 0.4
