// selectValidatorConcentration must report both ledgers the auction caps a
// country / ASO on, each with its own numerator, basis and cap: network stake
// (external + SAM target over networkTotalSol) and Marinade stake (SAM target
// over marinadeSamTvlSol).
import { selectValidatorConcentration } from '../src/sam'
import { AuctionConstraintType } from '../src/types'

import type { AuctionResult, AuctionValidator } from '../src'
import type { DsSamConfig } from '../src/config'

const cfg = {
  maxNetworkStakeConcentrationPerCountryDec: 0.4,
  maxNetworkStakeConcentrationPerAsoDec: 0.3,
  maxMarinadeStakeConcentrationPerCountryDec: 0.5,
  maxMarinadeStakeConcentrationPerAsoDec: 0.5,
} as unknown as DsSamConfig

const makeValidator = (
  voteAccount: string,
  externalActivatedSol: number,
  marinadeSamTargetSol: number,
  country: string,
  aso: string,
  cappedBy?: AuctionConstraintType,
): AuctionValidator =>
  ({
    voteAccount,
    country,
    aso,
    auctionStake: { externalActivatedSol, marinadeSamTargetSol },
    lastCapConstraint: cappedBy
      ? { constraintType: cappedBy, constraintName: cappedBy === AuctionConstraintType.COUNTRY ? country : aso }
      : null,
  }) as unknown as AuctionValidator

const makeResult = (
  validators: AuctionValidator[],
  networkTotalSol: number,
  marinadeSamTvlSol: number,
): AuctionResult =>
  ({
    winningTotalPmpe: 0,
    auctionData: { validators, stakeAmounts: { networkTotalSol, marinadeSamTvlSol } },
  }) as unknown as AuctionResult

// Network total 1000, Marinade SAM TVL 100.
// US: A(150+50) + B(90+10) + Z(100+0) = 400 network, 60 Marinade.
// aws: A + Z = 300 network, 50 Marinade. Z holds network stake with no SAM
// target, so it draws down the network cap but not the Marinade one.
const validators = [
  makeValidator('A', 150, 50, 'US', 'aws'),
  makeValidator('B', 90, 10, 'US', 'ovh'),
  makeValidator('C', 200, 0, 'DE', 'ovh'),
  makeValidator('Z', 100, 0, 'US', 'aws'),
]
const result = makeResult(validators, 1000, 100)

describe('selectValidatorConcentration', () => {
  it('measures the network ledger over total network stake', () => {
    const c = selectValidatorConcentration(result, cfg, 'A')
    if (!c) throw new Error('expected concentration for A')

    expect(c.country.label).toBe('US')
    expect(c.country.network.stakeSol).toBe(400)
    expect(c.country.network.basisSol).toBe(1000)
    expect(c.country.network.pctOfTotal).toBeCloseTo(0.4)
    expect(c.country.network.capPct).toBe(0.4)
    expect(c.country.network.leftToCapSol).toBe(0)
    expect(c.aso.network.pctOfTotal).toBeCloseTo(0.3)
    expect(c.aso.network.leftToCapSol).toBe(0)
  })

  it('measures the Marinade ledger over SAM TVL, SAM target only', () => {
    const c = selectValidatorConcentration(result, cfg, 'A')
    if (!c) throw new Error('expected concentration for A')

    expect(c.country.marinade.stakeSol).toBe(60)
    expect(c.country.marinade.basisSol).toBe(100)
    expect(c.country.marinade.pctOfTotal).toBeCloseTo(0.6)
    expect(c.country.marinade.capPct).toBe(0.5)
    expect(c.country.marinade.leftToCapSol).toBe(0)
    expect(c.aso.marinade.stakeSol).toBe(50)
    expect(c.aso.marinade.leftToCapSol).toBe(0)
  })

  it('counts every group member, in the auction set or not', () => {
    const c = selectValidatorConcentration(result, cfg, 'A')
    if (!c) throw new Error('expected concentration for A')

    expect(c.country.groupValidatorCount).toBe(3)
    expect(c.aso.groupValidatorCount).toBe(2)
  })

  it('names the ledger with less SOL headroom as binding', () => {
    // Same groups, 10x network total: the network ledger opens up (400 of a
    // 4000 cap) while Marinade's stays at 60 of a 50 cap.
    const c = selectValidatorConcentration(makeResult(validators, 10_000, 100), cfg, 'A')
    if (!c) throw new Error('expected concentration for A')

    expect(c.country.network.leftToCapSol).toBe(3600)
    expect(c.country.marinade.leftToCapSol).toBe(0)
    expect(c.country.binding).toBe('marinade')
  })

  it('reports zero shares when a basis is zero', () => {
    const c = selectValidatorConcentration(makeResult(validators, 0, 0), cfg, 'A')
    if (!c) throw new Error('expected concentration for A')

    expect(c.country.network.pctOfTotal).toBe(0)
    expect(c.country.marinade.pctOfTotal).toBe(0)
  })

  it('flags thisValidatorCapped only for the matching binding constraint', () => {
    const capped = [makeValidator('A', 150, 50, 'US', 'aws', AuctionConstraintType.COUNTRY), ...validators.slice(1)]
    const c = selectValidatorConcentration(makeResult(capped, 1000, 100), cfg, 'A')
    if (!c) throw new Error('expected concentration for A')

    expect(c.country.thisValidatorCapped).toBe(true)
    expect(c.aso.thisValidatorCapped).toBe(false)
  })

  it('returns null for a validator absent from the auction data', () => {
    expect(selectValidatorConcentration(result, cfg, 'NOPE')).toBeNull()
  })
})
