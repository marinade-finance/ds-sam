import { DsSamConfig, RawBlacklistResponseDto, RawBondsResponseDto, RawMevInfoResponseDto, RawMndeVotesResponseDto, RawRewardsRecordDto, RawRewardsResponseDto, RawTvlResponseDto, RawValidatorsResponseDto } from '../../src'
import { DataProvider } from '../../src/data-provider/data-provider'
import { ValidatorMockBuilder } from './validator-mock-builder'
import { isNotNull } from './utils'
import Decimal from 'decimal.js'

export type StaticDataProviderConfig = {
  validatorMockBuilders: ValidatorMockBuilder[]
  inflationRewardsPerEpoch: number
  mevRewardsPerEpoch: number
  currentEpoch: number
}

export class StaticDataProvider extends DataProvider {
  private validatorMockBuilders: ValidatorMockBuilder[] = []

  constructor (config: DsSamConfig, private readonly staticDataProviderConfig: StaticDataProviderConfig) {
    super(config, config.inputsSource)
    this.validatorMockBuilders = staticDataProviderConfig.validatorMockBuilders
  }

  async fetchValidators (): Promise<RawValidatorsResponseDto> {
    return {
      validators: this.validatorMockBuilders.map(v => v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch)),
    }
  }

  async fetchBonds (): Promise<RawBondsResponseDto> {
    return {
      bonds: this.validatorMockBuilders.map(v => v.toRawBondDto(this.staticDataProviderConfig.currentEpoch)).filter(isNotNull)
    }
  }

  async fetchTvlInfo (): Promise<RawTvlResponseDto> {
    return {
      total_virtual_staked_sol: this.validatorMockBuilders.reduce((sum, v) => sum + new Decimal(v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch).marinade_stake).div(1e9).toNumber(), 0),
      marinade_native_stake_sol: this.validatorMockBuilders.reduce((sum, v) => sum + new Decimal(v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch).marinade_native_stake).div(1e9).toNumber(), 0),
    }
  }

  async fetchBlacklist (): Promise<RawBlacklistResponseDto> {
    return `vote_account,code\n${this.validatorMockBuilders.map(v => v.toRawBlacklistResponseDtoRow()).filter(isNotNull).join('\n')}`
  }

  async fetchMndeVotes (): Promise<RawMndeVotesResponseDto> {
    return {
      voteRecordsCreatedAt: '2222-02-02T00:00:00Z',
      records: this.validatorMockBuilders.map(v => v.toRawMndeVoteDto()).filter(isNotNull),
    }
  }

  async fetchRewards (): Promise<RawRewardsResponseDto> {
    const epochs = this.config.rewardsEpochsCount
    const rewards_mev = Array.from({ length: epochs }, (_, i): RawRewardsRecordDto => [this.staticDataProviderConfig.currentEpoch - i - 1, this.staticDataProviderConfig.inflationRewardsPerEpoch])
    const rewards_inflation_est = Array.from({ length: epochs }, (_, i): RawRewardsRecordDto => [this.staticDataProviderConfig.currentEpoch - i - 1, this.staticDataProviderConfig.mevRewardsPerEpoch])

    return {
      rewards_mev,
      rewards_inflation_est,
    }
  }

  async fetchMevInfo (): Promise<RawMevInfoResponseDto> {
    return {
      validators: this.validatorMockBuilders.map(v => v.toRawValidatorMevInfoDto()).filter(isNotNull),
    }
  }
}