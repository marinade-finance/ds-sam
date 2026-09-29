import { effectiveCommissions, winningTotalPmpeOf } from '@marinade.finance/ds-sam-calc'

import type { ProtectedEventEstimatesInput } from './estimator'
import type {
  CommissionDetails,
  PastValidatorCommissions,
  RevenueValidatorInput,
  RevShare,
} from '@marinade.finance/ds-sam-calc'

// The part of a public `GET /api/v1/scores/sam` row the adapters read
export type SamScoreRow = {
  epoch: number
  voteAccount: string
  marinadeSamTargetSol: number
  maxStakeWanted: number | null
  revShare: Pick<RevShare, 'inflationPmpe' | 'mevPmpe' | 'totalPmpe' | 'auctionEffectiveBidPmpe'>
  values?: {
    commissions?: Pick<
      CommissionDetails,
      | 'inflationCommissionDec'
      | 'mevCommissionDec'
      | 'inflationCommissionOnchainDec'
      | 'inflationCommissionInBondDec'
      | 'mevCommissionOnchainDec'
      | 'mevCommissionInBondDec'
    >
  }
  metadata?: { scoringId?: string }
}

const runSlot = (row: SamScoreRow): number => Number(row.metadata?.scoringId?.split('.')[1] ?? 0)

// The SDK writes values.commissions.mevCommissionDec as `?? 1`; the same rule tells when it was null
const revenueValidatorFromScore = (row: SamScoreRow): RevenueValidatorInput => {
  const commissions = row.values?.commissions
  const mevUnknown =
    commissions == null ||
    effectiveCommissions(
      commissions.inflationCommissionOnchainDec,
      commissions.inflationCommissionInBondDec,
      commissions.mevCommissionOnchainDec,
      commissions.mevCommissionInBondDec,
    ).mevDec == null
  return {
    voteAccount: row.voteAccount,
    inflationCommissionDec: commissions?.inflationCommissionDec ?? null,
    mevCommissionDec: mevUnknown ? null : commissions.mevCommissionDec,
    maxStakeWanted: row.maxStakeWanted,
    revShare: row.revShare,
  }
}

// validator-bonds evaluates the epoch's highest-slot auction run, so a re-run supersedes the earlier one
export const samRunFromScores = (rows: SamScoreRow[], epoch: number): ProtectedEventEstimatesInput['samRun'] => {
  const epochRows = rows.filter(row => row.epoch === epoch)
  const lastSlot = Math.max(...epochRows.map(runSlot))
  const runRows = epochRows.filter(row => runSlot(row) === lastSlot)
  return {
    winningTotalPmpe: winningTotalPmpeOf(runRows),
    validators: runRows.map(revenueValidatorFromScore),
  }
}

export const pastCommissionsFromScores = (
  rows: SamScoreRow[],
  epoch: number,
): Map<string, PastValidatorCommissions> => {
  const past = new Map<string, PastValidatorCommissions>()
  for (const row of rows) {
    const commissions = row.values?.commissions
    // an unknown applied rate is left out, which charges nothing, as analyze-revenues does without a past snapshot
    if (row.epoch !== epoch || commissions?.inflationCommissionOnchainDec == null) {
      continue
    }
    past.set(row.voteAccount, {
      inflation: commissions.inflationCommissionOnchainDec,
      mev: commissions.mevCommissionOnchainDec ?? null,
    })
  }
  return past
}
