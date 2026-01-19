import fs from 'fs'

import axios from 'axios'
import Decimal from 'decimal.js'

// TODO: what was delStratVotes for?
import { calcEffParticipatingBidPmpe } from '../calculations'
import { InputsSource } from '../config'

import type { AggregatedData, AggregatedValidator } from '../types'
import type {
  RawBlacklistResponseDto,
  RawBondsResponseDto,
  RawMevInfoResponseDto,
  RawRewardsRecordDto,
  RawRewardsResponseDto,
  RawSourceData,
  RawTvlResponseDto,
  RawValidatorsResponseDto,
  RawScoredValidatorDto,
  SourceDataOverrides,
  AuctionHistory,
  AuctionHistoryStats,
  RawValidatorDto,
  RawOverrideDataDto,
} from './data-provider.dto'
import type { DsSamConfig } from '../config'

export class DataProvider {
  constructor(
    protected readonly config: DsSamConfig,
    private readonly dataSource: InputsSource,
  ) {
    this.validateConfig()
  }

  private validateConfig() {
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
        throw new Error(`Unsupported inputs source: ${String(this.dataSource)}`)
    }
  }

  // calculates a ratio of rewards to staked SOL in PMPE ('per 1000 SOL' per epoch)
  private aggregateRewardsRecords(
    activatedStakePerEpochs: Map<number, Decimal>,
    rawRewardsRecord: RawRewardsRecordDto[],
  ): number {
    const rewardsTotal = rawRewardsRecord.reduce(
      (agg, [epoch, rewards]) => {
        const stake = activatedStakePerEpochs.get(epoch)
        // Rewards in SOL (1e9) + stake in lamports (1e-0) + result in PMPE (1e3) = 1e12
        return stake
          ? {
              epochs: agg.epochs + 1,
              total: agg.total.add(new Decimal(rewards).mul(1e12).div(stake)),
            }
          : agg
      },
      { epochs: 0, total: new Decimal(0) },
    )

    return rewardsTotal.total.div(rewardsTotal.epochs).toNumber()
  }

  /* eslint-disable no-param-reassign */
  private processAuctions(input: RawScoredValidatorDto[]): AuctionHistory[] {
    const result: AuctionHistory[] = []
    let epoch = Infinity
    let validators: RawScoredValidatorDto[] = []
    const finalizeEpoch = (inputValidators: RawScoredValidatorDto[]) => {
      inputValidators.sort((a, b) => b.revShare.bondObligationPmpe - a.revShare.bondObligationPmpe)
      const winningTotalPmpe = inputValidators
        .filter(item => item.marinadeSamTargetSol > 0)
        .reduce((_, item) => item.revShare.totalPmpe, 0)
      result.push({ epoch, winningTotalPmpe, validators })
      inputValidators = []
    }
    for (const entry of input) {
      if (entry.epoch < epoch) {
        finalizeEpoch(validators)
        validators = []
        epoch = entry.epoch
      }
      validators.push(entry)
    }
    finalizeEpoch(validators)
    result.shift()
    return result
  }

  extractAuctionHistoryStats(auction: AuctionHistory, validator: RawValidatorDto): AuctionHistoryStats {
    const entry = auction.validators.find(({ voteAccount }) => validator.vote_account === voteAccount)
    const { revShare, values } = entry ?? {
      revShare: null,
      values: null,
    }
    const commissions = values?.commissions ?? {
      inflationCommissionDec: 1,
      mevCommissionDec: 1,
      blockRewardsCommissionDec: 1,
      inflationCommissionOnchainDec: 1,
      inflationCommissionInBondDec: null,
      mevCommissionOnchainDec: null,
      mevCommissionInBondDec: null,
      blockRewardsCommissionInBondDec: null,
    }
    if (revShare == null) {
      console.log(`validator ${validator.vote_account} did not participate in auction in epoch ${auction.epoch}`)
      return {
        epoch: auction.epoch,
        winningTotalPmpe: auction.winningTotalPmpe,
        auctionEffectiveBidPmpe: 0,
        bidPmpe: 0,
        totalPmpe: 0,
        bondObligationPmpe: 0,
        effParticipatingBidPmpe: 0,
        commissions,
      }
    }
    return {
      epoch: auction.epoch,
      winningTotalPmpe: auction.winningTotalPmpe,
      auctionEffectiveBidPmpe: revShare.auctionEffectiveBidPmpe,
      bidPmpe: revShare.bidPmpe,
      totalPmpe: revShare.totalPmpe,
      bondObligationPmpe: revShare.bondObligationPmpe,
      effParticipatingBidPmpe: calcEffParticipatingBidPmpe(revShare, auction.winningTotalPmpe),
      commissions,
    }
  }

  /* eslint-disable complexity */
  private aggregateValidators(
    data: RawSourceData,
    blacklist: Set<string>,
    dataOverrides: SourceDataOverrides | null = null,
  ): AggregatedValidator[] {
    const auctionHistoriesData = this.processAuctions(data.auctions)
    return data.validators.validators.map((validator): AggregatedValidator => {
      const bond = data.bonds.bonds.find(({ vote_account }) => validator.vote_account === vote_account)
      const mev = data.mevInfo.validators.find(({ vote_account }) => validator.vote_account === vote_account)
      const override = data.overrides?.validators.find(({ voteAccount }) => validator.vote_account === voteAccount)

      const inflationCommissionOverride = dataOverrides?.inflationCommissions?.get(validator.vote_account)
      const mevCommissionOverride = dataOverrides?.mevCommissions?.get(validator.vote_account)
      const blockRewardsCommissionOverride = dataOverrides?.blockRewardsCommissions?.get(validator.vote_account)
      const bidCpmpeOverride = dataOverrides?.cpmpes?.get(validator.vote_account)

      const inflationCommissionOverrideDec =
        inflationCommissionOverride !== undefined ? inflationCommissionOverride / 100 : null
      const mevCommissionOverrideDec = mevCommissionOverride !== undefined ? mevCommissionOverride / 10_000 : null
      const blockRewardsCommissionOverrideDec =
        blockRewardsCommissionOverride !== undefined ? blockRewardsCommissionOverride / 10_000 : null
      const bidCpmpeOverrideDec = bidCpmpeOverride !== undefined ? bidCpmpeOverride / 1e9 : null

      const inflationCommissionInBondDec =
        bond?.inflation_commission_bps != null ? Number(bond.inflation_commission_bps) / 10_000 : null
      const mevCommissionInBondDec = bond?.mev_commission_bps != null ? Number(bond.mev_commission_bps) / 10_000 : null
      const blockRewardsCommissionInBondDec =
        bond?.block_commission_bps != null ? Number(bond.block_commission_bps) / 10_000 : null

      const inflationCommissionOnchainDec =
        (validator.commission_effective ?? validator.commission_advertised ?? 100) / 100
      const mevCommissionOnchainDec = mev ? mev.mev_commission_bps / 10_000 : null

      // data to be applied in calculation of rev share as it considers the overrides and bond commissions (note: it can be negative)
      let inflationCommissionDec =
        inflationCommissionOverrideDec ??
        Math.min(inflationCommissionInBondDec ?? Infinity, inflationCommissionOnchainDec)
      let mevCommissionDec =
        mevCommissionOverrideDec ??
        (mevCommissionInBondDec != null && mevCommissionInBondDec < (mevCommissionOnchainDec ?? 1)
          ? mevCommissionInBondDec
          : mevCommissionOnchainDec)
      let blockRewardsCommissionDec = blockRewardsCommissionOverrideDec ?? blockRewardsCommissionInBondDec

      const bidCpmpeInBondDec = bond?.cpmpe != null ? new Decimal(bond.cpmpe).div(1e9).toNumber() : null
      const bidCpmpeDec = bidCpmpeOverrideDec ?? bidCpmpeInBondDec

      // safeguard against validator accidentally overly low commission to pay overly more than 100% of rewards
      let minimalCommissionDec: number | undefined = undefined
      if (this.config.minimalCommission != null) {
        if (inflationCommissionDec < this.config.minimalCommission) {
          minimalCommissionDec = this.config.minimalCommission
          inflationCommissionDec = this.config.minimalCommission
        }
        if (mevCommissionDec && mevCommissionDec < this.config.minimalCommission) {
          minimalCommissionDec = this.config.minimalCommission
          mevCommissionDec = this.config.minimalCommission
        }
        if (blockRewardsCommissionDec && blockRewardsCommissionDec < this.config.minimalCommission) {
          minimalCommissionDec = this.config.minimalCommission
          blockRewardsCommissionDec = this.config.minimalCommission
        }
      }

      const lastAuctionHistory = auctionHistoriesData
        .flatMap(auction => auction.validators)
        .find(v => v.voteAccount === validator.vote_account)
      const auctions = auctionHistoriesData.map(auction => this.extractAuctionHistoryStats(auction, validator))
      const bondBalanceSol = bond ? new Decimal(bond.effective_amount).div(1e9).toNumber() : null
      const claimableBondBalanceSol = bond
        ? Math.max(0, new Decimal(bond.funded_amount).sub(bond.remainining_settlement_claim_amount).div(1e9).toNumber())
        : null
      const marinadeActivatedStakeSol = new Decimal(validator.marinade_stake)
        .add(validator.marinade_native_stake)
        .div(1e9)
        .toNumber()

      return {
        voteAccount: validator.vote_account,
        clientVersion: validator.version ?? '0.0.0',
        voteCredits: validator.credits,
        aso: validator.dc_aso ?? 'Unknown',
        country: validator.dc_country ?? 'Unknown',
        bondBalanceSol,
        claimableBondBalanceSol,
        lastBondBalanceSol: lastAuctionHistory?.values?.bondBalanceSol ?? null,
        lastMarinadeActivatedStakeSol: lastAuctionHistory?.values?.marinadeActivatedStakeSol ?? null,
        lastSamBlacklisted: override?.lastSamBlacklisted ?? lastAuctionHistory?.values?.samBlacklisted ?? null,
        totalActivatedStakeSol: new Decimal(validator.activated_stake).div(1e9).toNumber(),
        marinadeActivatedStakeSol,
        inflationCommissionDec,
        mevCommissionDec,
        blockRewardsCommissionDec,
        bidCpmpe: bidCpmpeDec,
        maxStakeWanted:
          this.config.minMaxStakeWanted != null && bond ? new Decimal(bond.max_stake_wanted).div(1e9).toNumber() : null,
        values: {
          bondBalanceSol,
          marinadeActivatedStakeSol,
          paidUndelegationSol: lastAuctionHistory?.values?.paidUndelegationSol ?? 0,
          bondRiskFeeSol: 0,
          samBlacklisted: blacklist.has(validator.vote_account),
          commissions: {
            inflationCommissionDec,
            mevCommissionDec: mevCommissionDec ?? 1,
            blockRewardsCommissionDec: blockRewardsCommissionDec ?? 1,
            inflationCommissionOnchainDec,
            mevCommissionOnchainDec,
            inflationCommissionInBondDec,
            mevCommissionInBondDec,
            blockRewardsCommissionInBondDec,
            inflationCommissionOverrideDec: inflationCommissionOverrideDec ?? undefined,
            mevCommissionOverrideDec: mevCommissionOverrideDec ?? undefined,
            blockRewardsCommissionOverrideDec: blockRewardsCommissionOverrideDec ?? undefined,
            bidCpmpeInBondDec,
            bidCpmpeOverrideDec: bidCpmpeOverrideDec ?? undefined,
            minimalCommissionDec,
          },
        },
        foundationStakeSol: new Decimal(validator.foundation_stake).div(1e9).toNumber(),
        selfStakeSol: new Decimal(validator.self_stake).div(1e9).toNumber(),
        epochStats: validator.epoch_stats
          .filter(({ epoch_end_at }) => !!epoch_end_at)
          .map(es => ({
            epoch: es.epoch,
            totalActivatedStake: new Decimal(es.activated_stake),
            marinadeActivatedStake: new Decimal(es.marinade_stake).add(es.marinade_native_stake),
            voteCredits: es.credits,
          })),
        auctions,
      }
    })
  }

  aggregateData(data: RawSourceData, dataOverrides: SourceDataOverrides | null = null): AggregatedData {
    const activatedStakePerEpochs = new Map<number, Decimal>()
    let externalStakeTotal = new Decimal(0)
    data.validators.validators.forEach(({ epoch_stats, activated_stake, marinade_stake, marinade_native_stake }) => {
      epoch_stats.forEach(es => {
        const epochStake = activatedStakePerEpochs.get(es.epoch) ?? new Decimal(0)
        activatedStakePerEpochs.set(es.epoch, epochStake.add(es.activated_stake))
      })
      externalStakeTotal = externalStakeTotal.add(activated_stake).sub(marinade_stake).sub(marinade_native_stake)
    })

    const tvlSol = data.tvlInfo.total_virtual_staked_sol + data.tvlInfo.marinade_native_stake_sol

    const blacklist = new Set(
      data.blacklist
        .split('\n')
        .slice(1) // header row
        .map(line => line.trim().split(',')[0])
        .filter((value): value is string => !!value),
    )

    const epoch = data.rewards.rewards_inflation_est.reduce((epoch, entry) => Math.max(epoch, entry[0]), 0) + 1

    console.log('tvl', tvlSol)
    return {
      epoch,
      validators: this.aggregateValidators(data, blacklist, dataOverrides),
      rewards: {
        inflationPmpe: this.aggregateRewardsRecords(activatedStakePerEpochs, data.rewards.rewards_inflation_est),
        mevPmpe: this.aggregateRewardsRecords(activatedStakePerEpochs, data.rewards.rewards_mev),
        blockPmpe: data.rewards.rewards_block
          ? this.aggregateRewardsRecords(activatedStakePerEpochs, data.rewards.rewards_block)
          : 0,
      },
      stakeAmounts: {
        networkTotalSol: externalStakeTotal.div(1e9).add(tvlSol).toNumber(),
        marinadeSamTvlSol: tvlSol,
        marinadeRemainingSamSol: tvlSol,
      },
      blacklist,
    }
  }

  cacheSourceData(data: RawSourceData) {
    if (!this.config.inputsCacheDirPath) {
      throw new Error('Cannot cache data without cache directory path configured')
    }
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/validators.json`, JSON.stringify(data.validators, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/mev-info.json`, JSON.stringify(data.mevInfo, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/bonds.json`, JSON.stringify(data.bonds, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/tvl-info.json`, JSON.stringify(data.tvlInfo, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/blacklist.csv`, data.blacklist)
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/rewards.json`, JSON.stringify(data.rewards, null, 2))
    fs.writeFileSync(`${this.config.inputsCacheDirPath}/auctions.json`, JSON.stringify(data.auctions, null, 2))
    if (data.overrides) {
      fs.writeFileSync(`${this.config.inputsCacheDirPath}/overrides.json`, JSON.stringify(data.overrides, null, 2))
    }
  }

  parseCachedSourceData(): RawSourceData {
    if (!this.config.inputsCacheDirPath) {
      throw new Error('Cannot parse cached data without cache directory path configured')
    }
    const validators: RawValidatorsResponseDto = JSON.parse(
      fs.readFileSync(`${this.config.inputsCacheDirPath}/validators.json`).toString(),
    ) as RawValidatorsResponseDto
    const mevInfo: RawMevInfoResponseDto = JSON.parse(
      fs.readFileSync(`${this.config.inputsCacheDirPath}/mev-info.json`).toString(),
    ) as RawMevInfoResponseDto
    const bonds: RawBondsResponseDto = JSON.parse(
      fs.readFileSync(`${this.config.inputsCacheDirPath}/bonds.json`).toString(),
    ) as RawBondsResponseDto
    const tvlInfo: RawTvlResponseDto = JSON.parse(
      fs.readFileSync(`${this.config.inputsCacheDirPath}/tvl-info.json`).toString(),
    ) as RawTvlResponseDto
    const blacklist: RawBlacklistResponseDto = fs
      .readFileSync(`${this.config.inputsCacheDirPath}/blacklist.csv`)
      .toString()
    const rewards: RawRewardsResponseDto = JSON.parse(
      fs.readFileSync(`${this.config.inputsCacheDirPath}/rewards.json`).toString(),
    ) as RawRewardsResponseDto

    const auctionsFile = `${this.config.inputsCacheDirPath}/auctions.json`
    const auctions: RawScoredValidatorDto[] = fs.existsSync(auctionsFile)
      ? (JSON.parse(fs.readFileSync(auctionsFile).toString()) as RawScoredValidatorDto[])
      : []
    this.fixRawScoredValidatorsDto(auctions)

    const overridesFile = `${this.config.inputsCacheDirPath}/overrides.json`
    const overrides: RawOverrideDataDto | undefined = fs.existsSync(overridesFile)
      ? (JSON.parse(fs.readFileSync(overridesFile).toString()) as RawOverrideDataDto)
      : undefined

    return {
      validators,
      mevInfo,
      bonds,
      tvlInfo,
      rewards,
      blacklist,
      auctions,
      overrides,
    }
  }

  async fetchSourceData(): Promise<RawSourceData> {
    const [validators, mevInfo, bonds, tvlInfo, blacklist, rewards, auctions] = await Promise.all([
      this.fetchValidators(),
      this.fetchMevInfo(),
      this.fetchBonds(),
      this.fetchTvlInfo(),
      this.fetchBlacklist(),
      this.fetchRewards(),
      this.fetchAuctions(this.config.bidTooLowPenaltyHistoryEpochs),
    ])

    const epoch = rewards.rewards_inflation_est.reduce((epoch, entry) => Math.max(epoch, entry[0]), 0) + 1
    const overrides = await this.fetchOverrides(epoch)

    const data = {
      validators,
      mevInfo,
      bonds,
      tvlInfo,
      blacklist,
      rewards,
      auctions,
      overrides: overrides ?? undefined,
    }
    if (this.config.cacheInputs) {
      this.cacheSourceData(data)
    }
    return data
  }

  // Fixing missing data in validators response from older API versions
  private fixRawScoredValidatorsDto(validators: RawScoredValidatorDto[]): void {
    validators.forEach(v => {
      v.revShare = {
        ...v.revShare,
        blockPmpe: v.revShare.blockPmpe ?? 0,
        bondObligationPmpe: v.revShare.bondObligationPmpe ?? v.revShare.bidPmpe,
        onchainDistributedPmpe: v.revShare.onchainDistributedPmpe ?? v.revShare.inflationPmpe + v.revShare.mevPmpe,
      }
    })
  }

  async fetchValidators(): Promise<RawValidatorsResponseDto> {
    // The API returns epoch stats also for the current epoch which is not finished and can't be used
    const epochsCount = 1 + Math.max(this.config.validatorsUptimeEpochsCount, this.config.rewardsEpochsCount)

    const url = `${this.config.validatorsApiBaseUrl}/validators?epochs=${epochsCount}&limit=1000000`
    const response = await axios.get<RawValidatorsResponseDto>(url)

    // Prevent delinquent validators from being processed and appearing in results
    const validators = response.data.validators.filter(v => v.epoch_stats.slice(0, 3).some(es => es.credits > 0))
    return { ...response.data, validators }
  }

  async fetchBonds(): Promise<RawBondsResponseDto> {
    const url = `${this.config.bondsApiBaseUrl}/bonds/bidding`
    const response = await axios.get<RawBondsResponseDto>(url)
    return response.data
  }

  async fetchTvlInfo(): Promise<RawTvlResponseDto> {
    const url = `${this.config.tvlInfoApiBaseUrl}/tlv`
    const response = await axios.get<RawTvlResponseDto>(url)
    return response.data
  }

  async fetchBlacklist(): Promise<RawBlacklistResponseDto> {
    const url = `${this.config.blacklistApiBaseUrl}/blacklist.csv`
    const response = await axios.get<RawBlacklistResponseDto>(url)
    return response.data
  }

  async fetchRewards(): Promise<RawRewardsResponseDto> {
    const url = `${this.config.validatorsApiBaseUrl}/rewards?epochs=${this.config.rewardsEpochsCount}`
    const response = await axios.get<RawRewardsResponseDto>(url)
    return response.data
  }

  async fetchMevInfo(): Promise<RawMevInfoResponseDto> {
    const url = `${this.config.validatorsApiBaseUrl}/mev`
    const response = await axios.get<RawMevInfoResponseDto>(url)
    return response.data
  }

  async fetchAuctions(n: number): Promise<RawScoredValidatorDto[]> {
    const url = `${this.config.scoringApiBaseUrl}/api/v1/scores/sam?lastEpochs=${n + 1}`
    const response = await axios.get<RawScoredValidatorDto[]>(url)
    this.fixRawScoredValidatorsDto(response.data)
    return response.data
  }

  async fetchOverrides(epoch: number): Promise<RawOverrideDataDto | null> {
    const url = `${this.config.overridesApiBaseUrl}/${epoch}/overrides.json`
    try {
      const response = await axios.get<RawOverrideDataDto>(url)
      return response.data
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null
      }
      throw error
    }
  }
}
