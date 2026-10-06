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
  evaluateRevenueExpectations,
  InputsSource,
  PastValidatorCommissions,
  RawBondsResponseDto,
  RevenueExpectation,
  Rewards,
  SourceDataOverrides,
} from '@marinade.finance/ds-sam-sdk'

export type { RevenueExpectation }

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
  // Live u8 percent at the snapshot slot; a change inside the anti-rug window is not what agave applied
  commission: number
  // Read from epoch_stakes(E), the rate agave applied to the snapshot epoch; absent in older snapshots
  inflation_rewards_commission_bps?: number | null
  mev_commission?: number
  stake: number
  credits: number | null
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

export type RevenueExpectationCollection = {
  epoch: number
  slot: number
  revenueExpectations: RevenueExpectation[]
}

export const loadSnapshotValidatorsCollection = (path: string): SnapshotValidatorsCollection =>
  JSON.parse(fs.readFileSync(path).toString()) as SnapshotValidatorsCollection

export const snapshotOnchainCommissions = (validatorMeta: SnapshotValidatorMeta): PastValidatorCommissions => {
  const { inflation_rewards_commission_bps: bps, commission, vote_account: voteAccount } = validatorMeta
  assert(
    bps == null || (Number.isInteger(bps) && bps >= 0),
    `Snapshot inflation_rewards_commission_bps invalid for ${voteAccount}: ${bps}`,
  )
  return {
    // The vote program stores any u16 and agave's commission_split clamps it to 100% when paying
    inflation: bps != null ? Math.min(bps, 10_000) / 10_000 : commission / 100,
    // mev_commission is validator_commission_bps from Jito TipDistributionAccount
    mev: validatorMeta.mev_commission != null ? validatorMeta.mev_commission / 10_000 : null,
  }
}

const warnOnCommissionSourceGaps = (validatorMetas: SnapshotValidatorMeta[], source: string): void => {
  const missingBps = validatorMetas.filter(
    ({ inflation_rewards_commission_bps }) => inflation_rewards_commission_bps == null,
  ).length
  if (missingBps > 0) {
    console.warn(
      `${source} carries no inflation_rewards_commission_bps for ${missingBps} of ${validatorMetas.length} validators; ` +
        'the live u8 percent fallback is not the applied rate and truncates any rate that is not a whole percent',
    )
  }
  const disagreeing = validatorMetas.filter(
    ({ inflation_rewards_commission_bps: bps, commission }) => bps != null && Math.floor(bps / 100) !== commission,
  ).length
  if (disagreeing > 0) {
    console.warn(
      `${source}: the live u8 percent differs from the applied inflation_rewards_commission_bps for ` +
        `${disagreeing} of ${validatorMetas.length} validators, a change still inside the anti-rug window`,
    )
  }
}

export const getValidatorOverrides = (
  snapshotValidatorsCollection: SnapshotValidatorsCollection,
  bonds: RawBondsResponseDto,
): SourceDataOverrides => {
  const inflationCommissionsDec = new Map<string, number>()
  const mevCommissionsDec = new Map<string, number | undefined>()
  const blockRewardsCommissionsDec = new Map<string, number>()
  const cpmpesDec = new Map<string, number | undefined>()

  const bondsByVoteAccount = new Map(bonds.bonds.map(b => [b.vote_account, b]))

  warnOnCommissionSourceGaps(snapshotValidatorsCollection.validator_metas, 'Snapshot')

  for (const validatorMeta of snapshotValidatorsCollection.validator_metas) {
    const bond = bondsByVoteAccount.get(validatorMeta.vote_account)

    const onchain = snapshotOnchainCommissions(validatorMeta)
    const inflationBondDec =
      bond?.inflation_commission_bps != null ? Number(bond.inflation_commission_bps) / 10_000 : null
    const mevBondDec = bond?.mev_commission_bps != null ? Number(bond.mev_commission_bps) / 10_000 : null

    const effective = effectiveCommissions(onchain.inflation, inflationBondDec, onchain.mev, mevBondDec)

    assert(
      effective.inflationDec != null && Number.isFinite(effective.inflationDec),
      `Snapshot carries no usable inflation commission for ${validatorMeta.vote_account}: ${effective.inflationDec}`,
    )
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
    // Narrow on purpose: archived results predate several AuctionResult members, so only the field
    // actually read may be asserted here.
    const auctionDataParsedFromFixtures = JSON.parse(
      fs.readFileSync(options.samResultsFixtureFilePath).toString(),
    ) as Pick<AuctionResult, 'winningTotalPmpe'>
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
    warnOnCommissionSourceGaps(pastValidatorCollection.validator_metas, 'Past snapshot')

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
  ): RevenueExpectation[] =>
    evaluateRevenueExpectations(
      validatorsBefore,
      validatorsAfter,
      auctionResult.winningTotalPmpe,
      pastValidatorCommissions,
      rewards,
      this.logger,
    )

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
