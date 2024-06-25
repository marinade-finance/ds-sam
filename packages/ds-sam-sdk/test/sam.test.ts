import { DsSamSDK } from "../src"
import { StaticDataProviderBuilder, defaultStaticDataProviderBuilder } from "./helpers/static-data-provider-builder"
import { prettyPrintAuctionResult } from "./helpers/utils"
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from "./helpers/validator-mock-builder"

describe('sam', () => {
  describe('distribution', () => {
    it('distributes stake to validators with bonds', async () => {
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()
      const validators = [
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withInflationCommission(100)
          .withMevCommission(100)
          .withGoodPerformance()
          .withExternalStake(500_000_000),
        ...Array.from({ length: 50 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withGoodPerformance()
          .withLiquidStake(100_000)
          .withNativeStake(50_000)
          .withBond({ stakeWanted: 1e6, cpmpe: 0, balance: 100 })
        ),
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withGoodPerformance()
          .withLiquidStake(100_000)
          .withNativeStake(50_000)
          .withMndeVotes(1),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
    })

    it('distributes stake to validators with good total pmpe', async () => {
      const voteAccountsSam = generateVoteAccounts('SAM')
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()
      const validators = [
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withInflationCommission(100)
          .withGoodPerformance()
          .withLiquidStake(10_000_000)
          .withNativeStake(10_000_000)
          .withExternalStake(490_000_000),
        ...Array.from({ length: 50 }, () => new ValidatorMockBuilder(voteAccountsSam.next().value, identities.next().value)
          .withGoodPerformance()
          .withMndeVotes(1)
          .withBond({ stakeWanted: 160_000, cpmpe: 0, balance: 100 })
        ),
        new ValidatorMockBuilder(voteAccountsSam.next().value, identities.next().value)
          .withInflationCommission(6)
          .withGoodPerformance()
          .withBond({ stakeWanted: 1e6, cpmpe: 0, balance: 100 }),
        new ValidatorMockBuilder(voteAccountsSam.next().value, identities.next().value)
          .withInflationCommission(7)
          .withGoodPerformance()
          .withBond({ stakeWanted: 1e6, cpmpe: 0, balance: 100 }),
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withInflationCommission(8)
          .withGoodPerformance()
          .withBond({ stakeWanted: 1e6, cpmpe: 0, balance: 100 }),
        new ValidatorMockBuilder(voteAccountsSam.next().value, identities.next().value)
          .withInflationCommission(8)
          .withMevCommission(0)
          .withGoodPerformance()
          .withBond({ stakeWanted: 1e6, cpmpe: 0, balance: 100 }),
        new ValidatorMockBuilder(voteAccountsSam.next().value, identities.next().value)
          .withInflationCommission(8)
          .withGoodPerformance()
          .withBond({ stakeWanted: 1e6, cpmpe: 0.1, balance: 100 }),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
    })
  })
})