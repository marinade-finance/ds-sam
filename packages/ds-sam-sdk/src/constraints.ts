import { AuctionConstraintsConfig, AuctionData, StakeConcEntity, StakeConcEntityType } from './types'
import { validatorTotalAuctionStakeSol, zeroStakeConcentration } from './utils'

export class AuctionConstraints {
  private stakeConcentrationEntities: StakeConcEntity[] = []

  constructor (private readonly config: AuctionConstraintsConfig) {}

  getMinCapStakeConcentrationEntity (): StakeConcEntity {
    const minCapEntity = this.stakeConcentrationEntities.reduce((minCapEntity: StakeConcEntity | null, entity): StakeConcEntity | null => {
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

  updateState ({ validators }: AuctionData) {
    const countries = new Map<string, StakeConcEntity>()
    const asos = new Map<string, StakeConcEntity>()
    const entities: StakeConcEntity[] = []

    validators.forEach(validator => {
      const stake = validatorTotalAuctionStakeSol(validator)

      const countryStakeCon = countries.get(validator.country) ?? zeroStakeConcentration(StakeConcEntityType.COUNTRY, validator.country, {
        totalSol: this.config.totalCountryStakeCapSol,
        marinadeSol: this.config.marinadeCountryStakeCapSol,
      })
      countryStakeCon.validators.push(validator)
      countries.set(validator.country, {
        entityType: StakeConcEntityType.COUNTRY,
        entityName: validator.country,
        totalStakeSol: countryStakeCon.totalStakeSol + stake,
        totalLeftToCapSol: countryStakeCon.totalLeftToCapSol - stake,
        marinadeStakeSol: countryStakeCon.marinadeStakeSol + validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: countryStakeCon.marinadeLeftToCapSol - validator.auctionStake.marinadeMndeTargetSol - validator.auctionStake.marinadeSamTargetSol,
        validators: countryStakeCon.validators,
      })

      // TODO? wrap countries and ASOs processing into a reused function
      const asoStakeCon = asos.get(validator.aso) ?? zeroStakeConcentration(StakeConcEntityType.ASO, validator.aso, {
        totalSol: this.config.totalAsoStakeCapSol,
        marinadeSol: this.config.marinadeAsoStakeCapSol,
      })
      asoStakeCon.validators.push(validator)
      asos.set(validator.aso, {
        entityType: StakeConcEntityType.ASO,
        entityName: validator.aso,
        totalStakeSol: asoStakeCon.totalStakeSol + stake,
        totalLeftToCapSol: asoStakeCon.totalLeftToCapSol - stake,
        marinadeStakeSol: asoStakeCon.marinadeStakeSol + validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
        marinadeLeftToCapSol: asoStakeCon.marinadeLeftToCapSol - validator.auctionStake.marinadeMndeTargetSol - validator.auctionStake.marinadeSamTargetSol,
        validators: asoStakeCon.validators,
      })
      entities.push({
        entityType: StakeConcEntityType.VALIDATOR,
        entityName: validator.voteAccount,
        totalStakeSol: validatorTotalAuctionStakeSol(validator),
        totalLeftToCapSol: Infinity,
        marinadeStakeSol: validator.auctionStake.marinadeMndeTargetSol + validator.auctionStake.marinadeSamTargetSol,
        // TODO? this needs to be kept in sync with the fact that only SAM stake is limited per validator, not MNDE stake
        marinadeLeftToCapSol: this.config.marinadeValidatorSamStakeCapSol - validator.auctionStake.marinadeSamTargetSol,
        validators: [validator],
      })
    })
    countries.forEach(country => entities.push(country))
    asos.forEach(aso => entities.push(aso))

    console.log('entities', entities.slice(0, 5), entities.slice(countries.size, countries.size + 5), entities.slice(countries.size + asos.size, countries.size + asos.size + 5))

    this.stakeConcentrationEntities = entities
  }
}
