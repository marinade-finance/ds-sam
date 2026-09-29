import assert from 'node:assert'

import { DsSamSDK } from '../src'
import {
  computeSamEligibilityThresholds,
  isBackstopEligible,
  samIneligibilityGate,
  samPmpeThreshold,
} from '../src/eligibility'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

describe('samIneligibilityGate', () => {
  it('returns each gate name for the eligibility.test.ts fixtures', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()

    const blacklistedVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .blacklisted()
    const wrongVersionVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withVersion('1.16.0')
    const badUptimeVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withBadPerformance()
    const noBondVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withBond(null)
    const eligibleVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withBond({ stakeWanted: 0, cpmpe: 1, balance: 10 })

    const validators = [blacklistedVal, wrongVersionVal, badUptimeVal, noBondVal, eligibleVal]
    const dsSam = new DsSamSDK(
      { validatorsClientVersionSemverExpr: '>=1.17.0' },
      defaultStaticDataProviderBuilder(validators),
    )
    const aggregatedData = await dsSam.getAggregatedData()
    const thresholds = computeSamEligibilityThresholds(aggregatedData, dsSam.config)
    const findAggregated = (voteAccount: string) => {
      const validator = aggregatedData.validators.find(v => v.voteAccount === voteAccount)
      assert(validator)
      return validator
    }
    const gateFor = (voteAccount: string) =>
      samIneligibilityGate(findAggregated(voteAccount), aggregatedData.blacklist, thresholds, dsSam.config)

    expect(gateFor(blacklistedVal.voteAccount)).toBe('blacklist')
    expect(gateFor(wrongVersionVal.voteAccount)).toBe('clientVersion')
    expect(gateFor(badUptimeVal.voteAccount)).toBe('uptime')
    expect(gateFor(noBondVal.voteAccount)).toBe('noBond')
    expect(gateFor(eligibleVal.voteAccount)).toBeNull()
  })

  it('a validator ineligible only by PMPE returns null with totalPmpe below samPmpeThreshold', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()

    const commissionTooHighVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withMevCommission(100)
      .withInflationCommission(8)

    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder([commissionTooHighVal]))
    const aggregatedData = await dsSam.getAggregatedData()
    const thresholds = computeSamEligibilityThresholds(aggregatedData, dsSam.config)
    const validator = aggregatedData.validators.find(v => v.voteAccount === commissionTooHighVal.voteAccount)
    assert(validator)
    const transformed = dsSam
      .transformValidators(aggregatedData)
      .find(v => v.voteAccount === commissionTooHighVal.voteAccount)
    assert(transformed)

    expect(samIneligibilityGate(validator, aggregatedData.blacklist, thresholds, dsSam.config)).toBeNull()
    expect(transformed.revShare.totalPmpe).toBeLessThan(samPmpeThreshold(thresholds))
  })
})

describe('isBackstopEligible', () => {
  const config = { enableZeroCommissionBackstop: true }

  it('true when revShare matches or exceeds the zero-commission rewards', () => {
    const rewards = { inflationPmpe: 0.4, mevPmpe: 0.05 }
    const revShare = { inflationPmpe: 0.4, mevPmpe: 0.05 }
    expect(isBackstopEligible(revShare, rewards, config)).toBe(true)
  })

  it('false when revShare falls short of the zero-commission rewards', () => {
    const rewards = { inflationPmpe: 0.4, mevPmpe: 0.05 }
    const revShare = { inflationPmpe: 0.3, mevPmpe: 0.05 }
    expect(isBackstopEligible(revShare, rewards, config)).toBe(false)
  })

  it('false when the config disables the backstop, even if revShare would qualify', () => {
    const rewards = { inflationPmpe: 0.4, mevPmpe: 0.05 }
    const revShare = { inflationPmpe: 0.4, mevPmpe: 0.05 }
    expect(isBackstopEligible(revShare, rewards, { enableZeroCommissionBackstop: false })).toBe(false)
  })
})

describe('samPmpeThreshold', () => {
  it('is the max of the two thresholds', () => {
    expect(samPmpeThreshold({ minEffectiveRevSharePmpe: 0.3, minSamRevSharePmpe: 0.5 })).toBe(0.5)
    expect(samPmpeThreshold({ minEffectiveRevSharePmpe: 0.6, minSamRevSharePmpe: 0.5 })).toBe(0.6)
  })
})
