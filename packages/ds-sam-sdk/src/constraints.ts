import { AuctionConstraintsConfig, AuctionData, StakeConcentration } from './types'
import { calcValidatorAuctionStakeSol, zeroStakeConcentration } from './utils'

export class AuctionConstraints {
  private countriesConcentrations = new Map<string, StakeConcentration>()
  private asosConcentrations = new Map<string, StakeConcentration>()

  constructor (private readonly config: AuctionConstraintsConfig) {}

  evaluateState ({ validators, stakeAmounts }: AuctionData) {
    const countries = new Map<string, StakeConcentration>()
    const asos = new Map<string, StakeConcentration>()

    validators.forEach(validator => {
      // TODO update when clarified
      if (!validator.country) validator.country = 'Unknown'
      if (!validator.aso) validator.aso = 'Unknown'

      const stake = calcValidatorAuctionStakeSol(validator)

      const countryStake = countries.get(validator.country) ?? zeroStakeConcentration({
        total: this.config.totalCountryStakeCapSol,
        marinade: this.config.marinadeCountryStakeCapSol,
      })
      countries.set(validator.country, {
        totalStakeSol: countryStake.totalStakeSol + stake,
        totalStakeShareDec: countryStake.totalStakeShareDec + (stake / stakeAmounts.totalSol),
        totalLeftToCapSol: countryStake.totalLeftToCapSol - stake,
        marinadeStakeSol: countryStake.marinadeStakeSol + validator.marinadeTargetStake,
        marinadeTvlShareDec: countryStake.marinadeTvlShareDec + (validator.marinadeTargetStake / stakeAmounts.marinadeTvlSol),
        marinadeLeftToCapSol: countryStake.marinadeLeftToCapSol - validator.marinadeTargetStake,
      })

      const asoStake = asos.get(validator.aso) ?? zeroStakeConcentration({
        total: this.config.totalAsoStakeCapSol,
        marinade: this.config.marinadeAsoStakeCapSol,
      })
      asos.set(validator.aso, {
        totalStakeSol: asoStake.totalStakeSol + stake,
        totalStakeShareDec: asoStake.totalStakeShareDec + (stake / stakeAmounts.totalSol),
        totalLeftToCapSol: asoStake.totalLeftToCapSol - stake,
        marinadeStakeSol: asoStake.marinadeStakeSol + validator.marinadeTargetStake,
        marinadeTvlShareDec: asoStake.marinadeTvlShareDec + (validator.marinadeTargetStake / stakeAmounts.marinadeTvlSol),
        marinadeLeftToCapSol: asoStake.marinadeLeftToCapSol - validator.marinadeTargetStake,
      })
    })
    this.countriesConcentrations = countries
    this.asosConcentrations = asos
  }
}
