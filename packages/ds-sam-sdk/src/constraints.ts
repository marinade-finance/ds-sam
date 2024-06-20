import { AuctionConstraintsConfig, AuctionData, AuctionValidator, BondConfig, AuctionConstraint, AuctionConstraintType } from './types'
import { validatorTotalAuctionStakeSol, zeroStakeConcentration } from './utils'

export class AuctionConstraints {
  private constraints: AuctionConstraint[] = []

  constructor(private readonly config: AuctionConstraintsConfig) { }

  getMinCapStakeConcentrationEntity(filter = (AuctionConstraint: AuctionConstraint) => true): AuctionConstraint {
    const minCapEntity = this.constraints.filter(filter).reduce((minCapEntity: AuctionConstraint | null, entity): AuctionConstraint | null => {
      const entityCap = Math.min(entity.totalLeftToCapSol, entity.marinadeLeftToCapSol)
      if (entityCap <= 0) {
        return minCapEntity
      }
      if (!minCapEntity) {
        return entity
      }
      const minCap = Math.min(minCapEntity.totalLeftToCapSol, minCapEntity.marinadeLeftToCapSol)
      return entityCap < minCap ? entity : minCapEntity
    }, null)
    if (!minCapEntity) {
      throw new Error('Failed to find stake concentration entity with min cap')
    }
    return minCapEntity
  }

  getMinCapForEvenDistribution(voteAccounts: Set<string>): number {
    const minCap = this.constraints.reduce((globalMinCap: number | null, entity): number | null => {
      const log = (...args: any[]) => void 0 //console.log('get min cap', {...entity, validators: entity.validators.length}, ...args)
      const affectedValidators = entity.validators.reduce((sum, validator) => sum + Number(voteAccounts.has(validator.voteAccount)), 0)

      if (affectedValidators === 0) {
        return globalMinCap
      }

      const entityCap = Math.min(entity.totalLeftToCapSol, entity.marinadeLeftToCapSol) / affectedValidators
      log('entity cap = ', entityCap, 'globalMinCap = ', globalMinCap)
      if (entityCap <= 0) {
        log('setting min to 0')
        return 0
      }
      if (globalMinCap === null) {
        log('first entity considered, setting it as minimum')
        return entityCap
      }
      return Math.min(entityCap, globalMinCap)
    }, null)
    if (minCap === null) {
      throw new Error('Failed to find stake concentration entity with min cap')
    }
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
  }

  updateStateForMnde(auctionData: AuctionData) {
    this.constraints = [
      ...this.buildCountryConcentrationConstraints(auctionData),
      ...this.buildAsoConcentrationConstraints(auctionData),
      ...this.buildMndeBondConstraints(auctionData),
      ...this.buildMndeVoteConstraints(auctionData)
    ]
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
      marinadeLeftToCapSol: bondStakeCapSam({} as any, validator) - validator.auctionStake.marinadeSamTargetSol,
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
      marinadeLeftToCapSol: bondStakeCapMnde({} as any, validator) - validator.auctionStake.marinadeMndeTargetSol,
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

export const bondStakeCapSam = (bondConfig: BondConfig, validator: AuctionValidator): number => {
  // refundableDepositPerStake * stakeCap + downtimeProtectionPerStake * stakeCap + bidPerStake * stakeCap = bondBalanceSol
  // stakeCap = bondBalanceSol / (refundableDepositPerStake + downtimeProtectionPerStake + bidPerStake)
  const bidPerStake = (validator.bidCpmpe ?? 0) / 1000
  const downtimeProtectionPerStake = 1 / 10000
  const refundableDepositPerStake = validator.revShare.totalPmpe / 1000
  const bondBalanceSol = Math.max((validator.bondBalanceSol ?? 0) - bondBalanceUsedForMnde(bondConfig, validator), 0)
  return bondBalanceSol / (refundableDepositPerStake + downtimeProtectionPerStake + bidPerStake)
}

export const bondStakeCapMnde = (bondConfig: BondConfig, validator: AuctionValidator): number => {
  // downtimeProtectionPerStake * stakeCap = bondBalanceSol
  // stakeCap = bondBalanceSol / downtimeProtectionPerStake
  const downtimeProtectionPerStake = 1 / 10000
  const bondBalanceSol = validator.bondBalanceSol ?? 0
  return bondBalanceSol / downtimeProtectionPerStake
}

export const bondBalanceUsedForMnde = (bondConfig: BondConfig, validator: AuctionValidator): number => {
  // downtimeProtectionPerStake * stake = bondBalanceSol
  const downtimeProtectionPerStake = 1 / 10000
  return validator.auctionStake.marinadeMndeTargetSol * downtimeProtectionPerStake
}
