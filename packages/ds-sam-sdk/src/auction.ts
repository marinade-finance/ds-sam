import { AuctionData, AuctionResult, AuctionValidator } from './types'
import { AuctionConstraints } from './constraints'

const logValidators = (validators: AuctionValidator[]) => {
  console.log('validators -----------------------------')
  for (const validator of validators) {
    console.log(validator.voteAccount, validator.revShare.totalPmpe, validator.auctionStake.marinadeMndeTargetSol, validator.auctionStake.marinadeSamTargetSol)
  }
  console.log('----------------------------- validators')
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
      console.log("MNDE distributing", evenDistributionCap, "to every validator in the group", eligibleValidators.size)

      for (const validator of eligibleValidators.values()) {
        validator.auctionStake.marinadeMndeTargetSol += evenDistributionCap
        this.data.stakeAmounts.marinadeRemainingMndeSol -= evenDistributionCap
      }

      // logValidators(remEligibleValidators)

      this.constraints.updateStateForMnde(this.data)
      remEligibleValidators = remEligibleValidators.filter((validator) => {
        const validatorCap = this.constraints.findCapForValidator(validator)
        if (validatorCap < EPSILON) {
          console.log('MNDE removing validator', validator.voteAccount, 'from the group because the cap has been reached')
          return false
        }
        return true
      })

      if (this.data.stakeAmounts.marinadeRemainingMndeSol < EPSILON) {
        console.log("MNDE No stake remaining to distribute")
        break
      } else {
        console.log("MNDE Stake remaining", this.data.stakeAmounts.marinadeRemainingMndeSol)
      }
    }
  }

  distributeSamStake () {
    this.data.validators.sort((a, b) => b.revShare.totalPmpe - a.revShare.totalPmpe)
    this.constraints.updateStateForSam(this.data)

    // logValidators(this.data.validators)

    let previousGroupPmpe = Infinity
    let group = null
    let winningTotalPmpe = Infinity
    let groups = 0
    let rounds = 0
    while (group = this.findNextPmpeGroup(previousGroupPmpe)) {
      groups++
      group.validators = group.validators.filter(validator => validator.samEligible)

      console.log('SAM ========= new round ==========')
      console.log('SAM', group.validators.length, 'validators eligible')

      if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
        console.log("SAM No stake remaining to distribute")
        break
      }

      while (group.validators.length > 0) {
        rounds++
        const remainingStakeToDistribute = this.data.stakeAmounts.marinadeRemainingSamSol
        const groupValidators = new Map(group.validators.map(validator => [validator.voteAccount, validator]))
        const groupVoteAccounts = new Set(groupValidators.keys())

        const evenDistributionCap = Math.min(this.constraints.getMinCapForEvenDistribution(groupVoteAccounts), remainingStakeToDistribute / group.validators.length)
        console.log("SAM distributing", evenDistributionCap, "to every validator in the group", groupValidators.size)

        for (const validator of groupValidators.values()) {
          validator.auctionStake.marinadeSamTargetSol += evenDistributionCap
          this.data.stakeAmounts.marinadeRemainingSamSol -= evenDistributionCap
          winningTotalPmpe = validator.revShare.totalPmpe
        }

        // logValidators(group.validators)

        this.constraints.updateStateForSam(this.data)
        group.validators = group.validators.filter((validator) => {
          const validatorCap = this.constraints.findCapForValidator(validator)
          if (validatorCap < EPSILON) {
            console.log('SAM removing validator', validator.voteAccount, 'from the group because the cap has been reached')
            return false
          }
          return true
        })

        if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
          console.log("SAM No stake remaining to distribute")
          break
        } else {
          console.log("SAM Stake remaining", this.data.stakeAmounts.marinadeRemainingSamSol)
        }
      }

      previousGroupPmpe = group.totalPmpe
    }

    console.log("SAM rounds", rounds, "groups", groups)

    return winningTotalPmpe
  }

  evaluate (): AuctionResult {
    console.log('stake amounts before', this.data.stakeAmounts)
    this.distributeMndeStake()
    const winningTotalPmpe = this.distributeSamStake()

    console.log('stake amounts after', this.data.stakeAmounts)
    return {
      auctionData: this.data,
      winningTotalPmpe,
    }
  }

  findNextPmpeGroup (totalPmpe: number): { totalPmpe: number, validators: AuctionValidator[] } | null {
    console.log('finding next pmpe group...', totalPmpe)
    const nextGroupCandidates = this.data.validators.filter((validator) => validator.revShare.totalPmpe < totalPmpe)
    if (nextGroupCandidates.length === 0) {
      console.log('...no pmpe group remaining', totalPmpe)
      return null
    }
    const maxPmpe = nextGroupCandidates.reduce((max, validator) => Math.max(validator.revShare.totalPmpe, max), 0)
    const validators = nextGroupCandidates.filter((validator) => validator.revShare.totalPmpe === maxPmpe)

    console.log('...found next pmpe group', maxPmpe, validators.length)
    return {
      totalPmpe: maxPmpe,
      validators,
    }
  }
}
