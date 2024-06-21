import { DsSamConfig } from "src";
import { ValidatorMockBuilder } from "./validator-mock-builder";
import { StaticDataProvider } from "./static-data-provider";

export class StaticDataProviderBuilder {
  private validatorMockBuilders: ValidatorMockBuilder[] | null = null
  private inflationRewardsPerEpoch: number | null = null
  private mevRewardsPerEpoch: number | null = null
  private currentEpoch: number | null = null

  withValidators(validatorMockBuilders: ValidatorMockBuilder[]) {
    this.validatorMockBuilders = validatorMockBuilders
    return this
  }

  withInflationRewardsPerEpoch(inflationRewardsPerEpoch: number) {
    this.inflationRewardsPerEpoch = inflationRewardsPerEpoch
    return this
  }

  withMevRewardsPerEpoch(mevRewardsPerEpoch: number) {
    this.mevRewardsPerEpoch = mevRewardsPerEpoch
    return this
  }

  withCurrentEpoch(epoch: number) {
    this.currentEpoch = epoch
    return this
  }

  builder() {
    const { validatorMockBuilders, inflationRewardsPerEpoch, mevRewardsPerEpoch, currentEpoch } = this
    if (validatorMockBuilders === null) {
      throw new Error('StaticDataProviderBuilder needs validators to be set')
    }
    if (inflationRewardsPerEpoch === null) {
      throw new Error('StaticDataProviderBuilder needs inflation rewards per epoch to be set')
    }
    if (mevRewardsPerEpoch === null) {
      throw new Error('StaticDataProviderBuilder needs MEV rewards per epoch to be set')
    }
    if (currentEpoch === null) {
      throw new Error('StaticDataProviderBuilder needs current epoch to be set')
    }

    return (config: DsSamConfig) => new StaticDataProvider(config, {
      validatorMockBuilders,
      inflationRewardsPerEpoch,
      mevRewardsPerEpoch,
      currentEpoch,
    })
  }
}

export const defaultStaticDataProviderBuilder = (validators: ValidatorMockBuilder[]) => new StaticDataProviderBuilder()
  .withCurrentEpoch(1000)
  .withInflationRewardsPerEpoch(200000)
  .withMevRewardsPerEpoch(50000)
  .withValidators(validators)
  .builder()