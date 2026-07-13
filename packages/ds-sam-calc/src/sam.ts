import { AuctionConstraintType } from './types'

import type { DsSamConfig } from './config'
import type { AuctionResult, AuctionValidator } from './types'

export const selectInSet = (v: AuctionValidator): boolean => v.auctionStake.marinadeSamTargetSol > 0

export const selectPaidUndelegationSol = (v: AuctionValidator): number => v.values?.paidUndelegationSol ?? 0

export const selectNonBidPmpe = (v: AuctionValidator): number =>
  v.revShare.inflationPmpe + v.revShare.mevPmpe + (v.revShare.blockPmpe ?? 0)

// AugmentedAuctionValidator: AuctionValidator with derived per-validator fields
// pre-computed. expectedStakeChangeSol drives the next-epoch delta display and
// decomposes into three signed components that always sum to it:
//   paidUndelegationSol (≤0)      scheduled undelegation outflow (only when target ≤ active)
//   redelegationInflowSol (≥0)    inflow from the uninvested float (TVL − Σactive)
//   naturalWithdrawalSol (≤0)     rotation outflow (over-target excess, lowest unstakePriority first)
// cutoffRank is the dense position relative to the auction cutoff: 0 = at the
// winning total PMPE, +1 = closest distinct tier above (ties share a rank),
// -1 = closest distinct tier below.
export type AugmentedAuctionValidator = Omit<AuctionValidator, 'values'> & {
  values: NonNullable<AuctionValidator['values']> & {
    expectedStakeChangeSol: number
    expectedStakePaidUndelegationSol: number
    expectedStakeRedelegationInflowSol: number
    expectedStakeNaturalWithdrawalSol: number
    cutoffRank: number
  }
}

type ExpectedStakeChange = {
  total: number
  paidUndelegation: number
  redelegationInflow: number
  naturalWithdrawal: number
}

// Natural redelegation-turnover cap: ~1% of TVL redistributed each epoch.
// Not SDK-exported; maintained here until the SDK exposes it.
const WITHDRAWAL_FRACTION_PER_EPOCH = 0.01

// Paid undelegation (bond risk fee) projection switch. OFF: the protocol
// allocates the 1% rotation budget bottom-up by unstakePriority and does not
// currently prioritise undelegating the paid-undelegation validators, so a
// paid validator at target does not actually lose that stake this epoch.
// Flip to true once the protocol prioritises these undelegations.
const PAID_UNDELEGATION_ENABLED = false

const gatedPaidUndelegationSol = (v: AuctionValidator): number =>
  PAID_UNDELEGATION_ENABLED ? selectPaidUndelegationSol(v) : 0

// 1%-TVL rotation: sorted by unstakePriority asc (lowest prio unstaked first),
// takes each validator's over-target excess until the budget is exhausted.
// Paid undelegation is applied first; the rotation only takes what remains.
function computeNaturalWithdrawal(validators: AuctionValidator[], tvl: number): Map<string, number> {
  const out = new Map<string, number>()
  let remaining = WITHDRAWAL_FRACTION_PER_EPOCH * tvl
  if (remaining <= 0) return out
  const prio = (v: AuctionValidator) => (Number.isFinite(v.unstakePriority) ? v.unstakePriority : Infinity)
  const sorted = [...validators].sort((a, b) => prio(a) - prio(b))
  for (const v of sorted) {
    const paid = gatedPaidUndelegationSol(v)
    const excess = Math.max(0, v.marinadeActivatedStakeSol - paid - v.auctionStake.marinadeSamTargetSol)
    if (excess <= 0) continue
    const take = Math.min(excess, remaining)
    out.set(v.voteAccount, take)
    remaining -= take
    if (remaining <= 0) break
  }
  return out
}

type RedelegationAllocation = {
  greedyInflowSolByVote: Map<string, number>
  // null when the budget covered every below-target winner — no binding frontier.
  priorityFrontierPmpe: number | null
  // Standard competition rank by revShare.totalPmpe desc; ties share the higher position.
  rankByVote: Map<string, number>
  // Lowest-totalPmpe in-set validator; sets winningBidPmpe. null when nobody is in set.
  marginalWinner: AuctionValidator | null
}

