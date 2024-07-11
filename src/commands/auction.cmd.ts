import { CliUtilityService, Command, CommandRunner, Option } from 'nest-commander'
import { Logger } from '@nestjs/common'
import { AuctionResult, DsSamConfig, DsSamSDK, InputsSource } from '@marinade.finance/ds-sam-sdk'
import { formatLastCapConstraint } from '../../packages/ds-sam-sdk/src/utils'
import fs from 'fs'

const COMMAND_NAME = 'auction'

type AuctionCommandOptions = Partial<DsSamConfig & {
  configFilePath: string
  outputDirPath: string
}>

@Command({
  name: COMMAND_NAME,
  description: 'Run the auction (see README for SDK config details)',
})
export class AuctionCommand extends CommandRunner {
  private readonly logger = new Logger()

  constructor (private readonly nestCliUtilSvc: CliUtilityService) {
    super()
  }

  async run (inputs: string[], options: AuctionCommandOptions): Promise<void> {
    const fileConfig: AuctionCommandOptions = options.configFilePath ? JSON.parse(fs.readFileSync(options.configFilePath).toString()) : {}
    const config: AuctionCommandOptions = { ...fileConfig, ...options }

    this.logger.log(`Running "${COMMAND_NAME}" command...`, { ...config })
    const dsSam = new DsSamSDK({ ...config })
    const result = await dsSam.run()
    this.logger.log(`Finished "${COMMAND_NAME}" command`, { ...config })

    for (const validator of result.auctionData.validators) {
      console.log(`${validator.voteAccount}  \t${validator.auctionStake.marinadeMndeTargetSol}\t${validator.auctionStake.marinadeSamTargetSol}\t${validator.revShare.totalPmpe}\t${formatLastCapConstraint(validator.lastCapConstraint)}`)
    }

    if (config.outputDirPath) {
      this.storeResults(result, `${config.outputDirPath}/results.json`, `${config.outputDirPath}/summary.md`)
    }
  }

  storeResults (result: AuctionResult, resultsPath: string, summaryPath: string) {
    const resultsStr = JSON.stringify({
      ...result,
      auctionData: {
        ...result.auctionData,
        blacklist: Array.from(result.auctionData.blacklist),
        validators: result.auctionData.validators.map(({ lastCapConstraint, epochStats: _, ...validator }) =>
          ({ ...validator, lastCapConstraint: lastCapConstraint && { ...lastCapConstraint, validators: lastCapConstraint.validators.length }}))
      }
    }, null, 2)

    fs.writeFileSync(resultsPath, resultsStr)
    fs.writeFileSync(summaryPath, this.formatResultSummary(result))
  }

  formatResultSummary (result: AuctionResult): string {
    const { validators, stakeAmounts: { networkTotalSol, marinadeMndeTvlSol, marinadeSamTvlSol }} = result.auctionData
    const stakedValidators = validators.filter(({ auctionStake: { marinadeMndeTargetSol, marinadeSamTargetSol } }) => marinadeMndeTargetSol + marinadeSamTargetSol > 0).length
    return [
      `## Auction summary`,
      `\n### Stake amounts`,
      `- Total network stake = \`${networkTotalSol.toLocaleString()}\` SOL`,
      `- Total Marinade stake = \`${(marinadeMndeTvlSol + marinadeSamTvlSol).toLocaleString()}\` SOL`,
      `  - MNDE stake = \`${marinadeMndeTvlSol.toLocaleString()}\` SOL`,
      `  - SAM stake = \`${marinadeSamTvlSol.toLocaleString()}\` SOL`,
      `\n### Results stats`,
      `- Auction winning rev share = \`${result.winningTotalPmpe}\` PMPE`,
      `- Staked validators count = \`${stakedValidators.toLocaleString()}\``,
      ``,
    ].join('\n')
  }

  @Option({
    flags: '-c, --config-file-path <string>',
    name: 'configFilePath',
    description: 'File to read base config from (overridden by other options)',
  })
  parseOptConfigFilePath(val: string) {
    return val
  }
  @Option({
    flags: '-o, --output-dir-path <string>',
    name: 'outputDirPath',
    description: 'File to write the results into',
  })
  parseOptOutputFilePath(val: string) {
    return val
  }

  @Option({
    flags: '-i, --inputs-source <string>',
    name: 'inputsSource',
    description: 'SDK param `inputsSource`',
    choices: Object.values(InputsSource),
  })
  parseOptInputsSource(val: string) {
    return val
  }
  @Option({
    flags: '--cache-dir-path <string>',
    name: 'inputsCacheDirPath',
    description: 'SDK param `inputsCacheDirPath`',
  })
  parseOptInputsCacheDirPath(val: string) {
    return val
  }
  @Option({
    flags: '--cache-inputs',
    name: 'cacheInputs',
    description: 'SDK param `cacheInputs`',
  })
  parseOptCacheInputs() {
    return true
  }

