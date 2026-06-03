import { calcBidTooLowPenalty, calcValidatorRevShare } from '../src/calculations'
import { effectiveCommissions } from '../src/utils'

import type { RevShare } from '../src/types'
import type { AuctionValidator } from '../src/types'

const REWARDS = { inflationPmpe: 0.4, mevPmpe: 0.05, blockPmpe: 0 }
const BID = 0.005
const PERMITTED_DEVIATION = 0.01
const HISTORY_EPOCHS = 3

const revShareFor = (onchainInflationDec: number, inBondInflationDec: number | null, bidCpmpe: number): RevShare => {
  const effective = effectiveCommissions(onchainInflationDec, inBondInflationDec, 0, null)
  return calcValidatorRevShare(
    {
      voteAccount: 'validator',
      inflationCommissionDec: effective.inflationDec,
      mevCommissionDec: effective.mevDec,
      blockRewardsCommissionDec: null,
      bidCpmpe,
      values: {
        commissions: {
          inflationCommissionDec: effective.inflationDec,
          mevCommissionDec: effective.mevDec ?? 1,
          blockRewardsCommissionDec: 1,
          inflationCommissionOnchainDec: onchainInflationDec,
          inflationCommissionInBondDec: inBondInflationDec,
          mevCommissionOnchainDec: 0,
          mevCommissionInBondDec: null,
          blockRewardsCommissionInBondDec: null,
        },
      },
    },
    REWARDS,
  )
}

const penaltyFor = ({
  revShare,
  winningTotalPmpe,
  pastEffParticipating,
  pastBidPmpe,
}: {
  revShare: RevShare
  winningTotalPmpe: number
  pastEffParticipating: number[]
  pastBidPmpe: number
}) => {
  revShare.effParticipatingBidPmpe = Math.max(0, winningTotalPmpe - revShare.onchainDistributedPmpe)
  const validator = {
    revShare,
    auctions: pastEffParticipating.map(effParticipatingBidPmpe => ({
      effParticipatingBidPmpe,
      bidPmpe: pastBidPmpe,
    })),
    bidTooLowPenalty: { coef: NaN, base: NaN },
    marinadeActivatedStakeSol: 100000,
    values: { commissions: null },
  } as unknown as AuctionValidator
  return calcBidTooLowPenalty({
    historyEpochs: HISTORY_EPOCHS,
    winningTotalPmpe,
    validator,
    permittedBidDeviation: PERMITTED_DEVIATION,
  })
}

// The commission-based trigger is disabled in calcBidTooLowPenalty; the penalty magnitude
// path is shared with the bid trigger, so scenarios force it via a marginal bid decrease.
const TRIGGERING_PAST_BID = BID * 1.01