// Shared greedy redelegation allocation. The per-validator expected stake
// change, the auction-wide priority frontier, the totalPmpe-desc rank used
// by next-epoch advice, and the marginal-winner reference used by the
// auction APY math all read from this one pass so these four consumers never
// drift apart from each other.
// Validators are walked in descending revShare.totalPmpe order; a validator
// is "fully satisfied" when its entire below-target delta fit before the
// budget was exhausted.
//
// Estimate caveat: this pass does NOT enforce the SDK's concentration caps
// (country / ASO / per-validator / maxStakeWanted) that auction.evaluate()
// applies during stake distribution. The estimate assumes no such cap binds
// for the validator; a capped-out validator will show more inflow / a better
// frontier position here than the SDK would actually grant.
//
// Memoised per AuctionResult identity: called by computeExpectedStakeChanges,
// selectRedelegationPriorityFrontierPmpe, selectRedelegationPriorityRank,
// selectWinningApyForValidator, and computeNextEpochStake — same auction
// would otherwise run the greedy pass once per consumer per detail open.
const allocationCache = new WeakMap<AuctionResult, Map<number, RedelegationAllocation>>()

export function allocateRedelegation(auctionResult: AuctionResult, minBondBalanceSol: number): RedelegationAllocation {
  let byMin = allocationCache.get(auctionResult)
  if (!byMin) {
    byMin = new Map()
    allocationCache.set(auctionResult, byMin)
  }
  const cached = byMin.get(minBondBalanceSol)
  if (cached) return cached

  const validators = auctionResult.auctionData.validators
  const budget = selectRedelegationBudget(auctionResult)
  const rawDelta = (v: AuctionValidator) => v.auctionStake.marinadeSamTargetSol - v.marinadeActivatedStakeSol

  const sorted = [...validators].sort((va, vb) => (vb.revShare.totalPmpe ?? 0) - (va.revShare.totalPmpe ?? 0))
  const greedyInflowSolByVote = new Map<string, number>()
  const rankByVote = new Map<string, number>()
  let priorityFrontierPmpe: number | null = null
  let marginalWinner: AuctionValidator | null = null
  let prevPmpe: number | null = null
  let groupRank = 0
  let remaining = budget
  sorted.forEach((v, i) => {
    const pmpe = v.revShare.totalPmpe ?? 0
    if (pmpe !== prevPmpe) {
      groupRank = i + 1
      prevPmpe = pmpe
    }
    rankByVote.set(v.voteAccount, groupRank)
    if (v.auctionStake.marinadeSamTargetSol > 0) {
      marginalWinner = v
    }
    const belowMin = (v.bondBalanceSol ?? 0) < minBondBalanceSol
    if (budget > 0 && !belowMin) {
      const delta = rawDelta(v)
      if (delta > 0 && remaining > 0) {
        const alloc = Math.min(delta, remaining)
        greedyInflowSolByVote.set(v.voteAccount, (greedyInflowSolByVote.get(v.voteAccount) ?? 0) + alloc)
        remaining -= alloc
        if (alloc >= delta) {
          priorityFrontierPmpe = pmpe
        }
      }
    }
  })
  const result = {
    greedyInflowSolByVote,
    priorityFrontierPmpe,
    rankByVote,
    marginalWinner,
  }
  byMin.set(minBondBalanceSol, result)
  return result
}

// paidUndelegation = SDK's paidUndelegationSol (positive magnitude): bond risk
// fee charged by undelegating stake. Only non-zero when target ≤ active —
// when target > active the validator is receiving stake, not losing it.
// target < active: capped at active−target so stake never projects below target.
// target == active: shown in full as a negative; no rotation inflow offsets it.
// Sub-min-bond validators lose all stake and are excluded from inflow/rotation.
// Gated by PAID_UNDELEGATION_ENABLED — off by default, so paid resolves to 0
// and this branch is inert until the protocol prioritises these undelegations.
function computeExpectedStakeChanges(
  auctionResult: AuctionResult,
  minBondBalanceSol: number,
): Map<string, ExpectedStakeChange> {
  const validators = auctionResult.auctionData.validators
  const tvl = auctionResult.auctionData.stakeAmounts.marinadeSamTvlSol
  const bondBelowMin = (v: AuctionValidator) => (v.bondBalanceSol ?? 0) < minBondBalanceSol
  const result = new Map<string, ExpectedStakeChange>()
  const get = (va: string): ExpectedStakeChange => {
    let entry = result.get(va)
    if (!entry) {
      entry = {
        total: 0,
        paidUndelegation: 0,
        redelegationInflow: 0,
        naturalWithdrawal: 0,
      }
      result.set(va, entry)
    }
    return entry
  }

  for (const validator of validators) {
    if (bondBelowMin(validator)) {
      const entry = get(validator.voteAccount)
      entry.paidUndelegation = -validator.marinadeActivatedStakeSol
      entry.total = -validator.marinadeActivatedStakeSol
      continue
    }
    const paid = gatedPaidUndelegationSol(validator)
    if (paid > 0) {
      const entry = get(validator.voteAccount)
      if (validator.auctionStake.marinadeSamTargetSol < validator.marinadeActivatedStakeSol) {
        // Cap at active−target so the projected stake never undershoots target.
        const maxUndel = validator.marinadeActivatedStakeSol - validator.auctionStake.marinadeSamTargetSol
        const capped = Math.min(paid, maxUndel)
        entry.paidUndelegation = -capped
        entry.total += -capped
      } else {
        // target >= active: no rotation inflow (rawDelta = target - active ≤ 0).
        // paidUndelegation can only be non-zero when target == active (fee charged
        // while at target); show it in full so the net expected change is correct.
        entry.paidUndelegation = -paid
        entry.total += -paid
      }
    }
  }

  const byVote = new Map(validators.map(v => [v.voteAccount, v] as const))

  const { greedyInflowSolByVote } = allocateRedelegation(auctionResult, minBondBalanceSol)
  for (const [va, alloc] of greedyInflowSolByVote) {
    const validator = byVote.get(va)
    if (validator && bondBelowMin(validator)) continue
    const entry = get(va)
    entry.redelegationInflow += alloc
    entry.total += alloc
  }

  const withdrawals = computeNaturalWithdrawal(
    validators.filter(v => !bondBelowMin(v)),
    tvl,
  )
  for (const [va, w] of withdrawals) {
    const validator = byVote.get(va)
    if (validator && bondBelowMin(validator)) continue
    const entry = get(va)
    entry.naturalWithdrawal -= w
    entry.total -= w
  }

  return result
}

