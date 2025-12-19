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

  // Use zero-commission validators for backstop
  enableZeroCommissionBackstop: boolean

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
  // How much unprotected stake do we put on a validator w.r.t the foundation delegated stake
  // Note: In the docs, the term "stake matching" is used instead of "unprotected stake"
  unprotectedFoundationStakeDec: number
  // How much unprotected stake do we put on a validator w.r.t the other 3-rd party delegated stake
  unprotectedDelegatedStakeDec: number
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
  // Max share of unprotected stake on 3-rd party stake of a validator
  maxUnprotectedStakePerValidatorDec: number
  // The minimum amount of unprotected stake we are willing to delegate to a validator
  minUnprotectedStakeToDelegateSol: number

  // Multiplier to get from reputation to reputation limit; if null no limit is imposed
  spendRobustReputationMult: number | null
  // The reputation decays every epoch by 1 - 1 / spendRobustReputationDecayEpochs
  spendRobustReputationDecayEpochs: number
  // A validator can never get lower reputation than minSpendRobustReputation
  minSpendRobustReputation: number
  // A validator can never get higher reputation than maxSpendRobustReputation
  maxSpendRobustReputation: number
  // We start scaling with reputations higher than initialScaledSpendRobustReputation
  initialScaledSpendRobustReputation: number
  // Only reputations higher than minScaledSpendRobustReputation are considered
  // for TVL scaling
  minScaledSpendRobustReputation: number
  // Every new vote account that joins the auction gets initialSpendRobustReputation at the start
  initialSpendRobustReputation: number

  // The minimal bond balanace to have to get and retain any stake
  minBondBalanceSol: number

  // Unused at the moment
  spendRobustReputationBondBoostCoef: number

  // The minimum number of epochs payments for which the bond has to cover on top
  // of the downtime and rugging risk
  minBondEpochs: number

  // The ideal number of epochs payments for which the bond has to cover on top
  // of the downtime and rugging risk
  idealBondEpochs: number

  // The multiplier used in the bondRiskFeeSol formula
  // If set to zero, bondRiskFeeSol is effectivelly disabled
  bondRiskFeeMult: number

  // The amount of bond-to-be withdrawn still counted as available
  // for the purposes of bondRiskFeeSol
  // If set to one, exitFee is not charged
  pendingWithdrawalBondMult: number

  // The minimal bound for delegated stake a validator can set through maxStakeWanted
  // If null, maxStakeWanted does not limit delegated stake
  minMaxStakeWanted: number | null

  // If null, expectedMaxWinningBidRatio will not have any effect
  expectedMaxWinningBidRatio: number | null

  // The lower bound for the expectedMaxBidPmpe used for bond requirements calculation
  minExpectedEffBidPmpe: number

  // The estimated transaction fee Pmpe
  expectedFeePmpe: number

  // The minimal eligible transaction fee Pmpe
  // If null, minimal eligible transaction fee Pmpe is not enforced as if it was -inf
  minEligibleFeePmpe: number | null

  // Minimum commission a validator can set (probably in bond configuration)
  // Prevents validators from setting overly negative commissions
  minimalCommission: number | null

  // Multiplier for bond balance requirements when calculating stake caps constraints.
  // We assume some bond balance for the stake is required and multiply the calculated bond requirement
  // by this factor must be in interval [1.0, 2.0].
  bondObligationSafetyMult: number

  // Permitted deviation in bid Pmpe below the winning bid Pmpe
  // This deviation will not be penalized when calculating the BidTooLowPenalty meaning validator
  // may slightly underbid the winning bid without being penalized. Permitted interval is [0, 1.0].
  bidTooLowPenaltyPermittedDeviationPmpe: number

  // Validator vote accounts to collect debug info for
  debugVoteAccounts: string[]
}

// NOTE: It’s not a good idea to make changes here because the tests rely on DEFAULT_CONFIG.
export const DEFAULT_CONFIG: DsSamConfig = {
  inputsSource: InputsSource.APIS,

  validatorsApiBaseUrl: 'https://validators-api.marinade.finance',
  bondsApiBaseUrl: 'https://validator-bonds-api.marinade.finance',
  tvlInfoApiBaseUrl: 'https://api.marinade.finance',
  // marinade proxy cache API, pointing to raw gh: 'https://raw.githubusercontent.com/marinade-finance/delegation-strategy-2/master'
  blacklistApiBaseUrl: 'https://thru.marinade.finance/marinade-finance/delegation-strategy-2/master',
  // marinade proxy cache API, pointing to 'https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/main/epochs'
  overridesApiBaseUrl: 'https://thru.marinade.finance/marinade-finance/ds-sam-pipeline/main/epochs',
  snapshotsApiBaseUrl: 'https://snapshots-api.marinade.finance',
  scoringApiBaseUrl:  'https://scoring.marinade.finance',

  enableZeroCommissionBackstop: false,
  rewardsEpochsCount: 10,
  validatorsUptimeEpochsCount: 3,
  validatorsUptimeThresholdDec: 0.8,
  validatorsClientVersionSemverExpr: '>=1.18.15 || >=0.101.20013 <1.0.0',
  validatorsMaxEffectiveCommissionDec: 0.07,
  unprotectedDelegatedStakeDec: 0,
  unprotectedFoundationStakeDec: 0,
  minUnprotectedStakeToDelegateSol: 0,
  bidTooLowPenaltyHistoryEpochs: 3,

  mndeDirectedStakeShareDec: 0,
  mndeStakeCapMultiplier: 0.1,
  maxMarinadeStakeConcentrationPerCountryDec: 1,
  maxMarinadeStakeConcentrationPerAsoDec: 1,
  maxNetworkStakeConcentrationPerCountryDec: 0.3,
  maxNetworkStakeConcentrationPerAsoDec: 0.3,
  maxMarinadeTvlSharePerValidatorDec: 0.04,
  maxUnprotectedStakePerValidatorDec: 0,
  spendRobustReputationMult: null,
  spendRobustReputationDecayEpochs: 50,
  minSpendRobustReputation: -20,
  initialScaledSpendRobustReputation: 100,
  minScaledSpendRobustReputation: 5,
  maxSpendRobustReputation: 1000,
  initialSpendRobustReputation: 1,
  minBondBalanceSol: 0,
  spendRobustReputationBondBoostCoef: 0,
  minBondEpochs: 1,
  idealBondEpochs: 1,
  bondRiskFeeMult: 0,
  pendingWithdrawalBondMult: 1,
  minMaxStakeWanted: null,
  expectedFeePmpe: 0,
  expectedMaxWinningBidRatio: null,
  minExpectedEffBidPmpe: 0,
  minEligibleFeePmpe: null,
  bondObligationSafetyMult: 1,
  bidTooLowPenaltyPermittedDeviationPmpe: 0.05,
  minimalCommission: -2.0,

  debugVoteAccounts: [],
}

