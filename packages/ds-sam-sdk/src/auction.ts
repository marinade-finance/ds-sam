/* eslint-disable no-param-reassign */

import { calcBondRiskFee, calcEffParticipatingBidPmpe, calcBidTooLowPenalty } from './calculations'

import type { DsSamConfig } from './config'
import type { AuctionConstraints } from './constraints'
import type { Debug } from './debug'
import type { AuctionData, AuctionResult, AuctionValidator } from './types'

export const EPSILON = 1e-4

const LOG_TO_EVERY_VALIDATOR = 'to every validator in the group'
const LOG_CAP_REACHED = 'from the group because the cap has been reached'
const LOG_NO_STAKE_REMAINING = 'No stake remaining to distribute'

export type ReputationValues = {
  spendRobustReputation: number
  adjSpendRobustReputation: number
  adjMaxSpendRobustDelegation: number
}

export const setReputation = (validator: AuctionValidator, values: ReputationValues): ReputationValues => {
  const oldValues = {
    spendRobustReputation: validator.values.spendRobustReputation,
    adjSpendRobustReputation: validator.values.adjSpendRobustReputation,
    adjMaxSpendRobustDelegation: validator.values.adjMaxSpendRobustDelegation,
  }
  validator.values.spendRobustReputation = values.spendRobustReputation
  validator.values.adjSpendRobustReputation = values.adjSpendRobustReputation
  validator.values.adjMaxSpendRobustDelegation = values.adjMaxSpendRobustDelegation
  return oldValues
}

export class Auction {
  constructor(
    private data: AuctionData,
    private constraints: AuctionConstraints,
    private config: DsSamConfig,
    private debug: Debug,
  ) {}

  distributeMndeStake() {
    this.constraints.updateStateForMnde(this.data)
    this.debug.getVoteAccounts().forEach(voteAccount => {
      const constraints = this.constraints.getValidatorConstraints(voteAccount)
      this.debug.pushValidatorEvent(
        voteAccount,
        `MNDE start constraints: ${constraints ? `${JSON.stringify(constraints.map(constraint => ({ ...constraint, validators: constraint.validators.length })))}` : 'NULL'}`,
      )
    })

    let remEligibleValidators = this.data.validators.filter(validator => validator.mndeEligible)

    while (remEligibleValidators.length > 0) {
      const eligibleValidators = new Map(remEligibleValidators.map(validator => [validator.voteAccount, validator]))
      const eligibleVoteAccounts = new Set(eligibleValidators.keys())
      const { cap: evenDistributionCap } = this.constraints.getMinCapForEvenDistribution(eligibleVoteAccounts)
      this.debug.log('MNDE distributing', evenDistributionCap, LOG_TO_EVERY_VALIDATOR, eligibleValidators.size)

      for (const validator of eligibleValidators.values()) {
        validator.auctionStake.marinadeMndeTargetSol += evenDistributionCap
        this.data.stakeAmounts.marinadeRemainingMndeSol -= evenDistributionCap
      }

      this.constraints.updateStateForMnde(this.data)
      remEligibleValidators = remEligibleValidators.filter(validator => {
        const validatorCap = this.constraints.findCapForValidator(validator)
        if (validatorCap < EPSILON) {
          this.debug.log('MNDE removing validator', validator.voteAccount, LOG_CAP_REACHED)
          return false
        }
        return true
      })

      if (this.data.stakeAmounts.marinadeRemainingMndeSol < EPSILON) {
        this.debug.log('MNDE No stake remaining to distribute')
        break
      } else {
        this.debug.log('MNDE Stake remaining', this.data.stakeAmounts.marinadeRemainingMndeSol)
      }
    }
  }