// Memoised per AuctionResult identity. minBondBalanceSol comes from DsSamConfig
// (stable across the lifetime of a loaded auction), so reusing the prior
// computation when it matches avoids a per-render rebuild from sam-table.
const augmentCache = new WeakMap<AuctionResult, { minBondBalanceSol: number; result: AugmentedAuctionValidator[] }>()

export function augmentAuctionResult(
  auctionResult: AuctionResult,
  minBondBalanceSol: number,
): AugmentedAuctionValidator[] {
  const cached = augmentCache.get(auctionResult)
  if (cached && cached.minBondBalanceSol === minBondBalanceSol) return cached.result
  const validators = auctionResult.auctionData.validators
  const changes = computeExpectedStakeChanges(auctionResult, minBondBalanceSol)
  // Dense rank around the winning total PMPE: ties share a position, the
  // marginal winner sits at 0. Above-cutoff is +1 (closest tier above), below
  // is -1 (closest tier below). Ranking by totalPmpe (not maxApy) avoids the
  // epochs-per-year wobble — the auction clears on totalPmpe directly.
  const eps = 1e-9
  const win = auctionResult.winningTotalPmpe
  const pmpes = validators.map(v => v.revShare.totalPmpe)
  const above = [...new Set(pmpes.filter(p => p > win + eps))].sort((a, b) => a - b)
  const below = [...new Set(pmpes.filter(p => p < win - eps))].sort((a, b) => b - a)
  const aboveRank = new Map<number, number>()
  above.forEach((p, i) => aboveRank.set(p, 1 + i))
  const belowRank = new Map<number, number>()
  below.forEach((p, i) => belowRank.set(p, -1 - i))
  const cutoffRanks = new Map<string, number>()
  for (const v of validators) {
    const p = v.revShare.totalPmpe
    const rank = Math.abs(p - win) < eps ? 0 : p > win ? (aboveRank.get(p) ?? 0) : (belowRank.get(p) ?? 0)
    cutoffRanks.set(v.voteAccount, rank)
  }

  const result = validators.map(validator => {
    const change = changes.get(validator.voteAccount)
    return {
      ...validator,
      values: {
        ...validator.values,
        expectedStakeChangeSol: change?.total ?? 0,
        expectedStakePaidUndelegationSol: change?.paidUndelegation ?? 0,
        expectedStakeRedelegationInflowSol: change?.redelegationInflow ?? 0,
        expectedStakeNaturalWithdrawalSol: change?.naturalWithdrawal ?? 0,
        cutoffRank: cutoffRanks.get(validator.voteAccount) ?? 0,
      },
    }
  })
  augmentCache.set(auctionResult, { minBondBalanceSol, result })
  return result
}

export const selectExpectedStakeChange = (v: AuctionValidator): number =>
  (v as AugmentedAuctionValidator).values?.expectedStakeChangeSol ?? 0

export type ExpectedStakeChangeBreakdown = Omit<ExpectedStakeChange, 'total'>

