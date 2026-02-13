import { EPSILON } from './auction'
import { AuctionConstraintType } from './types'
import { minCapFromConstraint, validatorTotalAuctionStakeSol, zeroStakeConcentration } from './utils'

import type { Debug } from './debug'
import type { AuctionConstraint, AuctionConstraintsConfig, AuctionData, AuctionValidator } from './types'

export class AuctionConstraints {
  private constraints: AuctionConstraint[] = []
  private constraintsPerValidator: Map<string, AuctionConstraint[]> = new Map()

  constructor(
    private readonly config: AuctionConstraintsConfig,
    private debug: Debug,
  ) {}

  getMinCapForEvenDistribution(
    voteAccounts: Set<string>,
    collectDebug = true,
  ): { cap: number; constraint: AuctionConstraint } {
    const constraints: AuctionConstraint[] = []
    for (const voteAccount of voteAccounts) {
      constraints.push(...(this.constraintsPerValidator.get(voteAccount) ?? []))
    }
    const min = constraints.reduce((minConstraint: AuctionConstraint | null, constraint): AuctionConstraint | null => {
      const { cap, affectedValidators } = minCapFromConstraint(constraint, voteAccounts)

      if (affectedValidators === 0) {
        return minConstraint
      }
      if (minConstraint === null) {
        return constraint
      }
      const { cap: minCap } = minCapFromConstraint(minConstraint, voteAccounts)
      return cap < minCap ? constraint : minConstraint
    }, null)
    if (min === null) {
      throw new Error('Failed to find stake concentration entity with min cap')
    }
    const { cap: resultMinCap } = minCapFromConstraint(min, voteAccounts)
    const event = `min cap ${resultMinCap} of type ${min.constraintType} (${min.constraintName}) found for ${voteAccounts.size} validators: ${Array.from(voteAccounts.values()).slice(0, 5).join(' ')}`
    if (collectDebug) {
      this.debug.pushValidatorSetEvent(voteAccounts, event)
    }
    this.debug.log(event)

    return { cap: resultMinCap, constraint: min }
  }

  /* eslint-disable no-param-reassign */
  findCapForValidator(validator: AuctionValidator): number {
    const { cap, constraint } = this.getMinCapForEvenDistribution(new Set([validator.voteAccount]), false)
    if (cap < EPSILON) {
      validator.lastCapConstraint = constraint
      this.debug.pushValidatorEvent(
        validator.voteAccount,
        `reached cap due to ${constraint.constraintType} (${constraint.constraintName}) constraint`,
      )
    }
    return cap
  }

  getValidatorConstraints(voteAccount: string) {
    return this.constraintsPerValidator.get(voteAccount)
  }

