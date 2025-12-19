import assert from 'assert'

import { DsSamSDK } from '../src'
import {
  blockRewardsStaticDataProviderBuilder,
  defaultStaticDataProviderBuilder,
} from './helpers/static-data-provider-builder'
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
        ...Array.from({ length: 50 }, () =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withGoodPerformance()
            .withLiquidStake(100_000)
            .withNativeStake(50_000)
            .withBond({ stakeWanted: 1e6, cpmpe: 0, balance: 100 }),
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
        ...Array.from({ length: 50 }, () =>
          new ValidatorMockBuilder(voteAccountsSam.next().value, identities.next().value)
            .withGoodPerformance()
            .withMndeVotes(1)
            .withBond({ stakeWanted: 160_000, cpmpe: 0, balance: 100 }),
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
        ...Array.from({ length: 8 }, () =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
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

      const totalMndeStake = result.auctionData.validators.reduce(
        (sum, validator) => sum + validator.auctionStake.marinadeMndeTargetSol,
        0,
      )
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
        ...Array.from({ length: 98 }, () =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withEligibleDefaults()
            .withExternalStake(1_000_000)
            .withMndeVotes(0),
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      const totalMndeStake = result.auctionData.validators.reduce(
        (sum, validator) => sum + validator.auctionStake.marinadeMndeTargetSol,
        0,
      )
      const totalSamStake = result.auctionData.validators.reduce(
        (sum, validator) => sum + validator.auctionStake.marinadeSamTargetSol,
        0,
      )
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
        ...Array.from({ length: 5 }, () =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withEligibleDefaults()
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 1_000 }),
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withBond({
            stakeWanted: 1_000_000,
            cpmpe: 0.1 + 0.1 * (index % 2),
            balance: 1_000,
          }),
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults().withBond({
            stakeWanted: 1_000_000,
            cpmpe: 0.01 + 0.01 * (index % 2),
            balance: 1_000,
          }),
        ),
        ...Array.from({ length: 5 }, () =>
          new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
            .withEligibleDefaults()
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0.2, balance: 1_000 }),
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
            .blacklisted(),
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          new ValidatorMockBuilder(`underfunded-${index}`, identities.next().value)
            .withGoodPerformance()
            .withExternalStake(10_000_000)
            .withLiquidStake(10_000 * (index + 1))
            .withBond({
              stakeWanted: 1_000_000,
              cpmpe: 0.1 * (index + 1),
              balance: 1,
            }),
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          new ValidatorMockBuilder(`overstaked-${index}`, identities.next().value)
            .withGoodPerformance()
            .withExternalStake(10_000_000)
            .withLiquidStake(100_000 + 10_000 * (index + 1))
            .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 1_000 }),
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
            .withBond({
              stakeWanted: 1_000_000,
              cpmpe: index + 1,
              balance: 1_000,
            }),
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.run()

      result.auctionData.validators.forEach(({ revShare }) =>
        expect(isFinite(revShare.effParticipatingBidPmpe)).toBe(true),
      )

      result.auctionData.validators.forEach(({ revShare }) =>
        expect(isFinite(revShare.auctionEffectiveBidPmpe)).toBe(true),
      )

      result.auctionData.validators
        .filter(validator => validator.revShare.effParticipatingBidPmpe > 0)
        .forEach(({ revShare }) => {
          expect(
            Math.abs(
              revShare.mevPmpe + revShare.inflationPmpe + revShare.effParticipatingBidPmpe - result.winningTotalPmpe,
            ),
          ).toBeLessThan(1e-12)
          expect(
            Math.abs(revShare.onchainDistributedPmpe + revShare.effParticipatingBidPmpe - result.winningTotalPmpe),
          ).toBeLessThan(1e-12)
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
          expect(
            Math.abs(
              revShare.mevPmpe + revShare.inflationPmpe + revShare.auctionEffectiveBidPmpe - result.winningTotalPmpe,
            ),
          ).toBeLessThan(1e-12)
          expect(
            Math.abs(revShare.onchainDistributedPmpe + revShare.auctionEffectiveBidPmpe - result.winningTotalPmpe),
          ).toBeLessThan(1e-12)
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
            .withBond({
              stakeWanted: 1_000_000,
              cpmpe: index + 1,
              balance: 1_000,
            }),
        ),
      ]
      const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
      const result = await dsSam.runFinalOnly()

      result.auctionData.validators.forEach(({ revShare }) =>
        expect(isFinite(revShare.effParticipatingBidPmpe)).toBe(true),
      )

      result.auctionData.validators.forEach(({ revShare }) =>
        expect(isFinite(revShare.auctionEffectiveBidPmpe)).toBe(true),
      )

      result.auctionData.validators
        .filter(validator => validator.revShare.effParticipatingBidPmpe > 0)
        .forEach(({ revShare }) => {
          expect(
            Math.abs(
              revShare.mevPmpe + revShare.inflationPmpe + revShare.effParticipatingBidPmpe - result.winningTotalPmpe,
            ),
          ).toBeLessThan(1e-12)
          expect(
            Math.abs(revShare.onchainDistributedPmpe + revShare.effParticipatingBidPmpe - result.winningTotalPmpe),
          ).toBeLessThan(1e-12)
        })

      result.auctionData.validators
        .filter(validator => validator.revShare.totalPmpe < result.winningTotalPmpe)
        .forEach(({ revShare }) => {
          expect(revShare.auctionEffectiveBidPmpe).toStrictEqual(revShare.bidPmpe)
        })

      result.auctionData.validators
        .filter(validator => validator.revShare.totalPmpe >= result.winningTotalPmpe)
        .forEach(({ revShare }) => {
          expect(
            Math.abs(
              revShare.mevPmpe + revShare.inflationPmpe + revShare.auctionEffectiveBidPmpe - result.winningTotalPmpe,
            ),
          ).toBeLessThan(1e-12)
          expect(
            Math.abs(revShare.onchainDistributedPmpe + revShare.auctionEffectiveBidPmpe - result.winningTotalPmpe),
          ).toBeLessThan(1e-12)
        })
    })
  })

  describe('test dynamic commission', () => {
    it('ds sam sdk run', async () => {
      const voteAccounts = generateVoteAccounts()
      const identities = generateIdentities()

      // Validator with good performance and bond - should be SAM and MNDE eligible
      const validator1Good = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withInflationCommission(5)
        .withMevCommission(10)
        .withGoodPerformance()
        .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 100 })
        .withNativeStake(0)
        .withExternalStake(100_000)
      const validator2Good = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withInflationCommission(5)
        .withMevCommission(10)
        .withGoodPerformance()
        .withBond({
          stakeWanted: 1_000_000,
          cpmpe: 0,
          balance: 100,
          bondBlockCommission: 20,
        })
        .withNativeStake(0)
        .withExternalStake(100_000)
      // Validator with no bond - should not be SAM eligible
      const validator3NoBond = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withGoodPerformance()
        .withInflationCommission(5)
        .withMevCommission(10)
        .withLiquidStake(10_000)
        .withExternalStake(100_000)
      // Blacklisted validator - should be ineligible
      const validator4Blacklist = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withGoodPerformance()
        .blacklisted()
        .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 100 })
        .withLiquidStake(10_000)
        .withExternalStake(100_000)
      // Validator with poor performance (bad uptime) - should be ineligible
      const validator5Poor = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withBadPerformance()
        .withInflationCommission(5)
        .withMevCommission(1)
        .withBond({
          stakeWanted: 1_000_000,
          cpmpe: 0,
          balance: 100,
          bondInflationCommission: 4,
          bondMevCommission: 1,
          bondBlockCommission: 98,
        })
        .withLiquidStake(100_000)
        .withExternalStake(100_000)
      // Validator with high commission - test SAM vs MNDE eligibility
      const validator6HighCommission = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withGoodPerformance()
        .withInflationCommission(95)
        .withMevCommission(95)
        .withBond({
          stakeWanted: 1_000_000,
          cpmpe: 0,
          balance: 100,
          bondBlockCommission: 95,
        })
        .withLiquidStake(100_000)
        .withNativeStake(1_000_000)
        .withExternalStake(100_000)
      // Zero commission validator - should be backstop eligible
      const validator7BackStop = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withGoodPerformance()
        .withInflationCommission(10)
        .withMevCommission(20)
        .withBond({
          stakeWanted: 1_000_000,
          cpmpe: 0,
          balance: 10_000,
          bondBlockCommission: 0,
          bondInflationCommission: 0,
          bondMevCommission: 0,
        })
        .withLiquidStake(1_000_000)
        .withNativeStake(1_000_000)
        .withExternalStake(1_000_000)

      const validators = [
        validator1Good,
        validator2Good,
        validator3NoBond,
        validator4Blacklist,
        validator5Poor,
        validator6HighCommission,
        validator7BackStop,
      ]

      const dsSam = new DsSamSDK(
        { enableZeroCommissionBackstop: true },
        blockRewardsStaticDataProviderBuilder(validators),
      )

      const result = await dsSam.run()
      const auctionRewards = result.auctionData.rewards

      // Verify zero commission validator is backstop eligible
      const backstopValidator7 = result.auctionData.validators.find(
        v => v.voteAccount === validator7BackStop.voteAccount,
      )
      expect(backstopValidator7).toBeDefined()
      expect(backstopValidator7?.backstopEligible).toBe(true)
      expect(
        (backstopValidator7?.revShare.inflationPmpe ?? 0) +
          (backstopValidator7?.revShare.mevPmpe ?? 0) +
          (backstopValidator7?.revShare.blockPmpe ?? 0),
      ).toEqual(backstopValidator7?.revShare.totalPmpe)
      expect(backstopValidator7?.revShare.totalPmpe).toEqual(
        auctionRewards.blockPmpe + auctionRewards.inflationPmpe + auctionRewards.mevPmpe,
      )

      const eligibleValidators = result.auctionData.validators.filter(v => v.samEligible || v.mndeEligible)
      expect(eligibleValidators.length).toEqual(3)
      const ineligibleValidators = result.auctionData.validators.filter(v => !v.samEligible && !v.mndeEligible)
      expect(ineligibleValidators.length).toEqual(4)
      const backstopValidators = result.auctionData.validators.filter(v => v.backstopEligible)
      expect(backstopValidators.length).toEqual(2) // including 1 eligible + 1 zero commission

      result.auctionData.validators.forEach(validator => {
        expect(validator.revShare).toBeDefined()
        expect(validator.revShare.totalPmpe).toBeDefined()
        expect(validator.revShare.inflationPmpe).toBeDefined()
        expect(validator.revShare.mevPmpe).toBeDefined()
        expect(validator.revShare.blockPmpe).toBeDefined()
      })

      const backStopValidator = result.auctionData.validators.find(
        v => v.voteAccount === validator7BackStop.voteAccount,
      )
      assert(backStopValidator, 'Backstopped validator not found in results')
      expect(backStopValidator.backstopEligible).toBe(true)
      expect(
        backStopValidator.revShare.inflationPmpe +
          backStopValidator.revShare.mevPmpe +
          backStopValidator.revShare.blockPmpe,
      ).toEqual(backStopValidator.revShare.totalPmpe)
      expect(backStopValidator.revShare.totalPmpe).toEqual(
        auctionRewards.blockPmpe + auctionRewards.inflationPmpe + auctionRewards.mevPmpe,
      )
      expect(backStopValidator.values.commissions.blockRewardsCommissionDec).toEqual(0)
      expect(backStopValidator.values.commissions.blockRewardsCommissionInBondDec).toEqual(0)
      expect(backStopValidator.values.commissions.inflationCommissionDec).toEqual(0)
      expect(backStopValidator.values.commissions.inflationCommissionInBondDec).toEqual(0)
      expect(backStopValidator.values.commissions.inflationCommissionOnchainDec).toEqual(0.1)
      expect(backStopValidator.values.commissions.mevCommissionDec).toEqual(0)
      expect(backStopValidator.values.commissions.mevCommissionInBondDec).toEqual(0)
      expect(backStopValidator.values.commissions.mevCommissionOnchainDec).toEqual(0.2)
      expect(backStopValidator.samEligible).toBe(true)
      expect(backStopValidator.mndeEligible).toBe(true)

      const poorValidator = result.auctionData.validators.find(v => v.voteAccount === validator5Poor.voteAccount)
      assert(poorValidator, 'Poor validator not found in results')
      expect(poorValidator.samEligible).toBe(false)
      expect(poorValidator.mndeEligible).toBe(false)
      expect(poorValidator.values.commissions.blockRewardsCommissionDec).toEqual(0.98)
      expect(poorValidator.values.commissions.blockRewardsCommissionInBondDec).toEqual(0.98)
      expect(poorValidator.values.commissions.inflationCommissionDec).toEqual(0.04)
      expect(poorValidator.values.commissions.inflationCommissionInBondDec).toEqual(0.04)
      expect(poorValidator.values.commissions.inflationCommissionOnchainDec).toEqual(0.05)
      expect(poorValidator.values.commissions.mevCommissionDec).toEqual(0.01)
      expect(poorValidator.values.commissions.mevCommissionInBondDec).toEqual(0.01)
      expect(poorValidator.values.commissions.mevCommissionOnchainDec).toEqual(0.01)
      expect(poorValidator.auctionStake.marinadeSamTargetSol).toEqual(0)
      expect(poorValidator.auctionStake.marinadeMndeTargetSol).toEqual(0)

      const blacklistedValidator = result.auctionData.validators.find(
        v => v.voteAccount === validator4Blacklist.voteAccount,
      )
      assert(blacklistedValidator, 'Blacklisted validator not found in results')
      expect(blacklistedValidator.samEligible).toBe(false)
      expect(blacklistedValidator.mndeEligible).toBe(false)
      expect(blacklistedValidator.auctionStake.marinadeSamTargetSol).toEqual(0)
      expect(blacklistedValidator.auctionStake.marinadeMndeTargetSol).toEqual(0)

      const noBondValidator = result.auctionData.validators.find(v => v.voteAccount === validator3NoBond.voteAccount)
      assert(noBondValidator, 'No bond validator not found in results')
      expect(noBondValidator.samEligible).toBe(false)
      expect(noBondValidator.mndeEligible).toBe(false)
      expect(noBondValidator.auctionStake.marinadeSamTargetSol).toEqual(0)
      expect(noBondValidator.auctionStake.marinadeMndeTargetSol).toEqual(0)

      const highCommissionValidator = result.auctionData.validators.find(
        v => v.voteAccount === validator6HighCommission.voteAccount,
      )
      assert(highCommissionValidator, 'High commission validator not found in results')
      expect(highCommissionValidator.samEligible).toBe(false)
      expect(highCommissionValidator.mndeEligible).toBe(false)
      expect(highCommissionValidator.values.commissions.blockRewardsCommissionDec).toEqual(0.95)
      expect(highCommissionValidator.values.commissions.inflationCommissionDec).toEqual(0.95)
      expect(highCommissionValidator.values.commissions.mevCommissionDec).toEqual(0.95)
      expect(highCommissionValidator.auctionStake.marinadeSamTargetSol).toEqual(0)
      expect(highCommissionValidator.auctionStake.marinadeMndeTargetSol).toEqual(0)

      const goodValidator1 = result.auctionData.validators.find(v => v.voteAccount === validator1Good.voteAccount)
      assert(goodValidator1, 'Good validator not found in results')
      expect(goodValidator1.samEligible).toBe(true)
      expect(goodValidator1.mndeEligible).toBe(true)
      const goodValidator2 = result.auctionData.validators.find(v => v.voteAccount === validator2Good.voteAccount)
      assert(goodValidator2, 'Good validator not found in results')
      expect(goodValidator2.samEligible).toBe(true)
      expect(goodValidator2.mndeEligible).toBe(true)

      expect(goodValidator2.auctionStake.marinadeSamTargetSol).toEqual(goodValidator1.auctionStake.marinadeSamTargetSol)
      expect(goodValidator2.revShare.totalPmpe).toBeGreaterThan(goodValidator1.revShare.totalPmpe)
      expect(goodValidator1.revShare.totalPmpe).toEqual(result.winningTotalPmpe)
      expect(backStopValidator.revShare.totalPmpe).toBeGreaterThan(result.winningTotalPmpe)
      expect(goodValidator2.revShare.totalPmpe).toBeGreaterThan(result.winningTotalPmpe)
    })
  })
})
