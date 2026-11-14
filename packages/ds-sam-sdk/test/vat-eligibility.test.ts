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

type VatVerdict = boolean | null | undefined

const buildersFor = (kinds: EpochKind[], closedEpochVatAdmitted: VatVerdict[]) => {
  const votes = generateVoteAccounts('vat')
  const ids = generateIdentities()
  return closedEpochVatAdmitted.map(admitted =>
    withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      kinds,
    ).withClosedEpochVatAdmitted(admitted),
  )
}

const gatesOf = async (validators: ValidatorMockBuilder[]) => {
  const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
  const aggregatedData = await dsSam.getAggregatedData()
  const thresholds = computeSamEligibilityThresholds(aggregatedData, dsSam.config)
  return validators.map(builder => {
    const validator = aggregatedData.validators.find(v => v.voteAccount === builder.voteAccount)
    assert(validator)
    return samIneligibilityGate(validator, aggregatedData.blacklist, thresholds, dsSam.config)
  })
}

const gatesFor = (kinds: EpochKind[], closedEpochVatAdmitted: VatVerdict[]) =>
  gatesOf(buildersFor(kinds, closedEpochVatAdmitted))

const repeat = (kind: EpochKind, count: number): EpochKind[] => Array.from({ length: count }, () => kind)

describe('VAT eligibility', () => {
  it('refuses only a validator whose newest closed epoch has vat_admitted false', async () => {
    expect(await gatesFor(repeat('alpenglow', 10), [false, true, null, undefined])).toEqual([
      'vatIneligible',
      null,
      null,
      null,
    ])
  })

  it('does not refuse on the running-epoch forecast', async () => {
    const [forecastRefused] = buildersFor(repeat('alpenglow', 10), [true])
    assert(forecastRefused)
    expect(await gatesOf([forecastRefused.withRunningEpochVatEligible(false)])).toEqual([null])
  })

  it('refuses a validator refused at the boundary and topped up since', async () => {
    const [toppedUp] = buildersFor(repeat('alpenglow', 10), [false])
    assert(toppedUp)
    expect(await gatesOf([toppedUp.withRunningEpochVatEligible(true)])).toEqual(['vatIneligible'])
  })

  it('ignores the verdict of an older epoch when the last epoch is not closed', async () => {
    const [stale] = buildersFor(repeat('alpenglow', 10), [false])
    assert(stale)
    expect(await gatesOf([stale.withLastEpochStillOpen()])).toEqual([null])
  })

  it('refuses in Tower epochs and in the migration epoch too', async () => {
    const towerOnly = repeat('tower', 10)
    const runningMigration: EpochKind[] = ['migration', ...repeat('tower', 9)]
    const afterMigration: EpochKind[] = ['alpenglow', 'migration', ...repeat('tower', 8)]
    for (const kinds of [towerOnly, runningMigration, afterMigration]) {
      expect(await gatesFor(kinds, [false, true])).toEqual(['vatIneligible', null])
    }
  })

  it('warns with the vote accounts whose closed-epoch verdict is unknown', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const [unknown, admitted] = buildersFor(repeat('alpenglow', 10), [null, true])
      const [unstaked] = buildersFor(repeat('alpenglow', 10), [null])
      assert(unknown && admitted && unstaked)
      unstaked.withNativeStake(0).withLiquidStake(0).withExternalStake(0)
      await gatesOf([unknown, admitted, unstaked])
      const vatWarnings = warn.mock.calls.map(([message]) => String(message)).filter(m => m.includes('VAT verdict'))
      expect(vatWarnings).toEqual([
        `No closed-epoch VAT verdict for 1 staked validator(s), not cut: ${unknown.voteAccount}`,
      ])

      warn.mockClear()
      await gatesOf(buildersFor(repeat('alpenglow', 10), [true, false]))
      expect(warn.mock.calls.filter(([message]) => String(message).includes('VAT verdict'))).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('gives a VAT-ineligible validator no SAM stake', async () => {
    const votes = generateVoteAccounts('vat-run')
    const ids = generateIdentities()
    const refused = withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    ).withClosedEpochVatAdmitted(false)
    const admitted = withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    ).withClosedEpochVatAdmitted(true)
    const result = await new DsSamSDK({}, defaultStaticDataProviderBuilder([refused, admitted])).run()

    assertValidatorIneligible(findValidatorInResult(refused.voteAccount, result))
    expect(findValidatorInResult(refused.voteAccount, result)?.samIneligibilityGate).toBe('vatIneligible')
    expect(findValidatorInResult(admitted.voteAccount, result)?.samEligible).toBe(true)
  })

  it('refuses a bondless VAT-ineligible validator for the backstop too', async () => {
    const votes = generateVoteAccounts('vat-bondless')
    const ids = generateIdentities()
    const bondless = (vatAdmitted: boolean) =>
      withEpochs(
        new ValidatorMockBuilder(votes.next().value, ids.next().value)
          .withEligibleDefaults()
          .withBond(null)
          .withInflationCommission(0)
          .withMevCommission(0),
        repeat('alpenglow', 10),
      ).withClosedEpochVatAdmitted(vatAdmitted)
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