export const selectExpectedStakeChangeBreakdown = (v: AugmentedAuctionValidator): ExpectedStakeChangeBreakdown => ({
  paidUndelegation: v.values.expectedStakePaidUndelegationSol,
  redelegationInflow: v.values.expectedStakeRedelegationInflowSol,
  naturalWithdrawal: v.values.expectedStakeNaturalWithdrawalSol,
})

export const selectCutoffRank = (v: AugmentedAuctionValidator): number => v.values.cutoffRank

export type ConcentrationContext = {
  // The validator's own country / ASO group.
  label: string
  // The group's share of the auction's total SAM target stake (0..1).
  pctOfTotal: number
  // Configured concentration cap for this constraint (0..1).
  capPct: number
  // How many validators fall in this group.
  groupValidatorCount: number
  // True when THIS validator's binding cap is this exact country / ASO.
  thisValidatorCapped: boolean
}

export type ValidatorConcentration = {
  country: ConcentrationContext
  aso: ConcentrationContext
}

// Per-validator concentration context: for the validator's own country and
// ASO, how much of the auction's SAM target stake that group already holds
// versus the configured cap, and whether this validator is itself capped by
// that constraint. Surfaced in the detail panel so the country / ASO limits
// stay inspectable per validator after the headline concentration tiles were
// removed. null when the validator is not in the auction set.
export const selectValidatorConcentration = (
  auctionResult: AuctionResult,
  config: DsSamConfig,
  voteAccount: string,
): ValidatorConcentration | null => {
  const validators = auctionResult.auctionData.validators
  const self = validators.find(v => v.voteAccount === voteAccount)
  if (!self) return null

  const context = (
    pick: (v: AuctionValidator) => string,
    capType: AuctionConstraintType,
    capPct: number,
  ): ConcentrationContext => {
    const key = pick(self) || '—'
    let groupStake = 0
    let total = 0
    let groupValidatorCount = 0
    for (const v of validators) {
      const stakeSol = v.auctionStake.marinadeSamTargetSol
      if (stakeSol <= 0) continue
      total += stakeSol
      if ((pick(v) || '—') === key) {
        groupStake += stakeSol
        groupValidatorCount += 1
      }
    }
    return {
      label: key,
      pctOfTotal: total > 0 ? groupStake / total : 0,
      capPct,
      groupValidatorCount,
      // Match the SDK's raw constraintName (not the '—' display fallback), so
      // an empty-named country/ASO still resolves its at-cap state correctly.
      thisValidatorCapped:
        self.lastCapConstraint?.constraintType === capType && self.lastCapConstraint.constraintName === pick(self),
    }
  }

  return {
    country: context(v => v.country, AuctionConstraintType.COUNTRY, config.maxNetworkStakeConcentrationPerCountryDec),
    aso: context(v => v.aso, AuctionConstraintType.ASO, config.maxNetworkStakeConcentrationPerAsoDec),
  }
}

// Budget for next-epoch re-delegation: TVL − Σ active is the pool stake
// already liquid in the reserve, free to (re)delegate without waiting for
// any cooldown. Natural withdrawals exit the pool to redeemers, not budget.
export function selectRedelegationBudget(auctionResult: AuctionResult): number {
  const validators = auctionResult.auctionData.validators
  const tvl = auctionResult.auctionData.stakeAmounts.marinadeSamTvlSol
  const activeTotal = validators.reduce((s, v) => s + v.marinadeActivatedStakeSol, 0)
  return Math.max(0, tvl - activeTotal)
}

// Lowest revShare.totalPmpe among winners that got their full below-target
// delta from this run's greedy redelegation. A validator wanting guaranteed
// priority inflow next epoch must clear this. Returns 0 when the budget
// reached everyone (or there was none / no below-target winner) — there is
// no binding frontier, any in-set validator is already served.
export function selectRedelegationPriorityFrontierPmpe(
  auctionResult: AuctionResult,
  minBondBalanceSol: number,
): number {
  return allocateRedelegation(auctionResult, minBondBalanceSol).priorityFrontierPmpe ?? 0
}

// 1-based position of this validator in the exact order the redelegation
// budget is handed out: revShare.totalPmpe descending — the same sort key
// the greedy pass uses. Ties share the higher position. This is the true
// delegation-priority rank, not the maxApy-derived sam-table rank; the
// greedy pass orders strictly on totalPmpe, so this is the rank that
// decides whether the budget reaches you before it runs dry.
export function selectRedelegationPriorityRank(
  v: AuctionValidator,
  auctionResult: AuctionResult,
  minBondBalanceSol: number,
): number | null {
  return allocateRedelegation(auctionResult, minBondBalanceSol).rankByVote.get(v.voteAccount) ?? null
}
