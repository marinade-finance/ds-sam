import { AuctionData, AuctionResult, AuctionValidator } from './types'
import { AuctionConstraints } from './constraints'

const logValidators = (validators: AuctionValidator[]) => {
  console.log('validators -----------------------------')
  for (const validator of validators) {
    console.log(validator.voteAccount, validator.revShare.totalPmpe, validator.auctionStake.marinadeMndeTargetSol, validator.auctionStake.marinadeSamTargetSol)
  }
}

const EPSILON = 1e-4

export class Auction {

  constructor (private data: AuctionData, private constraints: AuctionConstraints) { }

  // TODO WIP function
  distributeMndeStake () {
    const minCapEntity = this.constraints.getMinCapStakeConcentrationEntity()
    console.log('min cap entity', minCapEntity)

    const eligibleValidators = minCapEntity.validators.filter(validator => validator.mndeEligible)
    const solToCap = Math.min(minCapEntity.totalLeftToCapSol, minCapEntity.marinadeLeftToCapSol)

    this.data.stakeAmounts.marinadeRemainingMndeSol -= solToCap
  }

  evaluate (): AuctionData {
    this.data.validators.sort((a, b) => b.revShare.totalPmpe - a.revShare.totalPmpe)
    this.constraints.updateStateForSam(this.data)

    // logValidators(this.data.validators)

    let previousGroupPmpe = Infinity
    let group = null
    while (group = this.findNextPmpeGroup(previousGroupPmpe)) {

      console.log('========= new round ==========')

      if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
        console.log("No stake remaining to distribute")
        break
      }

      while (group.validators.length > 0) {
        const remainingStakeToDistribute = this.data.stakeAmounts.marinadeRemainingSamSol
        const groupVoteAccounts = new Set([...group.validators.map((validator) => validator.voteAccount)])
        const evenDistributionCap = Math.min(this.constraints.getMinCapForEvenDistribution(groupVoteAccounts), remainingStakeToDistribute / group.validators.length)
        console.log("distributing", evenDistributionCap, "to every validator in the group")

        for (const groupValidator of group.validators) {
          const validator = this.data.validators.find((validator) => validator.voteAccount === groupValidator.voteAccount)
          if (!validator) {
            throw new Error("Validator not found!")
          }
          validator.auctionStake.marinadeSamTargetSol += evenDistributionCap
          this.data.stakeAmounts.marinadeRemainingSamSol -= evenDistributionCap
        }

        logValidators(group.validators)

        this.constraints.updateStateForSam(this.data)
        group.validators = group.validators.filter((validator) => {
          const validatorCap = this.constraints.findCapForValidator(validator)
          if (validatorCap < EPSILON) {
            console.log('removing validfator', validator.voteAccount, 'from the group because the cap has been reached')
            return false
          }
          return true
        })

        if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
          console.log("No stake remaining to distribute")
          break
        } else {
          console.log("Stake remaining", this.data.stakeAmounts.marinadeRemainingSamSol)
        }
      }

      previousGroupPmpe = group.totalPmpe
    }

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

    return this.data
  }

  findNextPmpeGroup (totalPmpe: number): { totalPmpe: number, validators: AuctionValidator[] } | null {
    const nextGroupCandidates = this.data.validators.filter((validator) => validator.revShare.totalPmpe < totalPmpe)
    if (nextGroupCandidates.length === 0) {
      return null
    }
    const maxPmpe = nextGroupCandidates.reduce((max, validator) => Math.max(validator.revShare.totalPmpe, max), 0)
    const validators = nextGroupCandidates.filter((validator) => validator.revShare.totalPmpe === maxPmpe)

    return {
      totalPmpe: maxPmpe,
      validators,
    }
  }
}
