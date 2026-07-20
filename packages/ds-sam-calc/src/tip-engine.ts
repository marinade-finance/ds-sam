import { assertNever } from '@marinade.finance/ts-common'

import { blacklistPenaltySol, computeBidPenalty } from './bid-penalty'
import { computeBondCoverage } from './bond-coverage'
import { bondHealthFromAuction } from './bond-health'
import { bondSol, pay, stake, topUp } from './format'
import { selectInSet } from './sam'
import { AuctionConstraintType } from './types'

import type { BondCoverage } from './bond-coverage'
import type { BondHealthState } from './bond-health'
import type { CardStatusSeverity } from './card-status'
import type { DsSamConfig } from './config'
import type { AugmentedAuctionValidator } from './sam'

export type TipUrgency = 'critical' | 'warning' | 'info' | 'positive' | 'neutral'
export type TipConstraint = 'rank' | 'bond' | 'bid' | 'cap' | 'none'

export interface ValidatorTip {
  text: string
  urgency: TipUrgency
  constraint: TipConstraint
  // True only for the single most-severe state: an estimated bond risk fee
  // this epoch. Drives the alert glyph (and pulse) — never set for plain
  // below-min / no-bond, which stay critical-red without the escalation.
  alert?: boolean
  // Compact status label for the dense sam-table Next Step column, when the
  // full `text` sentence would over-state a calm, EXPECTED state. Set only by
  // bidCta for the non-defending out-of-set-below-winning row ("Bid below
  // winning price."); its presence is also the signal to render that row
  // muted. `text` keeps the full CTA for the detail panel. The engine owns
  // this string — the table must never re-derive it from in-set state.
  chip?: string
  // Signed next-epoch stake delta. Only meaningful when constraint === 'none';
  // that's the sole case whose glyph is allowed to be directional.
  delta: number
}

// SINGLE canonical source for every bond-state CTA string. The sam-table
// Next Step pill, the validator-detail header tip and the Bond breakdown
// status banner all surface THIS text byte-for-byte for a given state —
// never an independent re-wording. Each line is one short clause, sentence
// case, no parentheses, and carries the decisive value (the SOL top-up /
// minimum, or the fee figure when no top-up applies). `severity` is the
// critical/warning/good axis the breakdown banner uses; `urgency` is
// the tip-pill axis. They agree by construction.
export type BondAdvice = {
  text: string
  urgency: TipUrgency
  severity: CardStatusSeverity
}

// Two thresholds for the severity ladder, hoisted so bondAdvice can also
// use NON_TRIVIAL_STAKE_SOL:
//   NON_TRIVIAL_STAKE_SOL — validator HAS real stake (atRisk gate). 10k
//     is the practical "real validator vs novelty" line on Solana.
//   NON_TRIVIAL_LOSS_SOL — validator IS LOSING meaningful stake this
//     epoch (defend-lever gate). 1k is small enough to flag any
//     non-noise outflow, large enough to ignore rounding/cooldown jitter.
export const NON_TRIVIAL_STAKE_SOL = 10_000
export const NON_TRIVIAL_LOSS_SOL = 1_000

