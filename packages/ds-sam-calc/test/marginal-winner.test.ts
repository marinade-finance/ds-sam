// Tests for allocateRedelegation's marginalWinner: it must name the price-setting
// auction winner, not any validator that merely holds stake.
import { allocateRedelegation } from '../src/sam'

import type { AuctionResult, AuctionValidator } from '../src'

function makeValidator(voteAccount: string, totalPmpe: number, samTargetSol: number): AuctionValidator {
  return {
    voteAccount,
    totalActivatedStakeSol: samTargetSol,
    marinadeActivatedStakeSol: samTargetSol,
    bondBalanceSol: 100,
    auctionStake: { marinadeSamTargetSol: samTargetSol },
    revShare: { totalPmpe },
    values: { paidUndelegationSol: 0 },
  } as unknown as AuctionValidator
}

function makeResult(winningTotalPmpe: number, validators: AuctionValidator[]): AuctionResult {
  return {
    winningTotalPmpe,
    auctionData: {
      validators,
      stakeAmounts: { marinadeSamTvlSol: 0, marinadeRemainingSamSol: 0 },
    },
  } as unknown as AuctionResult
}

describe('allocateRedelegation — marginalWinner', () => {
  it('names the lowest-totalPmpe winner at the clearing price', () => {
    const result = makeResult(10, [makeValidator('HIGH', 12, 500), makeValidator('MARG', 10, 500)])

    expect(allocateRedelegation(result, 0).marginalWinner?.voteAccount).toBe('MARG')
  })

  it('ignores stake held below the clearing price', () => {
    // Backstop stake lands in the same marinadeSamTargetSol field, so a validator
    // under the cutoff can hold stake without having won the auction.
    const result = makeResult(10, [
      makeValidator('HIGH', 12, 500),
      makeValidator('MARG', 10, 500),
      makeValidator('BACKSTOP', 4, 500),
    ])

    expect(allocateRedelegation(result, 0).marginalWinner?.voteAccount).toBe('MARG')
  })

  it('is null when nobody holds stake at the clearing price', () => {
    const result = makeResult(10, [makeValidator('OUT', 8, 0), makeValidator('BACKSTOP', 4, 500)])

    expect(allocateRedelegation(result, 0).marginalWinner).toBeNull()
  })
})
