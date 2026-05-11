import { DEFAULT_CONFIG } from '../src/config'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder } from './helpers/validator-mock-builder'

import type { SourceDataOverrides, RawScoredValidatorDto } from '../src/data-provider/data-provider.dto'

type HistoryEntry = { voteAccount: string; values: { samBlacklisted: boolean } }

async function runStaticAggregate(
  validators: ValidatorMockBuilder[],
  history: HistoryEntry[] = [],
  config: Partial<typeof DEFAULT_CONFIG> = {},
  dataOverrides?: SourceDataOverrides,
) {
  const dp = defaultStaticDataProviderBuilder(validators)({
    ...DEFAULT_CONFIG,
    ...config,
  })
  const raw = await dp.fetchSourceData()
  raw.auctions = history.map(entry => ({
    ...entry,
    revShare: {},
    epoch: 700,
  })) as unknown as typeof raw.auctions
  return dp.aggregateData(raw, dataOverrides)
}

describe('Data Provider Testing Setup', () => {
  describe('StaticDataProvider → samBlacklisted / lastSamBlacklisted', () => {
    it('CSV only → samBlacklisted from builder.blacklisted()', async () => {
      const validators = [
        new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults().blacklisted(),
        new ValidatorMockBuilder('bob', 'id-b').withEligibleDefaults(),
        new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults().blacklisted(),
      ]
      const agg = await runStaticAggregate(validators)
      const flags = agg.validators.map(v => ({
        voteAccount: v.voteAccount,
        samBlacklisted: v.values.samBlacklisted,
        lastSamBlacklisted: v.lastSamBlacklisted,
      }))
      expect(flags).toEqual([
        {
          voteAccount: 'alice',
          samBlacklisted: true,
          lastSamBlacklisted: null,
        },
        { voteAccount: 'bob', samBlacklisted: false, lastSamBlacklisted: null },
        {
          voteAccount: 'carol',
          samBlacklisted: true,
          lastSamBlacklisted: null,
        },
      ])
    })

    it('history only → lastSamBlacklisted from prior auctions', async () => {
      const validators = [
        new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults(),
        new ValidatorMockBuilder('bob', 'id-b').withEligibleDefaults(),
        new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults(),
      ]
      const history = [
        { voteAccount: 'bob', values: { samBlacklisted: true } },
        { voteAccount: 'alice', values: { samBlacklisted: false } },
      ]
      const agg = await runStaticAggregate(validators, history)
      const flags = agg.validators.map(v => ({
        voteAccount: v.voteAccount,
        samBlacklisted: v.values.samBlacklisted,
        lastSamBlacklisted: v.lastSamBlacklisted,
      }))
      expect(flags).toEqual([
        {
          voteAccount: 'alice',
          samBlacklisted: false,
          lastSamBlacklisted: false,
        },
        { voteAccount: 'bob', samBlacklisted: false, lastSamBlacklisted: true },
        {
          voteAccount: 'carol',
          samBlacklisted: false,
          lastSamBlacklisted: null,
        },
      ])
    })

    it('disjoint CSV & history → each source honored', async () => {
      const validators = [
        new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults().blacklisted(),
        new ValidatorMockBuilder('bob', 'id-b').withEligibleDefaults(),
        new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults(),
      ]
      const history = [
        { voteAccount: 'bob', values: { samBlacklisted: true } },
        { voteAccount: 'alice', values: { samBlacklisted: false } },
      ]
      const agg = await runStaticAggregate(validators, history)
      const flags = agg.validators.map(v => ({
        voteAccount: v.voteAccount,
        samBlacklisted: v.values.samBlacklisted,
        lastSamBlacklisted: v.lastSamBlacklisted,
      }))
      expect(flags).toEqual([
        {
          voteAccount: 'alice',
          samBlacklisted: true,
          lastSamBlacklisted: false,
        },
        { voteAccount: 'bob', samBlacklisted: false, lastSamBlacklisted: true },
        {
          voteAccount: 'carol',
          samBlacklisted: false,
          lastSamBlacklisted: null,
        },
      ])
    })

    it('overlap CSV & history → both flags true', async () => {
      const validators = [
        new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults(),
        new ValidatorMockBuilder('bob', 'id-b').withEligibleDefaults(),
        new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults().blacklisted(),
      ]
      const history = [
        { voteAccount: 'carol', values: { samBlacklisted: true } },
        { voteAccount: 'alice', values: { samBlacklisted: false } },
        { voteAccount: 'bob', values: { samBlacklisted: false } },
      ]
      const agg = await runStaticAggregate(validators, history)
      const flags = agg.validators.map(v => ({
        voteAccount: v.voteAccount,
        samBlacklisted: v.values.samBlacklisted,
        lastSamBlacklisted: v.lastSamBlacklisted,
      }))
      expect(flags).toEqual([
        {
          voteAccount: 'alice',
          samBlacklisted: false,
          lastSamBlacklisted: false,
        },
        {
          voteAccount: 'bob',
          samBlacklisted: false,
          lastSamBlacklisted: false,
        },
        {
          voteAccount: 'carol',
          samBlacklisted: true,
          lastSamBlacklisted: true,
        },
      ])
    })
  })

  describe('Commissions Processing', () => {
    it('all commissions', async () => {
      const validators = [
        new ValidatorMockBuilder('validator', 'id')
          .withEligibleDefaults()
          .withInflationCommission(10)
          .withMevCommission(20)
          .withBond({
            stakeWanted: 0,
            cpmpe: 0,
            balance: 0,
            bondInflationCommission: 30,
            bondMevCommission: 40,
            bondBlockCommission: -30,
          }),
      ]
      const agg = await runStaticAggregate(validators, [], {
        minimalCommission: -0.2,
      })
      expect(agg.validators[0]?.values.commissions).toEqual({
        inflationCommissionDec: 0.1,
        mevCommissionDec: 0.2,
        blockRewardsCommissionDec: -0.2,
        inflationCommissionOnchainDec: 0.1,
        inflationCommissionInBondDec: 0.3,
        mevCommissionOnchainDec: 0.2,
        mevCommissionInBondDec: 0.4,
        blockRewardsCommissionInBondDec: -0.3,
        minimalCommissionDec: -0.2,
        bidCpmpeInBondDec: 0,
      })
    })

    it('data overrides', async () => {
      const validators = [
        new ValidatorMockBuilder('validator', 'id')
          .withEligibleDefaults()
          .withInflationCommission(10)
          .withMevCommission(20)
          .withBond({
            stakeWanted: 0,
            cpmpe: 0,
            balance: 0,
            bondInflationCommission: 30,
            bondMevCommission: 40,
            bondBlockCommission: 50,
          }),
      ]
      const agg = await runStaticAggregate(
        validators,
        [],
        { minimalCommission: 0.4 },
        {
          inflationCommissionsDec: new Map<string, number>().set('validator', 0.8),
          mevCommissionsDec: new Map<string, number>().set('validator', 0.009),
          blockRewardsCommissionsDec: new Map<string, number>().set('validator', 0.01),
          cpmpesDec: new Map<string, number>().set('validator', 50),
        },
      )
      expect(agg.validators[0]?.values.commissions).toEqual({
        inflationCommissionDec: 0.8, // override applied
        mevCommissionDec: 0.4, // override not applied as above minimal
        blockRewardsCommissionDec: 0.4, // override not applied as above minimal
        inflationCommissionOnchainDec: 0.1,
        inflationCommissionInBondDec: 0.3,
        mevCommissionOnchainDec: 0.2,
        mevCommissionInBondDec: 0.4,
        blockRewardsCommissionInBondDec: 0.5,
        minimalCommissionDec: 0.4,
        inflationCommissionOverrideDec: 0.8,
        blockRewardsCommissionOverrideDec: 0.01,
        mevCommissionOverrideDec: 0.009,
        bidCpmpeOverrideDec: 50,
        bidCpmpeInBondDec: 0,
      })
    })

    it('commissions rewritten correctly', async () => {
      const validators = [
        new ValidatorMockBuilder('first', 'id-1')
          .withEligibleDefaults()
          .withInflationCommission(10)
          .withMevCommission(10)
          .withBond({
            stakeWanted: 100_000,
            cpmpe: 0,
            balance: 500,
            bondInflationCommission: 5,
            bondMevCommission: 15,
            bondBlockCommission: 25,
          }),
        new ValidatorMockBuilder('second', 'id-2').withEligibleDefaults().withInflationCommission(20).withBond({
          stakeWanted: 200_000,
          cpmpe: 0,
          balance: 800,
          bondInflationCommission: null,
          bondMevCommission: -500,
          bondBlockCommission: -100,
        }),
      ]
      const agg = await runStaticAggregate(validators, [], {
        minimalCommission: -2.0,
      })
      const commissions = agg.validators.map(v => ({
        voteAccount: v.voteAccount,
        inflation: v.values.commissions.inflationCommissionDec,
        mev: v.values.commissions.mevCommissionDec,
        block: v.values.commissions.blockRewardsCommissionDec,
        minimal: v.values.commissions.minimalCommissionDec,
      }))
      expect(commissions).toEqual([
        { voteAccount: 'first', inflation: 0.05, mev: 0.1, block: 0.25 },
        {
          voteAccount: 'second',
          inflation: 0.2,
          mev: -2.0,
          block: -1.0,
          minimal: -2.0,
        },
      ])
    })
  })
})

