/**
 * Focused tests for updatePaidUndelegation:
 *   • delta = current - last
 *   • undeleg = max(delta, 0)
 *   • paid resets if delta > 10% of priorPaid, otherwise paid += delta
 */

import { Debug } from '../src/debug'
import { Auction } from '../src/auction'
import { ineligibleValidatorAggDefaults } from '../src/utils'
import type { AuctionData, AuctionValidator } from '../src/types'

describe('Auction.updatePaidUndelegation (simplified)', () => {
  /**
   * run - simulate a single updatePaidUndelegation epoch:
   *
   * @param last     Marinade stake from the last epoch
   * @param current  Marinade stake for the current epoch
   * @param priorPaid previous paidUndelegationSol
   * @returns        { undelegationAmount, paidUndelegationSol }
   */
  function run(
    last: number,
    current: number,
    priorPaid: number
  ): {
    undelegationAmount: number
    paidUndelegationSol: number
  } {
    const aggDefaults = ineligibleValidatorAggDefaults()
    const data: AuctionData = {
      epoch: NaN,
      validators: [{
        voteAccount: 'v1',
        auctions: [{ marinadeActivatedStakeSol: last }] as any,
        marinadeActivatedStakeSol: current,
        values: {
          paidUndelegationSol: priorPaid,
          marinadeActivatedStakeSolUndelegation: 0,
          ...aggDefaults.bidTooLowPenalty
        } as any,
        ...aggDefaults
      }] as any[],
      stakeAmounts: {
        networkTotalSol: NaN,
        marinadeMndeTvlSol: NaN,
        marinadeSamTvlSol: NaN,
        marinadeRemainingMndeSol: NaN,
        marinadeRemainingSamSol: NaN
      },
      rewards: { inflationPmpe: NaN, mevPmpe: NaN },
      blacklist: new Set<string>()
    }
    const auction = new Auction(data, {} as any, {} as any, new Debug(new Set()))
    auction.updatePaidUndelegation()
    const { values } = data.validators[0]!
    return {
      undelegationAmount: values.marinadeActivatedStakeSolUndelegation,
      paidUndelegationSol: values.paidUndelegationSol
    }
  }

  it('resets paid undelegation new there is a new delegation > 10% of paid undelegation', () => {
    const { undelegationAmount, paidUndelegationSol } = run(100, 103, 20)
    expect(undelegationAmount).toBeCloseTo(0)
    expect(paidUndelegationSol).toBeCloseTo(0)
  })

  it('accumulates paid and no undelegation when new delegation ≤ 10% of paid undelegation', () => {
    const { undelegationAmount, paidUndelegationSol } = run(100, 102, 20)
    expect(undelegationAmount).toBeCloseTo(0)
    expect(paidUndelegationSol).toBeCloseTo(20)
  })

  it('records undelegation when delta ≤ 0; but does not go below 0', () => {
    const { undelegationAmount, paidUndelegationSol } = run(79, 70, 5)
    expect(undelegationAmount).toBeCloseTo(9)
    expect(paidUndelegationSol).toBeCloseTo(0)
  })

  it('records undelegation when delta ≤ 0', () => {
    const { undelegationAmount, paidUndelegationSol } = run(72, 70, 5)
    expect(undelegationAmount).toBeCloseTo(2)
    expect(paidUndelegationSol).toBeCloseTo(3)
  })

  it('treats empty auction history as zero last stake (no undelegation)', () => {
    const aggDefaults = ineligibleValidatorAggDefaults()
    const data: AuctionData = {
      epoch: NaN,
      validators: [{
        voteAccount: 'v1',
        auctions: [],
        marinadeActivatedStakeSol: 25,
        values: {
          paidUndelegationSol: 0,
          marinadeActivatedStakeSolUndelegation: NaN,
          ...aggDefaults.bidTooLowPenalty
        } as any,
        ...aggDefaults
      }] as any[],
      stakeAmounts: {
        networkTotalSol: NaN,
        marinadeMndeTvlSol: NaN,
        marinadeSamTvlSol: NaN,
        marinadeRemainingMndeSol: NaN,
        marinadeRemainingSamSol: NaN
      },
      rewards: { inflationPmpe: NaN, mevPmpe: NaN },
      blacklist: new Set<string>()
    }
    const auction = new Auction(data, {} as any, {} as any, new Debug(new Set()))
    auction.updatePaidUndelegation()
    const { values } = data.validators[0]!
    expect(values.marinadeActivatedStakeSolUndelegation).toBeCloseTo(0)
    expect(values.paidUndelegationSol).toBeCloseTo(0)
  })
})
