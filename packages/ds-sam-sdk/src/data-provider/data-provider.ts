import axios from 'axios'
import { DsSamConfig, InputsSource } from '../config'
import {
  RawBlacklistResponseDto,
  RawBondsResponseDto,
  RawMevInfoResponseDto, RawMndeVotesResponseDto, RawRewardsRecordDto,
  RawRewardsResponseDto, RawSourceData, RawTvlResponseDto,
  RawValidatorsResponseDto,
  SourceDataOverrides
} from './data-provider.dto'
import Decimal from 'decimal.js'
import { AggregatedData, AggregatedValidator } from '../types'
import fs from 'fs'
import { MNDE_VOTE_DELEGATION_STRATEGY } from '../utils'

export class DataProvider {
  constructor (
    protected readonly config: DsSamConfig,
    private readonly dataSource: InputsSource,
  ) {
    this.validateConfig()
  }

  private validateConfig () {
    switch (this.dataSource) {
    case InputsSource.APIS:
      if (this.config.cacheInputs && !this.config.inputsCacheDirPath) {
        throw new Error('Cannot cache inputs without cache directory path configured')
      }
      break
    case InputsSource.FILES:
      if (!this.config.inputsCacheDirPath) {
        throw new Error(`Missing inputs cache directory path for inputs source: ${this.dataSource}`)
      }
      if (this.config.cacheInputs) {
        throw new Error(`Caching inputs not supported for inputs source: ${this.dataSource}`)
      }
      break
    default:
      throw new Error(`Unsupported inputs source: ${this.dataSource}`)
    }
  }

  aggregateRewardsRecords (activatedStakePerEpochs: Map<number, Decimal>, rawRewardsRecord: RawRewardsRecordDto[]): number {
    const rewardsTotal = rawRewardsRecord.reduce((agg, [epoch, rewards]) => {
      const stake = activatedStakePerEpochs.get(epoch)
      // Rewards in SOL (1e9) + stake in lamports (1e-0) + result in PMPE (1e3) = 1e12
      return stake ? { epochs: agg.epochs + 1, total: agg.total.add(new Decimal(rewards).mul(1e12).div(stake)) } : agg
    }, { epochs: 0, total: new Decimal(0) })

    return rewardsTotal.total.div(rewardsTotal.epochs).toNumber()
  }

  aggregateValidators (data: RawSourceData, validatorsMndeVotes: Map<string, Decimal>, solPerMnde: number, mndeStakeCapIncreases: Map<string, Decimal>, dataOverrides: SourceDataOverrides | null = null): AggregatedValidator[] {
    return data.validators.validators.map((validator): AggregatedValidator => {
      const bond = data.bonds.bonds.find(({ vote_account }) => validator.vote_account === vote_account)
      const mev = data.mevInfo.validators.find(({ vote_account }) => validator.vote_account === vote_account)
      const inflationCommissionOverride = dataOverrides?.inflationCommissions.get(validator.vote_account)
      const mevCommissionOverride = dataOverrides?.mevCommissions.get(validator.vote_account)

      const validatorMndeVotes = (validatorsMndeVotes.get(validator.vote_account) ?? new Decimal(0))
      const validatorMndeStakeCapIncrease = (mndeStakeCapIncreases.get(validator.vote_account) ?? new Decimal(0))

      const inflationCommissionDec = (inflationCommissionOverride ?? validator.commission_effective ?? validator.commission_advertised ?? 100) / 100
      const mevCommissionDec = (mevCommissionOverride !== undefined ? mevCommissionOverride / 10_000 : (mev ? mev.mev_commission_bps / 10_000 : null))
      return {
        voteAccount: validator.vote_account,
        clientVersion: validator.version ?? '0.0.0',
        voteCredits: validator.credits,
        aso: validator.dc_aso ?? 'Unknown',
        country: validator.dc_country ?? 'Unknown',
        bondBalanceSol: bond ? new Decimal(bond.effective_amount).div(1e9).toNumber() : null,
        totalActivatedStakeSol: new Decimal(validator.activated_stake).div(1e9).toNumber(),
        marinadeActivatedStakeSol: new Decimal(validator.marinade_stake).add(validator.marinade_native_stake).div(1e9).toNumber(),
        inflationCommissionDec,
        mevCommissionDec,
        bidCpmpe: bond ? new Decimal(bond.cpmpe).div(1e9).toNumber() : null,
        maxStakeWanted: null,
        mndeVotesSolValue: validatorMndeVotes.mul(solPerMnde).toNumber(),
        mndeStakeCapIncrease: validatorMndeStakeCapIncrease.toNumber(),
        epochStats: validator.epoch_stats.filter(({ epoch_end_at }) => !!epoch_end_at).map(es => ({
          epoch: es.epoch,
          totalActivatedStake: new Decimal(es.activated_stake),
          marinadeActivatedStake: new Decimal(es.marinade_stake).add(es.marinade_native_stake),
          voteCredits: es.credits,
        }))
      }
    })
  }