describe('processAuctions', () => {
  it('winningTotalPmpe is min totalPmpe among winners, not sorted by bondObligationPmpe', async () => {
    const validators = [new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults()]
    const dp = defaultStaticDataProviderBuilder(validators)(DEFAULT_CONFIG)
    const raw = await dp.fetchSourceData()

    // alice: lower bondObligationPmpe but higher totalPmpe than winner1
    // old code sorted by bondObl desc → alice was last → picked alice.totalPmpe=10 as threshold
    // correct threshold is min(8, 10) = 8
    raw.auctions = [
      {
        voteAccount: 'winner1',
        epoch: 700,
        marinadeSamTargetSol: 100,
        revShare: {
          totalPmpe: 8,
          bondObligationPmpe: 7,
          onchainDistributedPmpe: 2,
          bidPmpe: 0,
          inflationPmpe: 0,
          mevPmpe: 0,
          blockPmpe: 0,
          auctionEffectiveBidPmpe: 0,
          activatingStakePmpe: 0,
          calcEffParticipatingBidPmpe: 0,
        },
      },
      {
        voteAccount: 'alice',
        epoch: 700,
        marinadeSamTargetSol: 100,
        revShare: {
          totalPmpe: 10,
          bondObligationPmpe: 3,
          onchainDistributedPmpe: 3,
          bidPmpe: 0,
          inflationPmpe: 0,
          mevPmpe: 0,
          blockPmpe: 0,
          auctionEffectiveBidPmpe: 0,
          activatingStakePmpe: 0,
          calcEffParticipatingBidPmpe: 0,
        },
      },
    ] as RawScoredValidatorDto[]

    const agg = dp.aggregateData(raw)
    const alice = agg.validators.find(v => v.voteAccount === 'alice')
    const epoch700 = alice?.auctions[0]
    expect(epoch700?.winningTotalPmpe).toBe(8)
    expect(epoch700?.effParticipatingBidPmpe).toBeCloseTo(8 - 3) // max(0, 8 - onchainDistributed=3)
  })
})
