import assert from 'node:assert'

import { DsSamSDK } from '../src'
import { computeSamEligibilityThresholds, samIneligibilityGate } from '../src/eligibility'
import { StaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { assertValidatorIneligible, findValidatorInResult } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

type EpochKind = 'tower' | 'migration' | 'alpenglow'

const STAKE = 350_000

// Index 0 is the running epoch
const withEpochs = (builder: ValidatorMockBuilder, kinds: EpochKind[]) =>
  builder
    .withCredits(...kinds.map(kind => (kind === 'alpenglow' ? null : 432_000)))
    .withVoteRewards(...kinds.map(kind => (kind === 'tower' ? null : STAKE)))
    .withLeaderSlots(STAKE / 10_000)

const gatesFor = async (kinds: EpochKind[], vatEligible: (boolean | null)[]) => {
  const votes = generateVoteAccounts('vat')
  const ids = generateIdentities()
  const validators = vatEligible.map(eligible =>
    withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      kinds,
    ).withVatEligible(eligible),
  )
  const dataProvider = new StaticDataProviderBuilder()
    .withCurrentEpoch(1000)
    .withInflationRewardsPerEpoch(200000)
    .withMevRewardsPerEpoch(50000)
    .withBlockRewardsPerEpoch(0)
    .withValidators(validators)
    .build()
  const dsSam = new DsSamSDK({}, dataProvider)
  const aggregatedData = await dsSam.getAggregatedData()
  const thresholds = computeSamEligibilityThresholds(aggregatedData, dsSam.config)
  return validators.map(builder => {
    const validator = aggregatedData.validators.find(v => v.voteAccount === builder.voteAccount)
    assert(validator)
    return samIneligibilityGate(validator, aggregatedData.blacklist, thresholds, dsSam.config)
  })
}

const repeat = (kind: EpochKind, count: number): EpochKind[] => Array.from({ length: count }, () => kind)

describe('VAT eligibility', () => {
  it('refuses only a validator with vat_eligible false', async () => {
    expect(await gatesFor(repeat('alpenglow', 10), [false, true, null])).toEqual(['vatIneligible', null, null])
  })

  it('refuses in Tower epochs and in the migration epoch too', async () => {
    const towerOnly = repeat('tower', 10)
    const runningMigration: EpochKind[] = ['migration', ...repeat('tower', 9)]
    const afterMigration: EpochKind[] = ['alpenglow', 'migration', ...repeat('tower', 8)]
    for (const kinds of [towerOnly, runningMigration, afterMigration]) {
      expect(await gatesFor(kinds, [false, true])).toEqual(['vatIneligible', null])
    }
  })

  it('gives a VAT-ineligible validator no SAM stake', async () => {
    const votes = generateVoteAccounts('vat-run')
    const ids = generateIdentities()
    const refused = withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    ).withVatEligible(false)
    const admitted = withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    ).withVatEligible(true)
    const dataProvider = new StaticDataProviderBuilder()
      .withCurrentEpoch(1000)
      .withInflationRewardsPerEpoch(200000)
      .withMevRewardsPerEpoch(50000)
      .withBlockRewardsPerEpoch(0)
      .withValidators([refused, admitted])
      .build()
    const result = await new DsSamSDK({}, dataProvider).run()

    assertValidatorIneligible(findValidatorInResult(refused.voteAccount, result))
    expect(findValidatorInResult(admitted.voteAccount, result)?.samEligible).toBe(true)
  })
})