export function bondAdvice(
  coverage: BondCoverage,
  health: BondHealthState,
  bondRiskFeeSol: number,
  minBondBalanceSol: number,
  bondBalanceSol: number,
  marinadeActivatedStakeSol: number,
): BondAdvice {
  // Below the SDK minimum. Checked before the health switch so a below-min
  // bond in any tier gets the actionable wording.
  if (bondBalanceSol < minBondBalanceSol && health !== 'no-bond') {
    // Below-min without a pending fee — grey (informational, no stake at risk).
    const isCharging = bondRiskFeeSol > 0
    return {
      text: `Top up bond to ${bondSol(minBondBalanceSol)} to grow stake.`,
      urgency: isCharging ? 'critical' : 'neutral',
      severity: isCharging ? 'critical' : 'neutral',
    }
  }
  switch (health) {
    case 'no-bond': {
      // Novelty validators (active < 10k SOL) are effectively outside the
      // auction already — surface the CTA muted/grey. Only escalate to red
      // when there's real stake at risk of being pulled.
      const hasRealStake = marinadeActivatedStakeSol > NON_TRIVIAL_STAKE_SOL
      return {
        text: `Post a bond of ${bondSol(minBondBalanceSol)} to win stake.`,
        urgency: hasRealStake ? 'critical' : 'neutral',
        severity: hasRealStake ? 'critical' : 'neutral',
      }
    }
    case 'critical': {
      // Fee is actually being charged OR bond is already below the penalty
      // threshold → red/critical. Runway-only CRITICAL (no fee, above
      // threshold) → yellow/warning: the fee is approaching but not here yet.
      if (bondRiskFeeSol > 0) {
        const text =
          coverage.bondRiskFeeShortfall > 0
            ? `Top up ${topUp(coverage.bondRiskFeeShortfall)} or pay ${pay(bondRiskFeeSol)} bond fee.`
            : `Bond fee ${pay(bondRiskFeeSol)} estimated next epoch.`
        return { text, urgency: 'critical', severity: 'critical' }
      }
      if (coverage.bondRiskFeeShortfall > 0) {
        return {
          text: `Top up ${topUp(coverage.bondRiskFeeShortfall)} to avoid bond liquidation.`,
          urgency: 'critical',
          severity: 'critical',
        }
      }
      // Runway ≤ minBondEpochs + BOND_URGENT_EPOCHS: no fee yet but runway
      // is critically short. Show the keep-stake amount if available,
      // then the ideal top-up, otherwise a generic runway warning.
      if (coverage.topUpToKeepStake > 0) {
        return {
          text: `Top up ${topUp(coverage.topUpToKeepStake)} to keep stake.`,
          urgency: 'critical',
          severity: 'critical',
        }
      }
      if (coverage.topUpToIdealKeep > 0) {
        return {
          text: `Top up ${topUp(coverage.topUpToIdealKeep)} to extend runway.`,
          urgency: 'warning',
          severity: 'warning',
        }
      }
      return {
        text: 'Top up bond to extend runway.',
        urgency: 'warning',
        severity: 'warning',
      }
    }
    case 'watch': {
      if (coverage.topUpToKeepStake > 0) {
        return {
          text: `Top up ${topUp(coverage.topUpToKeepStake)} to keep stake.`,
          urgency: 'warning',
          severity: 'warning',
        }
      }
      if (coverage.topUpToIdealKeep > 0) {
        return {
          text: `Top up ${topUp(coverage.topUpToIdealKeep)} to grow stake.`,
          urgency: 'info',
          severity: 'warning',
        }
      }
      return {
        text: 'Top up bond to extend runway.',
        urgency: 'info',
        severity: 'warning',
      }
    }
    case 'healthy':
      return {
        text: 'Bond has enough coverage.',
        urgency: 'positive',
        severity: 'good',
      }
    default:
      return assertNever(health)
  }
}

// One CTA source per LEVER. Each helper owns its lever's wording and
// urgency end-to-end; getValidatorTip just picks the highest-severity
// candidate (with lever priority breaking ties). VISUALS.md doctrine:
// color = severity, glyph = lever — keep them orthogonal at the source.

export const SEVERITY_ORDER: Record<TipUrgency, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
  neutral: 4,
}
// Tiebreak at the same severity. Bond first (most actionable, hardest
// block), then bid/rank (same lever — raise the bid), then cap, then
// external block (samBlocked / blacklist), then none (the delta fallback).
export const LEVER_ORDER: Record<TipConstraint, number> = {
  bond: 0,
  bid: 1,
  rank: 1,
  cap: 2,
  none: 3,
}

function tip(
  text: string,
  urgency: TipUrgency,
  constraint: TipConstraint,
  delta: number,
  alert?: boolean,
  chip?: string,
): ValidatorTip {
  const built: ValidatorTip = { text, urgency, constraint, delta }
  if (alert) {
    built.alert = true
  }
  if (chip != null) {
    built.chip = chip
  }
  return built
}

// Callers must include at least one non-null candidate (in practice the
// always-non-null deltaCta sits at the tail). The signature relies on
// that — if every candidate is null, indexing into the empty array would
// return `undefined` and the cast would mask it.
function selectTip(...candidates: [...(ValidatorTip | null)[], ValidatorTip]): ValidatorTip {
  const live = candidates.filter((c): c is ValidatorTip => c !== null)
  live.sort(
    (a, b) =>
      SEVERITY_ORDER[a.urgency] - SEVERITY_ORDER[b.urgency] || LEVER_ORDER[a.constraint] - LEVER_ORDER[b.constraint],
  )
  const best = live[0]
  if (!best) {
    throw new Error('selectTip requires at least one non-null candidate')
  }
  return best
}

