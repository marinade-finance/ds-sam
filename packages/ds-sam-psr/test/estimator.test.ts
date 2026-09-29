import { buildEprCalculators, calculateProtectedEventEstimates, isProtectedEvent } from '../src'

import type { EpochRewards, ValidatorEpochStats, ValidatorWithEpochs } from '../src'

const REWARDS: EpochRewards[] = [[700, 70]]

function makeEpochStat(overrides: Partial<ValidatorEpochStats> = {}): ValidatorEpochStats {
  return {
    epoch: 700,
    credits: 432000,
    activated_stake: '1000000000000', // 1000 SOL in lamports
    marinade_stake: '500000000000', // 500 SOL in lamports
    marinade_native_stake: '500000000000', // 500 SOL in lamports
    commission_advertised: 5,
    ...overrides,
  }
}

function makeValidator(overrides: Partial<ValidatorWithEpochs> = {}): ValidatorWithEpochs {
  return {
    vote_account: 'vote1',
    marinade_stake: '500000000000',
    marinade_native_stake: '500000000000',
    epoch_stats: [makeEpochStat()],
    ...overrides,
  }
}

// B1: marinadeStake must be converted to SOL, not raw lamports
describe('B1 — marinadeStake lamport unit', () => {
  it('events have finite amounts in SOL range, not lamport range', () => {
    // Zero credits vs a 432000 reference is a full EPR loss; lamport-unit stake would make it ~1e18.
    const reference = makeValidator({
      vote_account: 'ref',
      epoch_stats: [makeEpochStat({ credits: 432000 })],
    })
    const underTest = makeValidator({
      vote_account: 'under-test',
      epoch_stats: [makeEpochStat({ credits: 0 })],
    })

    const events = calculateProtectedEventEstimates([reference, underTest], REWARDS)
    for (const event of events) {
      expect(Number.isFinite(event.amount)).toBe(true)
      expect(event.amount).toBeLessThan(1e12)
    }
  })
})

// B5: grace_commission_increase compared in bps when value is percentage points
describe('B5 — grace_commission_increase bps unit', () => {
  it('0.5% commission increase (50 bps loss) should not produce an event', () => {
    // 5% → 5.5% loses ~53 bps, under the grace of grace_commission_increase * 100 bps.
    const validator = makeValidator({
      epoch_stats: [
        makeEpochStat({ epoch: 700, commission_advertised: 5.5 }),
        makeEpochStat({ epoch: 699, commission_advertised: 5.0 }),
      ],
    })

    const events = calculateProtectedEventEstimates([validator], REWARDS)
    const commissionEvents = events.filter(
      e => isProtectedEvent(e.reason) && 'CommissionIncrease' in e.reason.ProtectedEvent,
    )
    expect(commissionEvents).toHaveLength(0)
  })

  it('2% commission increase does not throw or produce NaN amounts', () => {
    // 5% → 7% = +2%, eprLossBps ≈ 211 bps > 100 → passes grace check
    const validator = makeValidator({
      epoch_stats: [
        makeEpochStat({ epoch: 700, commission_advertised: 7 }),
        makeEpochStat({ epoch: 699, commission_advertised: 5 }),
      ],
    })

    const events = calculateProtectedEventEstimates([validator], REWARDS)
    for (const event of events) {
      expect(Number.isFinite(event.amount)).toBe(true)
    }
  })
})

// B6: targetCredits undefined not guarded before buildLowCreditsProtectedEvent
describe('B6 — targetCredits undefined guard', () => {
  it('epoch with zero stake (no targetCredits entry) does not crash', () => {
    const validator = makeValidator({
      epoch_stats: [makeEpochStat({ epoch: 701, activated_stake: '0', credits: 0 })],
    })

    expect(calculateProtectedEventEstimates([validator], REWARDS)).toBeInstanceOf(Array)
  })

  it('epoch missing from targetCreditsByEpoch produces no event', () => {
    const v1 = makeValidator({ vote_account: 'vote1' })
    const v2 = makeValidator({
      vote_account: 'vote2',
      epoch_stats: [makeEpochStat({ epoch: 800, credits: 0 })],
    })

    const events = calculateProtectedEventEstimates([v1, v2], REWARDS)
    expect(events.filter(e => e.vote_account === 'vote2')).toHaveLength(0)
  })
})

describe('buildEprCalculators current-epoch estimate', () => {
  const stakeByEpoch = new Map([
    [700, 1000],
    [701, 1000],
    [702, 1000],
  ])

  it.each([
    ['newest first', [[701, 20] as EpochRewards, [700, 10] as EpochRewards]],
    ['oldest first', [[700, 10] as EpochRewards, [701, 20] as EpochRewards]],
  ])('keeps each epoch its own rewards and projects the newest onto the next epoch (%s)', (_, rewards) => {
    const calculators = buildEprCalculators(stakeByEpoch, rewards)
    expect(calculators.get(700)?.(0)).toBe(0.01)
    expect(calculators.get(701)?.(0)).toBe(0.02)
    expect(calculators.get(702)?.(0)).toBe(0.02)
    expect(calculators.size).toBe(3)
  })
})
