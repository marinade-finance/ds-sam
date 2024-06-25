import { AuctionResult } from "../../src"

export const isNotNull = <T>(value: T | null): value is T => value !== null

export const prettyPrintAuctionResult = (auctionResult: AuctionResult) => {
    return [
        ...auctionResult.auctionData.validators.map(({ voteAccount, revShare, auctionStake }) => `${voteAccount}, inlfation pmpe: ${revShare.inflationPmpe}, mev pmpe: ${revShare.mevPmpe}, bid pmpe: ${revShare.bidPmpe}, total pmpe: ${revShare.totalPmpe}, mnde_target_stake: ${auctionStake.marinadeMndeTargetSol}, sam_target_stake: ${auctionStake.marinadeSamTargetSol}`)
    ].join('\n')
}
