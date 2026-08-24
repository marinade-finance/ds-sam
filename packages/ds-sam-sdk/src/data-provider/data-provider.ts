import fs from 'fs'

import {
  BASELINE_SLOTS_PER_YEAR,
  calcEffParticipatingBidPmpe,
  InputsSource,
  effectiveCommissions,
} from '@marinade.finance/ds-sam-calc'
import axios from 'axios'
import Decimal from 'decimal.js'

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
  RawValidatorDto,
} from './data-provider.dto'
import type {
  AggregatedData,
  AggregatedValidator,
  AuctionHistoryStats,
  DsSamConfig,
  SlotParams,
} from '@marinade.finance/ds-sam-calc'

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
        if (this.config.cacheInputs && this.config.blacklistFilePath) {
          throw new Error(
            'Cannot cache inputs while reading the blacklist from a local file: ' +
              'the cached blacklist.csv would be indistinguishable from an API snapshot',
          )
        }
        break
      case InputsSource.FILES:
        if (!this.config.inputsCacheDirPath) {
          throw new Error(`Missing inputs cache directory path for inputs source: ${this.dataSource}`)
        }
        if (this.config.cacheInputs) {
          throw new Error(`Caching inputs not supported for inputs source: ${this.dataSource}`)
        }
        if (this.config.blacklistFilePath) {
          throw new Error(
            `--blacklist-file is not read for inputs source ${this.dataSource}: ` +
              'the blacklist comes from the cached inputs',
          )
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

  private resolveSlotsPerYear(rewards: RawRewardsResponseDto, epoch: number): number {
    const records = rewards.slots_per_year ?? []
    if (records.length === 0) {
      if (this.dataSource === InputsSource.APIS) {
        throw new Error('Missing slots_per_year in rewards data')
      }
      // Inputs cached before the API published the nominal can only hold pre-SIMD-0525 epochs.
      console.warn(`Cached rewards carry no slots_per_year, assuming the baseline for epoch ${epoch}`)
      return BASELINE_SLOTS_PER_YEAR
    }
    // The API reports the running epoch too, so the auction's own regime is always available there.
    const record = records.find(([recordEpoch]) => recordEpoch === epoch)
    if (record !== undefined) {
      return record[1]
    }
    if (this.dataSource === InputsSource.APIS) {
      throw new Error(`Missing slots_per_year for the auction epoch ${epoch}`)
    }
    // Caches taken before the producer emitted the running-epoch row stop one short of the auction
    // epoch; the newest regime they carry is the closest thing to it, and replay must not die on it.
    const latest = records.reduce((acc, r) => (r[0] > acc[0] ? r : acc))
    console.warn(`Cached rewards stop at epoch ${latest[0]}, using its nominal for auction epoch ${epoch}`)
    return latest[1]
  }

  // Per-epoch issuance scales with 1/slots_per_year, so a window spanning a slot-time change
  // averages two regimes and lags the current one by up to the window length unless normalised.
  private aggregateInflationRecords(
    activatedStakePerEpochs: Map<number, Decimal>,
    rewards: RawRewardsResponseDto,
    targetSlotsPerYear: number,
  ): number {
    const slotsPerYearByEpoch = new Map(rewards.slots_per_year ?? [])
    if (slotsPerYearByEpoch.size === 0) {
      return this.aggregateRewardsRecords(activatedStakePerEpochs, rewards.rewards_inflation_est)
    }

    const normalized = rewards.rewards_inflation_est
      // aggregateRewardsRecords drops epochs with no stake, so requiring a regime for them would
      // abort the run over a record that never reaches the average.
      .filter(([epoch]) => activatedStakePerEpochs.has(epoch))
      .map(([epoch, amount]): RawRewardsRecordDto => {
        const slotsPerYear = slotsPerYearByEpoch.get(epoch)
        if (slotsPerYear === undefined) {
          throw new Error(`Missing slots_per_year for epoch ${epoch}, which has an inflation estimate`)
        }
        // Exact identity rather than a 1.0 factor, so a window without a transition cannot move at all.
        return slotsPerYear === targetSlotsPerYear
          ? [epoch, amount]
          : [epoch, new Decimal(amount).mul(slotsPerYear).div(targetSlotsPerYear).toNumber()]
      })

    return this.aggregateRewardsRecords(activatedStakePerEpochs, normalized)
  }

  private processAuctions(input: RawScoredValidatorDto[]): AuctionHistory[] {
    const epochs = [...new Set(input.map(e => e.epoch))].sort((a, b) => b - a)
    return epochs.map(epoch => {
      const validators = input.filter(entry => entry.epoch === epoch)
      const winners = validators.filter(entry => entry.marinadeSamTargetSol > 0)
      return {
        epoch,
        winningTotalPmpe: winners.reduce((min, entry) => Math.min(min, entry.revShare.totalPmpe), Infinity),
        validators,
      }
    })
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
        activatingStakePmpe: 0,
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
      activatingStakePmpe: revShare.activatingStakePmpe,
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

      const inflationCommissionOverrideDec = dataOverrides?.inflationCommissionsDec?.get(validator.vote_account) ?? null
      const mevCommissionOverrideDec = dataOverrides?.mevCommissionsDec?.get(validator.vote_account) ?? null
      const blockRewardsCommissionOverrideDec =
        dataOverrides?.blockRewardsCommissionsDec?.get(validator.vote_account) ?? null
      const bidCpmpeOverrideDec = dataOverrides?.cpmpesDec?.get(validator.vote_account) ?? null

      const inflationCommissionInBondDec =
        bond?.inflation_commission_bps != null ? Number(bond.inflation_commission_bps) / 10_000 : null
      const mevCommissionInBondDec = bond?.mev_commission_bps != null ? Number(bond.mev_commission_bps) / 10_000 : null
      const blockRewardsCommissionInBondDec =
        bond?.block_commission_bps != null ? Number(bond.block_commission_bps) / 10_000 : null

      const inflationCommissionOnchainDec =
        (validator.commission_effective ?? validator.commission_advertised ?? 100) / 100
      const mevCommissionOnchainDec = mev ? mev.mev_commission_bps / 10_000 : null

      // data to be applied in calculation of rev share as it considers the overrides and bond commissions (note: it can be negative)
      const effective = effectiveCommissions(
        inflationCommissionOnchainDec,
        inflationCommissionInBondDec,
        mevCommissionOnchainDec,
        mevCommissionInBondDec,
      )
      let inflationCommissionDec = inflationCommissionOverrideDec ?? effective.inflationDec
      let mevCommissionDec = mevCommissionOverrideDec ?? effective.mevDec
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
      const marinadeLiquidStakeSol = new Decimal(validator.marinade_stake).div(1e9).toNumber()
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
        lastSamBlacklisted: lastAuctionHistory?.values?.samBlacklisted ?? null,
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
          marinadeLiquidStakeSol,
          marinadeNativeTargetSol: 0,
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
    const slotParams: SlotParams = { slotsPerYear: this.resolveSlotsPerYear(data.rewards, epoch), epoch }

    console.log('tvl', tvlSol)
    return {
      epoch,
      validators: this.aggregateValidators(data, blacklist, dataOverrides),
      rewards: {
        inflationPmpe: this.aggregateInflationRecords(activatedStakePerEpochs, data.rewards, slotParams.slotsPerYear),
        mevPmpe: this.aggregateRewardsRecords(activatedStakePerEpochs, data.rewards.rewards_mev),
        blockPmpe: data.rewards.rewards_block
          ? this.aggregateRewardsRecords(activatedStakePerEpochs, data.rewards.rewards_block)
          : 0,
      },
      slotParams,
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

    return {
      validators,
      mevInfo,
      bonds,
      tvlInfo,
      rewards,
      blacklist,
      auctions,
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

    const data = {
      validators,
      mevInfo,
      bonds,
      tvlInfo,
      blacklist,
      rewards,
      auctions,
    }
    if (this.config.cacheInputs) {
      this.cacheSourceData(data)
    }
    return data
  }

  // Fixing missing data in validators response from older API versions
  private fixRawScoredValidatorsDto(validators: RawScoredValidatorDto[]): void {
    validators.forEach(v => {
      // eslint-disable-next-line no-param-reassign
      v.revShare = {
        ...v.revShare,
        activatingStakePmpe: v.revShare.activatingStakePmpe ?? 0,
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
    if (this.config.blacklistFilePath) {
      return fs.readFileSync(this.config.blacklistFilePath).toString()
    }
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
}
