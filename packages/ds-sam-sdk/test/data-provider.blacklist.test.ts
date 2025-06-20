import { DEFAULT_CONFIG, InputsSource } from '../src/config'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder } from './helpers/validator-mock-builder'

async function runStaticAggregate(
  builders: ValidatorMockBuilder[],
  history: any[] = []
) {
  const dpFactory = defaultStaticDataProviderBuilder(builders)
  const dp = dpFactory({ ...DEFAULT_CONFIG, inputsSource: InputsSource.APIS })
  const raw = await dp.fetchSourceData()
  raw.auctions = history
  return dp.aggregateData(raw, null)
}

describe('StaticDataProvider → samBlacklisted / lastSamBlacklisted', () => {
  const baseBuilders = [
    new ValidatorMockBuilder('alice', 'id-a').withEligibleDefaults(),
    new ValidatorMockBuilder('bob',   'id-b').withEligibleDefaults(),
    new ValidatorMockBuilder('carol', 'id-c').withEligibleDefaults(),
  ]

  it('CSV only → samBlacklisted from builder.blacklisted()', async () => {
    const builders = [
      baseBuilders[0]!.blacklisted(),
      baseBuilders[1]!,
      baseBuilders[2]!.blacklisted(),
    ]
    const agg = await runStaticAggregate(builders)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: true,  lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'carol', samBlacklisted: true,  lastSamBlacklisted: false },
    ])
  })

  it('history only → lastSamBlacklisted from prior auctions', async () => {
    const builders = baseBuilders.map(b => b)
    const history = [
      { voteAccount: 'bob', values: { samBlacklisted: true } }
    ]
    const agg = await runStaticAggregate(builders, history)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: true  },
      { voteAccount: 'carol', samBlacklisted: false, lastSamBlacklisted: false },
    ])
  })

  it('disjoint CSV & history → each source honored', async () => {
    const builders = [
      baseBuilders[0]!.blacklisted(),
      baseBuilders[1]!,
      baseBuilders[2]!,
    ]
    const history = [
      { voteAccount: 'bob', values: { samBlacklisted: true } }
    ]
    const agg = await runStaticAggregate(builders, history)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: true,  lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: true  },
      { voteAccount: 'carol', samBlacklisted: false, lastSamBlacklisted: false },
    ])
  })

  it('overlap CSV & history → both flags true', async () => {
    const builders = [
      baseBuilders[0]!,
      baseBuilders[1]!,
      baseBuilders[2]!.blacklisted(),
    ]
    const history = [
      { voteAccount: 'carol', values: { samBlacklisted: true } }
    ]
    const agg = await runStaticAggregate(builders, history)
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
