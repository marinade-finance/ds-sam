import { calcEffParticipatingBidPmpe } from './utils'
import { AuctionData, AuctionResult, AuctionValidator } from './types'
import { AuctionConstraints, bondBalanceRequiredForCurrentStake } from './constraints'
import { DsSamConfig } from './config'
import { Debug } from './debug'

const logValidators = (validators: AuctionValidator[]) => {
  console.log('validators -----------------------------')
  for (const validator of validators) {
    console.log(validator.voteAccount, validator.revShare.totalPmpe, validator.auctionStake.marinadeMndeTargetSol, validator.auctionStake.marinadeSamTargetSol)
  }
  console.log('----------------------------- validators')
}

export const EPSILON = 1e-4

export class Auction {

  constructor (private data: AuctionData, private constraints: AuctionConstraints, private config: DsSamConfig, private debug: Debug) { }

  distributeMndeStake () {
    this.constraints.updateStateForMnde(this.data)
    this.debug.getVoteAccounts().forEach((voteAccount) => {
      const constraints = this.constraints.getValidatorConstraints(voteAccount)
      this.debug.pushValidatorEvent(voteAccount, `MNDE start constraints: ${constraints ? `${JSON.stringify(constraints.map(constraint => ({ ...constraint, validators: constraint.validators.length})))}` : 'NULL'}`)
    })

    let remEligibleValidators = this.data.validators.filter(validator => validator.mndeEligible)

    while (remEligibleValidators.length > 0) {
      const eligibleValidators = new Map(remEligibleValidators.map(validator => [validator.voteAccount, validator]))
      const eligibleVoteAccounts = new Set(eligibleValidators.keys())
      const { cap: evenDistributionCap } = this.constraints.getMinCapForEvenDistribution(eligibleVoteAccounts)
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
    this.constraints.updateStateForSam(this.data)
    this.debug.getVoteAccounts().forEach((voteAccount) => {
      const constraints = this.constraints.getValidatorConstraints(voteAccount)
      this.debug.pushValidatorEvent(voteAccount, `SAM start constraints: ${constraints ? `${JSON.stringify(constraints.map(constraint => ({ ...constraint, validators: constraint.validators.length})))}` : 'NULL'}`)
    })

    // logValidators(this.data.validators)

    let previousGroupPmpe = Infinity
    let group = null
    let winningTotalPmpe = Infinity
    let groups = 0
    let rounds = 0
    while (group = this.findNextPmpeGroup(previousGroupPmpe)) {
      groups++
      group.validators = group.validators.filter(validator => validator.samEligible && !validator.samBlocked)

      console.log('SAM ========= new round ==========')
      console.log('SAM', group.validators.length, 'validators eligible')
      this.debug.pushValidatorSetEvent(new Set(group.validators.map(({ voteAccount }) => voteAccount)), `assigned to PMPE group ${group.totalPmpe} with ${group.validators.length} eligible validators: ${group.validators.slice(0, 5).map(({ voteAccount }) => voteAccount).join(' ')}`)

      if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
        console.log("SAM No stake remaining to distribute")
        this.debug.pushEvent('SAM No stake remaining to distribute')
        break
      }

      while (group.validators.length > 0) {
        rounds++
        const remainingStakeToDistribute = this.data.stakeAmounts.marinadeRemainingSamSol
        const groupValidators = new Map(group.validators.map(validator => [validator.voteAccount, validator]))
        const groupVoteAccounts = new Set(groupValidators.keys())

        const { cap } = this.constraints.getMinCapForEvenDistribution(groupVoteAccounts)
        const evenDistributionCap = Math.min(cap, remainingStakeToDistribute / group.validators.length)
        console.log("SAM distributing", evenDistributionCap, "to every validator in the group", groupValidators.size)

        for (const validator of groupValidators.values()) {
          validator.auctionStake.marinadeSamTargetSol += evenDistributionCap
          this.data.stakeAmounts.marinadeRemainingSamSol -= evenDistributionCap
          winningTotalPmpe = validator.revShare.totalPmpe
          this.debug.pushValidatorEvent(validator.voteAccount, `received ${evenDistributionCap} SAM stake in PMPE group ${validator.revShare.totalPmpe} with ${groupValidators.size} validators`)
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
          this.debug.pushEvent('SAM No stake remaining to distribute')
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

  setStakeUnstakePriorities () {
    this.data.validators.sort((a, b) => b.revShare.totalPmpe - a.revShare.totalPmpe)

    let currentGroupPmpe = NaN
    let currentStakePriority = 0
    this.data.validators.forEach(validator => {
      if (validator.revShare.totalPmpe === currentGroupPmpe) {
        validator.stakePriority = currentStakePriority
      } else {
        validator.stakePriority = ++currentStakePriority
        currentGroupPmpe = validator.revShare.totalPmpe
      }
    })

    this.data.validators
      .filter(({ mndeEligible, samEligible }) => !mndeEligible && !samEligible)
      .forEach(validator => validator.unstakePriority = 0)

    let bondsMaxIndex = 0
    this.data.validators
      .filter(({ unstakePriority }) => Number.isNaN(unstakePriority))
      .map(validator => ({
        validator,
        bondBalanceDiff: ((validator.bondBalanceSol ?? 0) - bondBalanceRequiredForCurrentStake(validator)) / validator.marinadeActivatedStakeSol
      }))
      .filter(({ bondBalanceDiff }) => bondBalanceDiff < 0) // Infinity and NaN filtered out too
      .sort((a, b) => a.bondBalanceDiff - b.bondBalanceDiff)
      .forEach(({ validator }, index) => bondsMaxIndex = validator.unstakePriority = index + 1)

    this.data.validators
      .filter(({ unstakePriority }) => Number.isNaN(unstakePriority))
      .map(validator => ({
        validator,
        stakeDiff: validator.marinadeActivatedStakeSol <= 0 ?
          1 :
          (validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol - validator.marinadeActivatedStakeSol) / validator.marinadeActivatedStakeSol
      }))
      .sort((a, b) => a.stakeDiff - b.stakeDiff)
      .forEach(({ validator }, index) => validator.unstakePriority = bondsMaxIndex + index + 1)
  }

  setEffectiveBids(winningTotalPmpe: number) {
    this.data.validators.forEach(({ revShare }) => {
      if (revShare.totalPmpe < winningTotalPmpe) {
        revShare.auctionEffectiveBidPmpe = revShare.bidPmpe
      } else {
        revShare.auctionEffectiveBidPmpe = Math.max(0, winningTotalPmpe - revShare.inflationPmpe - revShare.mevPmpe)
      }
    })
  }

  setBidTooLowPenalties(winningTotalPmpe: number) {
    const k = this.config.bidTooLowPenaltyHistoryEpochs
    this.data.validators.forEach(({ bidTooLowPenalty, revShare, auctions }) => {
      const historicalPmpe = auctions.slice(0, k).reduce(
        (acc, { effParticipatingBidPmpe }) => Math.min(acc, effParticipatingBidPmpe ?? Infinity),
        Infinity
      )
      const effParticipatingBidPmpe = calcEffParticipatingBidPmpe(revShare, winningTotalPmpe)
      const limit = Math.min(effParticipatingBidPmpe, historicalPmpe)
      const penaltyCoef = Math.min(1, Math.sqrt(1.5 * Math.max(0, limit - revShare.bidPmpe) / limit))
      bidTooLowPenalty.base = winningTotalPmpe + effParticipatingBidPmpe
      if (revShare.bidPmpe < 0.99999 * (auctions[0]?.bidPmpe ?? 0)) {
        bidTooLowPenalty.coef = penaltyCoef
      } else {
        bidTooLowPenalty.coef = 0
      }
      revShare.effParticipatingBidPmpe = effParticipatingBidPmpe
      revShare.bidTooLowPenaltyPmpe = bidTooLowPenalty.coef * bidTooLowPenalty.base
    })
  }

  getAuctionData (): AuctionData {
    return this.data
  }

  blockInSam (vote: string) {
    const entry = this.data.validators.find(({ voteAccount }) => voteAccount === vote)
    if (entry != null) {
      entry.samBlocked = true
    }
  }

  reset () {
    console.log('----------------------------- resetting auction')
    this.data.stakeAmounts.marinadeRemainingMndeSol = this.data.stakeAmounts.marinadeMndeTvlSol
    this.data.stakeAmounts.marinadeRemainingSamSol =  this.data.stakeAmounts.marinadeSamTvlSol
    this.data.validators.forEach(validator => {
      validator.auctionStake.marinadeMndeTargetSol = 0
      validator.auctionStake.marinadeSamTargetSol = 0
      validator.lastCapConstraint = null
      validator.stakePriority = NaN
      validator.unstakePriority = NaN
      validator.samBlocked = false
      validator.bidTooLowPenalty = {
        coef: 0,
        base: 0,
      }
    })
  }

  updateSpendRobustReputations(winningTotalPmpe: number, totalMarinadeSpend: number) {
    let marinadeTvlSol = this.data.stakeAmounts.marinadeSamTvlSol + this.data.stakeAmounts.marinadeMndeTvlSol
    this.data.validators.forEach(validator => {
      const values = validator.values
      
      if (validator.revShare.totalPmpe >= winningTotalPmpe) {
        // counterfactual auction - the validator is not part of the auction
        this.reset()
        console.log(`EVALUATING counterfactual auction for ${validator.voteAccount}`)
        validator.samBlocked = true
        const counterfactualResult = this.evaluateOne()

        // baseline auction - the validator is not bounded by its reputation
        this.reset()
        console.log(`EVALUATING baseline auction for ${validator.voteAccount}`)
        const origReputation = values.spendRobustReputation
        values.spendRobustReputation = Infinity
        const unboundedResult = this.evaluateOne()
        values.spendRobustReputation = origReputation

        // the reputation is the gain the validator's participation brings
        const marginalPmpeGain = Math.max(0, unboundedResult.winningTotalPmpe / counterfactualResult.winningTotalPmpe - 1)
        values.spendRobustReputation += marginalPmpeGain * totalMarinadeSpend
      }
      
      values.marinadeActivatedStakeSolUndelegation = -Math.min(
        0,
        validator.marinadeActivatedStakeSol
          - (validator.auctions[0]?.marinadeActivatedStakeSol ?? 0)
      )
      const coef = 1 / (validator.auctions[0]?.adjSpendRobustReputationInflationFactor ?? 1)
      values.spendRobustReputation -= coef * values.marinadeActivatedStakeSolUndelegation * winningTotalPmpe / 1000
      values.spendRobustReputation = Math.max(
        this.config.minSpendRobustReputation,
        Math.min(
          this.config.maxSpendRobustReputation,
          values.spendRobustReputation
        )
      )
      if (values.spendRobustReputation > Math.max(0, this.config.minSpendRobustReputation)) {
        values.spendRobustReputation *= 1 - 1 / this.config.spendRobustReputationDecayEpochs
      }

      values.adjSpendRobustReputation = values.spendRobustReputation
      if (validator.revShare.totalPmpe > 0) {
        const pm = validator.revShare.totalPmpe / 1000
        validator.maxBondDelegation = Math.min(
          (validator.bondBalanceSol ?? 0) / pm,
          this.config.maxMarinadeTvlSharePerValidatorDec * marinadeTvlSol
        )
      } else {
        validator.maxBondDelegation = 0
      }
    })
  }

  scaleReputationToFitTvl () {
    console.log('SCALING reputation to fit tvl')
    const mult = this.config.spendRobustReputationMult ?? 1
    let totalFactor = 1
    let factor = 1
    for (let i = 0; i < 100; i++) {
      for (const entry of this.data.validators) {
        const values = entry.values
        totalFactor *= factor
        values.adjSpendRobustReputation *= factor
        if (entry.revShare.totalPmpe > 0) {
          values.adjMaxSpendRobustDelegation = mult * values.adjSpendRobustReputation / (entry.revShare.totalPmpe / 1000)
        } else {
          values.adjMaxSpendRobustDelegation = 0
        }
      }

      let leftToScale = this.data.stakeAmounts.marinadeSamTvlSol
      let totalScalable = 0
      for (const entry of this.data.validators) {
        const values = entry.values
        if (values.adjMaxSpendRobustDelegation < entry.maxBondDelegation) {
          if (values.spendRobustReputation > this.config.minScaledSpendRobustReputation) {
            totalScalable += values.adjMaxSpendRobustDelegation
          }
        } else {
          leftToScale -= entry.maxBondDelegation
        }
      }

      factor = leftToScale / totalScalable
      if (!isFinite(factor) || factor <= 1) {
        break;
      }
    }
    for (const entry of this.data.validators) {
      entry.values.adjSpendRobustReputationInflationFactor = totalFactor
    }
    console.log(`SCALING factor found: ${totalFactor}`)
  }

  evaluateOne (): AuctionResult {
    console.log('stake amounts before', this.data.stakeAmounts)
    this.debug.pushInfo('start amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.pushEvent('DISTRIBUTING MNDE STAKE')
    this.distributeMndeStake()

    this.debug.pushInfo('post MNDE amounts', JSON.stringify(this.data.stakeAmounts))
    console.log(`MNDE overflow: ${this.data.stakeAmounts.marinadeRemainingMndeSol}`)
    if (this.data.stakeAmounts.marinadeRemainingMndeSol > EPSILON) {
      this.debug.pushEvent(`MNDE overflow ${this.data.stakeAmounts.marinadeRemainingMndeSol} SOL will be distributed in SAM`)
      this.data.stakeAmounts.marinadeSamTvlSol += this.data.stakeAmounts.marinadeRemainingMndeSol
      this.data.stakeAmounts.marinadeRemainingSamSol += this.data.stakeAmounts.marinadeRemainingMndeSol
      this.data.stakeAmounts.marinadeMndeTvlSol -= this.data.stakeAmounts.marinadeRemainingMndeSol
      this.data.stakeAmounts.marinadeRemainingMndeSol = 0
    }

    this.debug.pushInfo('pre SAM amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.pushEvent('DISTRIBUTING SAM STAKE')
    const winningTotalPmpe = this.distributeSamStake()
    this.debug.pushEvent('STAKE DISTRIBUTED')

    console.log('stake amounts after', this.data.stakeAmounts)
    this.debug.pushInfo('end amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.pushInfo('winning total PMPE', winningTotalPmpe.toString())

    this.setStakeUnstakePriorities()
    this.setEffectiveBids(winningTotalPmpe)
    this.setBidTooLowPenalties(winningTotalPmpe)

    return {
      auctionData: this.data,
      winningTotalPmpe,
    }
  }

  evaluate (): AuctionResult {
    const result = this.evaluateOne()
    const totalMarinadeSpend = result.auctionData.validators.reduce(
      (acc, entry) => acc + entry.revShare.auctionEffectiveBidPmpe * entry.marinadeActivatedStakeSol / 1000,
      0
    )
    this.updateSpendRobustReputations(result.winningTotalPmpe, totalMarinadeSpend)
    this.reset()
    this.scaleReputationToFitTvl()
    console.log('EVALUATING final auction')
    return this.evaluateOne()
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
