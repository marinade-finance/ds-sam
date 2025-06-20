/**
 *
 * Tests cover:
 *  - early exit when lastBondBalanceSol < 1
 *  - no action when bond balance is sufficient
 *  - correct computation of forced undelegation, coefficient, and fee
 *  - clamping behavior when floor threshold forces full undelegation
 *  - error thrown when result is non-finite
 */

import { calcBondRiskFee, BondRiskFeeConfig } from '../src/calculations'
import type { AuctionValidator, RevShare } from '../src/types'

const baseRevShare = {
  totalPmpe: 500,
  effParticipatingBidPmpe: 200,
  inflationPmpe: 100,
  mevPmpe: 100,
  auctionEffectiveBidPmpe: 200,
  expectedMaxEffBidPmpe: 200,
  blacklistPenaltyPmpe: NaN,
}

const baseConfig: BondRiskFeeConfig = {
  minBondEpochs: 1,
  idealBondEpochs: 2,
  minBondBalanceSol: 10,
  bondRiskFeeMult: 0.1,
  pendingWithdrawalBondMult: 0,
}

function makeValidator (overrides: {
  bondBalanceSol?: number
  lastBondBalanceSol?: number
  marinadeActivatedStakeSol?: number
  values?: { paidUndelegationSol: number }
  revShare?: Partial<RevShare>
} = {}): AuctionValidator {
  const defaultRevShare: RevShare = { ...baseRevShare, bidPmpe: 0, bidTooLowPenaltyPmpe: 0 }
  return {
    bondBalanceSol: overrides.bondBalanceSol ?? 0,
    claimableBondBalanceSol: overrides.bondBalanceSol ?? 0,
    lastBondBalanceSol: overrides.lastBondBalanceSol ?? 0,
    marinadeActivatedStakeSol: overrides.marinadeActivatedStakeSol ?? 0,
    values: { paidUndelegationSol: overrides.values?.paidUndelegationSol ?? 0 },
    revShare: { ...defaultRevShare, ...overrides.revShare },
  } as unknown as AuctionValidator
}

describe('calcBondRiskFee', () => {
  it('early exits when lastBondBalanceSol < 1', () => {
    const validator = makeValidator({
      bondBalanceSol: 100,
      lastBondBalanceSol: 0,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
    })
    const result = calcBondRiskFee(baseConfig, validator)!
    expect(result).toBeNull()
  })

  it('no action when bond balance is sufficient', () => {
    const validator = makeValidator({
      bondBalanceSol: 100,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
    })
    const result = calcBondRiskFee(baseConfig, validator)!
    expect(result).toBeNull()
  })

  it('computes forced undelegation and fee correctly when expected max pmpe > auction eff pmpe', () => {
    const validator = makeValidator({
      bondBalanceSol: 26,
      lastBondBalanceSol: 50,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 5 },
    })
    const result = calcBondRiskFee(baseConfig, validator)!
    expect(result.bondForcedUndelegation).toBeDefined()
    expect(result.bondRiskFee).toBeDefined()
    expect(result.paidUndelegationSol).toBeDefined()

    // Numerical assertions
    const bf = result.bondForcedUndelegation!
    expect(bf.base).toBeCloseTo(12.5, 6)
    expect(bf.coef).toBeCloseTo(0.5, 6)
    expect(bf.value).toBeCloseTo(45, 6)
    expect(result.bondRiskFee).toBeCloseTo(1.8, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(4.5, 6)
  })

  it('computes forced undelegation and fee correctly when coef is negative', () => {
    const validator = makeValidator({
      bondBalanceSol: 12,
      lastBondBalanceSol: 50,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 5 },
      revShare: { expectedMaxEffBidPmpe: 45 },
    })
    const result = calcBondRiskFee(baseConfig, validator)!
    expect(result.bondForcedUndelegation).toBeDefined()
    expect(result.bondRiskFee).toBeDefined()
    expect(result.paidUndelegationSol).toBeDefined()

    // Numerical assertions
    const bf = result.bondForcedUndelegation!
    expect(bf.base).toBeCloseTo(9.179104477611943, 6)
    expect(bf.coef).toBeCloseTo(-0.19402985074626855, 5)
    expect(bf.value).toBeCloseTo(45, 6)
    expect(result.bondRiskFee).toBeCloseTo(1.8, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(4.5, 6)
  })

  it('computes forced undelegation and fee correctly when expected max pmpe < auction eff pmpe', () => {
    const validator = makeValidator({
      bondBalanceSol: 10,
      lastBondBalanceSol: 50,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 5 },
      revShare: { expectedMaxEffBidPmpe: 45, auctionEffectiveBidPmpe: 40 },
    })
    const result = calcBondRiskFee(baseConfig, validator)!
    expect(result.bondForcedUndelegation).toBeDefined()
    expect(result.bondRiskFee).toBeDefined()
    expect(result.paidUndelegationSol).toBeDefined()

    // Numerical assertions
    const bf = result.bondForcedUndelegation!
    expect(bf.base).toBeCloseTo(15.149253731343286, 6)
    expect(bf.coef).toBeCloseTo(0.28358208955223885, 5)
    expect(bf.value).toBeCloseTo(45, 6)
    expect(result.bondRiskFee).toBeCloseTo(1.08, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(4.5, 6)
  })

  it('clamps full undelegation when floor threshold met', () => {
    const cfg = { ...baseConfig, minBondBalanceSol: 1000 }
    const validator = makeValidator({
      bondBalanceSol: 10,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
    })
    const result = calcBondRiskFee(cfg, validator)!
    expect(result.bondForcedUndelegation!.value).toBeCloseTo(50)
    expect(result.bondRiskFee).toBeCloseTo(2.0, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(5, 6)
  })

  it('forces full undelegation when coefficient <= 0', () => {
    const revShare = { ...baseRevShare, totalPmpe: 1000, effParticipatingBidPmpe: 200, inflationPmpe: 500, mevPmpe: 300, auctionEffectiveBidPmpe: 200 }
    const validator = makeValidator({
      bondBalanceSol: 10,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
      revShare,
    })
    const result = calcBondRiskFee(baseConfig, validator)!
    expect(result.bondForcedUndelegation!.value).toBeCloseTo(50)
    expect(result.bondRiskFee).toBeCloseTo(baseConfig.bondRiskFeeMult * 50 * ((revShare.inflationPmpe + revShare.mevPmpe + revShare.auctionEffectiveBidPmpe) / 1000))
  })

  it('handles zero effective PMPE with zero fee', () => {
    const revShare = { ...baseRevShare, totalPmpe: 0, effParticipatingBidPmpe: 0, inflationPmpe: 0, mevPmpe: 0, auctionEffectiveBidPmpe: 0 }
    const validator = makeValidator({
      bondBalanceSol: 0,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
      revShare,
    })
    const result = calcBondRiskFee(baseConfig, validator)!
    expect(result.paidUndelegationSol).toBeCloseTo(5)
    expect(result.bondRiskFee).toBeCloseTo(0)
  })

  it('handles zero expected max PMPE', () => {
    const revShare = { ...baseRevShare, totalPmpe: 0, effParticipatingBidPmpe: 0, inflationPmpe: 0, mevPmpe: 0, auctionEffectiveBidPmpe: 0, expectedMaxEffBidPmpe: 0 }
    const validator = makeValidator({
      bondBalanceSol: 0,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
      revShare,
    })
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).toBeNull()
  })
})
