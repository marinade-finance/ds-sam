import {
  AuctionConstraint,
  AuctionConstraintsConfig,
  AuctionConstraintType,
  AuctionData,
  AuctionValidator
} from './types'
import { minCapFromConstraint, validatorTotalAuctionStakeSol, zeroStakeConcentration } from './utils'
import { Debug } from './debug'
import { EPSILON } from './auction'

export class AuctionConstraints {
  private constraints: AuctionConstraint[] = []
  private constraintsPerValidator: Map<string, AuctionConstraint[]> = new Map()

  constructor (private readonly config: AuctionConstraintsConfig, private debug: Debug) { }

  getMinCapForEvenDistribution (voteAccounts: Set<string>, collectDebug = true): { cap: number, constraint: AuctionConstraint } {
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
    console.log(event)

    return { cap: resultMinCap, constraint: min }
  }

  findCapForValidator (validator: AuctionValidator): number {
    const { cap, constraint } = this.getMinCapForEvenDistribution(new Set([validator.voteAccount]), false)
    if (cap < EPSILON) {
      validator.lastCapConstraint = constraint
      this.debug.pushValidatorEvent(validator.voteAccount, `reached cap due to ${constraint.constraintType} (${constraint.constraintName}) constraint`)
    }
    return cap
  }

  getValidatorConstraints (voteAccount: string) {
    return this.constraintsPerValidator.get(voteAccount)
  }