  distributeSamStake() {
    this.constraints.updateStateForSam(this.data)
    this.debug.getVoteAccounts().forEach(voteAccount => {
      const constraints = this.constraints.getValidatorConstraints(voteAccount)
      this.debug.pushValidatorEvent(
        voteAccount,
        `SAM start constraints: ${constraints ? `${JSON.stringify(constraints.map(constraint => ({ ...constraint, validators: constraint.validators.length })))}` : 'NULL'}`,
      )
    })

    let previousGroupPmpe = Infinity
    let group = null
    let winningTotalPmpe = Infinity
    let groups = 0
    let rounds = 0
    while ((group = this.findNextPmpeGroup(previousGroupPmpe))) {
      groups++
      group.validators = group.validators.filter(validator => validator.samEligible && !validator.samBlocked)

      this.debug.log('SAM ========= new round ==========')
      this.debug.log('SAM', group.validators.length, 'validators eligible')
      this.debug.pushValidatorSetEvent(
        new Set(group.validators.map(({ voteAccount }) => voteAccount)),
        `assigned to PMPE group ${group.totalPmpe} with ${group.validators.length} eligible validators: ${group.validators
          .slice(0, 5)
          .map(({ voteAccount }) => voteAccount)
          .join(' ')}`,
      )

      if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
        this.debug.log(`SAM ${LOG_NO_STAKE_REMAINING}`)
        this.debug.pushEvent(`SAM ${LOG_NO_STAKE_REMAINING}`)
        break
      }

      while (group.validators.length > 0) {
        rounds++
        const remainingStakeToDistribute = this.data.stakeAmounts.marinadeRemainingSamSol
        const groupValidators = new Map(group.validators.map(validator => [validator.voteAccount, validator]))
        const groupVoteAccounts = new Set(groupValidators.keys())

        const { cap } = this.constraints.getMinCapForEvenDistribution(groupVoteAccounts)
        const evenDistributionCap = Math.min(cap, remainingStakeToDistribute / group.validators.length)
        this.debug.log('SAM distributing', evenDistributionCap, LOG_TO_EVERY_VALIDATOR, groupValidators.size)

        for (const validator of groupValidators.values()) {
          validator.auctionStake.marinadeSamTargetSol += evenDistributionCap
          this.data.stakeAmounts.marinadeRemainingSamSol -= evenDistributionCap
          winningTotalPmpe = validator.revShare.totalPmpe
          this.debug.pushValidatorEvent(
            validator.voteAccount,
            `received ${evenDistributionCap} SAM stake in PMPE group ${validator.revShare.totalPmpe} with ${groupValidators.size} validators`,
          )
        }

        this.constraints.updateStateForSam(this.data)
        group.validators = group.validators.filter(validator => {
          const validatorCap = this.constraints.findCapForValidator(validator)
          if (validatorCap < EPSILON) {
            this.debug.log('SAM removing validator', validator.voteAccount, LOG_CAP_REACHED)
            return false
          }
          return true
        })

        if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
          this.debug.log(`SAM ${LOG_NO_STAKE_REMAINING}`)
          this.debug.pushEvent(`SAM ${LOG_NO_STAKE_REMAINING}`)
          break
        } else {
          this.debug.log('SAM Stake remaining', this.data.stakeAmounts.marinadeRemainingSamSol)
        }
      }