  updateStateForSam(auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildSamBondConstraints(auctionData),
      ...this.buildValidatorConcentrationConstraints(auctionData),
      ...this.buildSamWantConstraints(auctionData),
    ]
    this.updateConstraintsPerValidator()
  }

  updateStateForBackstop(auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildBackstopConstraints(auctionData),
      ...this.buildValidatorConcentrationConstraints(auctionData),
      ...this.buildSamWantConstraints(auctionData),
    ]
    this.updateConstraintsPerValidator()
  }

  private updateConstraintsPerValidator() {
    this.constraintsPerValidator = new Map()
    for (const constraint of this.constraints) {
      for (const validator of constraint.validators) {
        const validatorConstraints = this.constraintsPerValidator.get(validator.voteAccount)
        if (validatorConstraints) {
          validatorConstraints.push(constraint)
        } else {
          this.constraintsPerValidator.set(validator.voteAccount, [constraint])
        }
      }
    }
  }

  private buildCountryConcentrationConstraints({ validators }: AuctionData) {
    const countries = new Map<string, AuctionConstraint>()

    validators.forEach(validator => {
      const stake = validatorTotalAuctionStakeSol(validator)

      const countryStakeCon =
        countries.get(validator.country) ??
        zeroStakeConcentration(AuctionConstraintType.COUNTRY, validator.country, {
          totalSol: this.config.totalCountryStakeCapSol,
          marinadeSol: this.config.marinadeCountryStakeCapSol,
        })
      countryStakeCon.validators.push(validator)
      countries.set(validator.country, {
        constraintType: AuctionConstraintType.COUNTRY,
        constraintName: validator.country,
        totalStakeSol: countryStakeCon.totalStakeSol + stake,
        totalLeftToCapSol: countryStakeCon.totalLeftToCapSol - stake,
        marinadeStakeSol: countryStakeCon.marinadeStakeSol + validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: countryStakeCon.marinadeLeftToCapSol - validator.auctionStake.marinadeSamTargetSol,
        validators: countryStakeCon.validators,
      })
    })
    return [...countries.values()]
  }

  private buildAsoConcentrationConstraints({ validators }: AuctionData) {
    const asos = new Map<string, AuctionConstraint>()

    validators.forEach(validator => {
      const stake = validatorTotalAuctionStakeSol(validator)

      const asoStakeCon =
        asos.get(validator.aso) ??
        zeroStakeConcentration(AuctionConstraintType.ASO, validator.aso, {
          totalSol: this.config.totalAsoStakeCapSol,
          marinadeSol: this.config.marinadeAsoStakeCapSol,
        })
      asoStakeCon.validators.push(validator)
      asos.set(validator.aso, {
        constraintType: AuctionConstraintType.ASO,
        constraintName: validator.aso,
        totalStakeSol: asoStakeCon.totalStakeSol + stake,
        totalLeftToCapSol: asoStakeCon.totalLeftToCapSol - stake,
        marinadeStakeSol: asoStakeCon.marinadeStakeSol + validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: asoStakeCon.marinadeLeftToCapSol - validator.auctionStake.marinadeSamTargetSol,
        validators: asoStakeCon.validators,
      })
    })
    return [...asos.values()]
  }

  private buildSamBondConstraints({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.BOND,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.bondStakeCapSam(validator) - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildBackstopConstraints({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.RISK,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.unprotectedStakeCap(validator) - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildSamWantConstraints({ validators }: AuctionData) {
    return validators.map(validator => {
      const maxStakeWanted = validator.maxStakeWanted ?? Infinity
      const clippedMaxStakeWanted = Math.max(
        this.config.minMaxStakeWanted,
        validator.marinadeActivatedStakeSol,
        maxStakeWanted > 0 ? maxStakeWanted : Infinity,
      )
      return {
        constraintType: AuctionConstraintType.WANT,
        constraintName: validator.voteAccount,
        totalStakeSol: validatorTotalAuctionStakeSol(validator),
        totalLeftToCapSol: Infinity,
        marinadeStakeSol: validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: clippedMaxStakeWanted - validator.auctionStake.marinadeSamTargetSol,
        validators: [validator],
      }
    })
  }

  private buildValidatorConcentrationConstraints({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.VALIDATOR,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.config.marinadeValidatorStakeCapSol - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  /* eslint-disable no-param-reassign */
  bondStakeCapSam(validator: AuctionValidator): number {
    const { revShare } = validator
    // do not make validators over-collateralize
    const minBidReservePmpe = this.config.minBondEpochs * revShare.expectedMaxEffBidPmpe
    const idealBidReservePmpe = this.config.idealBondEpochs * revShare.expectedMaxEffBidPmpe
    const minBondPmpe = revShare.onchainDistributedPmpe + revShare.expectedMaxEffBidPmpe + minBidReservePmpe
    const idealBondPmpe = revShare.onchainDistributedPmpe + revShare.expectedMaxEffBidPmpe + idealBidReservePmpe
    const effBondBalanceSol = validator.bondBalanceSol ?? 0
    const bondBalanceSol = Math.max(effBondBalanceSol, 0)
    // how much does the validator need to keep to pay for the unprotected stake
    const maxUnprotectedStakeSol = bondBalanceSol > 0 ? bondBalanceSol / (idealBidReservePmpe / 1000) : 0
    const unprotectedStakeSol = Math.min(this.unprotectedStakeCap(validator), maxUnprotectedStakeSol)
    const minUnprotectedReserve = unprotectedStakeSol * (minBidReservePmpe / 1000)
    const idealUnprotectedReserve = unprotectedStakeSol * (idealBidReservePmpe / 1000)
    const minLimit = Math.max(0, bondBalanceSol - minUnprotectedReserve) / (minBondPmpe / 1000)
    const idealLimit = Math.max(0, bondBalanceSol - idealUnprotectedReserve) / (idealBondPmpe / 1000)
    // always minLimit > idealLimit, since minBondEpochs < idealBondEpochs
    // if marinadeActivatedStakeSol = 0, then the limit is given by the lower limit, which is the idealLimit
    // if marinadeActivatedStakeSol > idealLimit, but below minLimit, the limit is given by minLimit
    // the limit will never exceed minLimit
    // which is also the limit at which we charge the bondRiskFeeSol
    const limit = Math.min(minLimit, Math.max(idealLimit, validator.marinadeActivatedStakeSol))
    const cap = this.clipBondStakeCap(validator, limit + unprotectedStakeSol)
    validator.unprotectedStakeSol = unprotectedStakeSol
    validator.bondSamStakeCapSol = cap
    // represents for how many epochs is this validator protected
    const protectedStakeSol = Math.max(0, validator.marinadeActivatedStakeSol - unprotectedStakeSol)
    validator.bondGoodForNEpochs =
      Math.max(0, bondBalanceSol - (revShare.onchainDistributedPmpe / 1000) * protectedStakeSol) /
      ((revShare.expectedMaxEffBidPmpe / 1000) * validator.marinadeActivatedStakeSol)
    // represents how much of the stake this validator has is protected sufficiently enough
    //
    // do not consider the flapping histeresis for unstake priorities and risk measures
    //
    // allow for some unprotected slack before we introduce the bond risk system doing this optimally
    let regularMinMaxStakeWanted = Math.max(10000, this.config.minMaxStakeWanted)
    let correction = regularMinMaxStakeWanted / (1 + regularMinMaxStakeWanted)
    validator.bondSamHealth =
      (1.1 * (minLimit + unprotectedStakeSol)) / (1 + validator.marinadeActivatedStakeSol) / correction
    return cap
  }

  /* eslint-disable no-param-reassign */
  unprotectedStakeCap(validator: AuctionValidator): number {
    let cap = Math.min(
      this.config.unprotectedValidatorStakeCapSol,
      this.config.unprotectedDelegatedStakeDec *
        Math.max(0, validator.totalActivatedStakeSol - validator.selfStakeSol - validator.foundationStakeSol) +
        this.config.unprotectedFoundationStakeDec * validator.foundationStakeSol,
    )
    if (cap < this.config.minUnprotectedStakeToDelegateSol) {
      cap = 0
    }
    validator.unprotectedStakeCapSol = cap
    return cap
  }

  clipBondStakeCap(validator: AuctionValidator, limit: number): number {
    const bondBalanceSol = validator.bondBalanceSol ?? 0
    // provide hysteresis so that the system does not flap
    if (bondBalanceSol < 0.8 * this.config.minBondBalanceSol) {
      return 0
    } else if (bondBalanceSol < this.config.minBondBalanceSol) {
      return Math.min(limit, validator.marinadeActivatedStakeSol)
    } else {
      return limit
    }
  }
}
