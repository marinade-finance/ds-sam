import { CliUtilityService, Command, CommandRunner, Option } from 'nest-commander'
import { Logger } from '@nestjs/common'
import { AuctionResult, AuctionValidator, DsSamSDK, InputsSource, SourceDataOverrides } from '@marinade.finance/ds-sam-sdk'
import fs from 'fs'

const COMMAND_NAME = 'analyze-revenues'

type AnalyzeRevenuesCommandOptions = {
  inputsCacheDirPath: string
  resultsFixtureFilePath: string
  snapshotValidatorsFilePath: string
  resultsFilePath?: string
}

export type SnapshotValidatorMeta = {
  vote_account: string
  commission: number
  mev_commission?: number
  stake: number
  credits: number
}

export type SnapshotValidatorsCollection = {
    epoch: number
    slot: number
    capitalization: number
    epoch_duration_in_years: number
    validator_rate: number
    validator_rewards: number
    validator_metas: SnapshotValidatorMeta[]
}

export type RevenueExpectation = {
  voteAccount: string
  expectedInflationCommission: number
  actualInflationCommission: number
  expectedMevCommission: number | null
  actualMevCommission: number | null
  expectedNonBidPmpe: number
  actualNonBidPmpe: number
  expectedSamPmpe: number
  maxSamStake: number | null
  samStakeShare: number
  lossPerStake: number
}

export const loadSnapshotValidatorsCollection = (path: string) => JSON.parse(fs.readFileSync(path).toString())

export const getValidatorOverrides = (snapshotValidatorsCollection: SnapshotValidatorsCollection): SourceDataOverrides => {
  const inflationCommissions = new Map()
  const mevCommissions = new Map()

  for (const validatorMeta of snapshotValidatorsCollection.validator_metas) {
    inflationCommissions.set(validatorMeta.vote_account, validatorMeta.commission)
    mevCommissions.set(validatorMeta.vote_account, validatorMeta.mev_commission)
  }

  return {
    inflationCommissions,
    mevCommissions,
  }
}

@Command({
  name: COMMAND_NAME,
  description: 'Run the commission changes analysis',
})
export class AnalyzeRevenuesCommand extends CommandRunner {
  private readonly logger = new Logger()

  constructor () {
    super()
  }

  async run (inputs: string[], options: AnalyzeRevenuesCommandOptions): Promise<void> {
    const revenueExpectations = await this.getRevenueExpectations(options)

    const { resultsFilePath } = options
    if (resultsFilePath) {
      this.storeResults(resultsFilePath, revenueExpectations)
    }
  }

  async getRevenueExpectations (options: AnalyzeRevenuesCommandOptions): Promise<RevenueExpectation[]> {
    const fileConfig: AnalyzeRevenuesCommandOptions = {
      ...JSON.parse(fs.readFileSync(`${options.inputsCacheDirPath}/config.json`).toString()),
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: options.inputsCacheDirPath,
    }
    
    const config: AnalyzeRevenuesCommandOptions = { ...fileConfig, ...options }
    this.logger.log(`Running "${COMMAND_NAME}" command...`, { ...config })

    const snapshotValidatorsCollection = loadSnapshotValidatorsCollection(options.snapshotValidatorsFilePath)
    const sourceDataOverrides = getValidatorOverrides(snapshotValidatorsCollection)

    const dsSam = new DsSamSDK({ ...config })
    const auctionDataCalculatedFromFixtures = await dsSam.run()
    const auctionDataParsedFromFixtures: AuctionResult = JSON.parse(fs.readFileSync(options.resultsFixtureFilePath).toString())
    console.log('Winning Total PMPE parsed from static results:', auctionDataParsedFromFixtures.winningTotalPmpe)
    console.log('Winning Total PMPE calculated from static results:', auctionDataCalculatedFromFixtures.winningTotalPmpe)

    const auctionValidatorsCalculatedWithOverrides = dsSam.transformValidators(await dsSam.getAggregatedData(sourceDataOverrides))
    
    return this.evaluateRevenueExpectationForAuctionValidators(auctionDataCalculatedFromFixtures.auctionData.validators, auctionValidatorsCalculatedWithOverrides)
  }

  evaluateRevenueExpectationForAuctionValidators = (validatorsBefore: AuctionValidator[], validatorsAfter: AuctionValidator[]): RevenueExpectation[] => {
    const evaluation = []
    for (const validatorBefore of validatorsBefore) {
      const validatorAfter = validatorsAfter.find((v) => v.voteAccount === validatorBefore.voteAccount)
      if (!validatorAfter) {
        this.logger.warn("Validator not present in the snapshot!", { voteAccount: validatorBefore.voteAccount })
        continue
      }

      const expectedNonBidPmpe = validatorBefore.revShare.inflationPmpe + validatorBefore.revShare.mevPmpe
      const actualNonBidPmpe = validatorAfter.revShare.inflationPmpe + validatorAfter.revShare.mevPmpe

      evaluation.push({
        voteAccount: validatorBefore.voteAccount,
        expectedInflationCommission: validatorBefore.inflationCommissionDec,
        actualInflationCommission: validatorAfter.inflationCommissionDec,
        expectedMevCommission: validatorBefore.mevCommissionDec,
        actualMevCommission: validatorAfter.mevCommissionDec,
        expectedNonBidPmpe,
        actualNonBidPmpe,
        expectedSamPmpe: expectedNonBidPmpe + (validatorBefore.revShare.auctionEffectiveBidPmpe ?? 0),
        maxSamStake: validatorBefore.maxStakeWanted,
        samStakeShare: validatorBefore.auctionStake.marinadeMndeTargetSol === 0 ? 1 : validatorBefore.auctionStake.marinadeSamTargetSol / (validatorBefore.auctionStake.marinadeMndeTargetSol + validatorBefore.auctionStake.marinadeSamTargetSol),
        lossPerStake: Math.max(0, expectedNonBidPmpe - actualNonBidPmpe) / 1000,
      })
    }

    return evaluation
  }

  storeResults (path: string, revenueExpectations: RevenueExpectation[]) {
    const revenueExpectationsStr = JSON.stringify(revenueExpectations, null, 2)
    fs.writeFileSync(path, revenueExpectationsStr)
  }

  @Option({
    flags: '--cache-dir-path <string>',
    name: 'inputsCacheDirPath',
    required: true,
    description: 'SDK param `inputsCacheDirPath`',
  })
  parseOptInputsCacheDirPath(val: string) {
    return val
  }
  @Option({
    flags: '--results-fixture-file-path <string>',
    name: 'resultsFixtureFilePath',
    required: true,
    description: 'Output JSON from SAM run to check data integrity',
  })
  parseOptResultsFixtureFilePath(val: string) {
    return val
  }
  @Option({
    flags: '--results-file-path <string>',
    name: 'resultsFilePath',
    description: 'Output JSON with a result to this file',
  })
  parseOptResultsFilePath(val: string) {
    return val
  }
  @Option({
    flags: '--snapshot-validators-file-path <string>',
    name: 'snapshotValidatorsFilePath',
    required: true,
    description: 'Validators.json parsed from Solana snapshot',
  })
  parseOptSnapshotValidatorsFilePath(val: string) {
    return val
  }
}