// Bond lever. Out-of-set + below-min is a hard block on the bond axis
// (clipBondStakeCap → 0); in-set unhealthy bond gets the canonical
// bondAdvice() text. Returns null when the bond is not the lever to pull
// (out-of-set with bond OK, in-set with healthy bond, or the soft-bond +
// gaining-stake exception — see comment below).
function bondCta(
  validator: AugmentedAuctionValidator,
  dsSamConfig: DsSamConfig,
  winningTotalPmpe: number,
  delta: number,
  precomputedCoverage?: BondCoverage,
): ValidatorTip | null {
  const bondBalance = validator.bondBalanceSol ?? 0
  const bondRiskFeeSol = validator.values.bondRiskFeeSol
  const coverage = precomputedCoverage ?? computeBondCoverage(validator, dsSamConfig, winningTotalPmpe)

  // Below-min: the SDK qualification gate (clipBondStakeCap → 0). Only
  // realistic for out-of-set validators (in-set with sub-min is impossible).
  // Wording carries the "qualify" / "re-qualify" framing the in-set CTA
  // doesn't need.
  if (bondBalance < dsSamConfig.minBondBalanceSol) {
    if (bondRiskFeeSol > 0) {
      // Need to clear both the penalty shortfall and the below-min block.
      const topUpAmt = Math.max(coverage.bondRiskFeeShortfall, dsSamConfig.minBondBalanceSol - bondBalance)
      return tip(`Top up ${topUp(topUpAmt)} or pay ${pay(bondRiskFeeSol)} bond fee.`, 'critical', 'bond', delta, true)
    }
    // Below-min, no SDK fee yet. The bond is a hard qualification gate, but
    // posting it only grows stake when the validator's price already clears
    // winning; if it's also below the winning price, the bond alone won't win
    // it any stake, so the honest headline is the loss (deltaCta's "Losing N
    // SOL"). Only escalate to warning — outranking the loss on the bond-lever
    // tiebreak — when the bond is the SOLE blocker; otherwise stay neutral and
    // let the loss show, so a big loser isn't handed a milder message than a
    // validator shedding a few SOL.
    const bondIsSoleBlocker = validator.revShare.totalPmpe >= winningTotalPmpe
    return tip(
      bondBalance <= 0
        ? `Post a bond of ${bondSol(dsSamConfig.minBondBalanceSol)} to grow stake.`
        : `Top up bond to ${bondSol(dsSamConfig.minBondBalanceSol)} to grow stake.`,
      bondIsSoleBlocker && isDefending(validator, delta) ? 'warning' : 'neutral',
      'bond',
      delta,
    )
  }

  // Above-min: emit the unhealthy-bond CTA via bondAdvice. CRITICAL (fee
  // imminent) fires for in-set OR out-of-set — the fee is bond-driven, not
  // rank-driven, so the alert can't be masked by out-of-set status. WATCH
  // gates on in-set (when target=0 the stake is leaving regardless of bond)
  // and defers when delta>0 (inflow is already arriving — bond advice at
  // INFO would be drowned out by the positive message).
  const inSet = selectInSet(validator)
  const health = bondHealthFromAuction(validator, dsSamConfig, winningTotalPmpe, coverage)
  // 'watch' implies runway > minBondEpochs + BOND_URGENT_EPOCHS, so any 'watch'
  // validator is already above the fee threshold.
  const fires = health === 'critical' || (inSet && health === 'watch' && (coverage.topUpToKeepStake > 0 || delta <= 0))
  // Healthy runway is measured against an already bond-clamped target, so a bond-capped winner can still need a top-up — defer to bondGrowthCta.
  if (!fires) {
    return inSet ? bondGrowthCta(validator, dsSamConfig.minMaxStakeWanted, delta) : null
  }
  // WATCH + no keep-shortfall + defending: the "grow stake" advisory fires at
  // INFO, which selectTip ranks below deltaCta's WARNING. Escalate to WARNING
  // so the actionable bond advice beats the symptom message.
  if (health === 'watch' && coverage.topUpToKeepStake === 0 && isDefending(validator, delta)) {
    const topUpAmt = coverage.topUpToIdealKeep
    return tip(
      topUpAmt > 0 ? `Top up ${topUp(topUpAmt)} to keep stake.` : 'Top up bond to keep stake.',
      'warning',
      'bond',
      delta,
    )
  }
  const advice = bondAdvice(
    coverage,
    health,
    bondRiskFeeSol,
    dsSamConfig.minBondBalanceSol,
    bondBalance,
    validator.marinadeActivatedStakeSol,
  )
  // Use bondAdvice's urgency as the canonical source — same severity the
  // breakdown banner uses. Alert (octagon) ONLY when a fee is actually
  // charged this epoch.
  return tip(advice.text, advice.urgency, 'bond', delta, health === 'critical' && bondRiskFeeSol > 0)
}

