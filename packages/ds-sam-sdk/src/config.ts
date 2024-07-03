export enum InputsSource {
  APIS = 'APIS',
  FILES = 'FILES',
}

export type DsSamConfig = {
  inputsSource: InputsSource
  inputsCacheDirPath?: string
  cacheInputs?: boolean

  // TODO? split into nested config sections
  validatorsApiBaseUrl: string
  mevInfoApiBaseUrl: string
  bondsApiBaseUrl: string
  tvlInfoApiBaseUrl: string
  blacklistApiBaseUrl: string
  snapshotsApiBaseUrl: string

  rewardsEpochsCount: number
  validatorsUptimeEpochsCount: number
  validatorsUptimeThreshold: number
  validatorsClientVersionSemverExpr: string
  validatorsMaxEffectiveCommissionDec: number

  mndeDirectedStakeShareDec: number
  maxMarinadeStakeConcentrationPerCountryDec: number
  maxMarinadeStakeConcentrationPerAsoDec: number
  maxNetworkStakeConcentrationPerCountryDec: number
  maxNetworkStakeConcentrationPerAsoDec: number
  maxMarinadeTvlSharePerValidatorDec: number

  debugVoteAccounts: string[]
}

export const DEFAULT_CONFIG: DsSamConfig = {
  inputsSource: InputsSource.APIS,

  validatorsApiBaseUrl: 'https://validators-api.marinade.finance',
  mevInfoApiBaseUrl: 'https://kobe.mainnet.jito.network',
  bondsApiBaseUrl: 'https://validator-bonds-api.marinade.finance',
  tvlInfoApiBaseUrl: 'https://api.marinade.finance',
  blacklistApiBaseUrl: 'https://raw.githubusercontent.com/marinade-finance/delegation-strategy-2/master',
  snapshotsApiBaseUrl: 'https://snapshots-api.marinade.finance',

  rewardsEpochsCount: 10,
  validatorsUptimeEpochsCount: 3,
  validatorsUptimeThreshold: 0.8,
  validatorsClientVersionSemverExpr: '*', // TODO eligible versions
  validatorsMaxEffectiveCommissionDec: 0.07,

  mndeDirectedStakeShareDec: 0.1,
  maxMarinadeStakeConcentrationPerCountryDec: 0.3,
  maxMarinadeStakeConcentrationPerAsoDec: 0.2,
  maxNetworkStakeConcentrationPerCountryDec: 0.3,
  maxNetworkStakeConcentrationPerAsoDec: 0.2,
  maxMarinadeTvlSharePerValidatorDec: 0.02,

  debugVoteAccounts: [],
}
