import { DsSamSDK } from '../src'
import { calcBidTooLowPenalty, calcEffParticipatingBidPmpe } from '../src/calculations'
import { commissionDetailsFor, revShareForCommissions } from './helpers/auction-test-utils'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { findValidatorInResult } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

import type { RevShare } from '../src/types'
import type { AuctionValidator } from '../src/types'

const REWARDS = { inflationPmpe: 0.4, mevPmpe: 0.05, blockPmpe: 0 }
const BID = 0.005
const STAKE_SOL = 100000

const revShareFor = (onchainInflationDec: number, inBondInflationDec: number | null, bidCpmpe: number): RevShare =>
  revShareForCommissions(REWARDS, onchainInflationDec, inBondInflationDec, bidCpmpe)

const pastAuction = (inflationCommissionDec: number, mevCommissionDec: number, bidPmpe: number) => ({
  present: true,
  bidPmpe,
  // stale estimate-based values must be ignored by the commitment reconstruction
  totalPmpe: 999,
  effParticipatingBidPmpe: 999,
  bondObligationPmpe: 999,
  commissions: {
    inflationCommissionDec,
    mevCommissionDec,
    blockRewardsCommissionDec: 1,
  },
})

// placeholder fabricated by extractAuctionHistoryStats for an epoch with no record of the validator
const absentAuction = () => ({
  present: false,
  bidPmpe: 0,
  totalPmpe: 0,
  effParticipatingBidPmpe: 0,
  bondObligationPmpe: 0,
  commissions: {
    inflationCommissionDec: 1,
    mevCommissionDec: 1,
    blockRewardsCommissionDec: 1,
  },
})

const penaltyFor = ({
  revShare,
  winningTotalPmpe,
  prevAuctions,
}: {
  revShare: RevShare
  winningTotalPmpe: number
  prevAuctions: object[]
}) => {
  revShare.effParticipatingBidPmpe = calcEffParticipatingBidPmpe(revShare, winningTotalPmpe)
  const validator = {
    revShare,
    auctions: prevAuctions,
    bidTooLowPenalty: { coef: NaN, base: NaN },
    marinadeActivatedStakeSol: STAKE_SOL,
    values: { commissions: null },
  } as unknown as AuctionValidator
  return calcBidTooLowPenalty({
    rewards: REWARDS,
    winningTotalPmpe,
    validator,
  })
}