  aggregateData (data: RawSourceData, dataOverrides: SourceDataOverrides | null = null): AggregatedData {
    const activatedStakePerEpochs = new Map<number, Decimal>()
    let externalStakeTotal = new Decimal(0)
    data.validators.validators.forEach(({ epoch_stats, activated_stake, marinade_stake, marinade_native_stake }) => {
      epoch_stats.forEach(es => {
        const epochStake = activatedStakePerEpochs.get(es.epoch) ?? new Decimal(0)
        activatedStakePerEpochs.set(es.epoch, epochStake.add(es.activated_stake))
      })
      externalStakeTotal = externalStakeTotal.add(activated_stake).sub(marinade_stake).sub(marinade_native_stake)
    })

    let totalMndeVotes = new Decimal(0)
    let delStratVotes = new Decimal(0)
    const validatorsMndeVotes = data.mndeVotes.records.reduce((agg, { validatorVoteAccount, amount }) => {
      const mndeAmount = amount ?? '0'
      const votes = agg.get(validatorVoteAccount) ?? new Decimal(0)
      agg.set(validatorVoteAccount, votes.add(mndeAmount))
      totalMndeVotes = totalMndeVotes.add(mndeAmount)
      if (validatorVoteAccount === MNDE_VOTE_DELEGATION_STRATEGY) {
        delStratVotes = delStratVotes.add(mndeAmount)
      }
      return agg
    }, new Map<string, Decimal>())

    const tvlSol = data.tvlInfo.total_virtual_staked_sol + data.tvlInfo.marinade_native_stake_sol
    const delStratVotesShare = totalMndeVotes.gt(0) ? delStratVotes.div(totalMndeVotes).toNumber() : 0
    const effectiveMndeTvlShareSol = totalMndeVotes.gt(0) ? (1 - delStratVotesShare) * this.config.mndeDirectedStakeShareDec * tvlSol : 0

    const effectiveMndeStakeCapIncrease = totalMndeVotes.gt(0) ? (1 - delStratVotesShare) * this.config.mndeStakeCapMultiplier : 0

    const validatorsMndeStakeCapIncreases = new Map<string, Decimal>()
    for (const [validatorVoteAccount, amount] of validatorsMndeVotes) {
      validatorsMndeStakeCapIncreases.set(validatorVoteAccount, amount.mul(effectiveMndeStakeCapIncrease).mul(tvlSol).div(totalMndeVotes))
    }

    const solPerMnde = totalMndeVotes.gt(0) ? new Decimal(effectiveMndeTvlShareSol).div(totalMndeVotes.sub(delStratVotes)).toNumber() : 0
    console.log('total mnde votes', totalMndeVotes)
    console.log('SOL per MNDE', solPerMnde)
    console.log('tvl', tvlSol)
    return {
      validators: this.aggregateValidators(data, validatorsMndeVotes, solPerMnde, validatorsMndeStakeCapIncreases, dataOverrides),
      rewards: {
        inflationPmpe: this.aggregateRewardsRecords(activatedStakePerEpochs, data.rewards.rewards_inflation_est),
        mevPmpe: this.aggregateRewardsRecords(activatedStakePerEpochs, data.rewards.rewards_mev),
      },
      stakeAmounts: {
        networkTotalSol: externalStakeTotal.div(1e9).add(tvlSol).toNumber(),
        marinadeMndeTvlSol: effectiveMndeTvlShareSol,
        marinadeSamTvlSol: tvlSol - effectiveMndeTvlShareSol,
        marinadeRemainingMndeSol: effectiveMndeTvlShareSol,
        marinadeRemainingSamSol: tvlSol - effectiveMndeTvlShareSol,
      },
      blacklist: new Set(data.blacklist
        .split('\n')
        .slice(1) // header row
        .map((line) => line.trim().split(',')[0])
        .filter((value): value is string => !!value)
      ),
    }
  }

