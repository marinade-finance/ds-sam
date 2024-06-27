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
})