// Bid lever. Two triggers — bid-too-low penalty (critical) and
// out-of-set bid-too-low (warning) — checked independently so the
// more-urgent CTA always wins under severity sort. A validator that
// dropped their bid hard can simultaneously be out-of-set AND penalised;
// nesting the penalty check inside the in-set branch would let the rank
// warning mask the critical penalty. Uses computeBidPenalty so the CTA,
// the bid-penalty breakdown headline, and the Payments tab's penalty
// row all quote the same SOL figure — and so simulation updates them
// together.
function bidCta(
  validator: AugmentedAuctionValidator,
  dsSamConfig: DsSamConfig,
  winningTotalPmpe: number,
  delta: number,
): ValidatorTip | null {
  const metrics = computeBidPenalty(validator, dsSamConfig, winningTotalPmpe)
  if (metrics.penaltyPmpe > 0) {
    return tip(`Raise bid or pay a ${pay(metrics.penaltySol)} penalty.`, 'critical', 'bid', delta, true)
  }
  // No penalty — out-of-set with an adequate bond becomes the rank CTA,
  // BUT only when the bid is actually the problem. A validator can be
  // out-of-set with a totalPmpe well above the winning total because a
  // country/ASO/validator cap binds, or because they're sam-blocked. In
  // those cases telling them to raise the bid is a lie — defer to capCta
  // (or stay silent).
  if (
    !selectInSet(validator) &&
    (validator.bondBalanceSol ?? 0) >= dsSamConfig.minBondBalanceSol &&
    validator.revShare.totalPmpe < winningTotalPmpe
  ) {
    // Bid too low — growth lever in general (raise the bid → qualify),
    // escalates to defend lever (yellow) when meaningful stake is leaving
    // so it outranks the generic "Losing N" delta narrative. The calm
    // (non-defending) case also carries the compact "Bid below winning
    // price." chip the dense table renders muted; a defending row drops the
    // chip so it keeps its warning colour and full CTA and actually stands
    // out instead of hiding in the muted below-cutoff block.
    const defending = isDefending(validator, delta)
    return tip(
      'Raise bid to qualify for stake.',
      defending ? 'warning' : 'info',
      'rank',
      delta,
      undefined,
      defending ? undefined : 'Bid below winning price.',
    )
  }
  return null
}

function capCauseLine(type: AuctionConstraintType | undefined, name: string | undefined): string {
  switch (type) {
    case AuctionConstraintType.COUNTRY:
      return `${name ?? 'Country'} at country cap`
    case AuctionConstraintType.ASO:
      return `${name ?? 'ASO'} at ASO cap`
    case AuctionConstraintType.VALIDATOR:
      return 'At per-validator cap'
    case AuctionConstraintType.WANT:
      return 'At your `maxStakeWanted` setting'
    default:
      return 'At a concentration cap'
  }
}

// Defend-lever predicate: a real validator is actively losing meaningful
// stake this epoch. Single source so the 5 CTA branches that gate WARNING
// vs INFO/NEUTRAL don't drift apart.
function isDefending(validator: AugmentedAuctionValidator, delta: number): boolean {
  return (validator.marinadeActivatedStakeSol ?? 0) > NON_TRIVIAL_STAKE_SOL && delta < -NON_TRIVIAL_LOSS_SOL
}

