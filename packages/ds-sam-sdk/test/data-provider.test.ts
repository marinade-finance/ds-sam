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
    const alice = new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults()
    const winner1 = new ValidatorMockBuilder('winner1', 'id-w1').withEligibleDefaults()
    const dp = defaultStaticDataProviderBuilder([alice])(DEFAULT_CONFIG)
    const raw = await dp.fetchSourceData()

    // winningTotalPmpe is the minimum totalPmpe among validators with stake, not the last by bondObligationPmpe order
    raw.auctions = [
      winner1.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 100,
        totalPmpe: 8,
        bondObligationPmpe: 7,
        onchainDistributedPmpe: 2,
      }),
      alice.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 100,
        totalPmpe: 10,
        bondObligationPmpe: 3,
        onchainDistributedPmpe: 3,
      }),
    ]

    const agg = dp.aggregateData(raw)
    const epoch700 = agg.validators.find(v => v.voteAccount === 'alice')?.auctions.find(a => a.epoch === 700)
    expect(epoch700?.winningTotalPmpe).toBe(8)
    expect(epoch700?.effParticipatingBidPmpe).toBe(5) // max(0, 8 - onchainDistributed=3)
  })

  it('zero-target/zero-stake entry does not influence winningTotalPmpe', async () => {
    const alice = new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults()
    const winner1 = new ValidatorMockBuilder('winner1', 'id-w1').withEligibleDefaults()
    const zero = new ValidatorMockBuilder('zero', 'id-z').withEligibleDefaults()
    const dp = defaultStaticDataProviderBuilder([alice])(DEFAULT_CONFIG)
    const raw = await dp.fetchSourceData()

    raw.auctions = [
      winner1.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 100,
        totalPmpe: 8,
        bondObligationPmpe: 7,
        onchainDistributedPmpe: 2,
      }),
      zero.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 0,
        totalPmpe: 3,
        bondObligationPmpe: 1,
        onchainDistributedPmpe: 1,
      }),
    ]

    const agg = dp.aggregateData(raw)
    const epoch700 = agg.validators.find(v => v.voteAccount === 'alice')?.auctions.find(a => a.epoch === 700)
    // zero-target entry (totalPmpe=3) must not lower the threshold below winner1's 8
    expect(epoch700?.winningTotalPmpe).toBe(8)
  })

  it('single winner: winningTotalPmpe equals that validator totalPmpe', async () => {
    const alice = new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults()
    const dp = defaultStaticDataProviderBuilder([alice])(DEFAULT_CONFIG)
    const raw = await dp.fetchSourceData()

    raw.auctions = [
      alice.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 100,
        totalPmpe: 12,
        bondObligationPmpe: 5,
        onchainDistributedPmpe: 4,
      }),
    ]

    const agg = dp.aggregateData(raw)
    const epoch700 = agg.validators.find(v => v.voteAccount === 'alice')?.auctions.find(a => a.epoch === 700)
    expect(epoch700?.winningTotalPmpe).toBe(12)
  })

  it('all-zero-target epoch: winningTotalPmpe is Infinity', async () => {
    const alice = new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults()
    const other = new ValidatorMockBuilder('other', 'id-o').withEligibleDefaults()
    const dp = defaultStaticDataProviderBuilder([alice])(DEFAULT_CONFIG)
    const raw = await dp.fetchSourceData()

    raw.auctions = [
      alice.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 0,
        totalPmpe: 5,
        bondObligationPmpe: 3,
        onchainDistributedPmpe: 1,
      }),
      other.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 0,
        totalPmpe: 9,
        bondObligationPmpe: 6,
        onchainDistributedPmpe: 2,
      }),
    ]

    const agg = dp.aggregateData(raw)
    const epoch700 = agg.validators.find(v => v.voteAccount === 'alice')?.auctions.find(a => a.epoch === 700)
    expect(epoch700?.winningTotalPmpe).toBe(Infinity)
  })

  it('effParticipatingBidPmpe clamps to 0 when onchainDistributed exceeds winningTotalPmpe', async () => {
    const alice = new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults()
    const dp = defaultStaticDataProviderBuilder([alice])(DEFAULT_CONFIG)
    const raw = await dp.fetchSourceData()

    raw.auctions = [
      alice.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 100,
        totalPmpe: 5,
        bondObligationPmpe: 3,
        onchainDistributedPmpe: 8,
      }),
    ]

    const agg = dp.aggregateData(raw)
    const epoch700 = agg.validators.find(v => v.voteAccount === 'alice')?.auctions.find(a => a.epoch === 700)
    expect(epoch700?.effParticipatingBidPmpe).toBe(0)
  })

  it('multi-epoch entries are grouped and sorted descending', async () => {
    const alice = new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults()
    const dp = defaultStaticDataProviderBuilder([alice])(DEFAULT_CONFIG)
    const raw = await dp.fetchSourceData()

    raw.auctions = [
      alice.toRawAuctionEntryDto({
        epoch: 699,
        marinadeSamTargetSol: 100,
        totalPmpe: 7,
        bondObligationPmpe: 4,
        onchainDistributedPmpe: 2,
      }),
      alice.toRawAuctionEntryDto({
        epoch: 700,
        marinadeSamTargetSol: 100,
        totalPmpe: 12,
        bondObligationPmpe: 5,
        onchainDistributedPmpe: 3,
      }),
    ]

    const agg = dp.aggregateData(raw)
    const aliceAuctions = agg.validators.find(v => v.voteAccount === 'alice')?.auctions ?? []

    expect(aliceAuctions.length).toBe(2)
    expect(aliceAuctions[0]?.epoch).toBe(700)
    expect(aliceAuctions[0]?.winningTotalPmpe).toBe(12)
    expect(aliceAuctions[1]?.epoch).toBe(699)
    expect(aliceAuctions[1]?.winningTotalPmpe).toBe(7)
  })
})
