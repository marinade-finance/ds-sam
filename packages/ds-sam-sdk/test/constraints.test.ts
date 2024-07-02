import { DsSamSDK } from "../src"
import { defaultStaticDataProviderBuilder } from "./helpers/static-data-provider-builder"
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from "./helpers/validator-mock-builder"
import { prettyPrintAuctionResult } from './helpers/utils'

describe('constraints', () => {
  it('applies bond constraints to SAM stake', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()

    const validators = [
      new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withBond({ stakeWanted: 15_000, cpmpe: 0, balance: 1_000 }),
      new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withBond({ stakeWanted: 20_000, cpmpe: 0, balance: 10 }),
      ...Array.from({ length: 18 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withBond({ stakeWanted: 10_000_000, cpmpe: 0, balance: 1_000 })),
    ]
    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
    const result = await dsSam.run()

    expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
  })

  it('applies bond constraints and ignores max stake wanted for MNDE stake', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()

    const validators = [
      new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(2000)
        .withBond({ stakeWanted: 10, cpmpe: 0, balance: 20 }),
      new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(3000)
        .withBond({ stakeWanted: 10, cpmpe: 0, balance: 0.1 }),
      ...Array.from({ length: 18 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(1000)
        .withBond({ stakeWanted: 10, cpmpe: 0, balance: 1_000 })),
    ]
    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
    const result = await dsSam.run()

    expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
  })
})