// Bond (not bid) is the growth lever when the auction clamps an in-set winner's target to the bond ceiling below their maxStakeWanted; runs from bondCta's healthy path so its 'bond'/info CTA outranks deltaCta's "raise bid" on the LEVER_ORDER tiebreak.
function bondGrowthCta(
  validator: AugmentedAuctionValidator,
  minMaxStakeWanted: number | null,
  delta: number,
): ValidatorTip | null {
  const target = validator.auctionStake.marinadeSamTargetSol
  const maxBond = validator.maxBondDelegation
  const bondCap = validator.bondSamStakeCapSol
  // Fire only when the bond cap — not the TVL cap or maxStakeWanted — is what holds target below what the validator wants.
  if (!(target > 0) || !Number.isFinite(maxBond) || maxBond <= 0) {
    return null
  }
  if (target < maxBond * 0.99) {
    return null
  }
  if (!Number.isFinite(bondCap) || bondCap > maxBond + 1e-6) {
    return null
  }
  const wanted = validator.maxStakeWanted
  // null maxStakeWanted = no self-imposed ceiling (treated as +Infinity); a set one is floored by minMaxStakeWanted, matching deltaCta.
  const wantedCeiling =
    wanted != null && wanted > 0 ? Math.max(minMaxStakeWanted ?? 0, wanted) : Number.POSITIVE_INFINITY
  if (wantedCeiling <= maxBond + 1e-6) {
    return null
  }
  return tip(
    wanted != null && wanted > 0 ? 'Top up bond to reach your `maxStakeWanted`.' : 'Top up bond to grow stake.',
    'info',
    'bond',
    delta,
  )
}

// Out-of-set despite a high enough totalPmpe. The bid isn't the lever —
// some other constraint binds. Names the actual reason so the user knows
// what to investigate (or accept) instead of seeing the deltaCta's
// misleading "Losing N SOL" symptom.
//
// Reasons in priority order (most specific first):
//   - samBlocked: hard block during auction (penalty escalation, etc.)
//   - maxStakeWanted === 0: validator opted out of stake entirely
//   - samEligible === false: failed pre-auction gate — narrowed down by
//     inspecting bondBalanceSol / blacklist where we can; falls back to
//     a "check the usual suspects" hint otherwise
//   - lastCapConstraint binding: concentration / want cap
//   - default: generic "constraint binds, investigate"
//
// Severity tracks ACTIVE STAKE — > 10k means real stake at risk so the
// tip goes critical-red; otherwise grey/neutral.
function outOfSetCta(
  validator: AugmentedAuctionValidator,
  winningTotalPmpe: number,
  delta: number,
  blacklist?: Set<string>,
): ValidatorTip | null {
  if (selectInSet(validator)) {
    return null
  }
  // Bid actually is the lever to pull → let bidCta own the message.
  if (validator.revShare.totalPmpe < winningTotalPmpe) {
    return null
  }

  // Severity ladder, applied throughout this function:
  //   red    — a real penalty is charged this epoch. Set tip.alert so the
  //            pill swaps to the octagon glyph.
  //   yellow — meaningful active stake is leaving (no penalty yet — "don't
  //            lose stake"). Gated on both atRisk AND non-trivial delta.
  //   violet — growth lever available ("get more stake" if you act).
  //   grey   — user's own choice / informational.
  const defending = isDefending(validator, delta)

  if (validator.samBlocked) {
    // Testing-only state — production traffic shouldn't reach here. Kept
    // red + octagon as a loud "this should never ship live" signal; not
    // worth the conditional-severity logic the other branches need.
    return tip('Blocked from SAM this epoch.', 'critical', 'none', delta, true)
  }

  // Gate on === false so an undefined samEligible (SDK pre-auction state)
  // doesn't route through the "not eligible" fallback by accident.
  if (validator.samEligible === false) {
    // Narrow the eligibility failure to the most actionable specific cause
    // we can detect from data we have. Bond + blacklist are cheap checks;
    // client-version semver matching and per-epoch vote-credit thresholds
    // need the SDK's internal computation — fall through to a hint that
    // names the remaining suspects.
    if (blacklist?.has(validator.voteAccount)) {
      // Red ONLY when the blacklist penalty is actively charging this
      // epoch (revShare.blacklistPenaltyPmpe > 0) — real money, octagon.
      // Otherwise it's informational ("flagged but no charge this epoch")
      // and stays grey regardless of stake size.
      const penaltyPmpe = validator.revShare.blacklistPenaltyPmpe ?? 0
      if (penaltyPmpe > 0) {
        const penaltySol = blacklistPenaltySol(validator)
        return tip(`Blacklisted — ${pay(penaltySol)} penalty this epoch.`, 'critical', 'none', delta, true)
      }
      // Yellow when defending so this message outranks deltaCta's symptom.
      return tip('Blacklisted.', defending ? 'warning' : 'neutral', 'none', delta)
    }
    // Growth lever — fix the eligibility checks and you can qualify.
    // Escalate to yellow when defending so this names the cause instead of
    // letting deltaCta's "Losing N SOL" win the severity sort.
    return tip('Not eligible — check client version and vote credits.', defending ? 'warning' : 'info', 'none', delta)
  }
  const cap = validator.lastCapConstraint
  if (cap && cap.totalLeftToCapSol === 0) {
    // WANT cap = user-set → grey (their choice).
    // Other caps: yellow when stake is actively leaving in meaningful
    // amounts, else violet (informational, no immediate loss).
    const capUrgency = cap.constraintType === AuctionConstraintType.WANT ? 'neutral' : defending ? 'warning' : 'info'
    return tip(`${capCauseLine(cap.constraintType, cap.constraintName)}.`, capUrgency, 'cap', delta)
  }
  return null
}

