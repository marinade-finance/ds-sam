import {
  calcBidTooLowPenalty,
  calcEffParticipatingBidPmpe,
  calcValidatorRevShare,
  effectiveCommissions,
} from '@marinade.finance/ds-sam-calc'

import type { CommissionDetails, RevShare, AuctionValidator } from '@marinade.finance/ds-sam-calc'

const REWARDS = { inflationPmpe: 0.4, mevPmpe: 0.05, blockPmpe: 0 }
const BID = 0.005
const PERMITTED_DEVIATION = 0.01
const HISTORY_EPOCHS = 3

const commissionsFor = (onchainInflationDec: number, inBondInflationDec: number | null): CommissionDetails => {
  const effective = effectiveCommissions(onchainInflationDec, inBondInflationDec, 0, null)
  return {
    inflationCommissionDec: effective.inflationDec,
    mevCommissionDec: effective.mevDec ?? 1,
    blockRewardsCommissionDec: 1,
    inflationCommissionOnchainDec: onchainInflationDec,
    inflationCommissionInBondDec: inBondInflationDec,
    mevCommissionOnchainDec: 0,
    mevCommissionInBondDec: null,
    blockRewardsCommissionInBondDec: null,
  }
}

const revShareFor = (
  onchainInflationDec: number,
  inBondInflationDec: number | null,
  bidCpmpe: number,
): RevShare & { commissions: CommissionDetails } => {
  const commissions = commissionsFor(onchainInflationDec, inBondInflationDec)
  const revShare = calcValidatorRevShare(
    {
      voteAccount: 'validator',
      inflationCommissionDec: commissions.inflationCommissionDec,
      mevCommissionDec: commissions.mevCommissionDec,
      blockRewardsCommissionDec: null,
      bidCpmpe,
      values: { commissions },
    },
    REWARDS,
  )
  return { ...revShare, commissions }
}

const penaltyFor = ({
  revShare,
  winningTotalPmpe,
  pastEffParticipating,
  pastBidPmpe,
}: {
  revShare: RevShare & { commissions: CommissionDetails }
  winningTotalPmpe: number
  pastEffParticipating: number[]
  pastBidPmpe: number
}) => {
  revShare.effParticipatingBidPmpe = calcEffParticipatingBidPmpe(revShare, winningTotalPmpe)
  const validator = {
    revShare,
    auctions: pastEffParticipating.map(effParticipatingBidPmpe => ({
      effParticipatingBidPmpe,
      bidPmpe: pastBidPmpe,
      // past 0%-commission era; relevant once the commission trigger gets re-enabled
      commissions: commissionsFor(0, null),
    })),
    bidTooLowPenalty: { coef: NaN, base: NaN },
    marinadeActivatedStakeSol: 100000,
    values: { commissions: revShare.commissions },
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

// effParticipatingBidPmpe = winningTotalPmpe - onchainDistributedPmpe: the slice of the
// clearing price the bond must cover, NOT the validator's own bid — so it INCREASES
// when commission increases (less gets distributed on-chain)
const effParticipatingFor = (onchainInflationDec: number, winningTotalPmpe: number): number =>
  calcEffParticipatingBidPmpe(revShareFor(onchainInflationDec, null, BID), winningTotalPmpe)

describe('bid too low penalty on commission changes (GEN-7037 exploration)', () => {
  it('commission raise alone does not fire the penalty today (commission trigger disabled)', () => {
    const winningTotalPmpe = 0.455
    const revShare = revShareFor(0.05, null, BID)
    expect(revShare.bondObligationPmpe).toBeCloseTo(BID, 12)
    const zeroEraEff = effParticipatingFor(0, winningTotalPmpe)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      pastEffParticipating: [zeroEraEff, zeroEraEff, zeroEraEff],
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
    const winningTotalPmpe = 0.455
    const revShare = revShareFor(0.05, null, BID)
    // floor still holds the 0%-commission era values W - G = 0.005
    const zeroEraEff = effParticipatingFor(0, winningTotalPmpe)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      pastEffParticipating: [zeroEraEff, zeroEraEff, zeroEraEff],
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
    const pastEff = effParticipatingFor(0.05, winningTotalPmpe)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      pastEffParticipating: [pastEff, pastEff, pastEff],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })

  it('the 1% slack does not renew: a second small in-bond step pays a fee', () => {
    const winningTotalPmpe = 0.44
    const floor = effParticipatingFor(0.05, winningTotalPmpe)
    expect(floor).toBeCloseTo(0.01, 12)
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

  it('0% -> 5% raise stays free only while pre-raise epochs keep the history floor low', () => {
    const winningTotalPmpe = 0.455
    const revShare = revShareFor(0.05, 0.05, BID)
    expect(revShare.bondObligationPmpe).toBeCloseTo(BID, 12)

    // the penalty limit is the min of the current and the historical eff participating values
    const raisedEff = effParticipatingFor(0.05, winningTotalPmpe)
    const zeroEraEff = effParticipatingFor(0, winningTotalPmpe)
    expect(raisedEff).toBeCloseTo(0.025, 12)
    expect(zeroEraEff).toBeCloseTo(0.005, 12)

    // onchain was raised last epoch; older history still holds the low 0%-era floor
    const withinWindow = penaltyFor({
      revShare: revShareFor(0.05, 0.05, BID),
      winningTotalPmpe,
      pastEffParticipating: [raisedEff, zeroEraEff, zeroEraEff],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(withinWindow.bidTooLowPenalty.coef).toBe(0)

    const afterWindow = penaltyFor({
      revShare: revShareFor(0.05, 0.05, BID),
      winningTotalPmpe,
      pastEffParticipating: [raisedEff, raisedEff, raisedEff],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(afterWindow.bidTooLowPenalty.coef).toBe(1)
    expect(afterWindow.bidTooLowPenaltyPmpe).toBeCloseTo(winningTotalPmpe + raisedEff, 12)
  })

  it('overshooting onchain commission keeps bondObligationPmpe above the floor at 5% effective', () => {
    const winningTotalPmpe = 0.455
    const revShare = revShareFor(0.1, 0.05, BID)
    expect(revShare.bondObligationPmpe).toBeCloseTo(0.025, 12)
    const pastEff = effParticipatingFor(0.05, winningTotalPmpe)
    const res = penaltyFor({
      revShare,
      winningTotalPmpe,
      pastEffParticipating: [pastEff, pastEff, pastEff],
      pastBidPmpe: TRIGGERING_PAST_BID,
    })
    expect(res.bidTooLowPenalty.coef).toBe(0)
    expect(res.bidTooLowPenaltyPmpe).toBe(0)
  })
})