  cacheSourceData (data: RawSourceData) {
    if (!this.config.inputsCacheDirPath) {
      throw new Error('Cannot cache data without cache directory path configured')
    }
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/validators.json`, JSON.stringify(data.validators, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/mev-info.json`, JSON.stringify(data.mevInfo, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/bonds.json`, JSON.stringify(data.bonds, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/tvl-info.json`, JSON.stringify(data.tvlInfo, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/blacklist.csv`, data.blacklist)
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/mnde-votes.json`, JSON.stringify(data.mndeVotes, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/rewards.json`, JSON.stringify(data.rewards, null, 2))
  }

  parseCachedSourceData (): RawSourceData {
    if (!this.config.inputsCacheDirPath) {
      throw new Error('Cannot parse cached data without cache directory path configured')
    }
    const validators: RawValidatorsResponseDto = JSON.parse(fs.readFileSync(`${this.config.inputsCacheDirPath}/validators.json`).toString())
    const mevInfo: RawMevInfoResponseDto = JSON.parse(fs.readFileSync(`${this.config.inputsCacheDirPath}/mev-info.json`).toString())
    const bonds: RawBondsResponseDto = JSON.parse(fs.readFileSync(`${this.config.inputsCacheDirPath}/bonds.json`).toString())
    const tvlInfo: RawTvlResponseDto = JSON.parse(fs.readFileSync(`${this.config.inputsCacheDirPath}/tvl-info.json`).toString())
    const blacklist: RawBlacklistResponseDto = fs.readFileSync(`${this.config.inputsCacheDirPath}/blacklist.csv`).toString()
    const mndeVotes: RawMndeVotesResponseDto = JSON.parse(fs.readFileSync(`${this.config.inputsCacheDirPath}/mnde-votes.json`).toString())
    const rewards: RawRewardsResponseDto = JSON.parse(fs.readFileSync(`${this.config.inputsCacheDirPath}/rewards.json`).toString())

    return { validators, mevInfo, bonds, tvlInfo, mndeVotes, rewards, blacklist }
  }

  async fetchSourceData (): Promise<RawSourceData> {
    const [
      validators,
      mevInfo,
      bonds,
      tvlInfo,
      blacklist,
      mndeVotes,
      rewards,
    ] = await Promise.all([
      this.fetchValidators(),
      this.fetchMevInfo(),
      this.fetchBonds(),
      this.fetchTvlInfo(),
      this.fetchBlacklist(),
      this.fetchMndeVotes(),
      this.fetchRewards(),
    ])

    const data = { validators, mevInfo, bonds, tvlInfo, blacklist, mndeVotes, rewards }
    if (this.config.cacheInputs) {
      this.cacheSourceData(data)
    }
    return data
  }

  async fetchValidators (): Promise<RawValidatorsResponseDto> {
    // The API returns epoch stats also for the current epoch which is not finished and can't be used
    const epochsCount = 1 + Math.max(this.config.validatorsUptimeEpochsCount, this.config.rewardsEpochsCount)

    const url = `${this.config.validatorsApiBaseUrl}/validators?epochs=${epochsCount}&limit=1000000`
    const response = await axios.get<RawValidatorsResponseDto>(url)

    // Prevent delinquent validators from being processed and appearing in results
    const validators = response.data.validators.filter(v => v.epoch_stats.slice(0, 3).some(es => es.credits > 0))
    return { ...response.data, validators }
  }

  async fetchBonds (): Promise<RawBondsResponseDto> {
    const url = `${this.config.bondsApiBaseUrl}/bonds`
    const response = await axios.get<RawBondsResponseDto>(url)
    return response.data
  }

  async fetchTvlInfo (): Promise<RawTvlResponseDto> {
    const url = `${this.config.tvlInfoApiBaseUrl}/tlv`
    const response = await axios.get<RawTvlResponseDto>(url)
    return response.data
  }

  async fetchBlacklist (): Promise<RawBlacklistResponseDto> {
    const url = `${this.config.blacklistApiBaseUrl}/blacklist.csv`
    const response = await axios.get<RawBlacklistResponseDto>(url)
    return response.data
  }

  async fetchMndeVotes (): Promise<RawMndeVotesResponseDto> {
    const url = `${this.config.snapshotsApiBaseUrl}/v1/votes/vemnde/latest`
    const response = await axios.get<RawMndeVotesResponseDto>(url)
    return response.data
  }

  async fetchRewards (): Promise<RawRewardsResponseDto> {
    const url = `${this.config.validatorsApiBaseUrl}/rewards?epochs=${this.config.rewardsEpochsCount}`
    const response = await axios.get<RawRewardsResponseDto>(url)
    return response.data
  }

  async fetchMevInfo (): Promise<RawMevInfoResponseDto> {
    const url = `${this.config.validatorsApiBaseUrl}/mev`
    const response = await axios.get<RawMevInfoResponseDto>(url)
    return response.data
  }
}
