import assert from 'assert'
import fs from 'fs'

import { Logger } from '@nestjs/common'
import { Command, CommandRunner, Option } from 'nest-commander'

import {
  AuctionResult,
  AuctionValidator,
  DsSamConfig,
  DsSamSDK,
  effectiveCommissions,
  InputsSource,
  RawBondsResponseDto,
  Rewards,
  SourceDataOverrides,
} from '@marinade.finance/ds-sam-sdk'

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

type PastValidatorCommissionsMap = Map<string, PastValidatorCommissions>

type PastValidatorCommissions = {
  inflation: number
  mev: number | null
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
  beforeSamCommissionIncreasePmpe: number
  maxSamStake: number | null
  samStakeShare: number
  lossPerStake: number
}

export const loadSnapshotValidatorsCollection = (path: string): SnapshotValidatorsCollection =>
  JSON.parse(fs.readFileSync(path).toString()) as SnapshotValidatorsCollection

export const snapshotOnchainCommissions = (validatorMeta: SnapshotValidatorMeta): PastValidatorCommissions => ({
  inflation: validatorMeta.commission / 100,
  // mev_commission is validator_commission_bps from Jito TipDistributionAccount
  mev: validatorMeta.mev_commission != null ? validatorMeta.mev_commission / 10_000 : null,
})

export const getValidatorOverrides = (
  snapshotValidatorsCollection: SnapshotValidatorsCollection,
  bonds: RawBondsResponseDto,
): SourceDataOverrides => {
  const inflationCommissionsDec = new Map<string, number>()
  const mevCommissionsDec = new Map<string, number | undefined>()
  const blockRewardsCommissionsDec = new Map<string, number>()
  const cpmpesDec = new Map<string, number | undefined>()

  const bondsByVoteAccount = new Map(bonds.bonds.map(b => [b.vote_account, b]))

  for (const validatorMeta of snapshotValidatorsCollection.validator_metas) {
    const bond = bondsByVoteAccount.get(validatorMeta.vote_account)

    const onchain = snapshotOnchainCommissions(validatorMeta)
    const inflationBondDec =
      bond?.inflation_commission_bps != null ? Number(bond.inflation_commission_bps) / 10_000 : null
    const mevBondDec = bond?.mev_commission_bps != null ? Number(bond.mev_commission_bps) / 10_000 : null

    const effective = effectiveCommissions(onchain.inflation, inflationBondDec, onchain.mev, mevBondDec)

    inflationCommissionsDec.set(validatorMeta.vote_account, effective.inflationDec)
    mevCommissionsDec.set(validatorMeta.vote_account, effective.mevDec ?? undefined)
  }

  return {
    inflationCommissionsDec,
    mevCommissionsDec,
    blockRewardsCommissionsDec,
    cpmpesDec,
  }
}

@Command({
  name: COMMAND_NAME,
  description: 'Run the commission changes analysis',
})
export class AnalyzeRevenuesCommand extends CommandRunner {
  private readonly logger = new Logger()

  constructor() {
    super()
  }

  async run(inputs: string[], options: AnalyzeRevenuesCommandOptions): Promise<void> {
    try {
      const revenueExpectationCollection = await this.getRevenueExpectationCollection(options)

      const { resultsFilePath } = options
      if (resultsFilePath) {
        this.storeResults(resultsFilePath, revenueExpectationCollection)
      }
    } catch (e: unknown) {
      console.error(e)
      throw e
    }
  }

  async getRevenueExpectationCollection(options: AnalyzeRevenuesCommandOptions): Promise<RevenueExpectationCollection> {
    const parsedConfig: DsSamConfig = JSON.parse(
      fs.readFileSync(`${options.inputsCacheDirPath}/config.json`).toString(),
    ) as DsSamConfig
    const fileConfig: DsSamConfig = {
      ...parsedConfig,
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
        pastSnapshotValidatorsCollection.epoch === snapshotValidatorsCollection.epoch - 1,
        `Epoch loaded from argument data '--snapshot-past-validators-file-path ${options.snapshotValidatorsFilePath}' ` +
          `has to be one less than the current snapshot epoch, but validators epoch is '${snapshotValidatorsCollection.epoch}' ` +
          `and past validators is '${pastSnapshotValidatorsCollection.epoch}'`,
      )
    }

    const bonds: RawBondsResponseDto = JSON.parse(
      fs.readFileSync(`${options.inputsCacheDirPath}/bonds.json`).toString(),
    ) as RawBondsResponseDto
    const sourceDataOverrides = getValidatorOverrides(snapshotValidatorsCollection, bonds)
    const pastValidatorChangeCommissions = this.getPastValidatorCommissions(pastSnapshotValidatorsCollection)

    const dsSam = new DsSamSDK({ ...config })
    const auctionDataCalculatedFromFixtures = await dsSam.run()
    const auctionDataParsedFromFixtures: AuctionResult = JSON.parse(
      fs.readFileSync(options.samResultsFixtureFilePath).toString(),
    ) as AuctionResult
    console.log('Winning Total PMPE parsed from static results:', auctionDataParsedFromFixtures.winningTotalPmpe)
    console.log(
      'Winning Total PMPE calculated from static results:',
      auctionDataCalculatedFromFixtures.winningTotalPmpe,
    )

    const aggregatedData = await dsSam.getAggregatedData(sourceDataOverrides)
    const auctionValidatorsCalculatedWithOverrides = dsSam.transformValidators(aggregatedData)

