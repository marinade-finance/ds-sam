import assert from 'node:assert'

import { Auction } from '../src/auction'
import { Debug } from '../src/debug'
import { ineligibleValidatorAggDefaults } from '../src/utils'

import type { DsSamConfig } from '../src/config'
import type { AuctionConstraints } from '../src/constraints'
import type { AuctionData, AuctionValidator } from '../src/types'

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
            ...aggDefaults.bidTooLowPenalty,
          } as unknown as AuctionValidator['values'],
          ...aggDefaults,
        },
      ] as unknown as AuctionValidator[],
      stakeAmounts: {
        networkTotalSol: NaN,
        marinadeSamTvlSol: NaN,
        marinadeRemainingSamSol: NaN,
      },
      rewards: { inflationPmpe: NaN, mevPmpe: NaN, blockPmpe: NaN },
      blacklist: new Set<string>(),
    }
    const auction = new Auction(
      data,
      {} as unknown as AuctionConstraints,
      {} as unknown as DsSamConfig,
      new Debug(new Set()),
    )
    auction.updatePaidUndelegation()
    const v = data.validators[0]
    assert(v)
    return v.values.paidUndelegationSol
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
            ...aggDefaults.bidTooLowPenalty,
          } as unknown as AuctionValidator['values'],
          ...aggDefaults,
        },
      ] as unknown as AuctionValidator[],
      stakeAmounts: {
        networkTotalSol: NaN,
        marinadeSamTvlSol: NaN,
        marinadeRemainingSamSol: NaN,
      },
      rewards: { inflationPmpe: NaN, mevPmpe: NaN, blockPmpe: NaN },
      blacklist: new Set<string>(),
    }
    const auction = new Auction(
      data,
      {} as unknown as AuctionConstraints,
      {} as unknown as DsSamConfig,
      new Debug(new Set()),
    )
    auction.updatePaidUndelegation()
    const v = data.validators[0]
    assert(v)
    expect(v.values.paidUndelegationSol).toBeCloseTo(0)
  })

  it('paidUndelegation=0 with positive delta resets to 0', () => {
    const aggDefaults = ineligibleValidatorAggDefaults()
    const data: AuctionData = {
      epoch: NaN,
      validators: [
        {
          voteAccount: 'v1',
          marinadeActivatedStakeSol: 100,
          lastMarinadeActivatedStakeSol: 50,
          values: {
            paidUndelegationSol: 0,
            bondRiskFeeSol: 0,
            bondBalanceSol: null,
            marinadeActivatedStakeSol: 100,
            samBlacklisted: false,
            commissions: {
              inflationCommissionDec: 0,
              mevCommissionDec: 0,
              blockRewardsCommissionDec: 0,
              inflationCommissionOnchainDec: 0,
              inflationCommissionInBondDec: null,
              mevCommissionOnchainDec: null,
              mevCommissionInBondDec: null,
              blockRewardsCommissionInBondDec: null,
            },
          },
          ...aggDefaults,
        },
      ] as unknown as AuctionValidator[],
      stakeAmounts: {
        networkTotalSol: NaN,
        marinadeSamTvlSol: NaN,
        marinadeRemainingSamSol: NaN,
      },
      rewards: {
        inflationPmpe: NaN,
        mevPmpe: NaN,
        blockPmpe: NaN,
      },
      blacklist: new Set<string>(),
    }
    const auction = new Auction(
      data,
      {} as unknown as AuctionConstraints,
      {} as unknown as DsSamConfig,
      new Debug(new Set()),
    )
    // delta = 100 - 50 = 50 > 10% of 0 -> reset
    auction.updatePaidUndelegation()
    const v = data.validators[0]
    assert(v)
    expect(v.values.paidUndelegationSol).toBe(0)
  })
})