// Cap lever. In-set + losing stake + a binding concentration cap
// (totalLeftToCapSol === 0). Non-actionable explanation — the validator
// can't unilaterally clear an ASO/country cap. Urgency:info keeps the
// chip distinct from warning-yellow (which implies "act"); cap outranks
// the generic delta-losing message via mutual exclusion in deltaCta, not
// by lying about urgency.
function capCta(validator: AugmentedAuctionValidator, delta: number): ValidatorTip | null {
  const cap = validator.lastCapConstraint
  // Fire for delta <= 0: losing stake (delta < 0) or blocked from growing
  // (delta === 0) by a binding cap. Skip when delta > 0 — stake is arriving,
  // cap is not the constraint this epoch.
  if (delta > 0 || cap == null || cap.totalLeftToCapSol !== 0) {
    return null
  }
  // Severity follows the global ladder:
  //   grey   — WANT cap (user-set).
  //   yellow — other cap AND defending (meaningful stake leaving).
  //   violet — other cap, no meaningful loss (informational).
  const urgency =
    cap.constraintType === AuctionConstraintType.WANT ? 'neutral' : isDefending(validator, delta) ? 'warning' : 'info'
  const cause = capCauseLine(cap.constraintType, cap.constraintName)
  // Two-line when actively losing stake; single line when just blocked.
  const text =
    delta < 0
      ? `${cause}\nLosing ${stake(Math.abs(delta))} until cap frees.`
      : `${cause} — stake can't grow until cap frees.`
  return tip(text, urgency, 'cap', delta)
}

// Single string for "in-set, above winning, bid still below the priority
// frontier" — deltaCta hits this from two different delta states (see
// below) and used to word it differently per branch even though it's the
// same situation and the same fix (raise the bid).
const RAISE_TO_GROW = 'Raise bid to grow stake next epoch.'

