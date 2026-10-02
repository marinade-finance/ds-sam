import { DsSamSDK } from '../src'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { assertValidatorIneligible, findValidatorInResult } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

const NO_COMMISSION_SOURCES = { effective: null, advertised: null }

describe('unresolved on-chain inflation commission', () => {
  it('excludes a validator with no resolvable rate and no Marinade stake', async () => {
    const voteAccounts = generateVoteAccounts('unresolved')
    const identities = generateIdentities()

    const unresolvedVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources(NO_COMMISSION_SOURCES)
      .withNativeStake(0)
      .withLiquidStake(0)
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const goodVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const networkBallast = new ValidatorMockBuilder(
      voteAccounts.next().value,
      identities.next().value,
    ).withExternalStake(2_000_000)

    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder([unresolvedVal, goodVal, networkBallast]))
    const result = await dsSam.run()

    const validator = findValidatorInResult(unresolvedVal.voteAccount, result)
    assertValidatorIneligible(validator)
    expect(validator?.backstopEligible).toStrictEqual(false)
    expect(validator?.values.commissions.inflationCommissionOnchainDec).toBeNull()
    expect(validator?.revShare.inflationPmpe).toStrictEqual(0)
    // MEV stays resolvable, so only the inflation half of the on-chain share drops out
    expect(validator?.revShare.onchainDistributedPmpe).toStrictEqual(validator?.revShare.mevPmpe)
    expect(findValidatorInResult(goodVal.voteAccount, result)?.auctionStake.marinadeSamTargetSol).toBeGreaterThan(0)
  })

  it('never charges a bond top-up it cannot measure', async () => {
    const voteAccounts = generateVoteAccounts('unresolved-bond')
    const identities = generateIdentities()

    // In-bond rate present, on-chain rate unknown: the old `?? 100` made the on-chain share 0 and
    // billed the whole in-bond inflation share a second time.
    const unresolvedVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources(NO_COMMISSION_SOURCES)
      .withNativeStake(0)
      .withLiquidStake(0)
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100, bondInflationCommission: 5 })
    const goodVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const networkBallast = new ValidatorMockBuilder(
      voteAccounts.next().value,
      identities.next().value,
    ).withExternalStake(2_000_000)

    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder([unresolvedVal, goodVal, networkBallast]))
    const result = await dsSam.run()

    const validator = findValidatorInResult(unresolvedVal.voteAccount, result)
    expect(validator?.values.commissions.inflationCommissionOnchainDec).toBeNull()
    expect(validator?.values.commissions.inflationCommissionInBondDec).toStrictEqual(0.05)
    expect(validator?.revShare.bondObligationPmpe).toStrictEqual(validator?.revShare.bidPmpe)
  })

  it('throws when a validator holding Marinade stake has no resolvable rate', async () => {
    const voteAccounts = generateVoteAccounts('unresolved-staked')
    const identities = generateIdentities()

    const stakedUnresolvedVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources(NO_COMMISSION_SOURCES)
      .withNativeStake(1_000)
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const networkBallast = new ValidatorMockBuilder(
      voteAccounts.next().value,
      identities.next().value,
    ).withExternalStake(2_000_000)

    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder([stakedUnresolvedVal, networkBallast]))

    await expect(dsSam.run()).rejects.toThrow(
      new RegExp(
        `No resolvable on-chain inflation commission for 1 validator\\(s\\).*${stakedUnresolvedVal.voteAccount}`,
      ),
    )
  })

  it('falls back to commission_advertised when commission_effective is null', async () => {
    const voteAccounts = generateVoteAccounts('advertised-fallback')
    const identities = generateIdentities()

    const fallbackVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources({ effective: null, advertised: 5 })
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const networkBallast = new ValidatorMockBuilder(
      voteAccounts.next().value,
      identities.next().value,
    ).withExternalStake(2_000_000)

    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder([fallbackVal, networkBallast]))
    const result = await dsSam.run()

    const validator = findValidatorInResult(fallbackVal.voteAccount, result)
    expect(validator?.values.commissions.inflationCommissionOnchainDec).toStrictEqual(0.05)
    expect(validator?.values.commissions.inflationCommissionOnchainSource).toStrictEqual('advertised')
    expect(validator?.samEligible).toStrictEqual(true)
    expect(validator?.revShare.onchainDistributedPmpe).toBeGreaterThan(0)
  })

  it('records which API field supplied the on-chain rate', async () => {
    const voteAccounts = generateVoteAccounts('commission-source')
    const identities = generateIdentities()

    const effectiveVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources({ effective: 4, advertised: 9 })
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const unresolvedVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources(NO_COMMISSION_SOURCES)
      .withNativeStake(0)
      .withLiquidStake(0)
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const networkBallast = new ValidatorMockBuilder(
      voteAccounts.next().value,
      identities.next().value,
    ).withExternalStake(2_000_000)

    const dsSam = new DsSamSDK({}, defaultStaticDataProviderBuilder([effectiveVal, unresolvedVal, networkBallast]))
    const result = await dsSam.run()

    const effective = findValidatorInResult(effectiveVal.voteAccount, result)
    expect(effective?.values.commissions.inflationCommissionOnchainSource).toStrictEqual('effective')
    expect(effective?.values.commissions.inflationCommissionOnchainDec).toStrictEqual(0.04)

    const unresolved = findValidatorInResult(unresolvedVal.voteAccount, result)
    expect(unresolved?.values.commissions.inflationCommissionOnchainSource).toBeUndefined()
    expect(unresolved?.values.commissions.inflationCommissionOnchainDec).toBeNull()
  })

  it('reads the effective rate from its bps, keeping the whole percent as the fallback', async () => {
    const voteAccounts = generateVoteAccounts('effective-bps')
    const identities = generateIdentities()

    const fractionalVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources({ effective: 7, advertised: 9 })
      .withCommissionEffectiveBps(650)
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const noBpsVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources({ effective: 7, advertised: 9 })
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    // DS2 never pairs bps with a null effective rate; if it did, the advertised fallback must still win
    const advertisedVal = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withEligibleDefaults()
      .withInflationCommissionSources({ effective: null, advertised: 9 })
      .withCommissionEffectiveBps(650)
      .withBond({ stakeWanted: 150_000, cpmpe: 1, balance: 100 })
    const networkBallast = new ValidatorMockBuilder(
      voteAccounts.next().value,
      identities.next().value,
    ).withExternalStake(2_000_000)

    const dsSam = new DsSamSDK(
      {},
      defaultStaticDataProviderBuilder([fractionalVal, noBpsVal, advertisedVal, networkBallast]),
    )
    const result = await dsSam.run()

    const fractional = findValidatorInResult(fractionalVal.voteAccount, result)
    expect(fractional?.values.commissions.inflationCommissionOnchainDec).toStrictEqual(0.065)
    expect(fractional?.values.commissions.inflationCommissionOnchainSource).toStrictEqual('effective')

    const noBps = findValidatorInResult(noBpsVal.voteAccount, result)
    expect(noBps?.values.commissions.inflationCommissionOnchainDec).toStrictEqual(0.07)
    expect(noBps?.values.commissions.inflationCommissionOnchainSource).toStrictEqual('effective')

    const advertised = findValidatorInResult(advertisedVal.voteAccount, result)
    expect(advertised?.values.commissions.inflationCommissionOnchainDec).toStrictEqual(0.09)
    expect(advertised?.values.commissions.inflationCommissionOnchainSource).toStrictEqual('advertised')
  })
})
