import { DsSamSDK } from '../src'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'
import { findValidatorInResult, prettyPrintAuctionResult } from './helpers/utils'

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
        .withBond({ stakeWanted: 11_000, cpmpe: 0, balance: 20 }),
      new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(3000)
        .withBond({ stakeWanted: 11_000, cpmpe: 0, balance: 0.1 }),
      ...Array.from({ length: 18 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(1000)
        .withBond({ stakeWanted: 11_000, cpmpe: 0, balance: 1_000 })),
    ]
    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
    const result = await dsSam.run()

    expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
  })

  it('applies Marinade stake concentration constraints', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()
    const country = 'dummy-country'
    const aso = 'dummy-aso'

    const validators = [
      ...Array.from({ length: 10 }, (_, idx) => new ValidatorMockBuilder(`country-validator-${idx}`, identities.next().value)
        .withEligibleDefaults()
        .withCountry(country)
        .withExternalStake(1_000_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 10_000 })),
      ...Array.from({ length: 10 }, (_, idx) => new ValidatorMockBuilder(`country-aso-validator-${idx}`, identities.next().value)
        .withEligibleDefaults()
        .withCountry(country)
        .withAso(aso)
        .withExternalStake(1_000_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 10_000 })),
      ...Array.from({ length: 10 }, (_, idx) => new ValidatorMockBuilder(`aso-validator-${idx}`, identities.next().value)
        .withEligibleDefaults()
        .withAso(aso)
        .withExternalStake(1_000_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 10_000 })),
      ...Array.from({ length: 20 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 10_000 })
        .withExternalStake(10_000_000))
    ]
    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
    const result = await dsSam.run()

    const countryExternalStake = result.auctionData.validators.reduce((sum, validator) => validator.country === country ? sum + validator.totalActivatedStakeSol : sum, 0)
    const asoExternalStake = result.auctionData.validators.reduce((sum, validator) => validator.aso === aso ? sum + validator.totalActivatedStakeSol : sum, 0)
    const countryMarinadeStake = result.auctionData.validators.reduce((sum, validator) => validator.country === country ? sum + validator.auctionStake.marinadeSamTargetSol + validator.auctionStake.marinadeMndeTargetSol : sum, 0)
    const asoMarinadeStake = result.auctionData.validators.reduce((sum, validator) => validator.aso === aso ? sum + validator.auctionStake.marinadeSamTargetSol + validator.auctionStake.marinadeMndeTargetSol : sum, 0)

    expect(countryMarinadeStake + countryExternalStake).toBeLessThan(result.auctionData.stakeAmounts.networkTotalSol * 0.3)
    expect(asoMarinadeStake + asoExternalStake).toBeLessThan(result.auctionData.stakeAmounts.networkTotalSol * 0.3)
    // Currently Mariande stake country and aso constraints are disabled
    expect(countryMarinadeStake).toBeLessThanOrEqual((result.auctionData.stakeAmounts.marinadeMndeTvlSol + result.auctionData.stakeAmounts.marinadeSamTvlSol) * 1)
    expect(asoMarinadeStake).toBeLessThanOrEqual((result.auctionData.stakeAmounts.marinadeMndeTvlSol + result.auctionData.stakeAmounts.marinadeSamTvlSol) * 1)
    expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
  })

  it('applies global stake concentration constraints', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()
    const country = 'dummy-country'
    const aso = 'dummy-aso'

    const validators = [
      ...Array.from({ length: 20 }, (_, idx) => new ValidatorMockBuilder(`country-validator-${idx}`, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withCountry(country)
        .withNativeStake(0)
        .withLiquidStake(0)
        .withExternalStake(1_490_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 10_000 })),
      ...Array.from({ length: 20 }, (_, idx) => new ValidatorMockBuilder(`country-aso-validator-${idx}`, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withCountry(country)
        .withAso(aso)
        .withNativeStake(0)
        .withLiquidStake(0)
        .withExternalStake(1_490_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 10_000 })),
      ...Array.from({ length: 20 }, (_, idx) => new ValidatorMockBuilder(`aso-validator-${idx}`, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withAso(aso)
        .withNativeStake(0)
        .withLiquidStake(0)
        .withExternalStake(2_000_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 1_000_000 })),
      ...Array.from({ length: 20 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withMndeVotes(0)
        .withNativeStake(0)
        .withLiquidStake(3_000_000)
        .withExternalStake(5_520_000)),
    ]
    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
    const result = await dsSam.run()

    const countryExternalStake = result.auctionData.validators.reduce((sum, validator) => validator.country === country ? sum + validator.totalActivatedStakeSol : sum, 0)
    const asoExternalStake = result.auctionData.validators.reduce((sum, validator) => validator.aso === aso ? sum + validator.totalActivatedStakeSol : sum, 0)
    const countryMarinadeStake = result.auctionData.validators.reduce((sum, validator) => validator.country === country ? sum + validator.auctionStake.marinadeSamTargetSol : sum, 0)
    const asoMarinadeStake = result.auctionData.validators.reduce((sum, validator) => validator.aso === aso ? sum + validator.auctionStake.marinadeSamTargetSol : sum, 0)

    expect(countryMarinadeStake + countryExternalStake).toBeLessThanOrEqual(result.auctionData.stakeAmounts.networkTotalSol * 0.3)
    expect(asoMarinadeStake + asoExternalStake).toBeLessThanOrEqual(result.auctionData.stakeAmounts.networkTotalSol * 0.3)
    // Currently Marinade country and aso constraints are disabled
    expect(countryMarinadeStake).toBeLessThan(result.auctionData.stakeAmounts.marinadeSamTvlSol * 1)
    expect(asoMarinadeStake).toBeLessThan(result.auctionData.stakeAmounts.marinadeSamTvlSol * 1)
    expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
  })

  it('applies validator stake concentration constraints', async () => {
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()

    const validators = [
      new ValidatorMockBuilder('dummy-validator', identities.next().value)
        .withEligibleDefaults()
        .withNativeStake(0)
        .withLiquidStake(0)
        .withExternalStake(100_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 10_000 }),
      ...Array.from({ length: 9 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withNativeStake(0)
        .withLiquidStake(0)
        .withExternalStake(100_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 1, balance: 1 })),
      ...Array.from({ length: 10 }, () => new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withEligibleDefaults()
        .withNativeStake(0)
        .withLiquidStake(10_000)
        .withExternalStake(10_000_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 1 })),
    ]
    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder(validators))
    const result = await dsSam.run()

    const { auctionStake } = findValidatorInResult('dummy-validator', result)!

    // 100_000 * 0.02 -> TVL * Default cap per validator
    // (0.1 * 100 / 2000) * 100_000 -> (mndeStakeCapMultiplier * validator MNDE votes / total MNDE votes) * TVL
    expect(auctionStake.marinadeSamTargetSol).toStrictEqual(100_000 * 0.02 + (0.1 * 100 / 2000) * 100_000)
    expect(prettyPrintAuctionResult(result)).toMatchSnapshot()
  })
})
