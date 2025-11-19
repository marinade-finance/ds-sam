import { DsSamSDK } from '../src'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { prettyPrintAuctionResult, prettyPrintStakeUnstakePriorities } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'
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
      // 100k total TVL => 0 MNDE TVL & 50% of votes for DelStrat => 0 MNDE stake distributed
      // Default config has MNDE TVL share = 0%
      expect(result.auctionData.stakeAmounts.marinadeMndeTvlSol).toStrictEqual(0)
      expect(result.auctionData.stakeAmounts.marinadeSamTvlSol).toStrictEqual(100_000)
      expect(totalMndeStake).toStrictEqual(0)
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

      const totalMndeStake = result.auctionData.validators.reduce((sum, validator) => sum + validator.auctionStake.marinadeMndeTargetSol, 0)
      const totalSamStake = result.auctionData.validators.reduce((sum, validator) => sum + validator.auctionStake.marinadeSamTargetSol, 0)
      expect(result.auctionData.stakeAmounts.marinadeMndeTvlSol).toStrictEqual(0)
      expect(result.auctionData.stakeAmounts.marinadeSamTvlSol).toStrictEqual(15_000_000)
      expect(totalMndeStake).toStrictEqual(0)
      expect(totalSamStake).toBeGreaterThan(13_500_000)
    })
  })

  describe('postprocessing', () => {
    it('assigns stake priorities', async () => {
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()
      const validators = [
        ...Array.from({ length: 5 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withEligibleDefaults()
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 1_000 })
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withEligibleDefaults()
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0.1 + (0.1 * (index % 2)), balance: 1_000 })
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withEligibleDefaults()
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0.01 + (0.01 * (index % 2)), balance: 1_000 })
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withEligibleDefaults()
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0.2, balance: 1_000 })
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      expect(prettyPrintStakeUnstakePriorities(result)).toMatchSnapshot()
    })

    it('assigns unstake priorities', async () => {
      const identities = generateIdentities()
      const validators = [
        ...Array.from({ length: 5 }, (_, index) =>
          new ValidatorMockBuilder(`ineligible-${index}`, identities.next().value)
            .withExternalStake(1_000_000)
            .blacklisted()
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          new ValidatorMockBuilder(`underfunded-${index}`, identities.next().value)
            .withGoodPerformance()
            .withExternalStake(10_000_000)
            .withLiquidStake(10_000 * (index + 1))
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0.1 * (index + 1), balance: 1 })
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          new ValidatorMockBuilder(`overstaked-${index}`, identities.next().value)
            .withGoodPerformance()
            .withExternalStake(10_000_000)
            .withLiquidStake(100_000 + 10_000 * (index + 1))
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 1_000 })
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      expect(prettyPrintStakeUnstakePriorities(result)).toMatchSnapshot()
    })

    it('run() assigns effective participating bids', async () => {
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()
      const validators = [
        ...Array.from({ length: 60 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withGoodPerformance()
            .withExternalStake(1_000_000)
            .withLiquidStake(10_000)
            .withInflationCommission(index)
            .withBond({ stakeWanted: 1_000_000, cpmpe: index + 1, balance: 1_000 })
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      result.auctionData.validators
        .forEach(({ revShare }) => expect(isFinite(revShare.effParticipatingBidPmpe)).toBe(true))

      result.auctionData.validators
        .forEach(({ revShare }) => expect(isFinite(revShare.auctionEffectiveBidPmpe)).toBe(true))

      result.auctionData.validators
        .filter(validator => validator.revShare.effParticipatingBidPmpe > 0)
        .forEach(({ revShare }) => {
          expect(Math.abs(
            revShare.mevPmpe +
              revShare.inflationPmpe +
              revShare.effParticipatingBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
          expect(Math.abs(
            revShare.onchainDistributedPmpe +
              revShare.effParticipatingBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
        })

      result.auctionData.validators
        .filter(validator => validator.revShare.totalPmpe < result.winningTotalPmpe)
        .forEach(({ revShare }) => {
          expect(revShare.auctionEffectiveBidPmpe).toStrictEqual(revShare.bidPmpe)
        })

      result.auctionData.validators
        .filter(validator => validator.revShare.totalPmpe < result.winningTotalPmpe)
        .forEach(({ revShare }) => {
          expect(revShare.auctionEffectiveBidPmpe).toStrictEqual(revShare.bidPmpe)
        })

      result.auctionData.validators
        .filter(validator => validator.revShare.totalPmpe >= result.winningTotalPmpe)
        .forEach(({ revShare }) => {
          expect(Math.abs(
            revShare.mevPmpe +
              revShare.inflationPmpe +
              revShare.auctionEffectiveBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
          expect(Math.abs(
            revShare.onchainDistributedPmpe +
              revShare.auctionEffectiveBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
        })

    })

    it('runFinalOnly() assigns effective participating bids', async () => {
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()
      const validators = [
        ...Array.from({ length: 60 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withGoodPerformance()
            .withExternalStake(1_000_000)
            .withLiquidStake(10_000)
            .withInflationCommission(index)
            .withBond({ stakeWanted: 1_000_000, cpmpe: index + 1, balance: 1_000 })
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.runFinalOnly()

      result.auctionData.validators
        .forEach(({ revShare }) => expect(isFinite(revShare.effParticipatingBidPmpe)).toBe(true))

      result.auctionData.validators
        .forEach(({ revShare }) => expect(isFinite(revShare.auctionEffectiveBidPmpe)).toBe(true))

      result.auctionData.validators
        .filter(validator => validator.revShare.effParticipatingBidPmpe > 0)
        .forEach(({ revShare }) => {
          expect(Math.abs(
            revShare.mevPmpe +
              revShare.inflationPmpe +
              revShare.effParticipatingBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
          expect(Math.abs(
            revShare.onchainDistributedPmpe +
              revShare.effParticipatingBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
        })

      result.auctionData.validators
        .filter(validator => validator.revShare.totalPmpe < result.winningTotalPmpe)
        .forEach(({ revShare }) => {
          expect(revShare.auctionEffectiveBidPmpe).toStrictEqual(revShare.bidPmpe)
        })

      result.auctionData.validators
        .filter(validator => validator.revShare.totalPmpe >= result.winningTotalPmpe)
        .forEach(({ revShare }) => {
          expect(Math.abs(
            revShare.mevPmpe +
              revShare.inflationPmpe +
              revShare.auctionEffectiveBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
          expect(Math.abs(
            revShare.onchainDistributedPmpe +
              revShare.auctionEffectiveBidPmpe -
              result.winningTotalPmpe
          )).toBeLessThan(1e-12)
        })

    })
  })
})
