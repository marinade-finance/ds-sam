import type { AggregatedData, AuctionConstraintsConfig, DsSamConfig } from '@marinade.finance/ds-sam-calc'

export const buildAuctionConstraintsConfig = (
  config: DsSamConfig,
  { stakeAmounts }: Pick<AggregatedData, 'stakeAmounts'>,
): AuctionConstraintsConfig => {
  const { networkTotalSol, marinadeSamTvlSol } = stakeAmounts
  const marinadeTotalTvlSol = marinadeSamTvlSol
  return {
    totalCountryStakeCapSol: networkTotalSol * config.maxNetworkStakeConcentrationPerCountryDec,
    totalAsoStakeCapSol: networkTotalSol * config.maxNetworkStakeConcentrationPerAsoDec,
    marinadeCountryStakeCapSol: marinadeTotalTvlSol * config.maxMarinadeStakeConcentrationPerCountryDec,
    marinadeAsoStakeCapSol: marinadeTotalTvlSol * config.maxMarinadeStakeConcentrationPerAsoDec,
    marinadeValidatorStakeCapSol: marinadeTotalTvlSol * config.maxMarinadeTvlSharePerValidatorDec,
    minBondBalanceSol: config.minBondBalanceSol,
    // if maxStakeWanted == null, disable the limit
    minMaxStakeWanted: config.minMaxStakeWanted ?? Infinity,
    minBondEpochs: config.minBondEpochs,
    idealBondEpochs: config.idealBondEpochs,
    unprotectedValidatorStakeCapSol: marinadeTotalTvlSol * config.maxUnprotectedStakePerValidatorDec,
    minUnprotectedStakeToDelegateSol: config.minUnprotectedStakeToDelegateSol,
    unprotectedFoundationStakeDec: config.unprotectedFoundationStakeDec,
    unprotectedDelegatedStakeDec: config.unprotectedDelegatedStakeDec,
    bondObligationSafetyMult: config.bondObligationSafetyMult,
    bondSamHealthMult: config.bondSamHealthMult,
  }
}
