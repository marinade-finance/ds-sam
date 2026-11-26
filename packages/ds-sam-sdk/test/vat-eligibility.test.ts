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

const gatesFor = (kinds: EpochKind[], vatEligible: VatVerdict[], admitted: VatVerdict = false) => {
  const votes = generateVoteAccounts('vat')
  const ids = generateIdentities()
  return gatesOf(
    vatEligible.map(eligible =>
      withEpochs(new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(), kinds)
        .withVatEligible(eligible)
        .withLastEpochVatAdmitted(admitted),
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

  it('refuses only when the chain refused and the running epoch reads false, whatever the closed forecast', async () => {
    const boundaries: [VatVerdict, VatVerdict][] = [
      [false, false],
      [false, true],
      [true, false],
      [false, null],
      [false, undefined],
      [null, false],
    ]
    const closedForecasts = [false, true]
    expect(
      await gatesOf(
        boundaryBuilders(
          boundaries.flatMap(([running, admitted]) =>
            closedForecasts.map(closedForecast => ({ running, admitted, closedForecast })),
          ),
        ),
      ),
    ).toEqual(['vatIneligible', null, null, null, null, null].flatMap(gate => closedForecasts.map(() => gate)))
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

  it('does not cut and warns when the verdict is unknown', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const builders = boundaryBuilders([
        { running: false, admitted: null, closedForecast: false },
        { running: false, admitted: null, closedForecast: true },
        { running: false, admitted: false, closedForecast: true },
      ])
      expect(await gatesOf(builders)).toEqual([null, null, 'vatIneligible'])
      const [first, second] = builders
      assert(first && second)
      expect(vatVerdictWarnings(warn)).toEqual([
        `No chain VAT verdict at the last epoch boundary for 2 staked validator(s) below the VAT minimum, not cut: ${first.voteAccount}, ${second.voteAccount}`,
      ])
    } finally {
      warn.mockRestore()
    }
  })

  it('does not cut without a row for the last epoch and does not warn', async () => {
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

  it('warns only for staked validators below the minimum without a verdict', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const [staked, unstaked, aboveMinimum, forecastTrue, absentVerdict] = boundaryBuilders([
        { running: false, admitted: null, closedForecast: false },
        { running: false, admitted: null, closedForecast: false },
        { running: true, admitted: null, closedForecast: true },
        { running: false, admitted: null, closedForecast: true },
        { running: false, admitted: undefined, closedForecast: false },
      ])
      assert(staked && unstaked && aboveMinimum && forecastTrue && absentVerdict)
      unstaked.withNativeStake(0).withLiquidStake(0).withExternalStake(0)
      expect(await gatesOf([staked, unstaked, aboveMinimum, forecastTrue, absentVerdict])).toEqual([
        null,
        null,
        null,
        null,
        null,
      ])
      expect(vatVerdictWarnings(warn)).toEqual([
        `No chain VAT verdict at the last epoch boundary for 3 staked validator(s) below the VAT minimum, not cut: ${staked.voteAccount}, ${forecastTrue.voteAccount}, ${absentVerdict.voteAccount}`,
      ])
    } finally {
      warn.mockRestore()
    }
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
    expect(await gatesFor(towerOnly, [false], null)).toEqual([null])
  })

  it('gives a VAT-ineligible validator no SAM stake', async () => {
    const votes = generateVoteAccounts('vat-run')
    const ids = generateIdentities()
    const refused = withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    )
      .withVatEligible(false)
      .withLastEpochVatAdmitted(false)
    const admitted = withEpochs(
      new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults(),
      repeat('alpenglow', 10),
    ).withVatEligible(true)
    const result = await new DsSamSDK({}, defaultStaticDataProviderBuilder([refused, admitted])).run()

    assertValidatorIneligible(findValidatorInResult(refused.voteAccount, result))
    expect(findValidatorInResult(refused.voteAccount, result)?.samIneligibilityGate).toBe('vatIneligible')
    expect(findValidatorInResult(refused.voteAccount, result)?.samIneligibilityGates).toEqual(['vatIneligible'])
    expect(findValidatorInResult(admitted.voteAccount, result)?.samEligible).toBe(true)
    expect(findValidatorInResult(admitted.voteAccount, result)?.samIneligibilityGates).toEqual([])
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
      )
        .withVatEligible(vatEligible)
        .withLastEpochVatAdmitted(false)
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
    expect(findValidatorInResult(refused.voteAccount, result)?.samIneligibilityGates).toEqual([
      'vatIneligible',
      'noBond',
    ])
    expect(findValidatorInResult(admitted.voteAccount, result)?.backstopEligible).toBe(true)
    expect(findValidatorInResult(admitted.voteAccount, result)?.samIneligibilityGates).toEqual(['noBond'])
  })
})
