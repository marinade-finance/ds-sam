import { formatLastCapConstraint } from '../../src/utils'

import type { AuctionResult, AuctionValidator } from '../../src'

export const isNotNull = <T>(value: T | null): value is T => value !== null

export const prettyPrintAuctionResult = (auctionResult: AuctionResult) => {
  return [
    ...auctionResult.auctionData.validators.map(
      ({ voteAccount, revShare, auctionStake, lastCapConstraint }) =>
        `${voteAccount}, inflation pmpe: ${revShare.inflationPmpe}, mev pmpe: ${revShare.mevPmpe}, bid pmpe: ${revShare.bidPmpe}, block pmpe: ${revShare.blockPmpe}, ` +
        `on-chain distributed pmpe: ${revShare.onchainDistributedPmpe} total pmpe: ${revShare.totalPmpe}, ` +
        `sam_target_stake: ${auctionStake.marinadeSamTargetSol}, last constraint: ${formatLastCapConstraint(lastCapConstraint)}`,
    ),
  ].join('\n')
}

export const prettyPrintStakeUnstakePriorities = (auctionResult: AuctionResult) =>
  auctionResult.auctionData.validators
    .map(
      ({ voteAccount, revShare, stakePriority, unstakePriority }) =>
        `${voteAccount} PMPE: ${revShare.totalPmpe} stake: ${stakePriority} unstake: ${unstakePriority}`,
    )
    .join('\n')

export const findValidatorInResult = (validatorVoteAccount: string, result: AuctionResult) =>
  result.auctionData.validators.find(({ voteAccount }) => voteAccount === validatorVoteAccount)

export const assertValidatorIneligible = (validator: AuctionValidator | undefined) => {
  expect(validator).toBeDefined()
  expect(validator?.samEligible).toStrictEqual(false)
  expect(validator?.auctionStake.marinadeSamTargetSol).toStrictEqual(0)
}
