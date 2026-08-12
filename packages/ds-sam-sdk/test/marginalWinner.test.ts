import assert from 'assert'

import { allocateRedelegation, selectNonBidPmpe } from '@marinade.finance/ds-sam-calc'

import { DsSamSDK } from '../src'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

import type { AuctionResult, AuctionValidator } from '../src'

// psr-dashboard rebases the clearing price onto a validator's own commission
// profile as `winningTotalPmpe - selectNonBidPmpe(marginalWinner)`, where
// marginalWinner is the lowest-PMPE validator holding SAM stake. That is only a
// bid while winningTotalPmpe names the marginal winner's own PMPE group;
// otherwise the subtraction crosses two unrelated validators and the caller's
// Math.max(0, ...) hides the mismatch. Backstop stake also lands in
// marinadeSamTargetSol, so this only holds while the backstop is disabled.
const assertMarginalWinnerIsMarginal = (result: AuctionResult): AuctionValidator => {
  const { marginalWinner } = allocateRedelegation(result, 0)
  const winners = result.auctionData.validators.filter(v => v.auctionStake.marinadeSamTargetSol > 0)

  expect(winners.length).toBeGreaterThan(0)
  assert(marginalWinner, 'auction produced no marginal winner')

  const lowestWinnerPmpe = Math.min(...winners.map(v => v.revShare.totalPmpe))
  expect(marginalWinner.revShare.totalPmpe).toStrictEqual(lowestWinnerPmpe)
  expect(result.winningTotalPmpe).toStrictEqual(lowestWinnerPmpe)
  expect(result.winningTotalPmpe - selectNonBidPmpe(marginalWinner)).toBeCloseTo(marginalWinner.revShare.bidPmpe, 9)

  return marginalWinner
}

// Uniform-price settlement: the marginal winner sets the price, so it pays
// exactly its own bid, and no winner ever pays more than it bid. Both follow
// from winningTotalPmpe naming the marginal winner's group — understating it
// charges every winner below the true clearing price.
const assertWinnersPayClearingPrice = (result: AuctionResult, marginalWinner: AuctionValidator) => {
  const winners = result.auctionData.validators.filter(v => v.auctionStake.marinadeSamTargetSol > 0)

  expect(marginalWinner.revShare.auctionEffectiveStaticBidPmpe).toBeCloseTo(marginalWinner.revShare.bidPmpe, 9)

  for (const winner of winners) {
    const { revShare } = winner
    expect(revShare.auctionEffectiveStaticBidPmpe).toBeLessThanOrEqual(revShare.bidPmpe + 1e-9)
    expect(revShare.auctionEffectiveBidPmpe).toBeCloseTo(
      Math.max(0, result.winningTotalPmpe - revShare.onchainDistributedPmpe),
      9,
    )
  }
}

// Five winners WANT-capped far below TVL, so SAM stake is still undistributed
// when the auction descends into the cheapest group; that group holds a single
// eligible validator whose country already exceeds the network concentration
// cap, so its cap never leaves 0 and it wins nothing.
const capBlockedTailScenario = () => {
  const voteAccounts = generateVoteAccounts()
  const identities = generateIdentities()
  const winners = Array.from({ length: 5 }, (_, i) =>
    new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withCountry('WINNER_COUNTRY')
      .withAso('WINNER_ASO')
      .withLiquidStake(200_000)
      .withExternalStake(10_000)
      .withBond({ stakeWanted: 1_000, cpmpe: 0.5 + i * 0.1, balance: 1000 }),
  )
  const capBlocked = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
    .withEligibleDefaults()
    .withCountry('SATURATED_COUNTRY')
    .withAso('SATURATED_ASO')
    .withLiquidStake(0)
    .withExternalStake(50_000_000)
    .withBond({ stakeWanted: 1e6, cpmpe: 0.01, balance: 1000 })

  return { validators: [...winners, capBlocked], capBlocked }
}

describe('marginal winner', () => {
  it('names the lowest-PMPE winner when every group can absorb stake', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()
    const validators = Array.from({ length: 30 }, (_, i) =>
      new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withBond({ stakeWanted: 1e6, cpmpe: 0.1 + i * 0.01, balance: 1000 }),
    )

    const result = await new DsSamSDK({}, defaultStaticDataProviderBuilder(validators)).run()
    const marginalWinner = assertMarginalWinnerIsMarginal(result)
    assertWinnersPayClearingPrice(result, marginalWinner)

    expect(marginalWinner.revShare.bidPmpe).toStrictEqual(0.1)
  })

  it('names the lowest-PMPE winner when the cheapest group is cap-blocked and stake is left over', async () => {
    const { validators, capBlocked } = capBlockedTailScenario()

    const result = await new DsSamSDK({}, defaultStaticDataProviderBuilder(validators)).run()

    const blocked = result.auctionData.validators.find(v => v.voteAccount === capBlocked.voteAccount)
    expect(blocked?.samEligible).toStrictEqual(true)
    expect(blocked?.auctionStake.marinadeSamTargetSol).toStrictEqual(0)
    // Far above EPSILON, or distributeSamStake would stop before descending into the
    // cap-blocked group and these tests would pass with the fix reverted.
    expect(result.auctionData.stakeAmounts.marinadeRemainingSamSol).toBeGreaterThan(100_000)

    assertMarginalWinnerIsMarginal(result)
  })

  it('charges the clearing price when the cheapest group is cap-blocked', async () => {
    const { validators, capBlocked } = capBlockedTailScenario()

    const result = await new DsSamSDK({}, defaultStaticDataProviderBuilder(validators)).run()
    const marginalWinner = assertMarginalWinnerIsMarginal(result)
    assertWinnersPayClearingPrice(result, marginalWinner)

    // The cap-blocked validator sits below the cutoff and is billed as an outsider.
    const blocked = result.auctionData.validators.find(v => v.voteAccount === capBlocked.voteAccount)
    expect(blocked?.revShare.auctionEffectiveBidPmpe).toStrictEqual(blocked?.revShare.bondObligationPmpe)
  })

  // expectedMaxWinningBidRatio makes the dry run in updateExpectedMaxEffBidPmpe
  // feed bond stake caps, so a clearing price taken from a cap-blocked group
  // would understate every validator's expected bid and inflate its cap.
  it('keeps the clearing price intact when the dry run drives bond caps', async () => {
    const { validators } = capBlockedTailScenario()

    const result = await new DsSamSDK(
      { expectedMaxWinningBidRatio: 1.2, minExpectedEffBidPmpe: 0.01 },
      defaultStaticDataProviderBuilder(validators),
    ).run()
    const marginalWinner = assertMarginalWinnerIsMarginal(result)
    assertWinnersPayClearingPrice(result, marginalWinner)

    // The dry run priced a real bid rather than collapsing to minExpectedEffBidPmpe.
    expect(marginalWinner.revShare.expectedMaxEffBidPmpe).toBeGreaterThan(0.01)
  })
})
