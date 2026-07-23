import assert from 'node:assert'

import { DsSamSDK } from '../src'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { assertValidatorIneligible, findValidatorInResult } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

describe('eligibility', () => {
  it('identifies ineligible validators', async () => {
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
    const commissionTooHighVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withMevCommission(100)
      .withInflationCommission(8)

    const eligibleValidator = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withBond({ stakeWanted: 0, cpmpe: 1, balance: 10 })

    const validators = [
      blacklistedVal,
      wrongVersionVal,
      badUptimeVal,
      noBondVal,
      commissionTooHighVal,
      eligibleValidator,
    ]
    const dsSam = new DsSamSDK(
      { validatorsClientVersionSemverExpr: '>=1.17.0' },
      defaultStaticDataProviderBuilder(validators),
    )
    const result = await dsSam.run()

    assertValidatorIneligible(findValidatorInResult(blacklistedVal.voteAccount, result))
    assertValidatorIneligible(findValidatorInResult(wrongVersionVal.voteAccount, result))
    assertValidatorIneligible(findValidatorInResult(badUptimeVal.voteAccount, result))
    assertValidatorIneligible(findValidatorInResult(noBondVal.voteAccount, result))
    assertValidatorIneligible(findValidatorInResult(commissionTooHighVal.voteAccount, result))

    expect(findValidatorInResult(eligibleValidator.voteAccount, result)?.samEligible).toStrictEqual(true)
  })

  it('enforces the client version floor across Agave and Frankendancer', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()

    const cases: [string, boolean][] = [
      // Agave / Jito lane (floor 4.1.0-beta.0)
      ['1.18.15', false],
      ['3.9.9', false],
      ['4.0.3', false],
      ['4.1.0-alpha.0', false],
      ['4.1.0-beta.0', true],
      ['4.1.0-rc.1', true],
      ['4.1.0', true],
      ['4.1.1', true],
      ['5.0.0', true],
      // reserved for full Firedancer (1.x), currently rejected
      ['1.0.0', false],
      ['1.1.0', false],
      // Frankendancer lane (floor 0.1004.0-rc.40101, < 1.0.0)
      ['0.1.1', false],
      ['0.101.20013', false],
      ['0.911.40002', false],
      ['0.1004.0-rc.40100', false],
      ['0.1004.0-rc.40101', true],
      ['0.1004.0', true],
      ['0.1005.40100', true],
    ]

    const validators = cases.map(([version, eligible]) => ({
      version,
      eligible,
      builder: new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withVersion(version),
    }))
    // Default config floor tested, no overrides; expected values track config.ts.
    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators.map(v => v.builder)))
    const result = await dsSam.run()

    const actual = validators.map(v => [v.version, findValidatorInResult(v.builder.voteAccount, result)?.samEligible])
    const expected = validators.map(v => [v.version, v.eligible])
    expect(actual).toStrictEqual(expected)
  })

  it('marks empty epochStats as ineligible', async () => {
    const votes = generateVoteAccounts('empty-epoch')
    const ids = generateIdentities()
    const val = new ValidatorMockBuilder(votes.next().value, ids.next().value)
      .withInflationCommission(5)
      .withMevCommission(80)
      .withCredits()
      .withBond({
        stakeWanted: 150_000,
        cpmpe: 0,
        balance: 100,
      })

    const goodVal = new ValidatorMockBuilder(votes.next().value, ids.next().value).withEligibleDefaults()

    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder([val, goodVal]))
    const result = await dsSam.run()

    const v = findValidatorInResult(val.voteAccount, result)
    assert(v)
    expect(v.samEligible).toBe(false)
    expect(v.auctionStake.marinadeSamTargetSol).toBe(0)
  })
})
