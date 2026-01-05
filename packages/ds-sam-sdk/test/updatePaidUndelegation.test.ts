/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import { Auction } from '../src/auction'
import { Debug } from '../src/debug'
import { ineligibleValidatorAggDefaults } from '../src/utils'

import type { AuctionData } from '../src/types'

describe('Auction.updatePaidUndelegation (simplified)', () => {
  /**
   * run - simulate a single updatePaidUndelegation epoch:
   *
   * @param last     Marinade stake from the last epoch
   * @param current  Marinade stake for the current epoch
   * @param priorPaid previous paidUndelegationSol
   * @returns paidUndelegationSol
   */
  function run(last: number, current: number, priorPaid: number): number {
    const aggDefaults = ineligibleValidatorAggDefaults()
    const data: AuctionData = {
      epoch: NaN,
      validators: [
        {
          voteAccount: 'v1',
          marinadeActivatedStakeSol: current,
          lastMarinadeActivatedStakeSol: last,
          values: {
            paidUndelegationSol: priorPaid,
            marinadeActivatedStakeSolUndelegation: 0,
            ...aggDefaults.bidTooLowPenalty,
          } as any,
          ...aggDefaults,
        },
      ] as any[],
      stakeAmounts: {
        networkTotalSol: NaN,
        marinadeMndeTvlSol: NaN,
        marinadeSamTvlSol: NaN,
        marinadeRemainingMndeSol: NaN,
        marinadeRemainingSamSol: NaN,
      },
      rewards: { inflationPmpe: NaN, mevPmpe: NaN, blockPmpe: NaN },
      blacklist: new Set<string>(),
    }
    const auction = new Auction(data, {} as any, {} as any, new Debug(new Set()))
    auction.updatePaidUndelegation()
    return data.validators[0]!.values.paidUndelegationSol
  }

  it('resets paid undelegation new there is a new delegation > 10% of paid undelegation', () => {
    const paidUndelegationSol = run(100, 103, 20)
    expect(paidUndelegationSol).toBeCloseTo(0)
  })

  it('accumulates paid and no undelegation when new delegation ≤ 10% of paid undelegation', () => {
    const paidUndelegationSol = run(100, 102, 20)
    expect(paidUndelegationSol).toBeCloseTo(20)
  })

  it('records undelegation when delta ≤ 0; but does not go below 0', () => {
    const paidUndelegationSol = run(79, 70, 5)
    expect(paidUndelegationSol).toBeCloseTo(0)
  })

  it('records undelegation when delta ≤ 0', () => {
    const paidUndelegationSol = run(72, 70, 5)
    expect(paidUndelegationSol).toBeCloseTo(3)
  })

  it('treats empty auction history as zero last stake (no undelegation)', () => {
    const aggDefaults = ineligibleValidatorAggDefaults()
    const data: AuctionData = {
      epoch: NaN,
      validators: [
        {
          voteAccount: 'v1',
          auctions: [],
          marinadeActivatedStakeSol: 25,
          values: {
            paidUndelegationSol: 0,
            marinadeActivatedStakeSolUndelegation: NaN,
            ...aggDefaults.bidTooLowPenalty,
          } as any,
          ...aggDefaults,
        },
      ] as any[],
      stakeAmounts: {
        networkTotalSol: NaN,
        marinadeMndeTvlSol: NaN,
        marinadeSamTvlSol: NaN,
        marinadeRemainingMndeSol: NaN,
        marinadeRemainingSamSol: NaN,
      },
      rewards: { inflationPmpe: NaN, mevPmpe: NaN, blockPmpe: NaN },
      blacklist: new Set<string>(),
    }
    const auction = new Auction(data, {} as any, {} as any, new Debug(new Set()))
    auction.updatePaidUndelegation()

    expect(data.validators[0]!.values.paidUndelegationSol).toBeCloseTo(0)
  })
})
