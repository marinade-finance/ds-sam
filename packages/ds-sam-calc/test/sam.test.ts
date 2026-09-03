// clipBondStakeCap keeps a positive cap inside the 0.8x hysteresis band, and both
// delegation bots stake to that cap, so only an SDK-zeroed cap may project a total
// loss. A sub-min balance on its own must not.
import { augmentAuctionResult } from '../src/sam'

import type { AuctionResult, AuctionValidator } from '../src/types'

const MIN_BOND_BALANCE_SOL = 5

function makeValidator(overrides: Record<string, unknown> = {}): AuctionValidator {
  return {
    voteAccount: 'test',
    bondBalanceSol: 100,
    marinadeActivatedStakeSol: 10_000,
    auctionStake: { marinadeSamTargetSol: 10_000 },
    bondSamStakeCapSol: 250_000,
    unstakePriority: 1,
    revShare: { totalPmpe: 28 },
    values: { paidUndelegationSol: 0 },
    ...overrides,
  } as unknown as AuctionValidator
}

function deltaOf(validator: AuctionValidator, marinadeSamTvlSol = 0): number {
  const result = {
    winningTotalPmpe: 10,
    auctionData: { validators: [validator], stakeAmounts: { marinadeSamTvlSol } },
  } as unknown as AuctionResult
  const [augmented] = augmentAuctionResult(result, MIN_BOND_BALANCE_SOL)
  if (!augmented) {
    throw new Error('expected an augmented validator')
  }
  return augmented.values.expectedStakeChangeSol
}

describe('augmentAuctionResult below-min bond projection', () => {
  it('cap zeroed by the SDK → the whole stake is projected to leave', () => {
    expect(deltaOf(makeValidator({ bondBalanceSol: 2, bondSamStakeCapSol: 0 }))).toBe(-10_000)
  })

  it('inside the hysteresis band → the cap holds the stake, no total loss', () => {
    expect(deltaOf(makeValidator({ bondBalanceSol: 4.5, bondSamStakeCapSol: 10_000 }))).toBe(0)
  })

  // Below target with a rotation budget available, so a validator wrongly let out
  // of this branch would show inflow instead — the shape psr-dashboard pins too.
  it.each([
    ['never computed', undefined],
    ['NaN default', NaN],
  ])('cap %s → falls back to the balance verdict, loss still projected', (_name, bondSamStakeCapSol) => {
    const validator = makeValidator({
      bondBalanceSol: 2,
      bondSamStakeCapSol,
      marinadeActivatedStakeSol: 1_000,
      auctionStake: { marinadeSamTargetSol: 5_000 },
    })
    expect(deltaOf(validator, 20_000)).toBe(-1_000)
  })

  it('band row clipped below its active stake → only the excess leaves', () => {
    const validator = makeValidator({
      bondBalanceSol: 4.5,
      bondSamStakeCapSol: 1_500,
      auctionStake: { marinadeSamTargetSol: 1_500 },
    })
    expect(deltaOf(validator, 1_000_000)).toBe(-8_500)
  })
})
