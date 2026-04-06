import { calcValidatorRevShare } from '../src/calculations'
import { effectiveCommissions } from '../src/utils'

describe('calculations', () => {
  it('effectiveCommissions: both mev null returns null', () => {
    const result = effectiveCommissions(0.05, null, null, null)
    expect(result.inflationDec).toBe(0.05)
    expect(result.mevDec).toBeNull()
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
