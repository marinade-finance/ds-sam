import { DEFAULT_CONFIG } from '../src/config'
import { StaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder } from './helpers/validator-mock-builder'

// Build a SDK + a minimal raw payload for one validator with `totalStakeSol` external stake.
// Caller overrides `raw.rewards` to drive the cases under test.
const buildSdk = async (totalStakeSol = 1000) => {
  const dp = new StaticDataProviderBuilder()
    .withCurrentEpoch(1000)
    .withInflationRewardsPerEpoch(0)
    .withMevRewardsPerEpoch(0)
    .withBlockRewardsPerEpoch(0)
    .withValidators([
      new ValidatorMockBuilder('alice', 'id-a')
        .withEligibleDefaults()
        .withNativeStake(0)
        .withLiquidStake(0)
        .withExternalStake(totalStakeSol),
    ])
    .builder()(DEFAULT_CONFIG)
  const raw = await dp.fetchSourceData()
  raw.auctions = []
  return { dp, raw }
}

describe('ssiPmpe', () => {
  it('happy path: latest non-zero block + matching inflation', async () => {
    const { dp, raw } = await buildSdk()
    raw.rewards.rewards_inflation_est = [[999, 100]]
    raw.rewards.rewards_block = [[999, 50]]
    expect(dp.aggregateData(raw).ssiPmpe).toBeCloseTo(150, 9)
  })

  it('block leads inflation: anchors on latest block, uses prior inflation', async () => {
    const { dp, raw } = await buildSdk()
    raw.rewards.rewards_inflation_est = [[998, 100]]
    raw.rewards.rewards_block = [[999, 50]]
    expect(dp.aggregateData(raw).ssiPmpe).toBeCloseTo(150, 9)
  })

  it('inflation leads block: ignores newer inflation, anchors on latest block', async () => {
    const { dp, raw } = await buildSdk()
    raw.rewards.rewards_inflation_est = [
      [998, 100],
      [999, 999], // newer than block — must be ignored
    ]
    raw.rewards.rewards_block = [[998, 50]]
    expect(dp.aggregateData(raw).ssiPmpe).toBeCloseTo(150, 9)
  })

  it('explicit zero is treated as missing (block)', async () => {
    const { dp, raw } = await buildSdk()
    raw.rewards.rewards_inflation_est = [
      [998, 100],
      [999, 100],
    ]
    raw.rewards.rewards_block = [
      [998, 50],
      [999, 0], // ETL artifact — ignore and fall back to 998
    ]
    expect(dp.aggregateData(raw).ssiPmpe).toBeCloseTo(150, 9)
  })

  it('returns null when no non-zero block entry exists', async () => {
    const { dp, raw } = await buildSdk()
    raw.rewards.rewards_inflation_est = [[999, 100]]
    raw.rewards.rewards_block = [[999, 0]]
    expect(dp.aggregateData(raw).ssiPmpe).toBeNull()
  })

  it('returns null when no inflation entry at-or-before the block epoch', async () => {
    const { dp, raw } = await buildSdk()
    raw.rewards.rewards_inflation_est = [[1001, 100]] // only ahead of block
    raw.rewards.rewards_block = [[999, 50]]
    expect(dp.aggregateData(raw).ssiPmpe).toBeNull()
  })

  it('returns null when stake is unknown for the picked epoch', async () => {
    const { dp, raw } = await buildSdk()
    raw.rewards.rewards_inflation_est = [[9999, 100]]
    raw.rewards.rewards_block = [[9999, 50]]
    expect(dp.aggregateData(raw).ssiPmpe).toBeNull()
  })
})
