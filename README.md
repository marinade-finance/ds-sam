# ds-sam

## Running the CLI
Get info about available CLI options
```bash
pnpm run cli -- auction --help
```

Evaluate the auction
```bash
pnpm run cli -- auction [--options...]
```

## CLI config
Configured using CLI options or a config file passed in via the `-c` (`--config-file-path`) option

The CLI options take precedence over the config file values

## SDK config
Config [defaults](./packages/ds-sam-sdk/src/config.ts#L35)

```typescript
{
  // Fetch source data from APIs or from local files
  inputsSource: 'APIS' | 'FILES'
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

  // Validator vote accounts to collect debug info for
  debugVoteAccounts: string[]
}
```

## Development

To build

```sh
pnpm -r build
```

To run tests

```sh
pnpm test

# single test file
FILE='testfile.test.ts' pnpm test
```
