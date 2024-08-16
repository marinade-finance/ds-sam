import { Command, CommandRunner, Option } from 'nest-commander'
import { Logger } from '@nestjs/common'
import { AuctionResult, AuctionValidator, DsSamSDK, InputsSource, Rewards, SourceDataOverrides } from '@marinade.finance/ds-sam-sdk'
import fs from 'fs'
import assert from 'assert'

const COMMAND_NAME = 'analyze-revenues'

type AnalyzeRevenuesCommandOptions = {
  inputsCacheDirPath: string
  samResultsFixtureFilePath: string
  snapshotValidatorsFilePath: string
  snapshotPastValidatorsFilePath?: string
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

type ChangeCommissionsMap = Map<string, ChangeCommission>

type ChangeCommission = {
  inflationBefore: number,
  inflationAfter: number,
  mevBefore: number | null,
  mevAfter: number | null,
}

const DEFAULT_CHANGE_COMMISSION: ChangeCommission = {
  inflationBefore: 0,
  inflationAfter: 0,
  mevBefore: 0,
  mevAfter: 0,
}

export type RevenueExpectationCollection = {
  epoch: number
  slot: number
  revenueExpectations: RevenueExpectation[]
}

export type RevenueExpectation = {
  voteAccount: string
  expectedInflationCommission: number
  actualInflationCommission: number
  pastInflationCommission: number
  expectedMevCommission: number | null
  actualMevCommission: number | null
  pastMevCommission: number | null
  expectedNonBidPmpe: number
  actualNonBidPmpe: number
  expectedSamPmpe: number
  nonBidCommissionIncreasePmpe: number
  maxSamStake: number | null
  samStakeShare: number
  lossPerStake: number
}

export const loadSnapshotValidatorsCollection = (path: string): SnapshotValidatorsCollection => JSON.parse(fs.readFileSync(path).toString())

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
    const revenueExpectationCollection = await this.getRevenueExpectationCollection(options)

    const { resultsFilePath } = options
    if (resultsFilePath) {
      this.storeResults(resultsFilePath, revenueExpectationCollection)
    }
  }

  async getRevenueExpectationCollection (options: AnalyzeRevenuesCommandOptions): Promise<RevenueExpectationCollection> {
    const fileConfig: AnalyzeRevenuesCommandOptions = {
      ...JSON.parse(fs.readFileSync(`${options.inputsCacheDirPath}/config.json`).toString()),
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: options.inputsCacheDirPath,
    }
    
    const config: AnalyzeRevenuesCommandOptions = { ...fileConfig, ...options }
    this.logger.log(`Running "${COMMAND_NAME}" command...`, { ...config })

    const snapshotValidatorsCollection = loadSnapshotValidatorsCollection(options.snapshotValidatorsFilePath)

    let pastSnapshotValidatorsCollection: null | SnapshotValidatorsCollection = null
    if (options.snapshotPastValidatorsFilePath) {
      pastSnapshotValidatorsCollection = loadSnapshotValidatorsCollection(options.snapshotPastValidatorsFilePath)
      assert(
        pastSnapshotValidatorsCollection.epoch === snapshotValidatorsCollection.epoch -1,
        "Epoch loaded from argument data '--snapshot-past-validators-file-path' has to be one less than the current snapshot epoch, " +
        `but validators epoch is ${snapshotValidatorsCollection.epoch} and past validators is ${pastSnapshotValidatorsCollection.epoch}`
      )
    }

    const sourceDataOverrides = getValidatorOverrides(snapshotValidatorsCollection)
    const increaseCommissionsMap = this.getChangeCommissionsMap(
      snapshotValidatorsCollection, pastSnapshotValidatorsCollection
    )

    const dsSam = new DsSamSDK({ ...config })
    const auctionDataCalculatedFromFixtures = await dsSam.run()
    const auctionDataParsedFromFixtures: AuctionResult = JSON.parse(
      fs.readFileSync(options.samResultsFixtureFilePath).toString()
    )
    console.log('Winning Total PMPE parsed from static results:', auctionDataParsedFromFixtures.winningTotalPmpe)
    console.log('Winning Total PMPE calculated from static results:', auctionDataCalculatedFromFixtures.winningTotalPmpe)

    const aggregatedData = await dsSam.getAggregatedData(sourceDataOverrides)
    const auctionValidatorsCalculatedWithOverrides = dsSam.transformValidators(
      aggregatedData
    )
    
    const revenueExpectations = this.evaluateRevenueExpectationForAuctionValidators(
      auctionDataCalculatedFromFixtures.auctionData.validators,
      auctionValidatorsCalculatedWithOverrides,
      auctionDataCalculatedFromFixtures, // TODO: difference between auction calculated and parsed data?
      increaseCommissionsMap,
      aggregatedData.rewards
    )

    return {
      epoch: snapshotValidatorsCollection.epoch,
      slot: snapshotValidatorsCollection.slot,
      revenueExpectations,
    }
  }

  getChangeCommissionsMap = (
      validatorCollection: SnapshotValidatorsCollection,
      pastValidatorCollection: SnapshotValidatorsCollection | null
  ): ChangeCommissionsMap => {
    const changeMap: ChangeCommissionsMap = new Map()

    for (const validatorMeta of validatorCollection.validator_metas) {
      const vote_account = validatorMeta.vote_account
      const pastValidatorMeta = pastValidatorCollection?.validator_metas.find(
        v => v.vote_account === vote_account
      )
      const inflationAfter = validatorMeta.commission / 100
      const inflationBefore = (pastValidatorMeta?.commission ?? validatorMeta.commission) / 100
      const mevAfter = validatorMeta.mev_commission || null
      const mevBefore = pastValidatorMeta ? (pastValidatorMeta.mev_commission ? (pastValidatorMeta.mev_commission / 100) : null) : null
      changeMap.set(vote_account, {
        inflationBefore,
        inflationAfter,
        mevBefore,
        mevAfter,
      })
    }

    return changeMap
  }

  evaluateRevenueExpectationForAuctionValidators = (
    validatorsBefore: AuctionValidator[],
    validatorsAfter: AuctionValidator[],
    auctionResult: AuctionResult,
    changeCommissionsMap: ChangeCommissionsMap,
    rewards: Rewards
  ): RevenueExpectation[] => {
    const evaluation: RevenueExpectation[] = []
    for (const validatorBefore of validatorsBefore) {
      const validatorAfter = validatorsAfter.find((v) => v.voteAccount === validatorBefore.voteAccount)
      if (!validatorAfter) {
        this.logger.warn("Validator not present in the snapshot!", { voteAccount: validatorBefore.voteAccount })
        continue
      }

      // TODO: temporary fix for wrong value of MEV commission when there is no MEV data for epoch, skipping MEV for now
      // const expectedNonBidPmpe = validatorBefore.revShare.inflationPmpe + validatorBefore.revShare.mevPmpe
      // const actualNonBidPmpe = validatorAfter.revShare.inflationPmpe + validatorAfter.revShare.mevPmpe
      const expectedNonBidPmpe = validatorBefore.revShare.inflationPmpe
      const actualNonBidPmpe = validatorAfter.revShare.inflationPmpe

      const marinadeMndeTargetSol = validatorBefore.auctionStake.marinadeMndeTargetSol
      const marinadeSamTargetSol = validatorBefore.auctionStake.marinadeSamTargetSol

      // verification of commission increase (rug)
      // if validator increased commission (in comparison to last epoch) AND his auction bid is under the winning PMPE
      // he requires to top up the difference that is not covered by the bid (the part within winning PMPE range is covered by the bid)
      let nonBidCommissionIncreasePmpe = 0
      const changeCommission = changeCommissionsMap.get(validatorBefore.voteAccount) ?? DEFAULT_CHANGE_COMMISSION
      if (
        changeCommission.inflationAfter > changeCommission.inflationBefore &&
        auctionResult.winningTotalPmpe > validatorAfter.revShare.totalPmpe
      ) {
        const actualInflationPmpe = validatorAfter.revShare.inflationPmpe
        const expectedInflationPmpe = rewards.inflationPmpe * (1.0 - changeCommission.inflationBefore) 
        assert(
          expectedInflationPmpe > actualInflationPmpe,
          validatorAfter.voteAccount + ': expected inflation has to be greater to actual'
        )
        nonBidCommissionIncreasePmpe = Math.max(0, expectedInflationPmpe - actualInflationPmpe)
        this.logger.debug('Validator increased commission and has not won auction', {
          voteAccount: validatorBefore.voteAccount,
          pastInflationCommission: changeCommission.inflationBefore,
          inflationPmpeBefore: expectedInflationPmpe,
          inflationPmpeAfter: actualInflationPmpe,
          nonBidCommissionIncreasePmpe,
          winningPmpe: auctionResult.winningTotalPmpe,
          validatorTotalPmpe: validatorAfter.revShare.totalPmpe,
        })
      }


      evaluation.push({
        voteAccount: validatorBefore.voteAccount,
        expectedInflationCommission: validatorBefore.inflationCommissionDec,
        actualInflationCommission: validatorAfter.inflationCommissionDec,
        pastInflationCommission: changeCommission.inflationBefore,
        expectedMevCommission: validatorBefore.mevCommissionDec,
        actualMevCommission: validatorAfter.mevCommissionDec,
        pastMevCommission: changeCommission.mevBefore,
        expectedNonBidPmpe,
        actualNonBidPmpe,
        expectedSamPmpe: expectedNonBidPmpe + validatorBefore.revShare.auctionEffectiveBidPmpe,
        nonBidCommissionIncreasePmpe,
        maxSamStake: validatorBefore.maxStakeWanted,
        samStakeShare: marinadeMndeTargetSol === 0 ? 1 : marinadeSamTargetSol / (marinadeMndeTargetSol + marinadeSamTargetSol),
        lossPerStake: Math.max(0, expectedNonBidPmpe - actualNonBidPmpe) / 1000,
      })
    }

    return evaluation
  }

  storeResults (path: string, revenueExpectationCollection: RevenueExpectationCollection) {
    const revenueExpectationsStr = JSON.stringify(revenueExpectationCollection, null, 2)
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
    flags: '--sam-results-fixture-file-path <string>',
    name: 'samResultsFixtureFilePath',
    required: true,
    description: 'Output JSON from SAM run to check data integrity',
  })
  parseOptSamResultsFixtureFilePath(val: string) {
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
  @Option({
    flags: '--snapshot-past-validators-file-path <string>',
    name: 'snapshotPastValidatorsFilePath',
    required: false,
    description: 'Validators.json parsed from Solana snapshot from the previous epoch to --snapshot-validators-file-path',
  })
  parseOptSnapshotPastValidatorsFilePath(val: string) {
    return val
  }
}
