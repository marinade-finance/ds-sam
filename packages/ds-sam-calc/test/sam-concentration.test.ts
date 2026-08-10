// Tests for selectValidatorConcentration: the country / ASO group share must be
// on the NETWORK stake basis, because capPct is a network-stake cap
// (networkTotalSol * maxNetworkStakeConcentrationPer{Country,Aso}Dec).
import { selectValidatorConcentration } from '../src/sam'
import { AuctionConstraintType } from '../src/types'

import type { AuctionResult, AuctionValidator, DsSamConfig } from '../src'

const CONFIG: DsSamConfig = {
  maxNetworkStakeConcentrationPerCountryDec: 0.4,
  maxNetworkStakeConcentrationPerAsoDec: 0.3,
} as unknown as DsSamConfig

function makeValidator(
  voteAccount: string,
  external: number,
  target: number,
  country: string,
  aso: string,
  capped?: { type: AuctionConstraintType; name: string },
): AuctionValidator {
  return {
    voteAccount,
    country,
    aso,
    auctionStake: { externalActivatedSol: external, marinadeSamTargetSol: target },
    lastCapConstraint: capped ? { constraintType: capped.type, constraintName: capped.name } : null,
  } as unknown as AuctionValidator
}

function makeResult(networkTotalSol: number, validators: AuctionValidator[]): AuctionResult {
  return {
    winningTotalPmpe: 0,
    auctionData: {
      validators,
      stakeAmounts: { networkTotalSol, marinadeSamTvlSol: 0, marinadeRemainingSamSol: 0 },
    },
  } as unknown as AuctionResult
}

describe('selectValidatorConcentration — network stake basis', () => {
  // network total 1000.
  // DE = A(90+10) + C(190+10) = 300 -> 30% of network, well under the 40% cap.
  // US = B(400+0)                   = 400 -> 40%.
  // aso1 = A(100) + B(400)          = 500 -> 50%; aso2 = C(200) -> 20%.
  // Marinade-target basis would instead give DE 20/20 = 100% and aso1 10/20 = 50%.
  const validators = [
    makeValidator('A', 90, 10, 'DE', 'aso1'),
    makeValidator('B', 400, 0, 'US', 'aso1'),
    makeValidator('C', 190, 10, 'DE', 'aso2'),
  ]
  const result = makeResult(1000, validators)

  it('divides the group total auction stake by networkTotalSol', () => {
    const c = selectValidatorConcentration(result, CONFIG, 'A')
    if (!c) throw new Error('expected concentration for A')
    expect(c.country.label).toBe('DE')
    expect(c.country.pctOfTotal).toBeCloseTo(0.3, 12)
    expect(c.aso.label).toBe('aso1')
    expect(c.aso.pctOfTotal).toBeCloseTo(0.5, 12)
  })

  it('passes through the configured network caps unchanged', () => {
    const c = selectValidatorConcentration(result, CONFIG, 'A')
    if (!c) throw new Error('expected concentration for A')
    expect(c.country.capPct).toBe(0.4)
    expect(c.aso.capPct).toBe(0.3)
  })

  it('counts every group member, including zero-target validators', () => {
    const c = selectValidatorConcentration(result, CONFIG, 'B')
    if (!c) throw new Error('expected concentration for B')
    // B itself has no SAM target but its external stake counts against the cap.
    expect(c.country.label).toBe('US')
    expect(c.country.pctOfTotal).toBeCloseTo(0.4, 12)
    expect(c.country.groupValidatorCount).toBe(1)
    expect(c.aso.groupValidatorCount).toBe(2)
  })

  it('stays under the cap when nothing was capped', () => {
    // The Marinade-target basis would report DE at 20/20 = 100% of a 40% cap
    // with no COUNTRY constraint ever binding — a share cannot exceed its own
    // cap while the auction reports no cap hit.
    const c = selectValidatorConcentration(result, CONFIG, 'A')
    if (!c) throw new Error('expected concentration for A')
    expect(c.country.thisValidatorCapped).toBe(false)
    expect(c.country.pctOfTotal).toBeLessThanOrEqual(c.country.capPct)
  })

  it('reports 0 rather than NaN when networkTotalSol is 0', () => {
    const c = selectValidatorConcentration(makeResult(0, validators), CONFIG, 'A')
    if (!c) throw new Error('expected concentration for A')
    expect(c.country.pctOfTotal).toBe(0)
    expect(c.aso.pctOfTotal).toBe(0)
  })

  it('returns null for a validator outside the auction set', () => {
    expect(selectValidatorConcentration(result, CONFIG, 'missing')).toBeNull()
  })
})

describe('selectValidatorConcentration — group labels and at-cap state', () => {
  it('falls back to an em dash label for an empty country / ASO name', () => {
    const result = makeResult(1000, [makeValidator('A', 100, 0, '', '')])
    const c = selectValidatorConcentration(result, CONFIG, 'A')
    if (!c) throw new Error('expected concentration for A')
    expect(c.country.label).toBe('—')
    expect(c.aso.label).toBe('—')
    expect(c.country.pctOfTotal).toBeCloseTo(0.1, 12)
  })

  it('flags thisValidatorCapped only for the matching binding constraint', () => {
    const result = makeResult(1000, [
      makeValidator('A', 90, 10, 'DE', 'aso1', { type: AuctionConstraintType.COUNTRY, name: 'DE' }),
      makeValidator('B', 400, 0, 'US', 'aso2'),
    ])
    const c = selectValidatorConcentration(result, CONFIG, 'A')
    if (!c) throw new Error('expected concentration for A')
    expect(c.country.thisValidatorCapped).toBe(true)
    expect(c.aso.thisValidatorCapped).toBe(false)
  })

  it('does not flag at-cap when the binding constraint is a different type', () => {
    const result = makeResult(1000, [
      makeValidator('A', 90, 10, 'DE', 'aso1', { type: AuctionConstraintType.BOND, name: 'A' }),
    ])
    const c = selectValidatorConcentration(result, CONFIG, 'A')
    if (!c) throw new Error('expected concentration for A')
    expect(c.country.thisValidatorCapped).toBe(false)
    expect(c.aso.thisValidatorCapped).toBe(false)
  })
})
