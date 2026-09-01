// Parity tests for the moved CTA engine: getValidatorTip branch coverage
// (bond/bid/cap/delta CTAs, severity ordering) and the bondAdvice contract.
// Ported from psr-dashboard; UI-only helpers (getTipStyle/getTipIcon/
// nextStakeDeltaCell/getApyBreakdown) stay in the dashboard.
import { computeBondCoverage } from '../src/bond-coverage'
import { bondHealthFromAuction } from '../src/bond-health'
import { getValidatorTip, bondAdvice, outOfSetGate, outOfSetGateLabel } from '../src/tip-engine'

import type { DsSamConfig } from '../src'
import type { AugmentedAuctionValidator } from '../src/sam'

function makeValidator(overrides: Record<string, unknown> = {}): AugmentedAuctionValidator {
  return {
    voteAccount: 'test',
    bondGoodForNEpochs: 20,
    bondBalanceSol: 100,
    claimableBondBalanceSol: 100,
    marinadeActivatedStakeSol: 10000,
    maxStakeWanted: 50000,
    auctionStake: { marinadeSamTargetSol: 15000 },
    minBondPmpe: 1,
    idealBondPmpe: 6,
    minUnprotectedReserve: 0,
    idealUnprotectedReserve: 0,
    values: { expectedStakeChangeSol: 5000 },
    revShare: {
      inflationPmpe: 5,
      mevPmpe: 2,
      blockPmpe: 1,
      bidPmpe: 20,
      totalPmpe: 28,
      bondObligationPmpe: 20,
      auctionEffectiveBidPmpe: 20,
      effParticipatingBidPmpe: 20,
    },
    ...overrides,
  } as unknown as AugmentedAuctionValidator
}

const DS_SAM_CONFIG = {
  minBondEpochs: 0,
  idealBondEpochs: 10,
  bondRiskFeeMult: 1,
  // Tiny so the existing 0.001-SOL "critical fee" fixtures stay ABOVE the
  // SDK minimum (they pin the fee branch, not the below-min branch); large
  // enough that bondSol(minBondBalanceSol) renders for the no-bond message.
  minBondBalanceSol: 0.0001,
  bidTooLowPenaltyHistoryEpochs: 10,
  bidTooLowPenaltyPermittedDeviationPmpe: 0.0001,
} as unknown as DsSamConfig

