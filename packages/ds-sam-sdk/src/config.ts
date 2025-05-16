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
  bondsApiBaseUrl: string
  tvlInfoApiBaseUrl: string
  blacklistApiBaseUrl: string
  snapshotsApiBaseUrl: string
  scoringApiBaseUrl: string
  overridesApiBaseUrl: string

  rewardsEpochsCount: number
  validatorsUptimeEpochsCount: number
  validatorsUptimeThresholdDec: number
  validatorsClientVersionSemverExpr: string
  validatorsMaxEffectiveCommissionDec: number
  bidTooLowPenaltyHistoryEpochs: number

  mndeDirectedStakeShareDec: number
  mndeStakeCapMultiplier: number
  maxMarinadeStakeConcentrationPerCountryDec: number
  maxMarinadeStakeConcentrationPerAsoDec: number
  maxNetworkStakeConcentrationPerCountryDec: number
  maxNetworkStakeConcentrationPerAsoDec: number
  maxMarinadeTvlSharePerValidatorDec: number
  spendRobustReputationMult: number | null
  spendRobustReputationDecayEpochs: number
  minSpendRobustReputation: number
  minScaledSpendRobustReputation: number
  maxSpendRobustReputation: number
  initialSpendRobustReputation: number
  minBondBalanceSol: number
  spendRobustReputationBondBoostCoef: number

  debugVoteAccounts: string[]
}

export const DEFAULT_CONFIG: DsSamConfig = {
  inputsSource: InputsSource.APIS,

  validatorsApiBaseUrl: 'https://validators-api.marinade.finance',
  bondsApiBaseUrl: 'https://validator-bonds-api.marinade.finance',
  tvlInfoApiBaseUrl: 'https://api.marinade.finance',
  blacklistApiBaseUrl: 'https://raw.githubusercontent.com/marinade-finance/delegation-strategy-2/master',
  overridesApiBaseUrl: 'https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/main/overrides',
  snapshotsApiBaseUrl: 'https://snapshots-api.marinade.finance',
  scoringApiBaseUrl:  'https://scoring.marinade.finance',

  rewardsEpochsCount: 10,
  validatorsUptimeEpochsCount: 3,
  validatorsUptimeThresholdDec: 0.8,
  validatorsClientVersionSemverExpr: '>=1.18.15 || >=0.101.20013 <1.0.0',
  validatorsMaxEffectiveCommissionDec: 0.07,
  bidTooLowPenaltyHistoryEpochs: 3,

  mndeDirectedStakeShareDec: 0,
  mndeStakeCapMultiplier: 0.1,
  maxMarinadeStakeConcentrationPerCountryDec: 1,
  maxMarinadeStakeConcentrationPerAsoDec: 1,
  maxNetworkStakeConcentrationPerCountryDec: 0.3,
  maxNetworkStakeConcentrationPerAsoDec: 0.3,
  maxMarinadeTvlSharePerValidatorDec: 0.04,
  spendRobustReputationMult: null,
  spendRobustReputationDecayEpochs: 50,
  minSpendRobustReputation: -20,
  minScaledSpendRobustReputation: 40,
  maxSpendRobustReputation: 1000,
  initialSpendRobustReputation: 1,
  minBondBalanceSol: 0,
  spendRobustReputationBondBoostCoef: 0,

  debugVoteAccounts: [],
}
