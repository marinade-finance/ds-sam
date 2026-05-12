/**
 * Tests cover:
 *  - early exit when lastBondBalanceSol < 1
 *  - no action when bond balance is sufficient
 *  - forced undelegation and fee computation (various coef/pmpe combos)
 *  - clamping: floor threshold, coef <= 0, full exposed stake
 *  - division by zero: idealBondPmpe=0, zero effective PMPE
 *  - zero expected max PMPE
 *  - SDK integration: bondRiskFeeMult=0 yields 0
 */

import assert from 'node:assert'

import { DsSamSDK } from '../src'
import { calcBondRiskFee } from '../src/calculations'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { findValidatorInResult } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

import type { BondRiskFeeConfig } from '../src/calculations'
import type { AuctionValidator, RevShare } from '../src/types'

const baseRevShare = {
  totalPmpe: 500,
  effParticipatingBidPmpe: 200,
  inflationPmpe: 100,
  mevPmpe: 90,
  blockPmpe: 10,

  auctionEffectiveBidPmpe: 200,
  activatingStakePmpe: 0,
  expectedMaxEffBidPmpe: 200,
  blacklistPenaltyPmpe: NaN,
}

const baseConfig: BondRiskFeeConfig = {
  minBondEpochs: 1,
  idealBondEpochs: 2,
  minBondBalanceSol: 10,
  bondRiskFeeMult: 0.1,
}