describe('getValidatorTip', () => {
  it('not in set → info/rank (growth lever — raise bid to qualify)', () => {
    const validator = makeValidator({
      auctionStake: { marinadeSamTargetSol: 0 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('info')
    expect(tip.constraint).toBe('rank')
    expect(tip.text).toContain('Raise bid')
  })

  it('out-of-set + bid penalty firing → critical/bid (penalty outranks rank)', () => {
    const validator = makeValidator({
      auctionStake: { marinadeSamTargetSol: 0 },
      revShare: {
        inflationPmpe: 5,
        mevPmpe: 2,
        blockPmpe: 1,
        bidPmpe: 0.5,
        totalPmpe: 8.5,
        bondObligationPmpe: 0,
        effParticipatingBidPmpe: 0.5,
        bidTooLowPenaltyPmpe: 0.5,
      },
      auctions: [
        { bidPmpe: 5, effParticipatingBidPmpe: 5 },
        { bidPmpe: 5, effParticipatingBidPmpe: 5 },
        { bidPmpe: 0.5, effParticipatingBidPmpe: 0.5 },
      ],
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('critical')
    expect(tip.constraint).toBe('bid')
    expect(tip.text).toContain('Raise bid')
  })

  it('out-of-set + above-min + critical bond, no fee yet → avoid-bond-liquidation CTA', () => {
    const validator = makeValidator({
      auctionStake: { marinadeSamTargetSol: 0 },
      bondBalanceSol: 50,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('critical')
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toContain('avoid bond liquidation')
    expect(tip.alert).toBeFalsy()
  })

  it('critical health, claimable below floor, no fee → "avoid bond liquidation"', () => {
    const validator = makeValidator({
      bondGoodForNEpochs: 4,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('critical')
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toContain('avoid bond liquidation')
    expect(tip.alert).toBeFalsy()
  })

  it('critical health, claimable below floor AND fee charged → "avoid the bond risk fee"', () => {
    const validator = makeValidator({
      bondGoodForNEpochs: 4,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
      values: { bondRiskFeeSol: 5 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('critical')
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toContain('bond fee')
    expect(tip.alert).toBe(true)
  })

  it('critical health (epochs > 5), claimable below floor, no fee → avoid-bond-liquidation CTA', () => {
    const validator = makeValidator({
      bondGoodForNEpochs: 8,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('critical')
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toContain('avoid bond liquidation')
    expect(tip.alert).toBeFalsy()
  })

  it('watch health (bond covers stake but not ideal) → info/bond top-up', () => {
    const validator = makeValidator({
      bondGoodForNEpochs: 7,
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
      marinadeActivatedStakeSol: 10000,
      values: { expectedStakeChangeSol: 0 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('info')
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toContain('Top up')
  })

  it('healthy + gaining stake → positive with SOL count', () => {
    const validator = makeValidator({
      bondBalanceSol: 400,
      claimableBondBalanceSol: 400,
      values: { expectedStakeChangeSol: 150000 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('positive')
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('arriving next epoch')
  })

  it('delta > 0 + below priority frontier → info/rank raise-bid for more', () => {
    const validator = makeValidator({
      values: { expectedStakeChangeSol: 28 },
      revShare: { totalPmpe: 28 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 20, undefined, undefined, 50)
    expect(tip.urgency).toBe('info')
    expect(tip.constraint).toBe('rank')
    expect(tip.text).toBe('Raise bid to grow stake next epoch.')
  })

  it('delta > 0 + at/above priority frontier → positive arriving message', () => {
    const validator = makeValidator({
      values: { expectedStakeChangeSol: 28 },
      revShare: { totalPmpe: 28 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 20, undefined, undefined, 10)
    expect(tip.urgency).toBe('positive')
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('arriving next epoch')
  })

  it('delta === 0 + active ≈ target → neutral "At target stake"', () => {
    const validator = makeValidator({
      marinadeActivatedStakeSol: 15000,
      auctionStake: { marinadeSamTargetSol: 15000 },
      values: { expectedStakeChangeSol: 0 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('neutral')
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('At target')
  })

  it('delta === 0 + active << target → info/rank raise-bid (budget ran out before this validator)', () => {
    const validator = makeValidator({ values: { expectedStakeChangeSol: 0 } })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('info')
    expect(tip.constraint).toBe('rank')
    expect(tip.text).toBe('Raise bid to grow stake next epoch.')
  })

  it('in-set, target pinned at bond ceiling below maxStakeWanted → info/bond "top up to reach maxStakeWanted" (NOT raise bid)', () => {
    // Regression: a winning validator whose SAM target is clipped by the bond
    // (maxBondDelegation, set by the bond cap not the TVL cap) below their
    // maxStakeWanted. The bond runway is healthy for the clamped target, so
    // bondCta used to return null and deltaCta wrongly advised "Raise bid to
    // grow stake" — a higher bid can't lift a bond ceiling; a bond top-up can.
    const validator = makeValidator({
      bondGoodForNEpochs: 20, // healthy runway for the current (clamped) target
      maxStakeWanted: 200_000,
      maxBondDelegation: 100_000, // ceiling the auction pinned the target to
      bondSamStakeCapSol: 100_000, // bond cap == ceiling → bond is the binder
      auctionStake: { marinadeSamTargetSol: 100_000 },
      marinadeActivatedStakeSol: 50_000, // below target → would be RAISE_TO_GROW
      values: { expectedStakeChangeSol: 0 },
    })
    // priorityFrontierPmpe 50 > totalPmpe 28 → without the fix this is the
    // "Raise bid to grow stake next epoch." branch.
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 20, undefined, undefined, 50)
    expect(tip.constraint).toBe('bond')
    expect(tip.urgency).toBe('info')
    expect(tip.text).toBe('Top up bond to reach your `maxStakeWanted`.')
    expect(tip.text).not.toBe('Raise bid to grow stake next epoch.')
  })

  it('in-set, target at ceiling but TVL cap (not bond) is the binder → stays raise-bid, no bond CTA', () => {
    // maxBondDelegation is set by the per-validator TVL cap here
    // (bondSamStakeCapSol > maxBondDelegation), so a bond top-up would NOT
    // grow stake — the growth CTA must not fire.
    const validator = makeValidator({
      bondGoodForNEpochs: 20,
      maxStakeWanted: 200_000,
      maxBondDelegation: 100_000,
      bondSamStakeCapSol: 150_000, // bond cap ABOVE the ceiling → TVL cap binds
      auctionStake: { marinadeSamTargetSol: 100_000 },
      marinadeActivatedStakeSol: 50_000,
      values: { expectedStakeChangeSol: 0 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 20, undefined, undefined, 50)
    expect(tip.constraint).not.toBe('bond')
    expect(tip.text).toBe('Raise bid to grow stake next epoch.')
  })

  it('in-set, target at bond ceiling that equals maxStakeWanted → at own cap, no bond CTA', () => {
    // Bond ceiling coincides with maxStakeWanted → the validator is at their
    // own setting; topping up the bond wouldn't grow them, so no bond CTA.
    const validator = makeValidator({
      bondGoodForNEpochs: 20,
      maxStakeWanted: 100_000,
      maxBondDelegation: 100_000,
      bondSamStakeCapSol: 100_000,
      auctionStake: { marinadeSamTargetSol: 100_000 },
      marinadeActivatedStakeSol: 100_000,
      values: { expectedStakeChangeSol: 0 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 20, undefined, undefined, 50)
    expect(tip.constraint).not.toBe('bond')
  })

  it('delta < 0 + at own maxStakeWanted cap (SUP-188 rebalance down) → neutral "At your maxStakeWanted setting"', () => {
    const config = { ...DS_SAM_CONFIG, minMaxStakeWanted: 10_000 } as unknown as DsSamConfig
    const validator = makeValidator({
      bondBalanceSol: 400,
      claimableBondBalanceSol: 400,
      maxStakeWanted: 20_000,
      marinadeActivatedStakeSol: 100_000,
      auctionStake: { marinadeSamTargetSol: 20_000 },
      values: { expectedStakeChangeSol: -80_000 },
    })
    const tip = getValidatorTip(validator, config, 100)
    expect(tip.urgency).toBe('neutral')
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('maxStakeWanted')
  })

  it('delta < 0 + maxStakeWanted below minMaxStakeWanted floor → not own cap, keeps losing message', () => {
    const config = { ...DS_SAM_CONFIG, minMaxStakeWanted: 50_000 } as unknown as DsSamConfig
    const validator = makeValidator({
      bondBalanceSol: 400,
      claimableBondBalanceSol: 400,
      maxStakeWanted: 20_000,
      marinadeActivatedStakeSol: 100_000,
      auctionStake: { marinadeSamTargetSol: 50_000 },
      values: { expectedStakeChangeSol: -50_000 },
    })
    const tip = getValidatorTip(validator, config, 100)
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('Losing')
  })

  it('delta < 0 + defending + healthy bond → warning, losing stake message', () => {
    const validator = makeValidator({
      bondBalanceSol: 400,
      claimableBondBalanceSol: 400,
      marinadeActivatedStakeSol: 50_000,
      values: { expectedStakeChangeSol: -5000 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('warning')
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('Losing')
  })

  it('delta < 0 + not defending → info, losing stake message', () => {
    const validator = makeValidator({
      marinadeActivatedStakeSol: 10_000,
      values: { expectedStakeChangeSol: -5000 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('info')
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('Losing')
  })

  it('delta < 0 + binding ASO cap → info/cap, names the ASO', () => {
    const validator = makeValidator({
      values: { expectedStakeChangeSol: -3953 },
      lastCapConstraint: {
        constraintType: 'ASO',
        constraintName: 'Hetzner Online GmbH',
        totalStakeSol: 1_450_000,
        totalLeftToCapSol: 0,
        marinadeStakeSol: 1_450_000,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('info')
    expect(tip.constraint).toBe('cap')
    expect(tip.text).toContain('Hetzner Online GmbH')
    expect(tip.text).toContain('at ASO cap')
    expect(tip.text).toContain('until cap frees')
  })

  it('delta < 0 + binding country cap → reads "at country cap"', () => {
    const validator = makeValidator({
      values: { expectedStakeChangeSol: -1200 },
      lastCapConstraint: {
        constraintType: 'COUNTRY',
        constraintName: 'Germany',
        totalStakeSol: 2_000_000,
        totalLeftToCapSol: 0,
        marinadeStakeSol: 2_000_000,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('cap')
    expect(tip.text).toContain('Germany at country cap')
  })

  it('delta === 0 + binding ASO cap → info/cap "stake can\'t grow" (Velox case)', () => {
    const validator = makeValidator({
      values: { expectedStakeChangeSol: 0 },
      lastCapConstraint: {
        constraintType: 'ASO',
        constraintName: 'Hetzner Online GmbH',
        totalStakeSol: 1_000_000,
        totalLeftToCapSol: 0,
        marinadeStakeSol: 1_000_000,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('cap')
    expect(tip.urgency).toBe('info')
    expect(tip.text).toContain("can't grow")
  })

  it('binding on the marinade side only (totalLeftToCapSol > 0) → still a cap CTA', () => {
    // findCapForValidator records lastCapConstraint on min(total, marinade) < EPSILON,
    // so the marinade side alone is enough — totalLeftToCapSol says nothing here.
    const validator = makeValidator({
      values: { expectedStakeChangeSol: -5000 },
      lastCapConstraint: {
        constraintType: 'ASO',
        constraintName: 'Hetzner Online GmbH',
        totalStakeSol: 1_000_000,
        totalLeftToCapSol: 50_000,
        marinadeStakeSol: 1_000_000,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('cap')
    expect(tip.text).toContain('Hetzner Online GmbH at ASO cap')
  })

  it('out of set → capCta stays silent, outOfSetCta owns the cap narrative', () => {
    const validator = makeValidator({
      auctionStake: { marinadeSamTargetSol: 0 },
      samEligible: true,
      samBlocked: false,
      bondSamStakeCapSol: 250_000,
      values: { expectedStakeChangeSol: -5000 },
      lastCapConstraint: {
        constraintType: 'ASO',
        constraintName: 'Hetzner Online GmbH',
        totalStakeSol: 1_000_000,
        totalLeftToCapSol: 0,
        marinadeStakeSol: 1_000_000,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 10)
    expect(tip.constraint).toBe('cap')
    expect(tip.text).toBe('Hetzner Online GmbH at ASO cap.')
  })

  // "until cap frees" is a promise that waiting works, so capCta must stay off the two
  // caps the validator clears themselves. Their owners word it as a lever instead.
  const selfClearableCap = (constraintType: string) => ({
    constraintType,
    constraintName: 'test',
    totalStakeSol: 1_000_000,
    totalLeftToCapSol: Infinity,
    marinadeStakeSol: 1_000_000,
    marinadeLeftToCapSol: 0,
    validators: [],
  })

  it('WANT cap on an in-set row → deltaCta owns it, no "until cap frees"', () => {
    const validator = makeValidator({
      maxStakeWanted: 50_000,
      auctionStake: { marinadeSamTargetSol: 50_000 },
      marinadeActivatedStakeSol: 50_000,
      values: { expectedStakeChangeSol: -5000 },
      lastCapConstraint: selfClearableCap('WANT'),
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 10)
    expect(tip.constraint).not.toBe('cap')
    expect(tip.text).toBe('At your `maxStakeWanted` setting.')
  })

  it('BOND cap on an in-set row → bondGrowthCta owns it, no "until cap frees"', () => {
    const validator = makeValidator({
      maxStakeWanted: 80_000,
      auctionStake: { marinadeSamTargetSol: 50_000 },
      marinadeActivatedStakeSol: 5_000,
      maxBondDelegation: 50_000,
      bondSamStakeCapSol: 50_000,
      values: { expectedStakeChangeSol: -5000 },
      lastCapConstraint: selfClearableCap('BOND'),
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 10)
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toBe('Top up bond to reach your `maxStakeWanted`.')
  })

  // The auction silently raises a sub-floor maxStakeWanted to minMaxStakeWanted, so
  // "your setting" would be a lie — deltaCta's atOwnCap guard is what catches it.
  it('WANT cap below the minMaxStakeWanted floor → never blamed on the setting', () => {
    const validator = makeValidator({
      maxStakeWanted: 7_000,
      auctionStake: { marinadeSamTargetSol: 10_000 },
      marinadeActivatedStakeSol: 50_000,
      values: { expectedStakeChangeSol: -5000 },
      lastCapConstraint: selfClearableCap('WANT'),
    })
    const tip = getValidatorTip(validator, { ...DS_SAM_CONFIG, minMaxStakeWanted: 10_000 }, 10)
    expect(tip.text).not.toContain('maxStakeWanted')
  })

  it('delta > 0 + binding cap → cap branch does not displace positive', () => {
    const validator = makeValidator({
      values: { expectedStakeChangeSol: 5000 },
      lastCapConstraint: {
        constraintType: 'ASO',
        constraintName: 'Hetzner Online GmbH',
        totalStakeSol: 1_000_000,
        totalLeftToCapSol: 0,
        marinadeStakeSol: 1_000_000,
        marinadeLeftToCapSol: 0,
        validators: [],
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('none')
    expect(tip.urgency).toBe('positive')
  })
})

describe('getValidatorTip watch health (bond top-up lever)', () => {
  it('watch health + defending (large loss) → warning/bond "keep stake" (beats deltaCta)', () => {
    const validator = makeValidator({
      bondGoodForNEpochs: 7,
      bondBalanceSol: 100,
      claimableBondBalanceSol: 100,
      marinadeActivatedStakeSol: 50000,
      values: { expectedStakeChangeSol: -33000 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('bond')
    expect(tip.urgency).toBe('warning')
    expect(tip.text).toContain('keep stake')
  })
})

describe('getValidatorTip — positive delta vs bond top-up precedence', () => {
  it('watch bond + topUpToIdealKeep>0 + delta>0 → NOT the "grow stake" top-up', () => {
    const validator = makeValidator({
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
      marinadeActivatedStakeSol: 10000,
      values: { expectedStakeChangeSol: 7500 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.text).not.toContain('Top up')
    expect(tip.text).not.toContain('grow stake')
    expect(tip.urgency).toBe('positive')
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('arriving next epoch')
  })

  it('watch bond (topUpToKeepStake>0) + delta>0 → keeps keep-stake CTA (truthful when gaining: inflow does not refill the bond)', () => {
    const validator = makeValidator({
      bondGoodForNEpochs: 7,
      bondBalanceSol: 100,
      claimableBondBalanceSol: 5,
      marinadeActivatedStakeSol: 10000,
      values: {
        expectedStakeChangeSol: 7500,
        paidUndelegationSol: 8000,
        bondRiskFeeSol: 0,
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('warning')
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toContain('keep stake')
    expect(tip.delta).toBe(7500)
  })

  it('critical bond (fee) + delta>0 → keeps the critical fee CTA (inflow does not pay the fee)', () => {
    const validator = makeValidator({
      bondGoodForNEpochs: 4,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
      values: { expectedStakeChangeSol: 7500 },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.urgency).toBe('critical')
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toContain('Top up')
    expect(tip.delta).toBe(7500)
  })
})

describe('bondAdvice — canonical CTA contract', () => {
  const adviceFor = (over: Record<string, unknown>) => {
    const v = makeValidator(over)
    const health = bondHealthFromAuction(v, DS_SAM_CONFIG, 100)
    const coverage = computeBondCoverage(v, DS_SAM_CONFIG, 100)
    return bondAdvice(
      coverage,
      health,
      (v.values as { bondRiskFeeSol?: number }).bondRiskFeeSol ?? 0,
      (DS_SAM_CONFIG as unknown as { minBondBalanceSol: number }).minBondBalanceSol ?? 0,
      v.bondBalanceSol ?? 0,
      v.marinadeActivatedStakeSol ?? 0,
    )
  }

  const states: Record<string, unknown>[] = [
    { bondBalanceSol: 0, claimableBondBalanceSol: 0 }, // no-bond
    {
      bondGoodForNEpochs: 4,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
    }, // critical (fee)
    {
      bondGoodForNEpochs: 1,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
      values: { bondRiskFeeSol: 5, paidUndelegationSol: 0 },
    }, // critical: fee>0 AND shortfall>0 → "Top up X or pay Y bond fee."
    {
      bondBalanceSol: 100,
      claimableBondBalanceSol: 5,
      marinadeActivatedStakeSol: 10000,
      values: { paidUndelegationSol: 8000, bondRiskFeeSol: 0 },
    }, // watch (keep stake)
    {
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
      marinadeActivatedStakeSol: 10000,
    }, // soft (grow)
    {
      bondBalanceSol: 400,
      claimableBondBalanceSol: 400,
      marinadeActivatedStakeSol: 10000,
    }, // healthy
  ]

  it('every CTA is paren-free, sentence-case, ends with a period', () => {
    for (const s of states) {
      const { text } = adviceFor(s)
      expect(text).not.toMatch(/[()]/)
      expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase())
      expect(text.endsWith('.')).toBe(true)
      expect(text.length).toBeLessThanOrEqual(60)
    }
  })

  it('value-bearing CTAs carry their decisive SOL figure', () => {
    for (const s of states) {
      const { text } = adviceFor(s)
      const isValueBearing = text.startsWith('Top up') || text.includes('required') || text.includes('bond fee ')
      if (!isValueBearing) continue
      expect(text).toMatch(/\d[\d,]*\s*SOL/)
    }
  })

  it("no CTA text contains the multi-clause 'too thin to back your stake' phrasing", () => {
    for (const s of states) {
      const { text } = adviceFor(s)
      expect(text).not.toContain('too thin to back your stake, so')
      expect(text).not.toContain('will be undelegated')
    }
  })

  it('shared boundary: getValidatorTip bond text === bondAdvice text', () => {
    const v = makeValidator({
      bondGoodForNEpochs: 7,
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
      marinadeActivatedStakeSol: 10000,
      values: { expectedStakeChangeSol: 0 },
    })
    const tip = getValidatorTip(v, DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('bond')
    const { text } = adviceFor({
      bondGoodForNEpochs: 7,
      bondBalanceSol: 50,
      claimableBondBalanceSol: 50,
      marinadeActivatedStakeSol: 10000,
      values: { expectedStakeChangeSol: 0 },
    })
    expect(tip.text).toBe(text)
  })

  it('shared boundary: critical fee tip text === bondAdvice text', () => {
    const over = {
      bondGoodForNEpochs: 4,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0,
      marinadeActivatedStakeSol: 100000,
      values: { expectedStakeChangeSol: -10 },
    }
    const tip = getValidatorTip(makeValidator(over), DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('bond')
    expect(tip.text).toBe(adviceFor(over).text)
  })
})

describe('getValidatorTip out-of-set bond top-up rounding', () => {
  it('sub-1 SOL bond top-up rounds up to "1 SOL", never "0 SOL"', () => {
    const validator = makeValidator({
      auctionStake: { marinadeSamTargetSol: 0 },
      marinadeActivatedStakeSol: 100,
      bondBalanceSol: 0.001,
      claimableBondBalanceSol: 0.001,
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    // topUp ceils, so a tiny shortfall advises at least 1 SOL — never "0 SOL".
    expect(tip.text).not.toMatch(/Top up 0 SOL/)
  })
})

const MIN_BOND_CONFIG = { ...DS_SAM_CONFIG, minBondBalanceSol: 5 } as unknown as DsSamConfig

const BOND_CAP_CONSTRAINT = {
  constraintType: 'BOND',
  constraintName: 'test',
  totalStakeSol: 500_008,
  // Every per-validator constraint the SDK builds carries Infinity here —
  // the shape the old totalLeftToCapSol === 0 gate silently dropped.
  totalLeftToCapSol: Infinity,
  marinadeStakeSol: 0,
  marinadeLeftToCapSol: 0,
  validators: [],
}

const COUNTRY_CAP_CONSTRAINT = {
  constraintType: 'COUNTRY',
  constraintName: 'Germany',
  totalStakeSol: 2_000_000,
  totalLeftToCapSol: 0,
  marinadeStakeSol: 2_000_000,
  marinadeLeftToCapSol: 0,
  validators: [],
}

// Out-of-set fixture whose price clears: totalPmpe 28 against the 10 passed
// as winningTotalPmpe below, so bidCta's rank branch stays silent.
function makeOutOfSet(overrides: Record<string, unknown> = {}): AugmentedAuctionValidator {
  return makeValidator({
    auctionStake: { marinadeSamTargetSol: 0 },
    samEligible: true,
    samBlocked: false,
    bondSamStakeCapSol: 250_000,
    lastCapConstraint: null,
    marinadeActivatedStakeSol: 8,
    values: { expectedStakeChangeSol: -8 },
    ...overrides,
  })
}

function labelFor(validator: AugmentedAuctionValidator, blacklist?: Set<string>): string {
  const gate = outOfSetGate(validator, MIN_BOND_CONFIG, blacklist)
  if (gate === null) {
    throw new Error('expected an identifiable gate')
  }
  return outOfSetGateLabel(gate, MIN_BOND_CONFIG)
}

describe('outOfSetGate', () => {
  it('in set → null', () => {
    expect(outOfSetGate(makeValidator(), MIN_BOND_CONFIG)).toBeNull()
  })

  it('samBlocked → blocked', () => {
    const validator = makeOutOfSet({ samBlocked: true })
    expect(outOfSetGate(validator, MIN_BOND_CONFIG)).toEqual({ kind: 'blocked' })
    expect(labelFor(validator)).toBe('Blocked from SAM')
  })

  it('samEligible false + on the blacklist → blacklisted', () => {
    const validator = makeOutOfSet({ samEligible: false })
    const blacklist = new Set(['test'])
    expect(outOfSetGate(validator, MIN_BOND_CONFIG, blacklist)).toEqual({ kind: 'blacklisted' })
    expect(labelFor(validator, blacklist)).toBe('Blacklisted')
  })

  it('samEligible false + not on the blacklist → ineligible', () => {
    const validator = makeOutOfSet({ samEligible: false })
    const blacklist = new Set(['other'])
    expect(outOfSetGate(validator, MIN_BOND_CONFIG, blacklist)).toEqual({ kind: 'ineligible' })
    expect(labelFor(validator, blacklist)).toBe('Not eligible')
  })

  it('bond clipped to zero + below min → bondBelowMin, label carries the minimum', () => {
    const validator = makeOutOfSet({
      bondBalanceSol: 2,
      claimableBondBalanceSol: 2,
      bondSamStakeCapSol: 0,
      lastCapConstraint: BOND_CAP_CONSTRAINT,
    })
    expect(outOfSetGate(validator, MIN_BOND_CONFIG)).toEqual({ kind: 'bondBelowMin' })
    expect(labelFor(validator)).toMatch(/^Bond below 5\.0.SOL minimum$/)
  })

  it('bond below min but INSIDE the hysteresis band → the real cap is blamed, not the bond', () => {
    // clipBondStakeCap only zeroes the cap below 0.8 × min, so a 4.5 SOL bond
    // against a 5 SOL minimum still carries stake — the country cap is what
    // actually holds this validator out, and the label must say so.
    const validator = makeOutOfSet({
      bondBalanceSol: 4.5,
      claimableBondBalanceSol: 4.5,
      bondSamStakeCapSol: 4_500,
      lastCapConstraint: COUNTRY_CAP_CONSTRAINT,
    })
    expect(outOfSetGate(validator, MIN_BOND_CONFIG)?.kind).toBe('cap')
    expect(labelFor(validator)).toBe('Germany at country cap')
  })

  it('BOND cap with adequate bond → cap, "At your bond cap"', () => {
    const validator = makeOutOfSet({ bondSamStakeCapSol: 0, lastCapConstraint: BOND_CAP_CONSTRAINT })
    expect(outOfSetGate(validator, MIN_BOND_CONFIG)?.kind).toBe('cap')
    expect(labelFor(validator)).toBe('At your bond cap')
  })

  it('RISK cap → cap, "At the risk cap"', () => {
    const validator = makeOutOfSet({
      lastCapConstraint: { ...BOND_CAP_CONSTRAINT, constraintType: 'RISK' },
    })
    expect(labelFor(validator)).toBe('At the risk cap')
  })

  it('COUNTRY cap binding on the marinade side only → cap, names the country', () => {
    const validator = makeOutOfSet({
      lastCapConstraint: { ...COUNTRY_CAP_CONSTRAINT, totalLeftToCapSol: 5_000 },
    })
    expect(outOfSetGate(validator, MIN_BOND_CONFIG)?.kind).toBe('cap')
    expect(labelFor(validator)).toBe('Germany at country cap')
  })

  it('eligible + bond fine + no cap recorded → null, generic fallthrough survives', () => {
    expect(outOfSetGate(makeOutOfSet(), MIN_BOND_CONFIG)).toBeNull()
  })
})

describe('outOfSetGate / outOfSetCta agreement', () => {
  // Anti-drift: the caption label and the CTA sentence must name one gate.
  // bondBelowMin is absent by design — outOfSetCta defers it to bondCta.
  const cases: Array<[string, Record<string, unknown>]> = [
    ['blocked', { samBlocked: true }],
    ['ineligible', { samEligible: false }],
    ['country cap', { lastCapConstraint: COUNTRY_CAP_CONSTRAINT }],
    ['bond cap', { bondSamStakeCapSol: 0, lastCapConstraint: BOND_CAP_CONSTRAINT }],
  ]

  it.each(cases)('%s: the CTA sentence opens with the caption label', (_name, overrides) => {
    const validator = makeOutOfSet(overrides)
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
    expect(tip.text.startsWith(labelFor(validator))).toBe(true)
  })
})

describe('getValidatorTip cause beats symptom when the price already clears', () => {
  it.each([
    ['bond cap recorded', BOND_CAP_CONSTRAINT],
    // A zeroed bond cap and a saturated country cap both yield 0, and
    // getMinCapForEvenDistribution keeps the first on a tie — COUNTRY is ordered
    // ahead of BOND, so this pairing is what the SDK actually records.
    ['country cap recorded', COUNTRY_CAP_CONSTRAINT],
  ])(
    'out of set + price clears + bond below min + calm (%s) → bond lever headlines, stays neutral',
    (_name, lastCapConstraint) => {
      const validator = makeOutOfSet({
        bondBalanceSol: 2,
        claimableBondBalanceSol: 2,
        bondSamStakeCapSol: 0,
        lastCapConstraint,
      })
      const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
      expect(tip.constraint).toBe('bond')
      // Neutral is load-bearing: tipBannerSeverity keeps bond + neutral grey, so
      // a validator with 8 SOL at risk never gets a critical-red banner.
      expect(tip.urgency).toBe('neutral')
      expect(tip.text).toContain('grow stake')
      expect(tip.text).not.toContain('Losing')
    },
  )

  it('out of set + price BELOW winning + bond below min + defending → the loss still headlines', () => {
    const validator = makeOutOfSet({
      bondBalanceSol: 2,
      claimableBondBalanceSol: 2,
      bondSamStakeCapSol: 0,
      lastCapConstraint: BOND_CAP_CONSTRAINT,
      marinadeActivatedStakeSol: 50_000,
      values: { expectedStakeChangeSol: -30_000 },
    })
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 100)
    expect(tip.constraint).toBe('none')
    expect(tip.urgency).toBe('warning')
    expect(tip.text).toContain('Losing')
  })

  it('out of set + price clears + no identifiable gate → delta fallback survives', () => {
    const tip = getValidatorTip(makeOutOfSet(), MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('Losing')
  })

  it('in set + losing stake → untouched by the out-of-set precedence rule', () => {
    const validator = makeValidator({
      marinadeActivatedStakeSol: 50_000,
      values: { expectedStakeChangeSol: -5_000 },
    })
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('Losing')
  })
})

// In set AND below the bond minimum is a real state, not an impossible one:
// sam.ts undelegates the whole active stake for it, so the bond is the only
// lever the operator has and the CTA must name it.
function makeInSetBelowMinBond(overrides: Record<string, unknown> = {}): AugmentedAuctionValidator {
  return makeValidator({
    auctionStake: { marinadeSamTargetSol: 1_547 },
    marinadeActivatedStakeSol: 1_547,
    values: { expectedStakeChangeSol: -1_547 },
    bondBalanceSol: 2,
    claimableBondBalanceSol: 2,
    samEligible: true,
    samBlocked: false,
    lastCapConstraint: null,
    ...overrides,
  })
}

describe('getValidatorTip in set + below the bond minimum', () => {
  it('losing the entire stake under the isDefending floor → bond lever headlines at warning', () => {
    const tip = getValidatorTip(makeInSetBelowMinBond(), MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('bond')
    expect(tip.urgency).toBe('warning')
    expect(tip.text).toContain('Top up bond')
    expect(tip.text).not.toContain('Losing')
  })

  it('calm below-min row → stays neutral (eligibility, not urgency)', () => {
    const validator = makeInSetBelowMinBond({ values: { expectedStakeChangeSol: 0 } })
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('bond')
    expect(tip.urgency).toBe('neutral')
  })

  it.each([
    ['whole stake', -50_000],
    ['part of it', -30_000],
  ])('large row losing %s → isDefending still owns the escalation', (_name, expectedStakeChangeSol) => {
    const validator = makeInSetBelowMinBond({
      auctionStake: { marinadeSamTargetSol: 50_000 },
      marinadeActivatedStakeSol: 50_000,
      maxStakeWanted: 200_000,
      values: { expectedStakeChangeSol },
    })
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('bond')
    expect(tip.urgency).toBe('warning')
  })

  it('dust row under the loss floor → no escalation, the loss keeps the headline', () => {
    const validator = makeInSetBelowMinBond({
      auctionStake: { marinadeSamTargetSol: 900 },
      marinadeActivatedStakeSol: 900,
      values: { expectedStakeChangeSol: -900 },
    })
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('none')
    expect(tip.urgency).toBe('info')
  })
})

// The whole-stake escalation is in-set only. makeOutOfSet's 8-SOL fixture sits
// under the loss floor, so these pin the 1k-10k band where the escalation would
// otherwise outrank the CTA naming the gate that actually holds the row out.
describe('getValidatorTip out of set + below the bond minimum keeps naming the real gate', () => {
  it('ineligible → eligibility CTA headlines, not the bond', () => {
    const validator = makeOutOfSet({
      samEligible: false,
      bondBalanceSol: 2,
      claimableBondBalanceSol: 2,
      bondSamStakeCapSol: 0,
      marinadeActivatedStakeSol: 5_000,
      values: { expectedStakeChangeSol: -5_000 },
    })
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('Not eligible')
    expect(tip.text).not.toContain('bond')
  })

  it('country cap → cap CTA headlines, not the bond', () => {
    const validator = makeOutOfSet({
      bondBalanceSol: 2,
      claimableBondBalanceSol: 2,
      bondSamStakeCapSol: 1_000,
      lastCapConstraint: COUNTRY_CAP_CONSTRAINT,
      marinadeActivatedStakeSol: 5_000,
      values: { expectedStakeChangeSol: -5_000 },
    })
    const tip = getValidatorTip(validator, MIN_BOND_CONFIG, 10)
    expect(tip.constraint).toBe('cap')
    expect(tip.text).toContain('country cap')
  })
})