// Delta lever — the "stake trajectory" fallback. Always emits something
// for in-set validators except when the cap lever explains the loss
// (mutual exclusion at source so we don't have to lie with urgency).
function deltaCta(
  validator: AugmentedAuctionValidator,
  delta: number,
  capBinding: boolean,
  priorityFrontierPmpe = 0,
  minMaxStakeWanted: number | null = null,
): ValidatorTip {
  const wanted = validator.maxStakeWanted
  const target = validator.auctionStake.marinadeSamTargetSol
  const active = validator.marinadeActivatedStakeSol
  // The validator's own cap binds ONLY when their setting is the value the
  // auction actually clips to: max(minMaxStakeWanted, wanted). A setting
  // below minMaxStakeWanted is silently raised to it (SDK
  // buildSamWantConstraints), so "at your setting" would be a lie — a 7k
  // request under a 10k floor lands at 10k. The cap can now pull target below
  // current stake (SUP-188), so activated stake is not part of the floor.
  const wantFloor = minMaxStakeWanted ?? 0
  const atOwnCap = wanted != null && wanted > 0 && wanted >= wantFloor && target >= wanted - 1e-9
  if (delta > 0) {
    // Validator is receiving scraps from leftover budget — below the priority
    // frontier. Raising bid to clear the frontier gets them full allocation.
    if (priorityFrontierPmpe > 0 && validator.revShare.totalPmpe < priorityFrontierPmpe) {
      return tip(RAISE_TO_GROW, 'info', 'rank', delta)
    }
    return tip(`${stake(delta)} arriving next epoch.`, 'positive', 'none', delta)
  }
  // delta < 0 with a binding cap: cap owns the narrative — surface 'at
  // target' so cap (info) isn't beaten by losing (warning). atOwnCap also
  // covers the SUP-188 rebalance-down case (delta < 0 as the WANT cap pulls
  // target below current stake): the loss is self-inflicted, so stay neutral.
  if (delta === 0 || capBinding || atOwnCap) {
    // Three flavours of "delta=0":
    //   a) at validator's own max-stake-wanted cap (their lever)
    //   b) active ≈ target — really at the SAM-assigned target
    //   c) active well below target — budget didn't reach this row
    // "At target stake" is only honest in (b); (c) made the message a lie on
    // budget-constrained runs (active 30k, target 72k, delta 0 -> "At target").
    const belowTarget = target > 0 && active < target * 0.99
    if (atOwnCap) {
      return tip('At your `maxStakeWanted` setting.', 'neutral', 'none', delta)
    }
    // delta===0 with active well below target: redistribution budget ran out
    // before reaching this validator. Higher bid → higher stakePriority →
    // served sooner in the greedy allocation pass.
    // Exception: if the bid already clears the priority frontier, the bid lever
    // is exhausted — budget simply ran out; "Raise bid" would be wrong advice.
    // NOTE: this guard is deliberately NOT the same expression as the
    // delta>0 branch above — when priorityFrontierPmpe is unknown (0) this
    // branch still advises raising the bid (safer default when nothing is
    // arriving), while the delta>0 branch stays silent (the positive delta
    // already tells the real story). Only the resulting string is shared.
    if (belowTarget && !capBinding) {
      if (priorityFrontierPmpe > 0 && validator.revShare.totalPmpe >= priorityFrontierPmpe) {
        return tip('At target stake.', 'neutral', 'none', delta)
      }
      return tip(RAISE_TO_GROW, 'info', 'rank', delta)
    }
    return tip('At target stake.', 'neutral', 'none', delta)
  }
  // Yellow only when the loss is meaningful (isDefending). Sub-threshold
  // losses (< 1k SOL or < 10k active) stay violet so a specific-reason
  // CTA at INFO level (bid too low, not-eligible) can outrank the symptom.
  return tip(
    `Losing ${stake(Math.abs(delta))} next epoch.`,
    isDefending(validator, delta) ? 'warning' : 'info',
    'none',
    delta,
  )
}

export const getValidatorTip = (
  validator: AugmentedAuctionValidator,
  dsSamConfig: DsSamConfig,
  winningTotalPmpe: number,
  // Hot-path optimisation: per-row callers (sam-table) precompute the
  // coverage to feed both the bond chip AND this tip. Passing it through
  // avoids a second computeBondCoverage call inside bondCta.
  precomputedCoverage?: BondCoverage,
  // Optional blacklist set from the auction data — lets outOfSetCta name
  // the specific eligibility failure when blacklist is the cause.
  blacklist?: Set<string>,
  // Priority frontier PMPE from the redelegation pass. When the validator's
  // totalPmpe already clears it, "Raise bid" is suppressed.
  priorityFrontierPmpe = 0,
): ValidatorTip => {
  const delta = validator.values.expectedStakeChangeSol
  const cap = capCta(validator, delta)
  return selectTip(
    bondCta(validator, dsSamConfig, winningTotalPmpe, delta, precomputedCoverage),
    bidCta(validator, dsSamConfig, winningTotalPmpe, delta),
    outOfSetCta(validator, winningTotalPmpe, delta, blacklist),
    cap,
    deltaCta(validator, delta, cap !== null, priorityFrontierPmpe, dsSamConfig.minMaxStakeWanted),
  )
}
