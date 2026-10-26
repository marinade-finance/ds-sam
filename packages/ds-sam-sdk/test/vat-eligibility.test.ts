import assert from 'node:assert'

import { DsSamSDK } from '../src'
import { computeSamEligibilityThresholds, samIneligibilityGate } from '../src/eligibility'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
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

const gatesFor = async (kinds: EpochKind[], vatEligible: (boolean | null | undefined)[]) => {
  const votes = generateVoteAccounts('vat')
  const ids = generateIdentities()
  const validators = vatEligible.map(eligible =>
    withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      kinds,
    ).withVatEligible(eligible),
  )
  const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
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
    expect(await gatesFor(repeat('alpenglow', 10), [false, true, null, undefined])).toEqual([
      'vatIneligible',
      null,
      null,
      null,
    ])
  })

  it('keeps a known vat_rejection_reason and drops an unknown one', async () => {
    const votes = generateVoteAccounts('vat-reason')
    const ids = generateIdentities()
    const reasons = ['below_cutoff', 'no_bls_key', 'future_reason', null, undefined]
    const validators = reasons.map(reason =>
      withEpochs(
        new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
        repeat('alpenglow', 10),
      )
        .withVatEligible(false)
        .withVatRejectionReason(reason),
    )
    const aggregatedData = await new DsSamSDK({}, defaultStaticDataProviderBuilder(validators)).getAggregatedData()
    expect(
      validators.map(
        builder => aggregatedData.validators.find(v => v.voteAccount === builder.voteAccount)?.vatRejectionReason,
      ),
    ).toEqual(['below_cutoff', 'no_bls_key', null, null, null])
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
    const result = await new DsSamSDK({}, defaultStaticDataProviderBuilder([refused, admitted])).run()

    assertValidatorIneligible(findValidatorInResult(refused.voteAccount, result))
    expect(findValidatorInResult(admitted.voteAccount, result)?.samEligible).toBe(true)
  })

  it('refuses a bondless VAT-ineligible validator for the backstop too', async () => {
    const votes = generateVoteAccounts('vat-bondless')
    const ids = generateIdentities()
    const bondless = (vatEligible: boolean) =>
      withEpochs(
        new ValidatorMockBuilder(votes.next().value, ids.next().value)
          .withEligibleDefaults()
          .withBond(null)
          .withInflationCommission(0)
          .withMevCommission(0),
        repeat('alpenglow', 10),
      ).withVatEligible(vatEligible)
    const refused = bondless(false)
    const admitted = bondless(true)
    const bonded = withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    )
    const result = await new DsSamSDK(
      { enableZeroCommissionBackstop: true },
      defaultStaticDataProviderBuilder([refused, admitted, bonded]),
    ).run()

    expect(findValidatorInResult(refused.voteAccount, result)?.backstopEligible).toBe(false)
    expect(findValidatorInResult(admitted.voteAccount, result)?.backstopEligible).toBe(true)
  })
})
