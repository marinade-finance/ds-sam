import fs from 'fs'
import os from 'os'
import path from 'path'

import { DEFAULT_CONFIG, InputsSource } from '@marinade.finance/ds-sam-calc'
import axios, { AxiosError } from 'axios'

import { DsSamSDK } from '../src'
import { StaticDataProvider } from './helpers/static-data-provider'
import { findValidatorInResult } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'
import { DataProvider } from '../src/data-provider/data-provider'

import type {
  RawCurrentBlacklistDto,
  RawScoredValidatorDto,
  RawValidatorQualityDto,
} from '../src/data-provider/data-provider.dto'
import type { BlacklistRulesConfig, DsSamConfig } from '@marinade.finance/ds-sam-calc'
import type { AxiosResponse } from 'axios'

const CURRENT_EPOCH = 1000
const EVALUATED_EPOCH = CURRENT_EPOCH - 1
const LEGACY_ACCOUNT = '2'.repeat(32)
const EXEMPT_ACCOUNT = '3'.repeat(32)
const RULES: BlacklistRulesConfig = { maxNewListings: 10, sandwich: { ratePct: 4 } }

const qualityRow = (voteAccount: string, blocks: number, sandwiched: number): RawValidatorQualityDto => ({
  vote_account: voteAccount,
  blocks_produced: blocks,
  blocks_with_sandwiches: sandwiched,
  sandwich_rate_30d: Math.round((1000 * sandwiched) / blocks) / 10,
  wide_sandwich_rate_30d: null,
  slot_duration_median_ms: null,
})

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const background = Array.from({ length: 40 }, (_, i) =>
  qualityRow(`${'n'.repeat(31)}${BASE58[i] ?? ''}`, 5000, 38 + (i % 3)),
)

const currentBlacklist = (): RawCurrentBlacklistDto => ({
  rows: [{ vote_account: LEGACY_ACCOUNT, code: 'BLACKLIST_COMMISSION_RUG', source: 'legacy', auction_epoch: null }],
  exempt: [{ vote_account: EXEMPT_ACCOUNT, rule: 'all', until_epoch: null }],
})

class RulesDataProvider extends StaticDataProvider {
  constructor(
    config: DsSamConfig,
    builders: ValidatorMockBuilder[],
    private readonly current: RawCurrentBlacklistDto,
    private readonly quality: Map<number, RawValidatorQualityDto[]>,
    private readonly history: RawScoredValidatorDto[],
  ) {
    super(config, {
      validatorMockBuilders: builders,
      inflationRewardsPerEpoch: 200000,
      mevRewardsPerEpoch: 50000,
      blockRewardsPerEpoch: 0,
      currentEpoch: CURRENT_EPOCH,
    })
  }

  override fetchCurrentBlacklist(): Promise<RawCurrentBlacklistDto> {
    return Promise.resolve(this.current)
  }

  override fetchValidatorQuality(epoch: number): Promise<RawValidatorQualityDto[]> {
    return Promise.resolve(this.quality.get(epoch) ?? [])
  }

  override fetchAuctions(): Promise<RawScoredValidatorDto[]> {
    return Promise.resolve(this.history)
  }
}

const setup = () => {
  const votes = generateVoteAccounts('rules')
  const ids = generateIdentities()
  const sandwicher = new ValidatorMockBuilder('5'.repeat(32), ids.next().value)
    .withEligibleDefaults()
    .withBond({ stakeWanted: 0, cpmpe: 1, balance: 10 })
  const exempted = new ValidatorMockBuilder(EXEMPT_ACCOUNT, ids.next().value)
    .withEligibleDefaults()
    .withBond({ stakeWanted: 0, cpmpe: 1, balance: 10 })
  const honest = new ValidatorMockBuilder('6'.repeat(32), ids.next().value)
    .withEligibleDefaults()
    .withBond({ stakeWanted: 0, cpmpe: 1, balance: 10 })
  const ballast = new ValidatorMockBuilder(votes.next().value, ids.next().value).withExternalStake(2_000_000)
  const builders = [sandwicher, exempted, honest, ballast]
  const history = [sandwicher, exempted, honest].map(
    builder =>
      ({
        voteAccount: builder.voteAccount,
        epoch: CURRENT_EPOCH - 1,
        revShare: {},
        values: { samBlacklisted: false },
      }) as unknown as RawScoredValidatorDto,
  )
  const quality = new Map([
    [EVALUATED_EPOCH - 1, [...background]],
    [
      EVALUATED_EPOCH,
      [
        ...background,
        qualityRow(sandwicher.voteAccount, 5000, 400),
        qualityRow(EXEMPT_ACCOUNT, 5000, 400),
        qualityRow(honest.voteAccount, 5000, 39),
      ],
    ],
  ])
  return { sandwicher, exempted, honest, builders, history, quality }
}

