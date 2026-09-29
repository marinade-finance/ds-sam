import { selectCurrentEpochEstimates, selectLatestProcessedEpoch, selectUnsettledEstimates } from '../src'

import type { ProtectedEvent } from '../src'

function makeLowCreditsEvent(epoch: number): ProtectedEvent {
  return {
    epoch,
    amount: 2_660_000_000,
    vote_account: 'vote1',
    meta: { funder: 'ValidatorBond' },
    reason: {
      ProtectedEvent: {
        LowCredits: {
          vote_account: 'vote1',
          expected_credits: 6_880_102,
          actual_credits: 6_631_431,
          commission: 5,
          expected_epr: 1,
          actual_epr: 0.96,
          epr_loss_bps: 361,
          stake: 1000,
        },
      },
    },
  }
}

describe('selectLatestProcessedEpoch', () => {
  it('returns the newest settled epoch', () => {
    expect(
      selectLatestProcessedEpoch([makeLowCreditsEvent(1005), makeLowCreditsEvent(1007), makeLowCreditsEvent(1006)]),
    ).toBe(1007)
  })

  it('returns 0 for no settled events', () => {
    expect(selectLatestProcessedEpoch([])).toBe(0)
  })
})

describe('selectUnsettledEstimates', () => {
  it('drops estimates at or below the latest settled epoch', () => {
    const kept = selectUnsettledEstimates(
      [makeLowCreditsEvent(1006), makeLowCreditsEvent(1007), makeLowCreditsEvent(1008)],
      1007,
    )
    expect(kept.map(e => e.epoch)).toEqual([1008])
  })

  it('keeps everything when nothing is settled yet', () => {
    const estimates = [makeLowCreditsEvent(1008), makeLowCreditsEvent(1009)]
    expect(selectUnsettledEstimates(estimates, 0)).toHaveLength(2)
  })
})

describe('selectCurrentEpochEstimates', () => {
  it('drops a past-epoch estimate whose settlement is already finalised', () => {
    const estimates = [makeLowCreditsEvent(1007)]
    expect(selectCurrentEpochEstimates(estimates, 1009, 1007)).toEqual([])
  })

  it('drops a past-epoch estimate even when it is not settled yet', () => {
    const estimates = [makeLowCreditsEvent(1008)]
    expect(selectCurrentEpochEstimates(estimates, 1009, 1007)).toEqual([])
  })

  it('keeps an estimate for the live epoch', () => {
    const estimates = [makeLowCreditsEvent(1009)]
    expect(selectCurrentEpochEstimates(estimates, 1009, 1007)).toHaveLength(1)
  })

  it('drops a live-epoch estimate once that epoch has settled', () => {
    const estimates = [makeLowCreditsEvent(1009)]
    expect(selectCurrentEpochEstimates(estimates, 1009, 1009)).toEqual([])
  })

  it('keeps only the live epoch out of a trailing 3-epoch window', () => {
    const estimates = [makeLowCreditsEvent(1007), makeLowCreditsEvent(1008), makeLowCreditsEvent(1009)]
    const kept = selectCurrentEpochEstimates(estimates, 1009, 0)
    expect(kept.map(e => e.epoch)).toEqual([1009])
  })

  it('shows nothing when the live epoch is unknown', () => {
    const estimates = [makeLowCreditsEvent(1009)]
    expect(selectCurrentEpochEstimates(estimates, null, 0)).toEqual([])
  })
})
