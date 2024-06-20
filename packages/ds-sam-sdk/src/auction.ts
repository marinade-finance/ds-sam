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

  distributeMndeStake () {
    this.constraints.updateStateForMnde(this.data)

    let remEligibleValidators = this.data.validators.filter(validator => validator.mndeEligible)
    
    while (remEligibleValidators.length > 0) {
      const eligibleValidators = new Map(remEligibleValidators.map(validator => [validator.voteAccount, validator]))
      const eligibleVoteAccounts = new Set(eligibleValidators.keys())
      const evenDistributionCap = this.constraints.getMinCapForEvenDistribution(eligibleVoteAccounts)
      console.log("distributing", evenDistributionCap, "to every validator in the group")

      for (const [_, validator] of eligibleValidators.entries()) {
        validator.auctionStake.marinadeMndeTargetSol += evenDistributionCap
        this.data.stakeAmounts.marinadeRemainingMndeSol -= evenDistributionCap
      }

      // logValidators(remEligibleValidators)

      this.constraints.updateStateForMnde(this.data)
      remEligibleValidators = remEligibleValidators.filter((validator) => {
        const validatorCap = this.constraints.findCapForValidator(validator)
        if (validatorCap < EPSILON) {
          console.log('removing validfator', validator.voteAccount, 'from the group because the cap has been reached')
          return false
        }
        return true
      })

      if (this.data.stakeAmounts.marinadeRemainingMndeSol < EPSILON) {
        console.log("No stake remaining to distribute")
        break
      } else {
        console.log("Stake remaining", this.data.stakeAmounts.marinadeRemainingMndeSol)
      }
    }
  }

  distributeSamStake () {
    this.data.validators.sort((a, b) => b.revShare.totalPmpe - a.revShare.totalPmpe)
    this.constraints.updateStateForSam(this.data)

    logValidators(this.data.validators)

    let previousGroupPmpe = Infinity
    let group = null
    let winningTotalPmpe = Infinity
    let groups = 0
    let rounds = 0
    while (group = this.findNextPmpeGroup(previousGroupPmpe)) {
      groups++
      group.validators = group.validators.filter(validator => validator.samEligible)

      console.log('========= new round ==========')

      if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
        console.log("No stake remaining to distribute")
        break
      }

      while (group.validators.length > 0) {
        rounds++
        const remainingStakeToDistribute = this.data.stakeAmounts.marinadeRemainingSamSol
        const groupValidators = new Map(group.validators.map(validator => [validator.voteAccount, validator]))
        const groupVoteAccounts = new Set(groupValidators.keys())

        const evenDistributionCap = Math.min(this.constraints.getMinCapForEvenDistribution(groupVoteAccounts), remainingStakeToDistribute / group.validators.length)
        console.log("distributing", evenDistributionCap, "to every validator in the group")

        for (const [_, validator] of groupValidators.entries()) {
          validator.auctionStake.marinadeSamTargetSol += evenDistributionCap
          this.data.stakeAmounts.marinadeRemainingSamSol -= evenDistributionCap
          winningTotalPmpe = validator.revShare.totalPmpe
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

    console.log("rounds", rounds, "groups", groups)

    return winningTotalPmpe
  }

  evaluate (): AuctionResult {
    this.distributeMndeStake()
    const winningTotalPmpe = this.distributeSamStake()

    return {
      auctionData: this.data,
      winningTotalPmpe: 0,
    }
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
