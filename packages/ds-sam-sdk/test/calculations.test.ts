import {
  calcValidatorRevShare,
  effectiveCommissions,
  isInflationCommissionUnresolved,
} from '@marinade.finance/ds-sam-calc'

describe('calculations', () => {
  it('effectiveCommissions: both mev null returns null', () => {
    const result = effectiveCommissions(0.05, null, null, null)
    expect(result.inflationDec).toBe(0.05)
    expect(result.mevDec).toBeNull()
  })

  it('effectiveCommissions: unknown on-chain inflation falls back to the in-bond rate', () => {
    expect(effectiveCommissions(null, 0.03, null, null).inflationDec).toBe(0.03)
  })

  it('effectiveCommissions: unknown on-chain inflation with no bond rate stays unknown', () => {
    expect(effectiveCommissions(null, null, null, null).inflationDec).toBeNull()
  })

  it('effectiveCommissions: the lower of the two rates still wins', () => {
    expect(effectiveCommissions(0.07, 0.03, null, null).inflationDec).toBe(0.03)
    expect(effectiveCommissions(0.03, 0.07, null, null).inflationDec).toBe(0.03)
  })

  it('effectiveCommissions: a negative in-bond rate is a subsidy, not an unknown', () => {
    expect(effectiveCommissions(0.05, -0.1, null, null).inflationDec).toBe(-0.1)
  })

  it('isInflationCommissionUnresolved: an override resolves an absent on-chain rate', () => {
    const commissions = {
      inflationCommissionDec: 0.05,
      mevCommissionDec: 1,
      blockRewardsCommissionDec: 1,
      inflationCommissionOnchainDec: null,
      inflationCommissionInBondDec: null,
      mevCommissionOnchainDec: null,
      mevCommissionInBondDec: null,
      blockRewardsCommissionOnchainDec: null,
      blockRewardsCommissionInBondDec: null,
    }
    expect(isInflationCommissionUnresolved(commissions)).toBe(true)
    expect(isInflationCommissionUnresolved({ ...commissions, inflationCommissionOverrideDec: 0.05 })).toBe(false)
    expect(isInflationCommissionUnresolved({ ...commissions, inflationCommissionOnchainDec: 0 })).toBe(false)
  })

  it('calcValidatorRevShare: block revenue is charged from the bond only while it has no on-chain rate', () => {
    const rewards = { inflationPmpe: 0, mevPmpe: 0, blockPmpe: 20 }
    const commissions = {
      inflationCommissionDec: 1,
      mevCommissionDec: 1,
      blockRewardsCommissionDec: 0.1,
      inflationCommissionOnchainDec: 1,
      inflationCommissionInBondDec: null,
      mevCommissionOnchainDec: null,
      mevCommissionInBondDec: null,
      blockRewardsCommissionOnchainDec: null,
      blockRewardsCommissionInBondDec: 0.1,
    }
    const validator = {
      voteAccount: 'v',
      inflationCommissionDec: 1,
      mevCommissionDec: null,
      blockRewardsCommissionDec: 0.1,
      bidCpmpe: 0,
      values: { commissions },
    }

    // No on-chain rate: the whole 18 PMPE block share is a bond obligation, and none of it counts as
    // already distributed on chain.
    const bondOnly = calcValidatorRevShare(validator, rewards)
    expect(bondOnly.blockPmpe).toBe(18)
    expect(bondOnly.bondObligationPmpe).toBe(18)
    expect(bondOnly.onchainDistributedPmpe).toBe(0)

    // Same 10% rate now visible on chain: the share is distributed there, so the bond owes nothing.
    const onchain = calcValidatorRevShare(
      { ...validator, values: { commissions: { ...commissions, blockRewardsCommissionOnchainDec: 0.1 } } },
      rewards,
    )
    expect(onchain.blockPmpe).toBe(18)
    expect(onchain.bondObligationPmpe).toBe(0)
    expect(onchain.onchainDistributedPmpe).toBe(18)
  })

  it('calcValidatorRevShare: an unknown on-chain rate charges no inflation top-up from the bond', () => {
    const rewards = { inflationPmpe: 100, mevPmpe: 50, blockPmpe: 20 }
    const commissions = {
      inflationCommissionDec: 0.05,
      mevCommissionDec: 1,
      blockRewardsCommissionDec: 1,
      inflationCommissionOnchainDec: null,
      inflationCommissionInBondDec: 0.05,
      mevCommissionOnchainDec: null,
      mevCommissionInBondDec: null,
      blockRewardsCommissionOnchainDec: null,
      blockRewardsCommissionInBondDec: null,
    }
    const validator = {
      voteAccount: 'v',
      inflationCommissionDec: 0.05,
      mevCommissionDec: null,
      blockRewardsCommissionDec: null,
      bidCpmpe: 1,
      values: { commissions },
    }

    const unresolved = calcValidatorRevShare(validator, rewards)
    expect(unresolved.onchainDistributedPmpe).toBe(0)
    expect(unresolved.bondObligationPmpe).toBe(1)

    // Same validator once the on-chain rate is known: the top-up is measurable and stays zero, because
    // the in-bond rate matches what was distributed on chain.
    const resolved = calcValidatorRevShare(
      { ...validator, values: { commissions: { ...commissions, inflationCommissionOnchainDec: 0.05 } } },
      rewards,
    )
    expect(resolved.onchainDistributedPmpe).toBe(95)
    expect(resolved.bondObligationPmpe).toBe(1)
  })

  it('calcValidatorRevShare with commissionDec=1.0', () => {
    const result = calcValidatorRevShare(
      {
        voteAccount: 'v',
        inflationCommissionDec: 1.0,
        mevCommissionDec: 1.0,
        blockRewardsCommissionDec: 1.0,
        bidCpmpe: 0,
        values: {
          commissions: {
            inflationCommissionDec: 1.0,
            mevCommissionDec: 1.0,
            blockRewardsCommissionDec: 1.0,
            inflationCommissionOnchainDec: 1.0,
            inflationCommissionInBondDec: 1.0,
            mevCommissionOnchainDec: 1.0,
            mevCommissionInBondDec: 1.0,
            blockRewardsCommissionOnchainDec: 1.0,
            blockRewardsCommissionInBondDec: 1.0,
          },
        },
      },
      { inflationPmpe: 100, mevPmpe: 50, blockPmpe: 20 },
    )
    expect(result.inflationPmpe).toBe(0)
    expect(result.mevPmpe).toBe(0)
    expect(result.blockPmpe).toBe(0)
    expect(result.totalPmpe).toBe(0)
  })
})