  updateStateForSam (auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildSamBondConstraints(auctionData),
      ...this.buildValidatorConcentrationConstraints(auctionData),
      ...this.buildReputationConstraints(auctionData),
      ...this.buildSamWantConstraints(auctionData),
    ]
    this.updateConstraintsPerValidator()
  }

  updateStateForBackstop (auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildBackstopConstraints(auctionData),
      ...this.buildValidatorConcentrationConstraints(auctionData),
      ...this.buildSamWantConstraints(auctionData),
    ]
    this.updateConstraintsPerValidator()
  }

  updateStateForMnde (auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildMndeBondConstraints(auctionData),
      ...this.buildMndeVoteConstraints(auctionData)
    ]
    this.updateConstraintsPerValidator()
  }

  private updateConstraintsPerValidator () {
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

  private buildCountryConcentrationConstraints ({ validators }: AuctionData) {
    const countries = new Map<string, AuctionConstraint>()

    validators.forEach(validator => {
      const stake = validatorTotalAuctionStakeSol(validator)

      const countryStakeCon = countries.get(validator.country) ?? zeroStakeConcentration(AuctionConstraintType.COUNTRY, validator.country, {
        totalSol: this.config.totalCountryStakeCapSol,
        marinadeSol: this.config.marinadeCountryStakeCapSol,
      })
      countryStakeCon.validators.push(validator)
      countries.set(validator.country, {
        constraintType: AuctionConstraintType.COUNTRY,
        constraintName: validator.country,
        totalStakeSol: countryStakeCon.totalStakeSol + stake,
        totalLeftToCapSol: countryStakeCon.totalLeftToCapSol - stake,
        marinadeStakeSol: countryStakeCon.marinadeStakeSol + validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: countryStakeCon.marinadeLeftToCapSol - validator.auctionStake.marinadeMndeTargetSol - validator.auctionStake.marinadeSamTargetSol,
        validators: countryStakeCon.validators,
      })
    })
    return [...countries.values()]
  }

  private buildAsoConcentrationConstraints ({ validators }: AuctionData) {
    const asos = new Map<string, AuctionConstraint>()

    validators.forEach(validator => {
      const stake = validatorTotalAuctionStakeSol(validator)

      const asoStakeCon = asos.get(validator.aso) ?? zeroStakeConcentration(AuctionConstraintType.ASO, validator.aso, {
        totalSol: this.config.totalAsoStakeCapSol,
        marinadeSol: this.config.marinadeAsoStakeCapSol,
      })
      asoStakeCon.validators.push(validator)
      asos.set(validator.aso, {
        constraintType: AuctionConstraintType.ASO,
        constraintName: validator.aso,
        totalStakeSol: asoStakeCon.totalStakeSol + stake,
        totalLeftToCapSol: asoStakeCon.totalLeftToCapSol - stake,
        marinadeStakeSol: asoStakeCon.marinadeStakeSol + validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: asoStakeCon.marinadeLeftToCapSol - validator.auctionStake.marinadeMndeTargetSol - validator.auctionStake.marinadeSamTargetSol,
        validators: asoStakeCon.validators,
      })
    })
    return [...asos.values()]
  }

  private buildReputationConstraints ({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.REPUTATION,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.reputationStakeCap(validator) - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildSamBondConstraints ({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.BOND,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.bondStakeCapSam(validator) - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildBackstopConstraints ({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.RISK,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.unprotectedStakeCap(validator) - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildSamWantConstraints ({ validators }: AuctionData) {
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
        marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: clippedMaxStakeWanted - validator.auctionStake.marinadeSamTargetSol,
        validators: [validator],
      }
    })
  }

  private buildMndeBondConstraints ({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.BOND,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.bondStakeCapMnde(validator) - validator.auctionStake.marinadeMndeTargetSol,
      validators: [validator],
    }))
  }

  private buildValidatorConcentrationConstraints ({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.VALIDATOR,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: (this.config.marinadeValidatorStakeCapSol + validator.mndeStakeCapIncrease) - validator.auctionStake.marinadeMndeTargetSol - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildMndeVoteConstraints ({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.MNDE,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol,
      marinadeLeftToCapSol: validator.mndeVotesSolValue - validator.auctionStake.marinadeMndeTargetSol,
      validators: [validator],
    }))
  }

  reputationStakeCap (validator: AuctionValidator): number {
    if (this.config.spendRobustReputationMult != null) {
      return Math.max(validator.values.adjMaxSpendRobustDelegation, validator.marinadeActivatedStakeSol)
    } else {
      return Infinity
    }
  }

  bondStakeCapSam (validator: AuctionValidator): number {
    const { revShare } = validator
    // do not make validators over-collateralize
    const minBidReservePmpe = this.config.minBondEpochs * revShare.expectedMaxEffBidPmpe
    const idealBidReservePmpe = this.config.idealBondEpochs * revShare.expectedMaxEffBidPmpe
    const minBondPmpe = revShare.inflationPmpe + revShare.mevPmpe + revShare.expectedMaxEffBidPmpe + minBidReservePmpe
    const idealBondPmpe = revShare.inflationPmpe + revShare.mevPmpe + revShare.expectedMaxEffBidPmpe + idealBidReservePmpe
    const effBondBalanceSol = (validator.bondBalanceSol ?? 0)
      * (1 + Math.min(this.config.spendRobustReputationBondBoostCoef * validator.values.spendRobustReputation, 1))
    const bondBalanceSol = Math.max(effBondBalanceSol - bondBalanceUsedForMnde(validator), 0)
    const minUnprotectedReserve = this.unprotectedStakeCap(validator) * (minBidReservePmpe / 1000)
    const idealUnprotectedReserve = this.unprotectedStakeCap(validator) * (idealBidReservePmpe / 1000)
    const minLimit = Math.max(0, bondBalanceSol - minUnprotectedReserve) / (minBondPmpe / 1000)
    const idealLimit = Math.max(0, bondBalanceSol - idealUnprotectedReserve) / (idealBondPmpe / 1000)
    // always minLimit > idealLimit, since minBondEpochs < idealBondEpochs
    // if marinadeActivatedStakeSol = 0, then the limit is given by the lower limit, which is the idealLimit
    // if marinadeActivatedStakeSol > idealLimit, but below minLimit, the limit is given by minLimit
    // the limit will never exceed minLimit
    // which is also the limit at which we charge the bondRiskFeeSol
    const limit = Math.min(minLimit, Math.max(idealLimit, validator.marinadeActivatedStakeSol))
    return this.clipBondStakeCap(validator, limit) + this.unprotectedStakeCap(validator)
  }

  unprotectedStakeCap (validator: AuctionValidator): number {
    return this.config.maxUnprotectedStakePerValidatorDec * Math.max(0, validator.totalActivatedStakeSol - validator.selfStakeSol + validator.foundationStakeSol)
  }

  bondStakeCapMnde (validator: AuctionValidator): number {
    const downtimeProtectionPerStake = 0
    const bondBalanceSol = validator.bondBalanceSol ?? 0
    const limit = bondBalanceSol / downtimeProtectionPerStake
    return this.clipBondStakeCap(validator, limit)
  }

  clipBondStakeCap (validator: AuctionValidator, limit: number): number {
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

export const bondBalanceUsedForMnde = (validator: AuctionValidator): number => {
  // downtimeProtectionPerStake * stake = bondBalanceSol
  const downtimeProtectionPerStake = 0
  return validator.auctionStake.marinadeMndeTargetSol * downtimeProtectionPerStake
}

export const bondBalanceRequiredForCurrentStake = (validator: AuctionValidator): number => {
  return bondBalanceRequiredForStakeAmount(validator.marinadeActivatedStakeSol, validator)
}

export const bondBalanceRequiredForStakeAmount = (stakeSol: number, validator: AuctionValidator): number => {
  // refundableDepositPerStake * stake + downtimeProtectionPerStake * stake + bidPerStake * stake = bondBalanceSol
  const bidPerStake = validator.revShare.bidPmpe / 1000
  const downtimeProtectionPerStake = 0
  const refundableDepositPerStake = validator.revShare.totalPmpe / 1000
  return stakeSol * (bidPerStake + downtimeProtectionPerStake + refundableDepositPerStake)
}

export const bondBalanceRequiredForXEpochs = (stakeSol: number, validator: AuctionValidator, epochs: number): number => {
  // refundableDepositPerStake * stake + downtimeProtectionPerStake * stake + bidPerStake * stake * epochs = bondBalanceSol
  const bidPerStake = validator.revShare.bidPmpe / 1000
  const downtimeProtectionPerStake = 0
  const refundableDepositPerStake = validator.revShare.totalPmpe / 1000
  return stakeSol * ((bidPerStake * epochs) + downtimeProtectionPerStake + refundableDepositPerStake)
}
