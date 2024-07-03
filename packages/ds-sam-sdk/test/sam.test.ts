import { DsSamSDK } from "../src"
import { StaticDataProviderBuilder, defaultStaticDataProviderBuilder } from "./helpers/static-data-provider-builder"
import { prettyPrintAuctionResult } from "./helpers/utils"
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from "./helpers/validator-mock-builder"
import { MNDE_VOTE_DELEGATION_STRATEGY } from '../src/utils'

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

    it('distributes MNDE stake directed to DelStrat as part of SAM', async () => {
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()
      const validators = [
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withEligibleDefaults()
          .withExternalStake(1_000_000)
          .withNativeStake(5_000)
          .withLiquidStake(5_000)
          .withMndeVotes(50),
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withEligibleDefaults()
          .withExternalStake(1_000_000)
          .withNativeStake(5_000)
          .withLiquidStake(5_000)
          .withMndeVotes(50),
        ...Array.from({ length: 8 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withEligibleDefaults()
          .withExternalStake(1_000_000)
          .withNativeStake(5_000)
          .withLiquidStake(5_000)
          .withMndeVotes(50),
        ),
        new ValidatorMockBuilder(MNDE_VOTE_DELEGATION_STRATEGY, 'marinade-delstrat-virtual-validator')
          .blacklisted() // avoid distributing stake to this virtual validator
          .withNativeStake(0)
          .withLiquidStake(0)
          .withMndeVotes(500),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      const totalMndeStake = result.auctionData.validators.reduce((sum, validator) => sum + validator.auctionStake.marinadeMndeTargetSol, 0)
      // 100k total TVL => 10k MNDE TVL & 50% of votes for DelStrat => 5k MNDE stake distributed
      expect(result.auctionData.stakeAmounts.marinadeMndeTvlSol).toStrictEqual(5_000)
      expect(result.auctionData.stakeAmounts.marinadeSamTvlSol).toStrictEqual(95_000)
      expect(totalMndeStake).toStrictEqual(5_000)
    })

    it('distributes overflow MNDE stake as part of SAM', async () => {
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()
      const validators = [
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withEligibleDefaults()
          .withExternalStake(1_000_000)
          .blacklisted()
          .withMndeVotes(100),
        new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withEligibleDefaults()
          .withExternalStake(1_000_000)
          .blacklisted()
          .withMndeVotes(100),
        ...Array.from({ length: 98 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
          .withEligibleDefaults()
          .withExternalStake(1_000_000)
          .withMndeVotes(0),
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()
      console.error(JSON.stringify(result.auctionData.stakeAmounts))
      console.error(prettyPrintAuctionResult(result))

      const totalMndeStake = result.auctionData.validators.reduce((sum, validator) => sum + validator.auctionStake.marinadeMndeTargetSol, 0)
      const totalSamStake = result.auctionData.validators.reduce((sum, validator) => sum + validator.auctionStake.marinadeSamTargetSol, 0)
      expect(result.auctionData.stakeAmounts.marinadeMndeTvlSol).toStrictEqual(0)
      expect(result.auctionData.stakeAmounts.marinadeSamTvlSol).toStrictEqual(15_000_000)
      expect(totalMndeStake).toStrictEqual(0)
      expect(totalSamStake).toBeGreaterThan(13_500_000)
    })
  })
})
