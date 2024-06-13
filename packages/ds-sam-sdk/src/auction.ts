import { AuctionData, AuctionResult } from './types'
import { AuctionConstraints } from './constraints'

export class Auction {

  constructor (private data: AuctionData, private constraints: AuctionConstraints) {}

  evaluate (): AuctionResult {
    this.data.validators.sort((a, b) => a.revShare.totalPmpe - b.revShare.totalPmpe)
    // console.log('VALIDATORS', this.data.validators.map(v => ({
    //   revShare: v.revShare,
    //   voteAccount: v.voteAccount,
    //   voteCredits: v.voteCredits,
    //   samEligible: v.samEligible,
    //   mndeEligible: v.mndeEligible,
    //   bondBalance: v.bondBalance,
    //   mevCommissionDec: v.mevCommissionDec,
    //   inflationCommissionDec: v.inflationCommissionDec,
    //   bidCpmpe: v.bidCpmpe,
    //   totalActivatedStake: v.totalActivatedStake,
    //   mndeVotesSolValue: v.mndeVotesSolValue,
    // })).slice(0, 20))
    this.constraints.evaluateState(this.data)

    return 'auction done'
  }
}