    const revenueExpectations = this.evaluateRevenueExpectationForAuctionValidators(
      auctionDataCalculatedFromFixtures.auctionData.validators,
      auctionValidatorsCalculatedWithOverrides,
      auctionDataCalculatedFromFixtures, // TODO: difference between auction calculated and parsed data?
      pastValidatorChangeCommissions,
      aggregatedData.rewards,
    )

    return {
      epoch: snapshotValidatorsCollection.epoch,
      slot: snapshotValidatorsCollection.slot,
      revenueExpectations,
    }
  }

  getPastValidatorCommissions = (
    pastValidatorCollection: SnapshotValidatorsCollection | null,
  ): PastValidatorCommissionsMap => {
    const commissionMap: PastValidatorCommissionsMap = new Map()
    if (pastValidatorCollection == null) {
      return commissionMap
    }

    for (const validatorMeta of pastValidatorCollection.validator_metas) {
      commissionMap.set(validatorMeta.vote_account, snapshotOnchainCommissions(validatorMeta))
    }

    return commissionMap
  }

  evaluateRevenueExpectationForAuctionValidators = (
    validatorsBefore: AuctionValidator[],
    validatorsAfter: AuctionValidator[],
    auctionResult: AuctionResult,
    pastValidatorCommissions: PastValidatorCommissionsMap,
    rewards: Rewards,
  ): RevenueExpectation[] => {
    const evaluation: RevenueExpectation[] = []
    for (const validatorBefore of validatorsBefore) {
      const validatorAfter = validatorsAfter.find(v => v.voteAccount === validatorBefore.voteAccount)
      if (!validatorAfter) {
        this.logger.warn('Validator not present in the snapshot!', {
          voteAccount: validatorBefore.voteAccount,
        })
        continue
      }

      // TODO: we are missing the information about blockCommission
      const expectedNonBidPmpe = validatorBefore.revShare.inflationPmpe + validatorBefore.revShare.mevPmpe
      const actualNonBidPmpe = validatorAfter.revShare.inflationPmpe + validatorAfter.revShare.mevPmpe

      // verification of commission increase (rug) at time before SAM was run in this epoch
      // validatorBefore is data when SAM was run, validatorAfter is data after SAM was run
      // this case manages the situation when validator increased commission in time-frame from start of epoch and running the SAM
      // if validator increased commission (in comparison to last epoch) AND his auction bid is under the winning PMPE
      // he requires to top up the difference that is not covered by the bid (the part within winning PMPE range is covered by the bid)
      let beforeSamCommissionIncreasePmpe = 0
      const lastEpochCommissions = pastValidatorCommissions.get(validatorBefore.voteAccount)
      // without the past snapshot data (--snapshot-past-validators-file-path) nothing is charged
      if (lastEpochCommissions != null && auctionResult.winningTotalPmpe > validatorBefore.revShare.totalPmpe) {
        const samInflationPmpe = validatorBefore.revShare.inflationPmpe
        const samMevPmpe = validatorBefore.revShare.mevPmpe
        const lastEpochInflationPmpe = rewards.inflationPmpe * (1.0 - lastEpochCommissions.inflation)
        const lastEpochMevPmpe =
          lastEpochCommissions.mev == null ? null : rewards.mevPmpe * (1.0 - lastEpochCommissions.mev)
        // combined delta: downstream charges combined non-bid PMPE, so a decrease in one commission offsets an increase in the other
        const lastEpochMevBasePmpe = lastEpochMevPmpe ?? samMevPmpe
        beforeSamCommissionIncreasePmpe = Math.max(
          0,
          lastEpochInflationPmpe + lastEpochMevBasePmpe - (samInflationPmpe + samMevPmpe),
        )
        if (beforeSamCommissionIncreasePmpe > 0) {
          this.logger.debug('Validator increased commission before SAM run and has not won auction', {
            voteAccount: validatorBefore.voteAccount,
            inflationCommissionLastEpoch: lastEpochCommissions.inflation,
            mevCommissionLastEpoch: lastEpochCommissions.mev,
            lastEpochInflationPmpe,
            lastEpochMevPmpe,
            samInflationPmpe,
            samMevPmpe,
            beforeSamCommissionIncreasePmpe,
            winningPmpe: auctionResult.winningTotalPmpe,
            validatorTotalPmpe: validatorBefore.revShare.totalPmpe,
          })
        }
      }

      evaluation.push({
        voteAccount: validatorBefore.voteAccount,
        expectedInflationCommission: validatorBefore.inflationCommissionDec,
        actualInflationCommission: validatorAfter.inflationCommissionDec,
        // 0 may also mean missing past snapshot data; beforeSamCommissionIncreasePmpe is 0 in that case too
        pastInflationCommission: lastEpochCommissions?.inflation ?? 0,
        expectedMevCommission: validatorBefore.mevCommissionDec,
        actualMevCommission: validatorAfter.mevCommissionDec,
        pastMevCommission: lastEpochCommissions?.mev ?? null,
        expectedNonBidPmpe,
        actualNonBidPmpe,
        expectedSamPmpe: expectedNonBidPmpe + validatorBefore.revShare.auctionEffectiveBidPmpe,
        beforeSamCommissionIncreasePmpe,
        maxSamStake: validatorBefore.maxStakeWanted,
        samStakeShare: 1,
        lossPerStake: Math.max(0, expectedNonBidPmpe - actualNonBidPmpe) / 1000,
      })
    }

    return evaluation
  }

  storeResults(path: string, revenueExpectationCollection: RevenueExpectationCollection) {
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
    description:
      'Validators.json parsed from Solana snapshot from the previous epoch to --snapshot-validators-file-path',
  })
  parseOptSnapshotPastValidatorsFilePath(val: string) {
    return val
  }
}