  @Option({
    flags: '--validators-url <string>',
    name: 'validatorsApiBaseUrl',
    description: 'SDK param `validatorsApiBaseUrl`',
  })
  parseOptValidatorsApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--mev-url <string>',
    name: 'mevInfoApiBaseUrl',
    description: 'SDK param `mevInfoApiBaseUrl`',
  })
  parseOptMevInfoApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--bonds-url <string>',
    name: 'bondsApiBaseUrl',
    description: 'SDK param `bondsApiBaseUrl`',
  })
  parseOptBondsApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--tvl-url <string>',
    name: 'tvlInfoApiBaseUrl',
    description: 'SDK param `tvlInfoApiBaseUrl`',
  })
  parseOptTvlInfoApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--blacklist-url <string>',
    name: 'blacklistApiBaseUrl',
    description: 'SDK param `blacklistApiBaseUrl`',
  })
  parseOptBlacklistApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--snapshots-url <string>',
    name: 'snapshotsApiBaseUrl',
    description: 'SDK param `snapshotsApiBaseUrl`',
  })
  parseOptSnapshotsApiBaseUrl(val: string) {
    return val
  }

  @Option({
    flags: '--rewards-epochs <number>',
    name: 'rewardsEpochsCount',
    description: 'SDK param `rewardsEpochsCount`',
  })
  parseOptRewardsEpochsCount(val: string) {
    return this.nestCliUtilSvc.parseInt(val)
  }
  @Option({
    flags: '--uptime-epochs <number>',
    name: 'validatorsUptimeEpochsCount',
    description: 'SDK param `validatorsUptimeEpochsCount`',
  })
  parseOptValidatorsUptimeEpochsCount(val: string) {
    return this.nestCliUtilSvc.parseInt(val)
  }
  @Option({
    flags: '--uptime-threshold <number>',
    name: 'validatorsUptimeThreshold',
    description: 'SDK param `validatorsUptimeThreshold`',
  })
  parseOptValidatorsUptimeThreshold(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--client-version-expr <string>',
    name: 'validatorsClientVersionSemverExpr',
    description: 'SDK param `validatorsClientVersionSemverExpr`',
  })
  parseOptValidatorsClientVersionSemverExpr(val: string) {
    return val
  }
  @Option({
    flags: '--max-effective-commission <number>',
    name: 'validatorsMaxEffectiveCommissionDec',
    description: 'SDK param `validatorsMaxEffectiveCommissionDec`',
  })
  parseOptValidatorsMaxEffectiveCommissionDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }

  @Option({
    flags: '--mnde-tvl-share <number>',
    name: 'mndeDirectedStakeShareDec',
    description: 'SDK param `mndeDirectedStakeShareDec`',
  })
  parseOptMndeDirectedStakeShareDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--marinade-country-cap <number>',
    name: 'maxMarinadeStakeConcentrationPerCountryDec',
    description: 'SDK param `maxMarinadeStakeConcentrationPerCountryDec`',
  })
  parseOptMaxMarinadeStakeConcentrationPerCountryDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--marinade-aso-cap <number>',
    name: 'maxMarinadeStakeConcentrationPerAsoDec',
    description: 'SDK param `maxMarinadeStakeConcentrationPerAsoDec`',
  })
  parseOptMaxMarinadeStakeConcentrationPerAsoDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--global-country-cap <number>',
    name: 'maxNetworkStakeConcentrationPerCountryDec',
    description: 'SDK param `maxNetworkStakeConcentrationPerCountryDec`',
  })
  parseOptMaxNetworkStakeConcentrationPerCountryDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--global-aso-cap <number>',
    name: 'maxNetworkStakeConcentrationPerAsoDec',
    description: 'SDK param `maxNetworkStakeConcentrationPerAsoDec`',
  })
  parseOptMaxNetworkStakeConcentrationPerAsoDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--marinade-validator-cap <number>',
    name: 'maxMarinadeTvlSharePerValidatorDec',
    description: 'SDK param `maxMarinadeTvlSharePerValidatorDec`',
  })
  parseOptMaxMarinadeTvlSharePerValidatorDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }

  @Option({
    flags: '--debug-vote-accounts <string...>',
    name: 'debugVoteAccounts',
    description: 'SDK param `debugVoteAccounts` (space separated)',
  })
  parseOptDebugVoteAccounts(option: string, optionsAccumulator: string[] = []): string[] {
    optionsAccumulator.push(option)
    return optionsAccumulator
  }
}
