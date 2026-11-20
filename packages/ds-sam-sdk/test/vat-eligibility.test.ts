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

const gatesFor = (kinds: EpochKind[], vatEligible: (VatVerdict | [VatVerdict, VatVerdict])[]) => {
  const votes = generateVoteAccounts('vat')
  const ids = generateIdentities()
  return gatesOf(
    vatEligible.map(eligible =>
      withEpochs(new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(), kinds)
        .withVatEligible(Array.isArray(eligible) ? eligible[0] : eligible)
        .withClosedEpochVatEligible(Array.isArray(eligible) ? eligible[1] : eligible),
    ),
  )
}

const repeat = (kind: EpochKind, count: number): EpochKind[] => Array.from({ length: count }, () => kind)

type Boundary = { running: VatVerdict; admitted: VatVerdict; closedForecast: VatVerdict }

const boundaryBuilders = (boundaries: Boundary[]) => {
  const votes = generateVoteAccounts('vat-boundary')
  const ids = generateIdentities()
  return boundaries.map(({ running, admitted, closedForecast }) =>
    withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    )
      .withVatEligible(running)
      .withClosedEpochVatEligible(closedForecast)
      .withLastEpochVatAdmitted(admitted),
  )
}

const vatVerdictWarnings = (warn: jest.SpyInstance) =>
  warn.mock.calls.map(([message]) => String(message)).filter(message => message.includes('chain VAT verdict'))

describe('VAT eligibility', () => {
  it('refuses only a validator with vat_eligible false', async () => {
    expect(await gatesFor(repeat('alpenglow', 10), [false, true, null, undefined])).toEqual([
      'vatIneligible',
      null,
      null,
      null,
    ])
  })

  it('refuses only when the running and the newest closed epoch both read false', async () => {
    // [running epoch, newest closed epoch]
    expect(
      await gatesFor(repeat('alpenglow', 10), [
        [false, false],
        [false, true],
        [true, false],
        [false, null],
        [null, false],
        [false, undefined],
      ]),
    ).toEqual(['vatIneligible', null, null, null, null, null])
  })

  it('does not cut a validator the chain admitted, whatever the forecasts read', async () => {
    expect(await gatesOf(boundaryBuilders([{ running: false, admitted: true, closedForecast: false }]))).toEqual([null])
  })

  it('cuts a validator the chain refused that is still below the VAT minimum', async () => {
    expect(await gatesOf(boundaryBuilders([{ running: false, admitted: false, closedForecast: true }]))).toEqual([
      'vatIneligible',
    ])
  })

  it('does not cut a validator the chain refused that has topped up since', async () => {
    expect(await gatesOf(boundaryBuilders([{ running: true, admitted: false, closedForecast: false }]))).toEqual([null])
  })

  it('reads the verdict of the last epoch while that epoch is still open', async () => {
    const [refused] = boundaryBuilders([{ running: false, admitted: false, closedForecast: true }])
    assert(refused)
    expect(await gatesOf([refused.withLastEpochStillOpen()])).toEqual(['vatIneligible'])
  })

  it('falls back to the newest closed forecast and warns when the verdict is unknown', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const builders = boundaryBuilders([
        { running: false, admitted: null, closedForecast: false },
        { running: false, admitted: null, closedForecast: true },
        { running: false, admitted: false, closedForecast: true },
      ])
      expect(await gatesOf(builders)).toEqual(['vatIneligible', null, 'vatIneligible'])
      const [first] = builders
      assert(first)
      expect(vatVerdictWarnings(warn)).toEqual([
        `No chain VAT verdict at the last epoch boundary for 1 staked validator(s) below the VAT minimum, using the newest closed forecast: ${first.voteAccount}`,
      ])
    } finally {
      warn.mockRestore()
    }
  })

  it('falls back without a row for the last epoch and does not warn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const [fresh, veteran] = boundaryBuilders([
        { running: false, admitted: undefined, closedForecast: false },
        { running: true, admitted: true, closedForecast: true },
      ])
      assert(fresh && veteran)
      fresh.withCredits(null).withVoteRewards(STAKE)
      // One epoch fails the uptime gate first, so the VAT outcome is read where the gate reads it
      const { validators } = await new DsSamSDK(
        {},
        defaultStaticDataProviderBuilder([fresh, veteran]),
      ).getAggregatedData()
      expect(validators.find(v => v.voteAccount === fresh.voteAccount)?.vatEligible).toBeNull()
      expect(vatVerdictWarnings(warn)).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('warns only for staked validators the fallback can cut', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const [staked, unstaked, aboveMinimum, keptByForecast] = boundaryBuilders([
        { running: false, admitted: null, closedForecast: false },
        { running: false, admitted: null, closedForecast: false },
        { running: true, admitted: null, closedForecast: true },
        { running: false, admitted: null, closedForecast: true },
      ])
      assert(staked && unstaked && aboveMinimum && keptByForecast)
      unstaked.withNativeStake(0).withLiquidStake(0).withExternalStake(0)
      expect(await gatesOf([staked, unstaked, aboveMinimum, keptByForecast])).toEqual([
        'vatIneligible',
        'vatIneligible',
        null,
        null,
      ])
      expect(vatVerdictWarnings(warn)).toEqual([
        `No chain VAT verdict at the last epoch boundary for 1 staked validator(s) below the VAT minimum, using the newest closed forecast: ${staked.voteAccount}`,
      ])
    } finally {
      warn.mockRestore()
    }
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
    expect(findValidatorInResult(refused.voteAccount, result)?.samIneligibilityGate).toBe('vatIneligible')
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
