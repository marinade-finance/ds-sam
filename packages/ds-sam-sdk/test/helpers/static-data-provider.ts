import Decimal from 'decimal.js'

import { isNotNull } from './utils'
import { DataProvider } from '../../src/data-provider/data-provider'

import type { ValidatorMockBuilder } from './validator-mock-builder'
import type {
  DsSamConfig,
  RawBlacklistResponseDto,
  RawBondsResponseDto,
  RawMevInfoResponseDto,
  RawRewardsRecordDto,
  RawRewardsResponseDto,
  RawScoredValidatorDto,
  RawSlotsPerYearRecordDto,
  RawTvlResponseDto,
  RawValidatorsResponseDto,
} from '../../src'

// agave LEGACY_SLOT_PARAMS.slots_per_year — the 400ms baseline every collected epoch ran under.
export const BASELINE_SLOTS_PER_YEAR = 78892314.984

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
      validators: this.validatorMockBuilders
        .filter(v => !v.isAuctionOnly())
        .map(v => v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch)),
    })
  }

  override fetchBonds(): Promise<RawBondsResponseDto> {
    return Promise.resolve({
      bonds: this.validatorMockBuilders
        .filter(v => !v.isAuctionOnly())
        .map(v => v.toRawBondDto(this.staticDataProviderConfig.currentEpoch))
        .filter(isNotNull),
    })
  }

  override fetchTvlInfo(): Promise<RawTvlResponseDto> {
    const dtos = this.validatorMockBuilders
      .filter(v => !v.isAuctionOnly())
      .map(v => v.toRawValidatorDto(this.staticDataProviderConfig.currentEpoch))
    return Promise.resolve({
      total_virtual_staked_sol: dtos.reduce((sum, dto) => sum + new Decimal(dto.marinade_stake).div(1e9).toNumber(), 0),
      marinade_native_stake_sol: dtos.reduce(
        (sum, dto) => sum + new Decimal(dto.marinade_native_stake).div(1e9).toNumber(),
        0,
      ),
    })
  }

  override fetchBlacklist(): Promise<RawBlacklistResponseDto> {
    const rows = this.validatorMockBuilders
      .filter(v => !v.isAuctionOnly())
      .map(v => v.toRawBlacklistResponseDtoRow())
      .filter(isNotNull)
      .join('\n')
    return Promise.resolve(`vote_account,code\n${rows}`)
  }

  override fetchRewards(): Promise<RawRewardsResponseDto> {
    const epochs = this.config.rewardsEpochsCount
    const rewardsMev = Array.from(
      { length: epochs },
      (_, i): RawRewardsRecordDto => [
        this.staticDataProviderConfig.currentEpoch - i - 1,
        this.staticDataProviderConfig.mevRewardsPerEpoch,
      ],
    )
    const rewardsInflationEst = Array.from(
      { length: epochs },
      (_, i): RawRewardsRecordDto => [
        this.staticDataProviderConfig.currentEpoch - i - 1,
        this.staticDataProviderConfig.inflationRewardsPerEpoch,
      ],
    )
    const rewardsBlock = Array.from(
      { length: epochs },
      (_, i): RawRewardsRecordDto => [
        this.staticDataProviderConfig.currentEpoch - i - 1,
        this.staticDataProviderConfig.blockRewardsPerEpoch,
      ],
    )

    const slotsPerYear = Array.from(
      { length: epochs },
      (_, i): RawSlotsPerYearRecordDto => [this.staticDataProviderConfig.currentEpoch - i - 1, BASELINE_SLOTS_PER_YEAR],
    )

    return Promise.resolve({
      rewards_mev: rewardsMev,
      rewards_inflation_est: rewardsInflationEst,
      rewards_block: rewardsBlock,
      slots_per_year: slotsPerYear,
    })
  }

  override fetchMevInfo(): Promise<RawMevInfoResponseDto> {
    return Promise.resolve({
      validators: this.validatorMockBuilders
        .filter(v => !v.isAuctionOnly())
        .map(v => v.toRawValidatorMevInfoDto())
        .filter(isNotNull),
    })
  }

  override fetchAuctions(): Promise<RawScoredValidatorDto[]> {
    return Promise.resolve(
      this.validatorMockBuilders.filter(v => v.hasAuctionEntry()).flatMap(v => v.toRawAuctionEntryDtos()),
    )
  }
}