      previousGroupPmpe = group.totalPmpe
    }

    this.debug.log('SAM rounds', rounds, 'groups', groups)

    return winningTotalPmpe
  }

  distributeBackstopStake() {
    this.constraints.updateStateForBackstop(this.data)
    this.debug.getVoteAccounts().forEach(voteAccount => {
      const constraints = this.constraints.getValidatorConstraints(voteAccount)
      this.debug.pushValidatorEvent(
        voteAccount,
        `SAM start constraints: ${constraints ? `${JSON.stringify(constraints.map(constraint => ({ ...constraint, validators: constraint.validators.length })))}` : 'NULL'}`,
      )
    })

    let rounds = 0
    let validators = this.data.validators.filter(validator => validator.backstopEligible && !validator.samBlocked)
    this.debug.log('BACKSTOP ========= new round ==========')
    this.debug.log('BACKSTOP', validators.length, 'validators eligible')
    this.debug.pushValidatorSetEvent(
      new Set(validators.map(({ voteAccount }) => voteAccount)),
      `assigned as BACKSTOP eligible validator: ${validators
        .slice(0, 5)
        .map(({ voteAccount }) => voteAccount)
        .join(' ')}`,
    )

    if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
      this.debug.log(`BACKSTOP ${LOG_NO_STAKE_REMAINING}`)
      this.debug.pushEvent(`BACKSTOP ${LOG_NO_STAKE_REMAINING}`)
      return
    }

    while (validators.length > 0) {
      rounds++
      const remainingStakeToDistribute = this.data.stakeAmounts.marinadeRemainingSamSol
      const groupValidators = new Map(validators.map(validator => [validator.voteAccount, validator]))
      const groupVoteAccounts = new Set(groupValidators.keys())

      const { cap } = this.constraints.getMinCapForEvenDistribution(groupVoteAccounts)
      const evenDistributionCap = Math.min(cap, remainingStakeToDistribute / validators.length)
      this.debug.log('BACKSTOP distributing', evenDistributionCap, LOG_TO_EVERY_VALIDATOR, groupValidators.size)

      for (const validator of groupValidators.values()) {
        validator.auctionStake.marinadeSamTargetSol += evenDistributionCap
        this.data.stakeAmounts.marinadeRemainingSamSol -= evenDistributionCap
        this.debug.pushValidatorEvent(
          validator.voteAccount,
          `received ${evenDistributionCap} SAM stake in PMPE group ${validator.revShare.totalPmpe} with ${groupValidators.size} validators`,
        )
      }

      this.constraints.updateStateForBackstop(this.data)
      validators = validators.filter(validator => {
        const validatorCap = this.constraints.findCapForValidator(validator)
        if (validatorCap < EPSILON) {
          this.debug.log('BACKSTOP removing validator', validator.voteAccount, LOG_CAP_REACHED)
          return false
        }
        return true
      })

      if (this.data.stakeAmounts.marinadeRemainingSamSol < EPSILON) {
        this.debug.log(`BACKSTOP ${LOG_NO_STAKE_REMAINING}`)
        this.debug.pushEvent(`BACKSTOP ${LOG_NO_STAKE_REMAINING}`)
        break
      } else {
        this.debug.log('BACKSTOP Stake remaining', this.data.stakeAmounts.marinadeRemainingSamSol)
      }
    }

    this.debug.log('BACKSTOP rounds', rounds)
  }

  setStakeUnstakePriorities() {
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
      .forEach(validator => (validator.unstakePriority = 0))

    let bondsMaxIndex = 0
    this.data.validators
      .filter(({ unstakePriority }) => Number.isNaN(unstakePriority))
      .map(validator => ({
        validator,
        bondBalanceDiff:
          ((validator.bondBalanceSol ?? 0) - this.constraints.bondBalanceRequiredForCurrentStake(validator)) /
          validator.marinadeActivatedStakeSol,
      }))
      .filter(({ bondBalanceDiff }) => bondBalanceDiff < 0) // Infinity and NaN filtered out too
      .sort((a, b) => a.bondBalanceDiff - b.bondBalanceDiff)
      .forEach(({ validator }, index) => (bondsMaxIndex = validator.unstakePriority = index + 1))

    this.data.validators
      .filter(({ unstakePriority }) => Number.isNaN(unstakePriority))
      .map(validator => ({
        validator,
        stakeDiff:
          validator.marinadeActivatedStakeSol <= 0
            ? 1
            : (validator.auctionStake.marinadeMndeTargetSol +
                validator.auctionStake.marinadeSamTargetSol -
                validator.marinadeActivatedStakeSol) /
              validator.marinadeActivatedStakeSol,
      }))
      .sort((a, b) => a.stakeDiff - b.stakeDiff)
      .forEach(({ validator }, index) => (validator.unstakePriority = bondsMaxIndex + index + 1))
  }

  setAuctionEffectiveBids(winningTotalPmpe: number) {
    for (const validator of this.data.validators) {
      const { revShare } = validator
      if (revShare.totalPmpe < winningTotalPmpe) {
        // The validator’s total PMPE (total amount expected to be shared with stakers) is lower
        // than the total PMPE of the last validator group (i.e., winningTotalPmpe) which is still in the auction
        // we expect nothing to be charged from the bond for this validator as its total PMPE is lower
        revShare.auctionEffectiveBidPmpe = revShare.bondObligationPmpe
      } else {
        // The validator is in the winning group, we calculate what is the assumed PMPE distributed from bond
        // The real distribution depends on how much stake the validator will get in the auction and on its rewards
        // (rewards are calculated from the previous epoch, so they are not known at time the auction is calculated)
        revShare.auctionEffectiveBidPmpe = calcEffParticipatingBidPmpe(revShare, winningTotalPmpe)
      }
    }
    this.setAuctionEffectiveStaticBids(winningTotalPmpe)
  }

  /**
   * What PMPE the validator will pay directly from its bond when using a static bid (`cpmpe`) in the bond configuration.
   *
   * This does not include any dynamic commission bidding the validator may configure
   * through commission arguments.
   */
  private setAuctionEffectiveStaticBids(winningTotalPmpe: number) {
    for (const validator of this.data.validators) {
      const { revShare } = validator
      if (revShare.totalPmpe < winningTotalPmpe) {
        // not in the auction, we expect nothing to be charged from the bond for this validator
        revShare.auctionEffectiveStaticBidPmpe = revShare.bidPmpe
      } else {
        // The validator is in the winning group, we calculate what PMPE is to be charged by bond static bid
        revShare.auctionEffectiveStaticBidPmpe = Math.max(
          0,
          winningTotalPmpe - revShare.inflationPmpe - revShare.mevPmpe - revShare.blockPmpe,
        )
      }
    }
  }

  setEffParticipatingBids(winningTotalPmpe: number) {
    for (const validator of this.data.validators) {
      const { revShare } = validator
      revShare.effParticipatingBidPmpe = calcEffParticipatingBidPmpe(revShare, winningTotalPmpe)
    }
  }

  setBidTooLowPenalties(winningTotalPmpe: number) {
    const k = this.config.bidTooLowPenaltyHistoryEpochs
    for (const validator of this.data.validators) {
      const value = calcBidTooLowPenalty({
        historyEpochs: k,
        winningTotalPmpe,
        validator,
        permittedBidDeviation: this.config.bidTooLowPenaltyPermittedDeviationPmpe,
      })
      validator.bidTooLowPenalty = value.bidTooLowPenalty
      validator.revShare.bidTooLowPenaltyPmpe = value.bidTooLowPenaltyPmpe
      validator.values.paidUndelegationSol += value.paidUndelegationSol
    }
  }

  updatePaidUndelegation() {
    for (const validator of this.data.validators) {
      const { values } = validator
      const delta = validator.lastMarinadeActivatedStakeSol
        ? validator.marinadeActivatedStakeSol - validator.lastMarinadeActivatedStakeSol
        : 0
      const undelegation = -Math.min(0, delta)
      if (delta > 0.1 * values.paidUndelegationSol || validator.marinadeActivatedStakeSol === 0) {
        values.paidUndelegationSol = 0
      } else {
        values.paidUndelegationSol -= Math.min(undelegation, values.paidUndelegationSol)
      }
      values.paidUndelegationSol = Math.max(0, values.paidUndelegationSol)
    }
  }

  setBondRiskFee() {
    for (const validator of this.data.validators) {
      if ((validator.lastBondBalanceSol ?? validator.bondBalanceSol ?? 0) < 1) {
        continue
      }
      const value = calcBondRiskFee(this.config, validator)
      if (value == null) {
        continue
      }
      const { bondForcedUndelegation, bondRiskFeeSol, paidUndelegationSol } = value
      validator.bondForcedUndelegation = bondForcedUndelegation
      validator.values.bondRiskFeeSol = bondRiskFeeSol
      validator.values.paidUndelegationSol += paidUndelegationSol
    }
  }

  getAuctionData(): AuctionData {
    return this.data
  }

  blockInSam(vote: string) {
    const entry = this.data.validators.find(({ voteAccount }) => voteAccount === vote)
    if (entry != null) {
      entry.samBlocked = true
    }
  }

  reset() {
    this.debug.log('----------------------------- resetting auction')
    this.data.stakeAmounts.marinadeRemainingMndeSol = this.data.stakeAmounts.marinadeMndeTvlSol
    this.data.stakeAmounts.marinadeRemainingSamSol = this.data.stakeAmounts.marinadeSamTvlSol
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
    for (const validator of this.data.validators) {
      const { values } = validator

      if (
        validator.revShare.totalPmpe >= winningTotalPmpe &&
        (validator.bondBalanceSol ?? 0) >= this.config.minBondBalanceSol
      ) {
        // counterfactual auction - the validator is not part of the auction
        this.reset()
        this.debug.log(`EVALUATING counterfactual auction for ${validator.voteAccount}`)
        validator.samBlocked = true
        const counterfactualResult = this.evaluateOne()

        // baseline auction - the validator is not bounded by its reputation
        this.reset()
        this.debug.log(`EVALUATING baseline auction for ${validator.voteAccount}`)
        const origReputation = setReputation(validator, {
          spendRobustReputation: Infinity,
          adjSpendRobustReputation: Infinity,
          adjMaxSpendRobustDelegation: Infinity,
        })
        const unboundedResult = this.evaluateOne()
        setReputation(validator, origReputation)

        // the reputation is the gain the validator's participation brings
        const marginalPmpeGain = Math.max(
          0,
          unboundedResult.winningTotalPmpe / counterfactualResult.winningTotalPmpe - 1,
        )
        values.spendRobustReputation += marginalPmpeGain * totalMarinadeSpend
      }
      const coef = 1 / validator.values.adjSpendRobustReputationInflationFactor
      values.marinadeActivatedStakeSolUndelegation = -Math.min(
        0,
        validator.lastMarinadeActivatedStakeSol
          ? validator.marinadeActivatedStakeSol - validator.lastMarinadeActivatedStakeSol
          : 0,
      )
      values.spendRobustReputation -= (coef * values.marinadeActivatedStakeSolUndelegation * winningTotalPmpe) / 1000
      values.spendRobustReputation = Math.max(
        this.config.minSpendRobustReputation,
        Math.min(this.config.maxSpendRobustReputation, values.spendRobustReputation),
      )
      if (values.spendRobustReputation > Math.max(0, this.config.minSpendRobustReputation)) {
        values.spendRobustReputation *= 1 - 1 / this.config.spendRobustReputationDecayEpochs
      }
    }
  }

  setMaxBondDelegations() {
    const marinadeTvlSol = this.data.stakeAmounts.marinadeSamTvlSol + this.data.stakeAmounts.marinadeMndeTvlSol
    for (const validator of this.data.validators) {
      if (validator.revShare.totalPmpe > 0) {
        validator.maxBondDelegation = Math.min(
          this.constraints.bondStakeCapSam(validator),
          this.config.maxMarinadeTvlSharePerValidatorDec * marinadeTvlSol,
        )
      } else {
        validator.maxBondDelegation = 0
      }
    }
  }

  setMaxSpendRobustDelegations() {
    for (const validator of this.data.validators) {
      this.setMaxSpendRobustDelegationsForValidator(validator)
    }
  }

  setMaxSpendRobustDelegationsForValidator(validator: AuctionValidator) {
    const values = validator.values
    values.adjSpendRobustReputation = values.spendRobustReputation * values.adjSpendRobustReputationInflationFactor
    if (!isFinite(values.adjSpendRobustReputation)) {
      throw new Error('adjSpendRobustReputation has to be finite')
    }
    if (validator.revShare.totalPmpe > 0) {
      values.adjMaxSpendRobustDelegation = Math.max(
        0,
        values.adjSpendRobustReputation / (validator.revShare.totalPmpe / 1000),
      )
    } else {
      values.adjMaxSpendRobustDelegation = 0
    }
  }

  /**
   * scaleReputationToFitTvl
   *
   * Adjusts each validator's reputation scaling factor so that the total stake
   * can be distributed without exceeding a floor PMPE.
   *
   * It works by:
   *
   * 1. Starting with every validator's raw reputation and a PMPE cap.
   * 2. Repeatedly scaling up high-reputation and high-bid validators' effective
   *    reputation until the sum of all capacity over a PMPE limit exceeds TVL
   *    or no further scaling is possible due to other limits outside of reputation.
   * 3. If no feasible scaling is found, it gradually lowers the bid cap and reputation
   *    threshold to force a solution.
   *
   * This ensures that the winning PMPE stays above a reasonable threshold
   * and that high-bid validators with low reputation can not easily game the scaling.
   */
  scaleReputationToFitTvl() {
    const { inflationPmpe, mevPmpe, blockPmpe } = this.data.rewards
    const initialTotalPmpeLimit = inflationPmpe + mevPmpe + blockPmpe + this.config.expectedFeePmpe
    this.debug.log(`SCALING reputation to fit tvl with pmpe above: ${initialTotalPmpeLimit}`)
    for (const entry of this.data.validators) {
      const values = entry.values
      values.adjSpendRobustReputation = values.spendRobustReputation
      values.adjSpendRobustReputationInflationFactor = 1
    }
    let factor = 1
    let totalFactor = factor
    let totalPmpeLimit = initialTotalPmpeLimit
    let minScaledReputation = this.config.initialScaledSpendRobustReputation
    this.debug.log(`SCALING limit bid: ${totalPmpeLimit}`)
    for (let i = 0; i < 200; i++) {
      totalFactor *= factor
      let leftToScale = this.data.stakeAmounts.marinadeSamTvlSol
      let leftTvl = this.data.stakeAmounts.marinadeSamTvlSol
      let totalScalable = 0
      for (const entry of this.data.validators) {
        const { values, revShare } = entry
        values.adjSpendRobustReputationInflationFactor *= factor
        this.setMaxSpendRobustDelegationsForValidator(entry)
        if (revShare.totalPmpe >= initialTotalPmpeLimit) {
          // if we can accommodate whole TVL on validators above totalPmpeLimit, we're done
          leftTvl -= Math.min(values.adjMaxSpendRobustDelegation, entry.maxBondDelegation)
        }
        if (revShare.totalPmpe >= totalPmpeLimit) {
          if (values.adjMaxSpendRobustDelegation < entry.maxBondDelegation) {
            // scale the validators with large reputation first so as to make
            // gaming the system by bidding high impossible
            if (values.spendRobustReputation >= minScaledReputation) {
              totalScalable += values.adjMaxSpendRobustDelegation
            }
          } else {
            leftToScale -= entry.maxBondDelegation
          }
        }
      }
      // if totalScalable = 0, we'll get Infinity or NaN which is caught below resulting in
      // either moving the totalPmpeLimit down or a break, us being done
      factor = Math.max(0, leftToScale) / totalScalable
      this.debug.log(
        `SCALING round ${i} # ${JSON.stringify({ factor, leftToScale, leftTvl, totalScalable, totalPmpeLimit })}`,
      )
      if (totalScalable === 0 && leftToScale > 0) {
        if (totalPmpeLimit > inflationPmpe + mevPmpe + blockPmpe) {
          totalPmpeLimit *= 0.99
          this.debug.log(`SCALING decreasing limit bid to: ${totalPmpeLimit}`)
          factor = 1
          continue
        } else if (minScaledReputation > this.config.minScaledSpendRobustReputation) {
          minScaledReputation *= 0.8
          totalPmpeLimit = initialTotalPmpeLimit
          this.debug.log(`SCALING reset limit bid to: ${totalPmpeLimit}`)
          this.debug.log(`SCALING decreasing minScaledReputation to: ${minScaledReputation}`)
          factor = 1
          continue
        } else {
          this.debug.log('SCALING to infinity')
          factor = 1.1
        }
      }
      if (!isFinite(factor) || factor <= 1 || leftTvl <= 0) {
        break
      }
    }
    const mult = this.config.spendRobustReputationMult ?? 1
    for (const entry of this.data.validators) {
      entry.values.adjSpendRobustReputationInflationFactor *= mult
      if (!isFinite(entry.values.adjSpendRobustReputationInflationFactor)) {
        throw new Error('adjSpendRobustReputationInflationFactor has to be finite')
      }
      if (entry.values.adjSpendRobustReputationInflationFactor < 0) {
        throw new Error('adjSpendRobustReputationInflationFactor can not be negative')
      }
      this.setMaxSpendRobustDelegationsForValidator(entry)
    }
    this.debug.log(`SCALING factor found: ${mult * totalFactor}`)
  }

  evaluateOne(): AuctionResult {
    this.debug.log('EVALUATING new auction ----------------------------------------')
    this.debug.pushInfo('start amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.pushEvent('DISTRIBUTING MNDE STAKE')
    this.distributeMndeStake()

    this.debug.pushInfo('post MNDE amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.log(`MNDE overflow: ${this.data.stakeAmounts.marinadeRemainingMndeSol}`)
    if (this.data.stakeAmounts.marinadeRemainingMndeSol > EPSILON) {
      this.debug.pushEvent(
        `MNDE overflow ${this.data.stakeAmounts.marinadeRemainingMndeSol} SOL will be distributed in SAM`,
      )
      this.data.stakeAmounts.marinadeSamTvlSol += this.data.stakeAmounts.marinadeRemainingMndeSol
      this.data.stakeAmounts.marinadeRemainingSamSol += this.data.stakeAmounts.marinadeRemainingMndeSol
      this.data.stakeAmounts.marinadeMndeTvlSol -= this.data.stakeAmounts.marinadeRemainingMndeSol
      this.data.stakeAmounts.marinadeRemainingMndeSol = 0
    }

    this.debug.pushInfo('pre SAM amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.pushEvent('DISTRIBUTING SAM STAKE')
    const winningTotalPmpe = this.distributeSamStake()
    this.debug.pushEvent('STAKE DISTRIBUTED')

    if (!isFinite(winningTotalPmpe)) {
      throw new Error('winningTotalPmpe has to be finite')
    }

    if (winningTotalPmpe <= 0) {
      throw new Error('winningTotalPmpe has to be positive')
    }

    this.debug.pushInfo('pre BACKSTOP amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.pushEvent('DISTRIBUTING BACKSTOP STAKE')
    this.distributeBackstopStake()
    this.debug.pushEvent('BACKSTOP STAKE DISTRIBUTED')

    this.debug.pushInfo('end amounts', JSON.stringify(this.data.stakeAmounts))
    this.debug.pushInfo('winning total PMPE', winningTotalPmpe.toString())

    return {
      auctionData: this.data,
      winningTotalPmpe,
    }
  }

  setExpectedMaxEffBidPmpes(expectedMaxTotalPmpe: number) {
    for (const validator of this.data.validators) {
      const { revShare } = validator
      revShare.expectedMaxEffBidPmpe = Math.max(
        this.config.minExpectedEffBidPmpe,
        Math.min(revShare.bondObligationPmpe, expectedMaxTotalPmpe - revShare.onchainDistributedPmpe),
      )
    }
  }

  updateExpectedMaxEffBidPmpe() {
    if (this.config.expectedMaxWinningBidRatio == null) {
      return
    }
    const { inflationPmpe, mevPmpe, blockPmpe } = this.data.rewards
    const rewardsBase = inflationPmpe + mevPmpe + blockPmpe
    const initialTotalPmpeLimit = rewardsBase + this.config.expectedFeePmpe
    this.setExpectedMaxEffBidPmpes(initialTotalPmpeLimit)
    const result = this.evaluateOne()
    this.reset()

    const shift = this.config.expectedMaxWinningBidRatio * Math.max(0, result.winningTotalPmpe - rewardsBase)
    this.setExpectedMaxEffBidPmpes(rewardsBase + shift)
  }

  setBlacklistPenalties(winningTotalPmpe: number) {
    for (const validator of this.data.validators) {
      if (validator.values.samBlacklisted && validator.lastSamBlacklisted === false) {
        validator.revShare.blacklistPenaltyPmpe =
          winningTotalPmpe + Math.min(3 * validator.revShare.effParticipatingBidPmpe, winningTotalPmpe)
      } else {
        validator.revShare.blacklistPenaltyPmpe = 0
      }
    }
  }

  evaluateFinal(): AuctionResult {
    this.setMaxSpendRobustDelegations()
    this.updateExpectedMaxEffBidPmpe()
    this.updatePaidUndelegation()
    const result = this.evaluateOne()
    this.setStakeUnstakePriorities()
    this.setAuctionEffectiveBids(result.winningTotalPmpe)
    this.setEffParticipatingBids(result.winningTotalPmpe)
    this.setBondRiskFee()
    this.setBidTooLowPenalties(result.winningTotalPmpe)
    this.setMaxBondDelegations()
    this.setBlacklistPenalties(result.winningTotalPmpe)
    return result
  }

  evaluate(): AuctionResult {
    this.setMaxSpendRobustDelegations()
    this.updateExpectedMaxEffBidPmpe()
    const result = this.evaluateOne()
    this.setAuctionEffectiveBids(result.winningTotalPmpe)
    const totalMarinadeSpend = result.auctionData.validators.reduce(
      (acc, entry) => acc + (entry.revShare.auctionEffectiveBidPmpe * entry.marinadeActivatedStakeSol) / 1000,
      0,
    )
    this.setMaxBondDelegations()
    this.updateSpendRobustReputations(result.winningTotalPmpe, totalMarinadeSpend)
    this.reset()
    this.scaleReputationToFitTvl()
    this.debug.log('EVALUATING final auction')
    return this.evaluateFinal()
  }

  findNextPmpeGroup(totalPmpe: number): { totalPmpe: number; validators: AuctionValidator[] } | null {
    this.debug.log('finding next pmpe group...', totalPmpe)
    const nextGroupCandidates = this.data.validators.filter(validator => validator.revShare.totalPmpe < totalPmpe)
    if (nextGroupCandidates.length === 0) {
      this.debug.log('...no pmpe group remaining', totalPmpe)
      return null
    }
    const maxPmpe = nextGroupCandidates.reduce((max, validator) => Math.max(validator.revShare.totalPmpe, max), 0)
    const validators = nextGroupCandidates.filter(validator => validator.revShare.totalPmpe === maxPmpe)

    this.debug.log('...found next pmpe group', maxPmpe, validators.length)
    return {
      totalPmpe: maxPmpe,
      validators,
    }
  }
}
