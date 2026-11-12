import { DEFAULT_SANDWICH_PARAMS } from './sandwich'

import type { SandwichParams } from './sandwich'
import type { BlacklistRulesConfig } from '../config'

export const sandwichParams = (config: NonNullable<BlacklistRulesConfig['sandwich']>): SandwichParams => ({
  ...DEFAULT_SANDWICH_PARAMS,
  ...config,
})

const check = (valid: boolean, field: string, rule: string, value: unknown) => {
  if (!valid) {
    throw new Error(`Invalid config: blacklistRules.${field} must be ${rule}, got ${String(value)}`)
  }
}

const isInteger = (value: number) => Number.isInteger(value) && value >= 0

export const validateBlacklistRulesConfig = (config: BlacklistRulesConfig) => {
  check(isInteger(config.maxNewListings), 'maxNewListings', 'a non-negative integer', config.maxNewListings)
  if (config.sandwich) {
    const params = sandwichParams(config.sandwich)
    check(params.ratePct > 0 && params.ratePct <= 100, 'sandwich.ratePct', 'in (0, 100]', params.ratePct)
    check(params.clusterMultiplier >= 1, 'sandwich.clusterMultiplier', '>= 1', params.clusterMultiplier)
    check(params.minExcessPp >= 0, 'sandwich.minExcessPp', '>= 0', params.minExcessPp)
    check(isInteger(params.minBlocks), 'sandwich.minBlocks', 'a non-negative integer', params.minBlocks)
    check(
      params.significanceP > 0 && params.significanceP < 1,
      'sandwich.significanceP',
      'in (0, 1)',
      params.significanceP,
    )
  }
  if (config.slowSlots) {
    const { medianMult, consecutiveEpochs } = config.slowSlots
    check(medianMult > 1, 'slowSlots.medianMult', '> 1', medianMult)
    check(
      isInteger(consecutiveEpochs) && consecutiveEpochs >= 1,
      'slowSlots.consecutiveEpochs',
      'an integer >= 1',
      consecutiveEpochs,
    )
  }
}