describe('calcBidTooLowPenalty (commitment formula, GEN-7037)', () => {
  it('charges an onchain commission raise with no in-bond config (commission trigger enabled)', () => {
    const winningTotalPmpe = 0.45
    const revShare = revShareFor(0.05, null, BID)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      prevAuctions: [pastAuction(0, 0, BID)],
    })
    const prevCommitment = 0.4 + 0.05 + BID
    const expectedShortfall = prevCommitment - revShare.totalPmpe
    expect(res.bidTooLowPenalty.prevCommitmentPmpe).toBeCloseTo(prevCommitment, 12)
    expect(res.bidTooLowPenalty.shortfallPmpe).toBeCloseTo(expectedShortfall, 12)
    expect(res.bidTooLowPenaltyPmpe).toBeCloseTo(expectedShortfall, 12)
    expect(res.paidUndelegationSol).toBeCloseTo((res.bidTooLowPenaltyPmpe * STAKE_SOL) / winningTotalPmpe, 8)
  })

  it('charges the onchain overshoot the same as the honest raise', () => {
    const winningTotalPmpe = 0.45
    const honest = penaltyFor({
      revShare: revShareFor(0.05, null, BID),
      winningTotalPmpe,
      prevAuctions: [pastAuction(0, 0, BID)],
    })
    const overshoot = penaltyFor({
      revShare: revShareFor(0.1, 0.05, BID),
      winningTotalPmpe,
      prevAuctions: [pastAuction(0, 0, BID)],
    })
    expect(overshoot.bidTooLowPenaltyPmpe).toBeGreaterThan(0)
    expect(overshoot.bidTooLowPenaltyPmpe).toBeCloseTo(honest.bidTooLowPenaltyPmpe, 12)
  })

  it('never charges a validator whose offer still clears the auction', () => {
    const res = penaltyFor({
      revShare: revShareFor(0.05, null, BID),
      winningTotalPmpe: 0.43,
      prevAuctions: [pastAuction(0, 0, BID)],
    })
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
    expect(res.paidUndelegationSol).toBe(0)
  })

  it('charges a gradual decommitment only its one-epoch shortfall (no cliff)', () => {
    const winningTotalPmpe = 0.46
    const firstStep = revShareFor(0.011, null, BID)
    const first = penaltyFor({
      revShare: firstStep,
      winningTotalPmpe,
      prevAuctions: [pastAuction(0, 0, BID)],
    })
    expect(first.bidTooLowPenaltyPmpe).toBeCloseTo(0.4 + 0.05 + BID - firstStep.totalPmpe, 12)

    const secondStep = revShareFor(0.022, null, BID)
    const second = penaltyFor({
      revShare: secondStep,
      winningTotalPmpe,
      prevAuctions: [pastAuction(0.011, 0, BID)],
    })
    expect(second.bidTooLowPenaltyPmpe).toBeCloseTo(firstStep.totalPmpe - secondStep.totalPmpe, 12)
  })

  it('ignores reward estimate drift when settings are unchanged', () => {
    const res = penaltyFor({
      revShare: revShareFor(0.05, null, BID),
      winningTotalPmpe: 0.46,
      prevAuctions: [pastAuction(0.05, 0, BID)],
    })
    expect(res.bidTooLowPenalty.shortfallPmpe).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('does not charge a newcomer without auction history', () => {
    const res = penaltyFor({
      revShare: revShareFor(0.05, null, BID),
      winningTotalPmpe: 0.45,
      prevAuctions: [],
    })
    expect(res.bidTooLowPenalty.prevCommitmentPmpe).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('falls back to the nearest present record when the previous epoch record is missing', () => {
    const winningTotalPmpe = 0.45
    const revShare = revShareFor(0.05, null, BID)
    const direct = penaltyFor({
      revShare: revShareFor(0.05, null, BID),
      winningTotalPmpe,
      prevAuctions: [pastAuction(0, 0, BID)],
    })
    const gapped = penaltyFor({
      revShare,
      winningTotalPmpe,
      prevAuctions: [absentAuction(), absentAuction(), pastAuction(0, 0, BID)],
    })
    expect(gapped.bidTooLowPenaltyPmpe).toBeGreaterThan(0)
    expect(gapped.bidTooLowPenaltyPmpe).toBeCloseTo(direct.bidTooLowPenaltyPmpe, 12)
  })

  it('does not look for a present record past the history window', () => {
    const res = penaltyFor({
      revShare: revShareFor(0.05, null, BID),
      winningTotalPmpe: 0.45,
      prevAuctions: [absentAuction(), absentAuction(), absentAuction(), pastAuction(0, 0, BID)],
    })
    expect(res.bidTooLowPenalty.prevCommitmentPmpe).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('reduces the commitment to the recorded bid when commission history is missing (all-1 fallback)', () => {
    const winningTotalPmpe = 0.45
    const noBid = penaltyFor({
      revShare: revShareFor(0.05, null, BID),
      winningTotalPmpe,
      prevAuctions: [pastAuction(1, 1, 0)],
    })
    expect(noBid.bidTooLowPenalty.prevCommitmentPmpe).toBe(0)
    expect(noBid.bidTooLowPenaltyPmpe).toBe(0)

    const withBid = penaltyFor({
      revShare: revShareFor(0.05, null, 0),
      winningTotalPmpe,
      prevAuctions: [pastAuction(1, 1, 0.02)],
    })
    expect(withBid.bidTooLowPenalty.prevCommitmentPmpe).toBeCloseTo(0.02, 12)
    expect(withBid.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('charges a pump-and-dump against the pumped commitment', () => {
    const winningTotalPmpe = 0.45
    const revShare = revShareFor(0.05, null, 0)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      prevAuctions: [pastAuction(-0.1, 0, 0.02)],
    })
    const pumpedCommitment = 0.4 * 1.1 + 0.05 + 0.02
    const expectedShortfall = pumpedCommitment - revShare.totalPmpe
    expect(res.bidTooLowPenalty.prevCommitmentPmpe).toBeCloseTo(pumpedCommitment, 12)
    expect(res.bidTooLowPenaltyPmpe).toBeCloseTo(expectedShortfall, 12)
  })

  it('clamps the penalty at the base cap', () => {
    const winningTotalPmpe = 0.45
    const revShare = revShareFor(0.9, null, 0)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      prevAuctions: [pastAuction(-2, 0, 0.02)],
    })
    expect(res.bidTooLowPenalty.shortfallPmpe).toBeGreaterThan(res.bidTooLowPenalty.base)
    expect(res.bidTooLowPenaltyPmpe).toBeCloseTo(res.bidTooLowPenalty.base, 12)
    expect(res.bidTooLowPenalty.coef).toBeCloseTo(1, 12)
  })

  it('charges a direct bid reduction (legacy trigger parity)', () => {
    const winningTotalPmpe = 0.45
    const revShare = revShareFor(0.05, null, BID)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      prevAuctions: [pastAuction(0.05, 0, 0.02)],
    })
    const prevCommitment = 0.38 + 0.05 + 0.02
    const expectedShortfall = prevCommitment - revShare.totalPmpe
    expect(res.bidTooLowPenaltyPmpe).toBeCloseTo(expectedShortfall, 12)
  })
})

describe('bid too low penalty (DsSamSDK integration)', () => {
  it('applies the commitment penalty through the auction', async () => {
    const PREV_EPOCH = 999
    const voteAccounts = generateVoteAccounts()
    const identities = generateIdentities()
    const baseValidator = () =>
      new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
        .withGoodPerformance()
        .withMevCommission(0)
        .withLiquidStake(100_000)
        .withNativeStake(50_000)
        .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 100 })
    const prevAuctionEntry = {
      epoch: PREV_EPOCH,
      marinadeSamTargetSol: 1000,
      // stale estimate-based values that the commitment reconstruction must ignore
      totalPmpe: 999,
      bondObligationPmpe: 999,
      onchainDistributedPmpe: 999,
    }
    // large external-stake validator sets a realistic network size (and thus PMPE scale)
    const network = new ValidatorMockBuilder(voteAccounts.next().value, identities.next().value)
      .withGoodPerformance()
      .withInflationCommission(100)
      .withExternalStake(500_000_000)
    const winners = Array.from({ length: 50 }, () => baseValidator())
    const decommitted = baseValidator()
      .withInflationCommission(10)
      .withAuctionEntry({ ...prevAuctionEntry, commissions: commissionDetailsFor(0, null) })
    const stable = baseValidator()
      .withInflationCommission(5)
      .withAuctionEntry({ ...prevAuctionEntry, commissions: commissionDetailsFor(0.05, null) })
    const missingHistory = baseValidator().withInflationCommission(10).withAuctionEntry(prevAuctionEntry)

    const dsSam = new DsSamSDK(
      {},
      defaultStaticDataProviderBuilder([network, ...winners, decommitted, stable, missingHistory]),
    )
    const result = await dsSam.run()
    const { rewards } = result.auctionData

    const charged = findValidatorInResult(decommitted.voteAccount, result)
    if (charged == null) {
      throw new Error('decommitted validator missing in auction result')
    }
    expect(charged.revShare.totalPmpe).toBeLessThan(result.winningTotalPmpe)
    const prevCommitment = rewards.inflationPmpe + rewards.mevPmpe
    expect(charged.bidTooLowPenalty.prevCommitmentPmpe).toBeCloseTo(prevCommitment, 9)
    const shortfall = prevCommitment - charged.revShare.totalPmpe
    const expectedPenalty = Math.min(shortfall, result.winningTotalPmpe + charged.revShare.effParticipatingBidPmpe)
    expect(charged.revShare.bidTooLowPenaltyPmpe).toBeGreaterThan(0)
    expect(charged.revShare.bidTooLowPenaltyPmpe).toBeCloseTo(expectedPenalty, 9)
    expect(charged.values.paidUndelegationSol).toBeGreaterThan(0)

    expect(findValidatorInResult(stable.voteAccount, result)?.revShare.bidTooLowPenaltyPmpe).toBe(0)

    const fallback = findValidatorInResult(missingHistory.voteAccount, result)
    expect(fallback?.bidTooLowPenalty.prevCommitmentPmpe).toBe(0)
    expect(fallback?.revShare.bidTooLowPenaltyPmpe).toBe(0)
  })
})