function makeValidator(
  overrides: {
    bondBalanceSol?: number
    lastBondBalanceSol?: number
    marinadeActivatedStakeSol?: number
    values?: { paidUndelegationSol: number }
    revShare?: Partial<RevShare>
  } = {},
): AuctionValidator {
  const defaultRevShare: RevShare = {
    ...baseRevShare,
    bidPmpe: 0,
    bidTooLowPenaltyPmpe: 0,
    onchainDistributedPmpe: baseRevShare.inflationPmpe + baseRevShare.mevPmpe,
    bondObligationPmpe: baseRevShare.blockPmpe,
    auctionEffectiveStaticBidPmpe: 0,
  }
  const revShare = { ...defaultRevShare, ...overrides.revShare }
  const minBidReservePmpe = baseConfig.minBondEpochs * revShare.expectedMaxEffBidPmpe
  const idealBidReservePmpe = baseConfig.idealBondEpochs * revShare.expectedMaxEffBidPmpe
  return {
    bondBalanceSol: overrides.bondBalanceSol ?? 0,
    claimableBondBalanceSol: overrides.bondBalanceSol ?? 0,
    lastBondBalanceSol: overrides.lastBondBalanceSol ?? 0,
    marinadeActivatedStakeSol: overrides.marinadeActivatedStakeSol ?? 0,
    unprotectedStakeSol: 0,
    minBondPmpe: revShare.onchainDistributedPmpe + revShare.expectedMaxEffBidPmpe + minBidReservePmpe,
    idealBondPmpe: revShare.onchainDistributedPmpe + revShare.expectedMaxEffBidPmpe + idealBidReservePmpe,
    minUnprotectedReserve: 0,
    idealUnprotectedReserve: 0,
    values: { paidUndelegationSol: overrides.values?.paidUndelegationSol ?? 0 },
    revShare,
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
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).toBeNull()
  })

  it('no action when bond balance is sufficient', () => {
    const validator = makeValidator({
      bondBalanceSol: 100,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
    })
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).toBeNull()
  })

  it('computes forced undelegation and fee correctly when expected max pmpe > auction eff pmpe', () => {
    const validator = makeValidator({
      bondBalanceSol: 26,
      lastBondBalanceSol: 50,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 5 },
      revShare: { onchainDistributedPmpe: 200 },
    })
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).not.toBeNull()
    assert(result)
    expect(result.bondForcedUndelegation).toBeDefined()
    expect(result.bondRiskFeeSol).toBeDefined()
    expect(result.paidUndelegationSol).toBeDefined()

    // Numerical assertions
    const bf = result.bondForcedUndelegation
    expect(bf.base).toBeCloseTo(12.5, 6)
    expect(bf.coef).toBeCloseTo(0.5, 6)
    expect(bf.value).toBeCloseTo(45, 6)
    expect(result.bondRiskFeeSol).toBeCloseTo(1.8, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(4.5, 6)
  })

  it('computes forced undelegation and fee correctly when coef is negative', () => {
    const validator = makeValidator({
      bondBalanceSol: 12,
      lastBondBalanceSol: 50,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 5 },
      revShare: { expectedMaxEffBidPmpe: 45, onchainDistributedPmpe: 200 },
    })
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).not.toBeNull()
    assert(result)
    expect(result.bondForcedUndelegation).toBeDefined()
    expect(result.bondRiskFeeSol).toBeDefined()
    expect(result.paidUndelegationSol).toBeDefined()

    // Numerical assertions
    const bf = result.bondForcedUndelegation
    expect(bf.base).toBeCloseTo(9.179104477611943, 6)
    expect(bf.coef).toBeCloseTo(-0.19402985074626855, 5)
    expect(bf.value).toBeCloseTo(45, 6)
    expect(result.bondRiskFeeSol).toBeCloseTo(1.8, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(4.5, 6)
  })

  it('computes forced undelegation and fee correctly when expected max pmpe < auction eff pmpe', () => {
    const validator = makeValidator({
      bondBalanceSol: 10,
      lastBondBalanceSol: 50,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 5 },
      revShare: {
        expectedMaxEffBidPmpe: 45,
        auctionEffectiveBidPmpe: 40,
        activatingStakePmpe: 0,
        onchainDistributedPmpe: 200,
      },
    })
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).not.toBeNull()
    assert(result)
    expect(result.bondForcedUndelegation).toBeDefined()
    expect(result.bondRiskFeeSol).toBeDefined()
    expect(result.paidUndelegationSol).toBeDefined()

    // Numerical assertions
    const bf = result.bondForcedUndelegation
    expect(bf.base).toBeCloseTo(15.149253731343286, 6)
    expect(bf.coef).toBeCloseTo(0.28358208955223885, 5)
    expect(bf.value).toBeCloseTo(45, 6)
    expect(result.bondRiskFeeSol).toBeCloseTo(1.08, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(4.5, 6)
  })

  it('clamps full undelegation when floor threshold met', () => {
    const cfg = { ...baseConfig, minBondBalanceSol: 1000 }
    const validator = makeValidator({
      bondBalanceSol: 10,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
      revShare: { onchainDistributedPmpe: 200 },
    })
    const result = calcBondRiskFee(cfg, validator)
    expect(result).not.toBeNull()
    assert(result)
    expect(result.bondForcedUndelegation.value).toBeCloseTo(50)
    expect(result.bondRiskFeeSol).toBeCloseTo(2.0, 6)
    expect(result.paidUndelegationSol).toBeCloseTo(5, 6)
  })

  it('forces full undelegation when coefficient <= 0', () => {
    const revShare = {
      ...baseRevShare,
      totalPmpe: 1000,
      effParticipatingBidPmpe: 200,
      inflationPmpe: 490,
      mevPmpe: 300,
      blockPmpe: 10,
      auctionEffectiveBidPmpe: 200,
      activatingStakePmpe: 0,
      onchainDistributedPmpe: 790,
    }
    const validator = makeValidator({
      bondBalanceSol: 10,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
      revShare,
    })
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).not.toBeNull()
    assert(result)
    expect(result.bondForcedUndelegation.value).toBeCloseTo(50)
    expect(result.bondRiskFeeSol).toBeCloseTo(
      baseConfig.bondRiskFeeMult * 50 * ((revShare.onchainDistributedPmpe + revShare.auctionEffectiveBidPmpe) / 1000),
    )
  })

  it('handles zero effective PMPE with zero fee', () => {
    const revShare = {
      ...baseRevShare,
      totalPmpe: 0,
      effParticipatingBidPmpe: 0,
      inflationPmpe: 0,
      mevPmpe: 0,
      blockPmpe: 0,
      auctionEffectiveBidPmpe: 0,
      activatingStakePmpe: 0,
      onchainDistributedPmpe: 0,
    }
    const validator = makeValidator({
      bondBalanceSol: 0,
      lastBondBalanceSol: 10,
      marinadeActivatedStakeSol: 50,
      values: { paidUndelegationSol: 0 },
      revShare,
    })
    const result = calcBondRiskFee(baseConfig, validator)
    expect(result).not.toBeNull()
    assert(result)
    expect(result.paidUndelegationSol).toBeCloseTo(5)
    expect(result.bondRiskFeeSol).toBeCloseTo(0)
  })

  it('idealBondPmpe=0 division by zero', () => {
    const v = {
      ...makeValidator({
        bondBalanceSol: 1,
        lastBondBalanceSol: 1,
        marinadeActivatedStakeSol: 1000,
        values: { paidUndelegationSol: 0 },
        revShare: {
          onchainDistributedPmpe: 5,
          auctionEffectiveBidPmpe: 5,
          expectedMaxEffBidPmpe: 5,
        },
      }),
      claimableBondBalanceSol: 1,
      unprotectedStakeSol: 0,
      minBondPmpe: 10,
      idealBondPmpe: 0,
      minUnprotectedReserve: 0,
      idealUnprotectedReserve: 0,
    } as unknown as AuctionValidator
    const result = calcBondRiskFee(
      {
        minBondEpochs: 1,
        idealBondEpochs: 0,
        minBondBalanceSol: 0,
        bondRiskFeeMult: 1,
      },
      v,
    )
    assert(result)
    expect(result.bondForcedUndelegation.base).toBe(0)
    expect(result.bondForcedUndelegation.coef).toBe(-Infinity)
    expect(result.bondForcedUndelegation.value).toBe(1000)
  })

  it('coef <= 0 uses full exposed stake', () => {
    const v = {
      ...makeValidator({
        bondBalanceSol: 1,
        lastBondBalanceSol: 1,
        marinadeActivatedStakeSol: 500,
        values: { paidUndelegationSol: 0 },
        revShare: {
          onchainDistributedPmpe: 5,
          auctionEffectiveBidPmpe: 5,
          expectedMaxEffBidPmpe: 5,
        },
      }),
      claimableBondBalanceSol: 1,
      unprotectedStakeSol: 0,
      minBondPmpe: 10,
      idealBondPmpe: 10,
      minUnprotectedReserve: 0,
      idealUnprotectedReserve: 0,
    } as unknown as AuctionValidator
    const result = calcBondRiskFee(
      {
        minBondEpochs: 1,
        idealBondEpochs: 1,
        minBondBalanceSol: 0,
        bondRiskFeeMult: 1,
      },
      v,
    )
    assert(result)
    expect(result.bondForcedUndelegation.coef).toBe(0)
    expect(result.bondForcedUndelegation.value).toBe(500)
  })

  it('handles zero expected max PMPE', () => {
    const revShare = {
      ...baseRevShare,
      totalPmpe: 0,
      effParticipatingBidPmpe: 0,
      inflationPmpe: 0,
      mevPmpe: 0,
      blockPmpe: 0,
      auctionEffectiveBidPmpe: 0,
      activatingStakePmpe: 0,
      expectedMaxEffBidPmpe: 0,
      onchainDistributedPmpe: 0,
    }
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

describe('claimable vs effective bond inconsistency', () => {
  /**
   * BUG DEMONSTRATION
   *
   * bondStakeCapSam uses bondBalanceSol (effective = lowest, net of withdrawals AND settlement claims).
   * calcBondRiskFee uses claimableBondBalanceSol (net of settlement claims ONLY, ignores withdrawals).
   *
   * When a validator has a large pending withdrawal request:
   *   effective (bondBalanceSol)   = 200  SOL
   *   claimable (claimableBondSol) = 1000 SOL
   *
   * bondStakeCapSam correctly caps new stake at ~339 SOL (using effective=200).
   * calcBondRiskFee sees claimable=1000 and incorrectly skips the fee for 500 SOL of already-staked stake.
   *
   * Manual check with marinadeActivatedStakeSol=500, minBondPmpe=590:
   *   fee condition: claimableBondSol - minUnprotectedReserve < projectedExposedStakeSol * (minBondPmpe/1000)
   *   using claimable=1000: 1000 - 0 < 500 * 0.590 → 1000 < 295 → FALSE  → fee skipped (BUG)
   *   using effective=200:   200 - 0 < 500 * 0.590 →  200 < 295 → TRUE   → fee would fire (correct)
   */
  it('fee is incorrectly skipped for under-bonded validator with large pending withdrawal', () => {
    // Parameters: minBondEpochs=1, idealBondEpochs=2, expectedMaxEffBidPmpe=200
    // onchainDistributedPmpe = inflationPmpe + mevPmpe = 100 + 90 = 190
    // minBondPmpe = 190 + 200 + 1*200 = 590
    // idealBondPmpe = 190 + 200 + 2*200 = 790
    const cfg: BondRiskFeeConfig = {
      minBondEpochs: 1,
      idealBondEpochs: 2,
      minBondBalanceSol: 0,
      bondRiskFeeMult: 0.1,
    }

    const marinadeActivatedStakeSol = 500 // existing committed stake
    const effectiveBond = 200 // bondBalanceSol — what bondStakeCapSam sees
    const claimableBond = 1000 // claimableBondBalanceSol — what calcBondRiskFee sees

    const revShare: RevShare = {
      ...baseRevShare,
      bidPmpe: 0,
      bidTooLowPenaltyPmpe: 0,
      onchainDistributedPmpe: baseRevShare.inflationPmpe + baseRevShare.mevPmpe, // 190
      bondObligationPmpe: baseRevShare.blockPmpe,
      auctionEffectiveStaticBidPmpe: 0,
    }
    // minBondPmpe set by bondStakeCapSam from effective=200, unprotectedStakeSol=0
    const minBondPmpe = revShare.onchainDistributedPmpe + revShare.expectedMaxEffBidPmpe + cfg.minBondEpochs * revShare.expectedMaxEffBidPmpe // 590
    const idealBondPmpe = revShare.onchainDistributedPmpe + revShare.expectedMaxEffBidPmpe + cfg.idealBondEpochs * revShare.expectedMaxEffBidPmpe // 790

    // Simulate state after bondStakeCapSam(bondBalanceSol=200) has run:
    // unprotectedStakeSol=0, minUnprotectedReserve=0, idealUnprotectedReserve=0
    const validator = {
      ...makeValidator({
        bondBalanceSol: effectiveBond,
        marinadeActivatedStakeSol,
        values: { paidUndelegationSol: 0 },
        revShare,
      }),
      claimableBondBalanceSol: claimableBond, // HIGHER value
      unprotectedStakeSol: 0,
      minBondPmpe,
      idealBondPmpe,
      minUnprotectedReserve: 0, // computed from effective=200, unprotected=0
      idealUnprotectedReserve: 0,
    } as unknown as AuctionValidator

    // Fee check condition (manual):
    //   claimableBond - minUnprotectedReserve < projectedExposedStakeSol * (minBondPmpe / 1000)
    //   1000 - 0 < 500 * (590/1000)
    //   1000 < 295  → FALSE → fee NOT fired
    const resultWithClaimable = calcBondRiskFee(cfg, validator)

    // What the check would produce if using effective bond consistently:
    //   200 - 0 < 500 * (590/1000)
    //   200 < 295  → TRUE → fee WOULD fire
    const validatorEffective = { ...validator, claimableBondBalanceSol: effectiveBond } as unknown as AuctionValidator
    const resultWithEffective = calcBondRiskFee(cfg, validatorEffective)

    // The code uses claimable=1000 → fee is NOT charged (returns null)
    // This is the BUG: the validator's actual usable bond is only 200 SOL,
    // which cannot cover 500 SOL × 590‰ = 295 SOL obligation.
    expect(resultWithClaimable).toBeNull() // BUG: fee skipped because claimable=1000 masks the shortfall

    // If the fee were computed consistently with the effective bond (200 SOL), it WOULD fire
    expect(resultWithEffective).not.toBeNull() // correct: 200 < 295 → fee due
  })
})

describe('setBondRiskFee (SDK integration)', () => {
  it('yields 0 when bondRiskFeeMult=0', async () => {
    const votes = generateVoteAccounts('brisk')
    const ids = generateIdentities()
    const val = new ValidatorMockBuilder(votes.next().value, ids.next().value)
      .withGoodPerformance()
      .withLiquidStake(100_000)
      .withNativeStake(50_000)
      .withBond({
        stakeWanted: 200_000,
        cpmpe: 0,
        balance: 100,
      })

    const dsSam = new DsSamSDK({ bondRiskFeeMult: 0 }, defaultStaticDataProviderBuilder([val]))
    const result = await dsSam.run()

    const v = findValidatorInResult(val.voteAccount, result)
    assert(v)
    expect(v.values.bondRiskFeeSol).toBe(0)
  })
})
