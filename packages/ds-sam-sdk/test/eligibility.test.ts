import { DsSamSDK } from "../src"
import { defaultStaticDataProviderBuilder } from "./helpers/static-data-provider-builder"
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from "./helpers/validator-mock-builder"
import { assertValidatorIneligible, findValidatorInResult } from './helpers/utils'

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

    const mndeIneligibleSamEligibleVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withMevCommission(100)
      .withInflationCommission(8)
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 10 })

    const validators = [blacklistedVal, wrongVersionVal, badUptimeVal, noBondVal, commissionTooHighVal, mndeIneligibleSamEligibleVal]
    const dsSam = new DsSamSDK({ validatorsClientVersionSemverExpr: '>=1.17.0' }, defaultStaticDataProviderBuilder(validators))
    const result = await dsSam.run()

    assertValidatorIneligible(findValidatorInResult(blacklistedVal.voteAccount, result)!)
    assertValidatorIneligible(findValidatorInResult(wrongVersionVal.voteAccount, result)!)
    assertValidatorIneligible(findValidatorInResult(badUptimeVal.voteAccount, result)!)
    assertValidatorIneligible(findValidatorInResult(noBondVal.voteAccount, result)!)
    assertValidatorIneligible(findValidatorInResult(commissionTooHighVal.voteAccount, result)!)

    const mndeIneligibleSamEligible = findValidatorInResult(mndeIneligibleSamEligibleVal.voteAccount, result)!
    expect(mndeIneligibleSamEligible.mndeEligible).toStrictEqual(false)
    expect(mndeIneligibleSamEligible.samEligible).toStrictEqual(true)
    expect(mndeIneligibleSamEligible.auctionStake.marinadeMndeTargetSol).toStrictEqual(0)
    expect(mndeIneligibleSamEligible.auctionStake.marinadeSamTargetSol).toBeGreaterThan(0)
  })

  it('considers also FD versions eligible', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()

    const validators: [ValidatorMockBuilder, boolean][] = [
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.18.15'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.18.16'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.18.14'), false],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.17.99'), false],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.19.0'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('0.113.20007'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('0.101.20013'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('0.101.20014'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('0.101.20012'), false],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('0.102.0'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('0.100.99'), false],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('0.999.99'), true],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.0.0'), false],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.0.1'), false],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('1.1.0'), false],
      [new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withVersion('2.0.0'), true],
    ]
    const dsSam = new DsSamSDK(
      { validatorsClientVersionSemverExpr: '>=1.18.15 || >=0.101.20013 <1.0.0' },
      defaultStaticDataProviderBuilder(validators.map(([validator]) => validator)),
    )
    const result = await dsSam.run()

    validators.forEach(([validator, eligibility]) => {
      const v = findValidatorInResult(validator.voteAccount, result)!
      expect(v.mndeEligible).toStrictEqual(eligibility)
      expect(v.samEligible).toStrictEqual(eligibility)
    })
  })
})
