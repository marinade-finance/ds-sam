// Parity tests for the moved CTA engine: getValidatorTip branch coverage
// (bond/bid/cap/delta CTAs, severity ordering) and the bondAdvice contract.
// Ported from psr-dashboard; UI-only helpers (getTipStyle/getTipIcon/
// nextStakeDeltaCell/getApyBreakdown) stay in the dashboard.
import { computeBondCoverage } from '../src/bond-coverage'
import { bondHealthFromAuction } from '../src/bond-health'
import { getValidatorTip, bondAdvice } from '../src/tip-engine'

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
  // enough that stake(minBondBalanceSol) renders for the no-bond message.
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

  it('lastCapConstraint with headroom (totalLeftToCapSol > 0) → no cap CTA', () => {
    const validator = makeValidator({
      values: { expectedStakeChangeSol: -5000 },
      lastCapConstraint: {
        constraintType: 'ASO',
        constraintName: 'Hetzner Online GmbH',
        totalStakeSol: 1_000_000,
        totalLeftToCapSol: 50_000,
        marinadeStakeSol: 1_000_000,
        marinadeLeftToCapSol: 50_000,
        validators: [],
      },
    })
    const tip = getValidatorTip(validator, DS_SAM_CONFIG, 100)
    expect(tip.constraint).toBe('none')
    expect(tip.text).toContain('Losing')
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
