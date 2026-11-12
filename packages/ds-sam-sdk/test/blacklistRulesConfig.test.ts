import { DsSamSDK } from '../src'

import type { BlacklistRulesConfig } from '@marinade.finance/ds-sam-calc'

const VALID: BlacklistRulesConfig = {
  maxNewListings: 10,
  sandwich: { ratePct: 4 },
  slowSlots: { medianMult: 1.1, consecutiveEpochs: 2 },
}

const sdk = (blacklistRules: BlacklistRulesConfig) => new DsSamSDK({ blacklistRules })

describe('blacklistRules config', () => {
  it('accepts a valid config, with or without rule sections', () => {
    expect(() => sdk(VALID)).not.toThrow()
    expect(() => sdk({ maxNewListings: 0 })).not.toThrow()
    expect(() => new DsSamSDK({})).not.toThrow()
  })

  it.each<[string, BlacklistRulesConfig]>([
    ['blacklistRules.maxNewListings', { ...VALID, maxNewListings: -1 }],
    ['blacklistRules.maxNewListings', { ...VALID, maxNewListings: 1.5 }],
    ['blacklistRules.sandwich.ratePct', { ...VALID, sandwich: { ratePct: 0 } }],
    ['blacklistRules.sandwich.ratePct', { ...VALID, sandwich: { ratePct: 101 } }],
    ['blacklistRules.sandwich.clusterMultiplier', { ...VALID, sandwich: { ratePct: 4, clusterMultiplier: 0.5 } }],
    ['blacklistRules.sandwich.minExcessPp', { ...VALID, sandwich: { ratePct: 4, minExcessPp: -1 } }],
    ['blacklistRules.sandwich.minBlocks', { ...VALID, sandwich: { ratePct: 4, minBlocks: -5 } }],
    ['blacklistRules.sandwich.significanceP', { ...VALID, sandwich: { ratePct: 4, significanceP: 0 } }],
    ['blacklistRules.sandwich.significanceP', { ...VALID, sandwich: { ratePct: 4, significanceP: 1 } }],
    ['blacklistRules.slowSlots.medianMult', { ...VALID, slowSlots: { medianMult: 1, consecutiveEpochs: 2 } }],
    ['blacklistRules.slowSlots.consecutiveEpochs', { ...VALID, slowSlots: { medianMult: 1.1, consecutiveEpochs: 0 } }],
  ])('refuses an out-of-range %s', (field, config) => {
    expect(() => sdk(config)).toThrow(`Invalid config: ${field} must be`)
  })

  it('bounds the slow-slots window by the epochs the validators fetch covers', () => {
    const rules = (consecutiveEpochs: number) => ({ ...VALID, slowSlots: { medianMult: 1.1, consecutiveEpochs } })
    const config = { validatorsUptimeEpochsCount: 3, rewardsEpochsCount: 7 }
    expect(() => new DsSamSDK({ ...config, blacklistRules: rules(7) })).not.toThrow()
    expect(() => new DsSamSDK({ ...config, blacklistRules: rules(8) })).toThrow(
      'Invalid config: blacklistRules.slowSlots.consecutiveEpochs must be <= 7',
    )
  })
})
