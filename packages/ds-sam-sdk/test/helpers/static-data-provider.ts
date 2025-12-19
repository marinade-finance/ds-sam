import Decimal from 'decimal.js'

import { isNotNull } from './utils'
import { DataProvider } from '../../src/data-provider/data-provider'

import type { ValidatorMockBuilder } from './validator-mock-builder'
import type {
  DsSamConfig,
  RawBlacklistResponseDto,
  RawBondsResponseDto,
  RawMevInfoResponseDto,
  RawMndeVotesResponseDto,
  RawRewardsRecordDto,
  RawRewardsResponseDto,
  RawTvlResponseDto,
  RawValidatorsResponseDto,
} from '../../src'

export type StaticDataProviderConfig = {
  validatorMockBuilders: ValidatorMockBuilder[]
  inflationRewardsPerEpoch: number
  mevRewardsPerEpoch: number
  blockRewardsPerEpoch: number
  currentEpoch: number
}

export class StaticDataProvider extends DataProvider {
  private validatorMockBuilders: ValidatorMockBuilder[] = []

  constructor(
    config: DsSamConfig,
    private readonly staticDataProviderConfig: StaticDataProviderConfig,
  ) {
    super(config, config.inputsSource)
    this.validatorMockBuilders = staticDataProviderConfig.validatorMockBuilders
  }

  override fetchValidators(): Promise<RawValidatorsResponseDto> {
    return Promise.resolve({
      validators: this.validatorMockBuilders.map(v => v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch)),
    })
  }

  override fetchBonds(): Promise<RawBondsResponseDto> {
    return Promise.resolve({
      bonds: this.validatorMockBuilders
        .map(v => v.toRawBondDto(this.staticDataProviderConfig.currentEpoch))
        .filter(isNotNull),
    })
  }

  override fetchTvlInfo(): Promise<RawTvlResponseDto> {
    return Promise.resolve({
      total_virtual_staked_sol: this.validatorMockBuilders.reduce(
        (sum, v) =>
          sum +
          new Decimal(v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch).marinade_stake)
            .div(1e9)
            .toNumber(),
        0,
      ),
      marinade_native_stake_sol: this.validatorMockBuilders.reduce(
        (sum, v) =>
          sum +
          new Decimal(v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch).marinade_native_stake)
            .div(1e9)
            .toNumber(),
        0,
      ),
    })
  }

  override fetchBlacklist(): Promise<RawBlacklistResponseDto> {
    const rows = this.validatorMockBuilders
      .map(v => v.toRawBlacklistResponseDtoRow())
      .filter(isNotNull)
      .join('\n')
    return Promise.resolve(`vote_account,code\n${rows}`)
  }

  override fetchMndeVotes(): Promise<RawMndeVotesResponseDto> {
    return Promise.resolve({
      voteRecordsCreatedAt: '2222-02-02T00:00:00Z',
      records: this.validatorMockBuilders.map(v => v.toRawMndeVoteDto()).filter(isNotNull),
    })
  }

  override fetchRewards(): Promise<RawRewardsResponseDto> {
    const epochs = this.config.rewardsEpochsCount
    const rewardsMev = Array.from(
      { length: epochs },
      (_, i): RawRewardsRecordDto => [
        this.staticDataProviderConfig.currentEpoch - i - 1,
        this.staticDataProviderConfig.inflationRewardsPerEpoch,
      ],
    )
    const rewardsInflationEst = Array.from(
      { length: epochs },
      (_, i): RawRewardsRecordDto => [
        this.staticDataProviderConfig.currentEpoch - i - 1,
        this.staticDataProviderConfig.mevRewardsPerEpoch,
      ],
    )
    const rewardsBlock = Array.from(
      { length: epochs },
      (_, i): RawRewardsRecordDto => [
        this.staticDataProviderConfig.currentEpoch - i - 1,
        this.staticDataProviderConfig.blockRewardsPerEpoch,
      ],
    )

    return Promise.resolve({
      rewards_mev: rewardsMev,
      rewards_inflation_est: rewardsInflationEst,
      rewards_block: rewardsBlock,
    })
  }

  override fetchMevInfo(): Promise<RawMevInfoResponseDto> {
    return Promise.resolve({
      validators: this.validatorMockBuilders.map(v => v.toRawValidatorMevInfoDto()).filter(isNotNull),
    })
  }
}
