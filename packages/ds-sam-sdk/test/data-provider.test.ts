import { DEFAULT_CONFIG } from '../src/config'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder } from './helpers/validator-mock-builder'

import type { SourceDataOverrides } from '../src/data-provider/data-provider.dto'

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
      const agg = await runStaticAggregate(validators, [], { minimalCommission: 0.4 }, {
        inflationCommissions: new Map<string, number>().set('validator', 80),
        mevCommissions: new Map<string, number>().set('validator', 90),
        blockRewardsCommissions: new Map<string, number>().set('validator', 100),
        cpmpes: new Map<string, number>(),
      }
      )
      expect(agg.validators[0]?.values.commissions).toEqual(
        {
          inflationCommissions: new Map<string, number>().set('validator', 80),
          mevCommissions: new Map<string, number>().set('validator', 90),
          blockRewardsCommissions: new Map<string, number>().set('validator', 100),
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
        // override for inflation in different units than block and mev
        inflationCommissionOverrideDec: 0.8,
        blockRewardsCommissionOverrideDec: 0.01,
        mevCommissionOverrideDec: 0.009,
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