describe('bid too low penalty on commission changes (GEN-7037 exploration)', () => {
  it('commission raise alone does not fire the penalty today (commission trigger disabled)', () => {
    const revShare = revShareFor(0.05, null, BID)
    expect(revShare.bondObligationPmpe).toBeCloseTo(BID, 12)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe: 0.455,
      pastEffParticipating: [0.005, 0.005, 0.005],
      pastBidPmpe: BID,
    })
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('onchain raise 0% -> 5% with no in-bond config keeps bondObligationPmpe untouched', () => {
    const before = revShareFor(0, null, BID)
    const after = revShareFor(0.05, null, BID)
    expect(after.bondObligationPmpe).toBeCloseTo(before.bondObligationPmpe, 12)
    expect(after.onchainDistributedPmpe).toBeCloseTo(before.onchainDistributedPmpe - 0.02, 12)
    expect(after.totalPmpe).toBeCloseTo(before.totalPmpe - 0.02, 12)
  })

  it('onchain raise 0% -> 5% with no in-bond config yields zero fee even when the trigger fires', () => {
    const revShare = revShareFor(0.05, null, BID)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe: 0.455,
      // floor still holds the 0%-commission era values W - G = 0.005
      pastEffParticipating: [0.005, 0.005, 0.005],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(revShare.effParticipatingBidPmpe).toBeCloseTo(0.025, 12)
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('onchain raise with in-bond pinned at 0% keeps totalPmpe and moves the cost to the bond', () => {
    const before = revShareFor(0, 0, BID)
    const after = revShareFor(0.05, 0, BID)
    expect(after.totalPmpe).toBeCloseTo(before.totalPmpe, 12)
    expect(before.bondObligationPmpe).toBeCloseTo(BID, 12)
    expect(after.bondObligationPmpe).toBeCloseTo(BID + 0.02, 12)
  })

  it('in-bond raise that keeps totalPmpe above the clearing price pays no fee', () => {
    const winningTotalPmpe = 0.44
    const revShare = revShareFor(0.05, 0.02, BID)
    expect(revShare.totalPmpe).toBeGreaterThanOrEqual(winningTotalPmpe)
    expect(revShare.bondObligationPmpe).toBeCloseTo(0.017, 12)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      pastEffParticipating: [0.01, 0.01, 0.01],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('the 1% slack does not renew: a second small in-bond step pays a fee', () => {
    const winningTotalPmpe = 0.44
    const floor = 0.01
    const withinSlack = revShareFor(0.05, 0.0376, BID)
    expect(withinSlack.bondObligationPmpe).toBeCloseTo(0.00996, 12)
    const first = penaltyFor({
      revShare: withinSlack,
      winningTotalPmpe,
      pastEffParticipating: [floor, floor, floor],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(first.bidTooLowPenalty.coef).toBe(0)

    // next epoch the floor is unchanged (effParticipating tracks clearing price, not own commitment)
    const nextStep = revShareFor(0.05, 0.0378, BID)
    expect(nextStep.bondObligationPmpe).toBeCloseTo(0.00988, 12)
    const second = penaltyFor({
      revShare: nextStep,
      winningTotalPmpe,
      pastEffParticipating: [floor, floor, floor],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    const adjustedLimit = floor * (1 - PERMITTED_DEVIATION)
    const expectedCoef = Math.min(1, Math.sqrt((1.5 * (adjustedLimit - nextStep.bondObligationPmpe)) / adjustedLimit))
    expect(second.bidTooLowPenalty.coef).toBeCloseTo(expectedCoef, 12)
    expect(second.bidTooLowPenalty.coef).toBeGreaterThan(0)
  })

  it('full 0% -> 5% effective jump is free within the 3-epoch history window and maximal after it', () => {
    const winningTotalPmpe = 0.455
    const revShare = revShareFor(0.05, 0.05, BID)
    expect(revShare.bondObligationPmpe).toBeCloseTo(BID, 12)

    // onchain was raised last epoch; older history still holds the low 0%-era floor
    const withinWindow = penaltyFor({
      revShare: revShareFor(0.05, 0.05, BID),
      winningTotalPmpe,
      pastEffParticipating: [0.025, 0.005, 0.005],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(withinWindow.bidTooLowPenalty.coef).toBe(0)

    const afterWindow = penaltyFor({
      revShare: revShareFor(0.05, 0.05, BID),
      winningTotalPmpe,
      pastEffParticipating: [0.025, 0.025, 0.025],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(afterWindow.bidTooLowPenalty.coef).toBe(1)
    expect(afterWindow.bidTooLowPenaltyPmpe).toBeCloseTo(winningTotalPmpe + 0.025, 12)
  })

  it('overshooting onchain commission keeps bondObligationPmpe above the floor at 5% effective', () => {
    const winningTotalPmpe = 0.455
    const revShare = revShareFor(0.1, 0.05, BID)
    expect(revShare.bondObligationPmpe).toBeCloseTo(0.025, 12)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      pastEffParticipating: [0.025, 0.025, 0.025],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })
})
