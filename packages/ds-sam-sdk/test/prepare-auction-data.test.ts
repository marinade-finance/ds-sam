import Decimal from 'decimal.js'

import { Auction } from '../src/auction'
import { AuctionConstraints } from '../src/constraints'
import { Debug } from '../src/debug'
import { buildAuctionConstraintsConfig } from '../src/engine-config'
import { DsSamSDK } from '../src/sdk'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

import type { AuctionResult } from '@marinade.finance/ds-sam-calc'

// native structuredClone throws on the Decimal instances in AggregatedValidator.epochStats (ds-sam-calc EpochStats)
const cloneAuctionData = <T>(value: T): T => {
  if (value instanceof Decimal) {
    return new Decimal(value) as T
  }
  if (Array.isArray(value)) {
    return value.map(cloneAuctionData) as T
  }
  if (value instanceof Set) {
    return new Set(Array.from(value, cloneAuctionData)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneAuctionData(v)])) as T
  }
  return value
}

const buildValidators = () => {
  const voteAccounts = generateVoteAccounts()
  const identities = generateIdentities()
  return Array.from({ length: 5 }, () =>
    new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value).withEligibleDefaults(),
  )
}

const comparable = (result: AuctionResult) => ({
  winningTotalPmpe: result.winningTotalPmpe,
  validators: result.auctionData.validators
    .map(v => ({
      voteAccount: v.voteAccount,
      marinadeSamTargetSol: v.auctionStake.marinadeSamTargetSol,
      revShare: v.revShare,
      values: v.values,
    }))
    .sort((a, b) => a.voteAccount.localeCompare(b.voteAccount)),
})

describe('prepareAuctionData', () => {
  it('reruns from pre-evaluation data match sdk.run(), and rerunning again is stable', async () => {
    const providerBuilder = defaultStaticDataProviderBuilder(buildValidators())

    const sdk = new DsSamSDK({}, providerBuilder)
    const prepared = await sdk.prepareAuctionData()
    const preEvaluationClone = cloneAuctionData(prepared.auctionData)

    const firstRerun = new Auction(
      prepared.auctionData,
      prepared.constraints,
      sdk.config,
      new Debug(new Set(), sdk.config.logVerbosity),
    ).evaluate()

    const freshResult = await new DsSamSDK({}, providerBuilder).run()

    expect(comparable(firstRerun)).toEqual(comparable(freshResult))

    const secondConstraints = new AuctionConstraints(
      buildAuctionConstraintsConfig(sdk.config, prepared.aggregatedData),
      new Debug(new Set(), sdk.config.logVerbosity),
    )
    const secondRerun = new Auction(
      cloneAuctionData(preEvaluationClone),
      secondConstraints,
      sdk.config,
      new Debug(new Set(), sdk.config.logVerbosity),
    ).evaluate()

    expect(comparable(secondRerun)).toEqual(comparable(firstRerun))
  })
})
