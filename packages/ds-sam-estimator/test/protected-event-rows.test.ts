import { buildProtectedEventRows } from '../src'

import type {
  AuctionPenaltyInput,
  ProtectedEvent,
  ScoringEntry,
  ValidatorEpochStats,
  ValidatorWithEpochs,
} from '../src'

const VOTE = 'vote1'
const LAST_DRYRUN_EPOCH = 608 // live bonds pipeline: 608

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
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
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
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    const penalties = result.filter(r => r.protectedEvent.reason === 'BidTooLowPenalty')
    const byEpoch = penalties.map(r => r.protectedEvent.epoch).sort()
    // 1007 is settled, 1008 comes from scoring, 1009 is the live epoch from the auction.
    expect(byEpoch).toEqual([1008, 1009])

    const live = penalties.find(r => r.protectedEvent.epoch === 1009)
    // 1000 SOL of Marinade stake × 2 PMPE / 1000 = 2 SOL, in lamports.
    expect(live?.protectedEvent.amount).toBe(2_000_000_000)
  })

  it('keeps the newest scored epoch when validator stats are already one epoch ahead', () => {
    const result = buildProtectedEventRows({
      validators: [makeValidator([1010, 1009, 1008])],
      settlements: [makeEvent(1008)],
      estimates: [],
      scoring: [makeScoring(1008), makeScoring(1009)],
      auctionValidators: [
        {
          voteAccount: VOTE,
          revShare: { bidTooLowPenaltyPmpe: 2, blacklistPenaltyPmpe: 0 },
          values: { bondRiskFeeSol: 0 },
        },
      ],
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    const penalties = result.filter(r => r.protectedEvent.reason === 'BidTooLowPenalty')
    expect(penalties.map(r => [r.protectedEvent.epoch, r.protectedEvent.amount])).toEqual([
      [1009, 1_000_000_000],
      [1010, 2_000_000_000],
    ])
  })

  it('keeps live-epoch scoring penalties when no auction result is given', () => {
    const result = buildProtectedEventRows({
      validators: [makeValidator([1009, 1008])],
      settlements: [makeEvent(1008)],
      estimates: [],
      scoring: [makeScoring(1009)],
      auctionValidators: [],
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    const penalties = result.filter(r => r.protectedEvent.reason === 'BidTooLowPenalty')
    expect(penalties.map(r => [r.protectedEvent.epoch, r.protectedEvent.amount])).toEqual([[1009, 1_000_000_000]])
  })

  it('emits no auction estimate for a live epoch that is already settled', () => {
    const result = buildProtectedEventRows({
      validators: [makeValidator([1009, 1008])],
      settlements: [makeEvent(1009)],
      estimates: [],
      scoring: [makeScoring(1008), makeScoring(1009)],
      auctionValidators: [
        {
          voteAccount: VOTE,
          revShare: { bidTooLowPenaltyPmpe: 2, blacklistPenaltyPmpe: 0 },
          values: { bondRiskFeeSol: 0 },
        },
      ],
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    expect(result.filter(r => r.status === 'estimate')).toEqual([])
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
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    expect(result.map(r => [r.protectedEvent.reason, r.protectedEvent.amount, r.validator])).toEqual([
      ['BidTooLowPenalty', 1_000_000_000, expect.objectContaining({ vote_account: VOTE })],
      ['BondRiskFee', 500_000_000, null],
    ])
  })

  it('keeps the live-epoch scoring penalty of a validator missing from the auction', () => {
    const result = buildProtectedEventRows({
      validators: [makeValidator([1009, 1008])],
      settlements: [makeEvent(1008)],
      estimates: [],
      scoring: [makeScoring(1009)],
      auctionValidators: [
        {
          voteAccount: 'other',
          revShare: { bidTooLowPenaltyPmpe: 0, blacklistPenaltyPmpe: 0 },
          values: { bondRiskFeeSol: 0 },
        },
      ],
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    expect(
      result
        .filter(r => r.status === 'estimate')
        .map(r => [r.protectedEvent.vote_account, r.protectedEvent.epoch, r.protectedEvent.amount]),
    ).toEqual([[VOTE, 1009, 1_000_000_000]])
  })

  it('keeps the scoring BondRiskFee for a validator with no stats for that epoch', () => {
    const result = buildProtectedEventRows({
      validators: [makeValidator([1010, 1008])],
      settlements: [makeEvent(1008)],
      estimates: [],
      scoring: [
        {
          epoch: 1009,
          voteAccount: VOTE,
          revShare: { bidTooLowPenaltyPmpe: 2, blacklistPenaltyPmpe: 1 },
          values: { bondRiskFeeSol: 0.5 },
        },
      ],
      auctionValidators: [],
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    expect(
      result
        .filter(r => r.status === 'estimate')
        .map(r => [r.protectedEvent.epoch, r.protectedEvent.reason, r.protectedEvent.amount]),
    ).toEqual([[1009, 'BondRiskFee', 500_000_000]])
  })

  it('rounds a non-integer bid-too-low penalty to an integer lamport amount', () => {
    const result = buildProtectedEventRows({
      validators: [
        {
          vote_account: VOTE,
          marinade_stake: '0',
          marinade_native_stake: '1000500000001', // 1,000.5 SOL + 1 lamport, not a multiple of 1000 lamports
          epoch_stats: [makeEpochStat(1009)],
        },
      ],
      settlements: [],
      estimates: [],
      scoring: [],
      auctionValidators: [
        {
          voteAccount: VOTE,
          revShare: { bidTooLowPenaltyPmpe: 3, blacklistPenaltyPmpe: 0 },
          values: { bondRiskFeeSol: 0 },
        },
      ],
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    const penalty = result.find(r => r.protectedEvent.reason === 'BidTooLowPenalty')
    expect(penalty?.protectedEvent.amount).toBe(3_001_500_000)
    expect(Number.isInteger(penalty?.protectedEvent.amount)).toBe(true)
  })

  it('passes an unknown settlement reason through buildProtectedEventRows unchanged as a fact', () => {
    const event: ProtectedEvent = {
      epoch: 1010,
      amount: 123,
      vote_account: VOTE,
      meta: { funder: 'ValidatorBond' },
      reason: 'SomethingNew',
    }

    const result = buildProtectedEventRows({
      validators: [makeValidator([1010])],
      settlements: [event],
      estimates: [],
      scoring: [],
      auctionValidators: [],
      lastDryrunEpoch: LAST_DRYRUN_EPOCH,
    })

    expect(result).toEqual([
      { status: 'fact', protectedEvent: event, validator: expect.objectContaining({ vote_account: VOTE }) },
    ])
  })

  it('lastDryrunEpoch controls the dryrun/fact split', () => {
    const result = buildProtectedEventRows({
      validators: [],
      settlements: [makeEvent(600), makeEvent(700)],
      estimates: [],
      scoring: [],
      auctionValidators: [],
      lastDryrunEpoch: 650,
    })

    const statusByEpoch = new Map(result.map(r => [r.protectedEvent.epoch, r.status]))
    expect(statusByEpoch.get(600)).toBe('dryrun')
    expect(statusByEpoch.get(700)).toBe('fact')
  })
})
