import { AuctionResult, AuctionValidator } from "../../src"
import { formatLastCapConstraint } from '../../src/utils'

export const isNotNull = <T>(value: T | null): value is T => value !== null

export const prettyPrintAuctionResult = (auctionResult: AuctionResult) => {
  return [
    ...auctionResult.auctionData.validators.map(({ voteAccount, revShare, auctionStake, lastCapConstraint }) =>
      `${voteAccount}, inflation pmpe: ${revShare.inflationPmpe}, mev pmpe: ${revShare.mevPmpe}, bid pmpe: ${revShare.bidPmpe}, total pmpe: ${revShare.totalPmpe}, mnde_target_stake: ${auctionStake.marinadeMndeTargetSol}, sam_target_stake: ${auctionStake.marinadeSamTargetSol}, last constraint: ${formatLastCapConstraint(lastCapConstraint)}`)
  ].join('\n')
}

export const prettyPrintStakeUnstakePriorities = (auctionResult: AuctionResult) =>
  auctionResult.auctionData.validators.map(({ voteAccount, revShare, stakePriority, unstakePriority }) =>
    `${voteAccount} PMPE: ${revShare.totalPmpe} stake: ${stakePriority} unstake: ${unstakePriority}`).join('\n')

export const findValidatorInResult = (validatorVoteAccount: string, result: AuctionResult) =>
  result.auctionData.validators.find(({ voteAccount }) => voteAccount === validatorVoteAccount)

export const assertValidatorIneligible = (validator: AuctionValidator) => {
  expect(validator.mndeEligible).toStrictEqual(false)
  expect(validator.samEligible).toStrictEqual(false)
  expect(validator.auctionStake.marinadeMndeTargetSol).toStrictEqual(0)
  expect(validator.auctionStake.marinadeSamTargetSol).toStrictEqual(0)
}
