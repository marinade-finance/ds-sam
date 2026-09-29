import { buildProtectedEventRows } from '../src'

import type {
  AuctionPenaltyInput,
  ProtectedEvent,
  ScoringEntry,
  ValidatorEpochStats,
  ValidatorWithEpochs,
} from '../src'

const VOTE = 'vote1'

function makeEpochStat(epoch: number): ValidatorEpochStats {
  return {
    epoch,
    credits: 432_000,
    activated_stake: '1000000000000',
    marinade_stake: '500000000000',
    marinade_native_stake: '500000000000',
    commission_advertised: 5,
  }
}

function makeValidator(epochs: number[]): ValidatorWithEpochs {
  return {
    vote_account: VOTE,
    marinade_stake: '500000000000',
    marinade_native_stake: '500000000000',
    epoch_stats: epochs.map(makeEpochStat),
  }
}

function makeEvent(epoch: number, amount = 1_000_000_000): ProtectedEvent {
  return {
    epoch,
    amount,
    vote_account: VOTE,
    meta: { funder: 'ValidatorBond' },
    reason: {
      ProtectedEvent: {
        LowCredits: {
          vote_account: VOTE,
          expected_credits: 432_000,
          actual_credits: 400_000,
          commission: 5,
          expected_epr: 1,
          actual_epr: 0.9,
          epr_loss_bps: 1000,
          stake: 1000,
        },
      },
    },
  }
}

function makeScoring(epoch: number): ScoringEntry {
  return {
    epoch,
    voteAccount: VOTE,
    revShare: { bidTooLowPenaltyPmpe: 1, blacklistPenaltyPmpe: 0 },
    values: { bondRiskFeeSol: 0 },
  }
}

describe('buildProtectedEventRows settled-epoch guard', () => {
  it('keeps settled facts, suppresses estimates at or below the settled epoch', () => {
    const result = buildProtectedEventRows({
      validators: [makeValidator([1009, 1008, 1007])],
      settlements: [makeEvent(1007)],
      estimates: [makeEvent(1007), makeEvent(1008), makeEvent(1009)],
      scoring: [],
      auctionValidators: [],
    })

    const facts = result.filter(r => r.status === 'fact')
    expect(facts.map(r => r.protectedEvent.epoch)).toEqual([1007])

    const estimateEpochs = result
      .filter(r => r.status === 'estimate')
      .map(r => r.protectedEvent.epoch)
      .sort((a, b) => a - b)
    expect(estimateEpochs).toEqual([1008, 1009])
    expect(estimateEpochs).not.toContain(1007)
  })

  it('still recomputes the current-epoch auction penalty', () => {
    // maxStatsEpoch 1009 === maxScoredEpoch 1009, so live-epoch penalties come from the auction.
    const auctionValidators: AuctionPenaltyInput[] = [
      {
        voteAccount: VOTE,
        revShare: { bidTooLowPenaltyPmpe: 2, blacklistPenaltyPmpe: 0 },
        values: { bondRiskFeeSol: 0 },
      },
    ]

    const result = buildProtectedEventRows({
      validators: [makeValidator([1009, 1008, 1007])],
      settlements: [makeEvent(1007)],
      estimates: [],
      scoring: [makeScoring(1007), makeScoring(1008), makeScoring(1009)],
      auctionValidators,
    })

    const penalties = result.filter(r => r.protectedEvent.reason === 'BidTooLowPenalty')
    const byEpoch = penalties.map(r => r.protectedEvent.epoch).sort()
    // 1007 is settled, 1008 comes from scoring, 1009 is the live epoch from the auction.
    expect(byEpoch).toEqual([1008, 1009])

    const live = penalties.find(r => r.protectedEvent.epoch === 1009)
    // 1000 SOL of Marinade stake × 2 PMPE / 1000 = 2 SOL, in lamports.
    expect(live?.protectedEvent.amount).toBe(2_000_000_000)
  })

  it('emits no NaN penalty for an auction validator missing from the validators list', () => {
    const result = buildProtectedEventRows({
      validators: [makeValidator([1009])],
      settlements: [],
      estimates: [],
      scoring: [makeScoring(1009)],
      auctionValidators: [
        {
          voteAccount: 'unknown',
          revShare: { bidTooLowPenaltyPmpe: 2, blacklistPenaltyPmpe: 1 },
          values: { bondRiskFeeSol: 0.5 },
        },
      ],
    })

    expect(result.map(r => [r.protectedEvent.reason, r.protectedEvent.amount, r.validator])).toEqual([
      ['BondRiskFee', 500_000_000, null],
    ])
  })
})
