import {
  AuctionConstraint,
  AuctionConstraintsConfig,
  AuctionConstraintType,
  AuctionData,
  AuctionValidator
} from './types'
import { validatorTotalAuctionStakeSol, zeroStakeConcentration } from './utils'

export class AuctionConstraints {
  private constraints: AuctionConstraint[] = []
  private constraintsPerValidator: Map<string, AuctionConstraint[]> = new Map()

  constructor(private readonly config: AuctionConstraintsConfig) { }

  getMinCapForEvenDistribution(voteAccounts: Set<string>): number {
    const constraints: AuctionConstraint[] = []
    for (const voteAccount of voteAccounts) {
      constraints.push(...(this.constraintsPerValidator.get(voteAccount) ?? []))
    }

    const minCap = constraints.reduce((globalMinCap: number | null, entity): number | null => {
      const log = (...args: any[]) => void 0 //console.log('get min cap', {...entity, validators: entity.validators.length}, ...args)
      const affectedValidators = entity.validators.reduce((sum, validator) => sum + Number(voteAccounts.has(validator.voteAccount)), 0)

      if (affectedValidators === 0) {
        log('no validators affected')
        return globalMinCap
      }

      const entityCap = Math.min(entity.totalLeftToCapSol, entity.marinadeLeftToCapSol) / affectedValidators
      log('entity cap = ', entityCap, 'globalMinCap = ', globalMinCap)
      if (globalMinCap === null) {
        log('first entity considered, setting it as minimum')
        return Math.max(0, entityCap)
      }
      return Math.max(0, Math.min(entityCap, globalMinCap))
    }, null)
    if (minCap === null) {
      throw new Error('Failed to find stake concentration entity with min cap')
    }
    console.log(`min cap ${minCap} found for ${voteAccounts.size} validators`)
    return minCap
  }

  findCapForValidator(validator: AuctionValidator): number {
    return this.getMinCapForEvenDistribution(new Set([validator.voteAccount]))
  }

  updateStateForSam(auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildSamBondConstraints(auctionData),
      ...this.buildValidatorConcentrationConstraints(auctionData),
    ]
    this.updateConstraintsPerValidator()
  }

  updateStateForMnde(auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildMndeBondConstraints(auctionData),
      ...this.buildMndeVoteConstraints(auctionData)
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

  private buildAsoConcentrationConstraints({ validators }: AuctionData) {
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

  private buildSamBondConstraints({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.BOND,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: bondStakeCapSam(validator) - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildMndeBondConstraints({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.BOND,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: bondStakeCapMnde(validator) - validator.auctionStake.marinadeMndeTargetSol,
      validators: [validator],
    }))
  }

  private buildValidatorConcentrationConstraints({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.VALIDATOR,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
      marinadeLeftToCapSol: this.config.marinadeValidatorSamStakeCapSol - validator.auctionStake.marinadeSamTargetSol,
      validators: [validator],
    }))
  }

  private buildMndeVoteConstraints({ validators }: AuctionData) {
    return validators.map(validator => ({
      constraintType: AuctionConstraintType.VALIDATOR,
      constraintName: validator.voteAccount,
      totalStakeSol: validatorTotalAuctionStakeSol(validator),
      totalLeftToCapSol: Infinity,
      marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol,
      marinadeLeftToCapSol: validator.mndeVotesSolValue - validator.auctionStake.marinadeMndeTargetSol,
      validators: [validator],
    }))
  }
}

export const bondStakeCapSam = (validator: AuctionValidator): number => {
  // refundableDepositPerStake * stakeCap + downtimeProtectionPerStake * stakeCap + bidPerStake * stakeCap = bondBalanceSol
  // stakeCap = bondBalanceSol / (refundableDepositPerStake + downtimeProtectionPerStake + bidPerStake)
  const bidPerStake = (validator.bidCpmpe ?? 0) / 1000
  const downtimeProtectionPerStake = 1 / 10000
  const refundableDepositPerStake = validator.revShare.totalPmpe / 1000
  const bondBalanceSol = Math.max((validator.bondBalanceSol ?? 0) - bondBalanceUsedForMnde(validator), 0)
  return Math.min(bondBalanceSol / (refundableDepositPerStake + downtimeProtectionPerStake + bidPerStake), validator.maxStakeWanted ?? 0)
}

export const bondStakeCapMnde = (validator: AuctionValidator): number => {
  // downtimeProtectionPerStake * stakeCap = bondBalanceSol
  // stakeCap = bondBalanceSol / downtimeProtectionPerStake
  const downtimeProtectionPerStake = 1 / 10000
  const bondBalanceSol = validator.bondBalanceSol ?? 0
  return bondBalanceSol / downtimeProtectionPerStake
}

export const bondBalanceUsedForMnde = (validator: AuctionValidator): number => {
  // downtimeProtectionPerStake * stake = bondBalanceSol
  const downtimeProtectionPerStake = 1 / 10000
  return validator.auctionStake.marinadeMndeTargetSol * downtimeProtectionPerStake
}