const sdkFor = (
  config: Partial<DsSamConfig>,
  { builders, history, quality }: ReturnType<typeof setup>,
  current = currentBlacklist(),
) =>
  new DsSamSDK({ blacklistRules: RULES, ...config }, c => new RulesDataProvider(c, builders, current, quality, history))

describe('blacklist decided in the auction', () => {
  it('lists and charges a significant sandwicher in the same run', async () => {
    const fixture = setup()
    const result = await sdkFor({}, fixture).run()

    const sandwicher = findValidatorInResult(fixture.sandwicher.voteAccount, result)
    expect(sandwicher?.values.samBlacklisted).toBe(true)
    expect(sandwicher?.samIneligibilityGate).toBe('blacklist')
    expect(sandwicher?.lastSamBlacklisted).toBe(false)
    expect(sandwicher?.revShare.blacklistPenaltyPmpe).toBeGreaterThan(0)

    expect(findValidatorInResult(fixture.exempted.voteAccount, result)?.values.samBlacklisted).toBe(false)
    expect(findValidatorInResult(fixture.honest.voteAccount, result)?.values.samBlacklisted).toBe(false)
    expect(result.auctionData.blacklist).toEqual(new Set([LEGACY_ACCOUNT, fixture.sandwicher.voteAccount]))

    const decision = result.auctionData.blacklistDecision
    expect(decision?.auctionEpoch).toBe(CURRENT_EPOCH)
    expect(decision?.evaluatedEpoch).toBe(EVALUATED_EPOCH)
    expect(decision?.missingEpochs).toEqual([])
    expect(decision?.maxNewListings).toBe(RULES.maxNewListings)
    expect(decision?.added.map(hit => [hit.voteAccount, hit.code])).toEqual([
      [fixture.sandwicher.voteAccount, `MALICIOUS_SM_${EVALUATED_EPOCH}`],
    ])
    expect(decision?.held).toEqual([])
  })

  it('holds the hits back above maxNewListings and keeps the current list', async () => {
    const fixture = setup()
    const result = await sdkFor({ blacklistRules: { ...RULES, maxNewListings: 0 } }, fixture).run()

    expect(findValidatorInResult(fixture.sandwicher.voteAccount, result)?.values.samBlacklisted).toBe(false)
    expect(result.auctionData.blacklist).toEqual(new Set([LEGACY_ACCOUNT]))
    expect(result.auctionData.blacklistDecision?.maxNewListings).toBe(0)
    expect(result.auctionData.blacklistDecision?.held.map(hit => hit.voteAccount)).toEqual([
      fixture.sandwicher.voteAccount,
    ])
    expect(result.auctionData.blacklistDecision?.newAccounts).toEqual([fixture.sandwicher.voteAccount])
    expect(result.auctionData.blacklistDecision?.alreadyListed).toEqual([])
  })

  it('a held re-run keeps the listings of its earlier run', async () => {
    const fixture = setup()
    const own = '7'.repeat(32)
    const current = currentBlacklist()
    current.rows.push({
      vote_account: own,
      code: `MALICIOUS_SM_${EVALUATED_EPOCH}`,
      source: 'auction',
      auction_epoch: CURRENT_EPOCH,
    })
    const result = await sdkFor({ blacklistRules: { ...RULES, maxNewListings: 0 } }, fixture, current).run()

    const decision = result.auctionData.blacklistDecision
    expect(result.auctionData.blacklist).toEqual(new Set([LEGACY_ACCOUNT, own]))
    expect(decision?.carried.map(row => [row.voteAccount, row.code])).toEqual([
      [own, `MALICIOUS_SM_${EVALUATED_EPOCH}`],
    ])
    expect(decision?.added).toEqual([])
    expect(decision?.held.map(hit => hit.voteAccount)).toEqual([fixture.sandwicher.voteAccount])
  })

  it('names the epoch without data and adds nothing', async () => {
    const fixture = { ...setup(), quality: new Map<number, RawValidatorQualityDto[]>() }
    const result = await sdkFor({}, fixture).run()

    expect(result.auctionData.blacklistDecision?.missingEpochs).toEqual([EVALUATED_EPOCH - 1, EVALUATED_EPOCH])
    expect(result.auctionData.blacklistDecision?.added).toEqual([])
    expect(result.auctionData.blacklist).toEqual(new Set([LEGACY_ACCOUNT]))
  })

  it('lists a sandwicher of the epoch whose data came late, one auction later', async () => {
    const fixture = setup()
    const sandwicher = fixture.sandwicher.voteAccount
    const quality = new Map([
      [EVALUATED_EPOCH - 1, [...background, qualityRow(sandwicher, 5000, 400)]],
      [EVALUATED_EPOCH, [...background, qualityRow(sandwicher, 5000, 39)]],
    ])
    const result = await sdkFor({}, { ...fixture, quality }).run()

    const decision = result.auctionData.blacklistDecision
    expect(decision?.added.map(hit => [hit.voteAccount, hit.code])).toEqual([
      [sandwicher, `MALICIOUS_SM_${EVALUATED_EPOCH - 1}`],
    ])
    expect(decision?.missingEpochs).toEqual([])
    expect(findValidatorInResult(sandwicher, result)?.values.samBlacklisted).toBe(true)
    expect(result.auctionData.blacklist).toEqual(new Set([LEGACY_ACCOUNT, sandwicher]))
  })

  it('judges the earlier epoch when the newest has no data', async () => {
    const fixture = setup()
    const sandwicher = fixture.sandwicher.voteAccount
    const quality = new Map([[EVALUATED_EPOCH - 1, [...background, qualityRow(sandwicher, 5000, 400)]]])
    const result = await sdkFor({}, { ...fixture, quality }).run()

    const decision = result.auctionData.blacklistDecision
    expect(decision?.added.map(hit => [hit.voteAccount, hit.code])).toEqual([
      [sandwicher, `MALICIOUS_SM_${EVALUATED_EPOCH - 1}`],
    ])
    expect(decision?.missingEpochs).toEqual([EVALUATED_EPOCH])
  })

  it('replays cached inputs that lack the earlier epoch and names it', async () => {
    const fixture = setup()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-blacklist-'))
    const live = await sdkFor({ cacheInputs: true, inputsCacheDirPath: dir }, fixture).run()
    const file = path.join(dir, 'validator-quality.json')
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as { epochs: Record<string, unknown> }
    delete cached.epochs[String(EVALUATED_EPOCH - 1)]
    fs.writeFileSync(file, JSON.stringify(cached))

    const replay = await new DsSamSDK({
      ...DEFAULT_CONFIG,
      blacklistRules: RULES,
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: dir,
    }).run()
    expect(replay.auctionData.blacklist).toEqual(live.auctionData.blacklist)
    expect(replay.auctionData.blacklistDecision?.added).toEqual(live.auctionData.blacklistDecision?.added)
    expect(replay.auctionData.blacklistDecision?.missingEpochs).toEqual([EVALUATED_EPOCH - 1])
  })

  it('refuses to decide on an empty current list', async () => {
    const fixture = setup()
    await expect(sdkFor({}, fixture, { rows: [], exempt: [] }).run()).rejects.toThrow(
      'no rows; refusing to decide on an empty list',
    )
  })

  it('names the bad row without printing it', async () => {
    const fixture = setup()
    const current = currentBlacklist()
    current.rows.push({ vote_account: 'not a key', code: 'X', source: 'legacy', auction_epoch: null })
    await expect(sdkFor({}, fixture, current).run()).rejects.toThrow('row 1: vote account is not a base58 pubkey')
  })

  it('names a null row by its index', async () => {
    const fixture = setup()
    const current = currentBlacklist()
    current.rows.push(null as unknown as RawCurrentBlacklistDto['rows'][number])
    await expect(sdkFor({}, fixture, current).run()).rejects.toThrow('row 1: vote account is not a base58 pubkey')
  })

  it('names the bad quality row without printing it', async () => {
    const fixture = setup()
    const rows = fixture.quality.get(EVALUATED_EPOCH) ?? []
    rows.push({ ...qualityRow('4'.repeat(32), 100, 5), blocks_with_sandwiches: 101 })
    await expect(sdkFor({}, fixture).run()).rejects.toThrow(
      `Invalid validator quality of epoch ${EVALUATED_EPOCH}: row ${rows.length - 1}: more blocks with sandwiches`,
    )
  })

  it('caches the rules inputs and decides the same from the files', async () => {
    const fixture = setup()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-blacklist-'))
    const live = await sdkFor({ cacheInputs: true, inputsCacheDirPath: dir }, fixture).run()

    expect(fs.existsSync(path.join(dir, 'blacklist.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'validator-quality.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'blacklist.csv'))).toBe(false)
    const cached = JSON.parse(fs.readFileSync(path.join(dir, 'validator-quality.json'), 'utf8')) as {
      epochs: Record<string, unknown>
    }
    expect(Object.keys(cached.epochs)).toEqual([String(EVALUATED_EPOCH - 1), String(EVALUATED_EPOCH)])

    const replay = await new DsSamSDK({
      ...DEFAULT_CONFIG,
      blacklistRules: RULES,
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: dir,
    }).run()
    expect(replay.auctionData.blacklist).toEqual(live.auctionData.blacklist)
    expect(replay.auctionData.blacklistDecision).toEqual(live.auctionData.blacklistDecision)
  })

  it('replays identically from the cached inputs, twice', async () => {
    const fixture = setup()
    const honest = fixture.honest.voteAccount
    const history = [
      ...fixture.history.filter(entry => entry.voteAccount !== honest),
      { voteAccount: honest, epoch: CURRENT_EPOCH - 1, revShare: {}, values: { samBlacklisted: true } },
    ] as unknown as RawScoredValidatorDto[]
    const current = currentBlacklist()
    current.rows.push({
      vote_account: '7'.repeat(32),
      code: `MALICIOUS_SM_${EVALUATED_EPOCH}`,
      source: 'auction',
      auction_epoch: CURRENT_EPOCH,
    })
    const rules = { ...RULES, maxNewListings: 0 }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-blacklist-'))
    const live = await sdkFor(
      { blacklistRules: rules, cacheInputs: true, inputsCacheDirPath: dir },
      { ...fixture, history },
      current,
    ).run()
    const decision = live.auctionData.blacklistDecision
    expect(decision?.kept).toEqual([honest])
    expect(decision?.carried).toHaveLength(1)
    expect(decision?.held).toHaveLength(1)

    const replay = async () => {
      const result = await new DsSamSDK({
        ...DEFAULT_CONFIG,
        blacklistRules: rules,
        inputsSource: InputsSource.FILES,
        inputsCacheDirPath: dir,
      }).run()
      return {
        blacklist: [...result.auctionData.blacklist].sort(),
        blacklistDecision: result.auctionData.blacklistDecision,
        validators: result.auctionData.validators.map(v => [v.voteAccount, v.values.samBlacklisted]),
      }
    }
    const first = await replay()
    const second = await replay()
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.blacklistDecision).toEqual(decision)
  })

  it('names a missing cached input', async () => {
    const fixture = setup()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-blacklist-'))
    await sdkFor({ cacheInputs: true, inputsCacheDirPath: dir }, fixture).run()
    fs.rmSync(path.join(dir, 'validator-quality.json'))

    const replay = new DsSamSDK({
      blacklistRules: RULES,
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: dir,
    })
    await expect(replay.run()).rejects.toThrow(`Missing cached input ${dir}/validator-quality.json`)
  })

  it('fails on a quality route that answers 404 or no validators array', async () => {
    const provider = new DataProvider({ ...DEFAULT_CONFIG, blacklistRules: RULES }, InputsSource.APIS)
    const get = jest.spyOn(axios, 'get')
    try {
      get.mockRejectedValueOnce(
        new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, { status: 404 } as AxiosResponse),
      )
      await expect(provider.fetchValidatorQuality(EVALUATED_EPOCH)).rejects.toThrow('Not Found')
      get.mockResolvedValueOnce({ data: { epoch: EVALUATED_EPOCH } })
      await expect(provider.fetchValidatorQuality(EVALUATED_EPOCH)).rejects.toThrow('validators must be an array')
    } finally {
      get.mockRestore()
    }
  })

  describe('previous auction', () => {
    const historyEntry = (voteAccount: string, epoch: number, samBlacklisted: boolean) =>
      ({ voteAccount, epoch, revShare: {}, values: { samBlacklisted } }) as unknown as RawScoredValidatorDto

    it('keeps an account the previous auction blacklisted and the list no longer serves', async () => {
      const fixture = setup()
      const honest = fixture.honest.voteAccount
      const history = [
        ...fixture.history.filter(entry => entry.voteAccount !== honest),
        historyEntry(honest, CURRENT_EPOCH - 1, true),
      ]
      const result = await sdkFor({}, { ...fixture, history }).run()

      expect(result.auctionData.blacklist.has(honest)).toBe(true)
      expect(result.auctionData.blacklistDecision?.kept).toEqual([honest])
      const validator = findValidatorInResult(honest, result)
      expect(validator?.values.samBlacklisted).toBe(true)
      expect(validator?.revShare.blacklistPenaltyPmpe).toBe(0)
    })

    it('an exempt entry releases it', async () => {
      const fixture = setup()
      const honest = fixture.honest.voteAccount
      const history = [
        ...fixture.history.filter(entry => entry.voteAccount !== honest),
        historyEntry(honest, CURRENT_EPOCH - 1, true),
      ]
      const current = currentBlacklist()
      current.exempt.push({ vote_account: honest, rule: 'sandwich', until_epoch: null })
      const result = await sdkFor({}, { ...fixture, history }, current).run()

      expect(result.auctionData.blacklistDecision?.kept).toEqual([])
      expect(result.auctionData.blacklistDecision?.removed).toEqual([honest])
      expect(findValidatorInResult(honest, result)?.values.samBlacklisted).toBe(false)
    })

    it('an exempt entry with until epoch does not release it', async () => {
      const fixture = setup()
      const honest = fixture.honest.voteAccount
      const history = [
        ...fixture.history.filter(entry => entry.voteAccount !== honest),
        historyEntry(honest, CURRENT_EPOCH - 1, true),
      ]
      const current = currentBlacklist()
      current.exempt.push({ vote_account: honest, rule: 'sandwich', until_epoch: CURRENT_EPOCH })
      const result = await sdkFor({}, { ...fixture, history }, current).run()

      expect(result.auctionData.blacklistDecision?.kept).toEqual([honest])
      expect(result.auctionData.blacklistDecision?.removed).toEqual([])
      expect(findValidatorInResult(honest, result)?.values.samBlacklisted).toBe(true)
    })

    it('the newest history entry before the auction epoch decides', async () => {
      const fixture = setup()
      const honest = fixture.honest.voteAccount
      const history = [
        ...fixture.history,
        historyEntry(honest, CURRENT_EPOCH - 2, true),
        historyEntry(honest, CURRENT_EPOCH, true),
      ]
      const result = await sdkFor({}, { ...fixture, history }).run()

      expect(result.auctionData.blacklistDecision?.kept).toEqual([])
      expect(findValidatorInResult(honest, result)?.values.samBlacklisted).toBe(false)
    })

    it('no history keeps nothing', async () => {
      const fixture = setup()
      const result = await sdkFor({}, { ...fixture, history: [] }).run()

      expect(result.auctionData.blacklistDecision?.kept).toEqual([])
    })
  })

  it('refuses a local blacklist file when the rules decide', () => {
    expect(() => new DsSamSDK({ blacklistRules: RULES, blacklistFilePath: './b.csv' })).toThrow(
      '--blacklist-file is not read when blacklistRules decide the blacklist',
    )
  })
})
