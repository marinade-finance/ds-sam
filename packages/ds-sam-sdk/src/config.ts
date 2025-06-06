export enum InputsSource {
  APIS = 'APIS',
  FILES = 'FILES',
}

export type DsSamConfig = {
  // Fetch source data from APIs or from local files
  inputsSource: InputsSource
  // Directory where to write/read input data (optional)
  inputsCacheDirPath?: string
  // Whether to cache input data (optional)
  cacheInputs?: boolean

  // TODO? split into nested config sections
  // Base URL of the API to get validators info from
  validatorsApiBaseUrl: string
  // Base URL of the API to get bonds from
  bondsApiBaseUrl: string
  // Base URL of the API to get TVL info from
  tvlInfoApiBaseUrl: string
  // Base URL of the API to get blacklist from
  blacklistApiBaseUrl: string
  // Base URL of the API to get snapshots from
  snapshotsApiBaseUrl: string
  // Base URL of the scoring API
  scoringApiBaseUrl: string
  // The base URL for the location of the overrides json
  overridesApiBaseUrl: string

  // How many epochs in the past to fetch rewards for
  rewardsEpochsCount: number
  // How many epochs in the past to validators uptimes for
  validatorsUptimeEpochsCount: number
  // Threshold of minimal validator uptime to be eligible (e.g. 0.8 for 80%)
  validatorsUptimeThresholdDec: number
  // Validators client version definition to be eligible
  validatorsClientVersionSemverExpr: string
  // Max effective commission of a validator to be eligible
  validatorsMaxEffectiveCommissionDec: number

  // How many historical bids to consider when deciding how much to charge for
  // the BidTooLowPenalty
  bidTooLowPenaltyHistoryEpochs: number

  // Share of Marinade TVL stake controlled by MNDE votes
  mndeDirectedStakeShareDec: number
  // Total Marinade TVL stake cap multiplier factor
  mndeStakeCapMultiplier: number,
  // Cap of Marinade stake share in a single country
  maxMarinadeStakeConcentrationPerCountryDec: number
  // Cap of Marinade stake share with a single ASO
  maxMarinadeStakeConcentrationPerAsoDec: number
  // Cap of global stake share in a single country
  maxNetworkStakeConcentrationPerCountryDec: number
  // Cap of global stake share with a single ASO
  maxNetworkStakeConcentrationPerAsoDec: number
  // Cap of Marinade stake share on a single validator
  maxMarinadeTvlSharePerValidatorDec: number

  // Multiplier to get from reputation to reputation limit; if null no limit is imposed
  spendRobustReputationMult: number | null
  // The reputation decays every epoch by 1 - 1 / spendRobustReputationDecayEpochs
  spendRobustReputationDecayEpochs: number
  // A validator can never get lower reputation than minSpendRobustReputation
  minSpendRobustReputation: number
  // A validator can never get higher reputation than maxSpendRobustReputation
  maxSpendRobustReputation: number
  // Only reputations higher than minScaledSpendRobustReputation are considered
  // for TVL scaling
  minScaledSpendRobustReputation: number
  // Every new vote account that joins the auction gets initialSpendRobustReputation at the start
  initialSpendRobustReputation: number

  // The minimal bond balanace to have to get and retain any stake
  minBondBalanceSol: number

  // Unused at the moment
  spendRobustReputationBondBoostCoef: number

  // The minimal bound for delegated stake a validator can set through maxStakeWanted
  // If null, maxStakeWanted does not limit delegated stake
  minMaxStakeWanted: number | null

  // Validator vote accounts to collect debug info for
  debugVoteAccounts: string[]
}

export const DEFAULT_CONFIG: DsSamConfig = {
  inputsSource: InputsSource.APIS,

  validatorsApiBaseUrl: 'https://validators-api.marinade.finance',
  bondsApiBaseUrl: 'https://validator-bonds-api.marinade.finance',
  tvlInfoApiBaseUrl: 'https://api.marinade.finance',
  blacklistApiBaseUrl: 'https://raw.githubusercontent.com/marinade-finance/delegation-strategy-2/master',
  overridesApiBaseUrl: 'https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/main/epochs',
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
  minMaxStakeWanted: null,

  debugVoteAccounts: [],
}
