import { DEFAULT_CONFIG, InputsSource } from '../src/config'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder } from './helpers/validator-mock-builder'

async function runStaticAggregate(
  validators: ValidatorMockBuilder[],
  history: any[] = []
) {
  const dp = defaultStaticDataProviderBuilder(validators)({ ...DEFAULT_CONFIG })
  const raw = await dp.fetchSourceData()
  raw.auctions = history.map(entry => ({ ...entry, revShare: {}, epoch: 700 }))
  return dp.aggregateData(raw)
}

describe('StaticDataProvider → samBlacklisted / lastSamBlacklisted', () => {

  it('CSV only → samBlacklisted from builder.blacklisted()', async () => {
    const validators = [
      new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults().blacklisted(),
      new ValidatorMockBuilder('bob',   'id-b').withEligibleDefaults(),
      new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults().blacklisted(),
    ]
    const agg = await runStaticAggregate(validators)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: true,  lastSamBlacklisted: null },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: null },
      { voteAccount: 'carol', samBlacklisted: true,  lastSamBlacklisted: null },
    ])
  })

  it('history only → lastSamBlacklisted from prior auctions', async () => {
    const validators = [
      new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults(),
      new ValidatorMockBuilder('bob',   'id-b').withEligibleDefaults(),
      new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults(),
    ]
    const history = [
      { voteAccount: 'bob', values: { samBlacklisted: true } },
      { voteAccount: 'alice', values: { samBlacklisted: false } }
    ]
    const agg = await runStaticAggregate(validators, history)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: true  },
      { voteAccount: 'carol', samBlacklisted: false, lastSamBlacklisted: null },
    ])
  })

  it('disjoint CSV & history → each source honored', async () => {
    const validators = [
      new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults().blacklisted(),
      new ValidatorMockBuilder('bob',   'id-b').withEligibleDefaults(),
      new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults(),
    ]
    const history = [
      { voteAccount: 'bob', values: { samBlacklisted: true } },
      { voteAccount: 'alice', values: { samBlacklisted: false } }
    ]
    const agg = await runStaticAggregate(validators, history)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: true,  lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: true  },
      { voteAccount: 'carol', samBlacklisted: false, lastSamBlacklisted: null },
    ])
  })

  it('overlap CSV & history → both flags true', async () => {
    const validators = [
      new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults(),
      new ValidatorMockBuilder('bob',   'id-b').withEligibleDefaults(),
      new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults().blacklisted(),
    ]
    const history = [
      { voteAccount: 'carol', values: { samBlacklisted: true } },
      { voteAccount: 'alice', values: { samBlacklisted: false } },
      { voteAccount: 'bob', values: { samBlacklisted: false } },
    ]
    const agg = await runStaticAggregate(validators, history)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'carol', samBlacklisted: true,  lastSamBlacklisted: true  },
    ])
  })
})
