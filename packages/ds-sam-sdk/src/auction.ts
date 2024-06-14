import { AuctionData, AuctionResult } from './types'
import { AuctionConstraints } from './constraints'

export class Auction {

  constructor (private data: AuctionData, private constraints: AuctionConstraints) {}

  // TODO WIP function
  distributeMndeStake () {
    const minCapEntity = this.constraints.getMinCapStakeConcentrationEntity()
    console.log('min cap entity', minCapEntity)

    const eligibleValidators = minCapEntity.validators.filter(validator => validator.mndeEligible)
    const solToCap = Math.min(minCapEntity.totalLeftToCapSol, minCapEntity.marinadeLeftToCapSol)

    this.data.stakeAmounts.marinadeRemainingMndeSol -= solToCap
  }

  evaluate (): AuctionResult {
    this.data.validators.sort((a, b) => b.revShare.totalPmpe - a.revShare.totalPmpe)
    this.constraints.updateState(this.data)

    // this.distributeMndeStake()
    // console.log('VALIDATORS', this.data.validators.map(v => ({
    //   revShare: v.revShare,
    //   voteAccount: v.voteAccount,
    //   voteCredits: v.voteCredits,
    //   samEligible: v.samEligible,
    //   mndeEligible: v.mndeEligible,
    //   bondBalanceSol: v.bondBalanceSol,
    //   mevCommissionDec: v.mevCommissionDec,
    //   inflationCommissionDec: v.inflationCommissionDec,
    //   bidCpmpe: v.bidCpmpe,
    //   totalActivatedStakeSol: v.totalActivatedStakeSol,
    //   mndeVotesSolValue: v.mndeVotesSolValue,
    // })).slice(0, 20))

    return 'auction done'
  }
}
