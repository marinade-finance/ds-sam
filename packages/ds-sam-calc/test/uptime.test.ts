import assert from 'node:assert'

import Decimal from 'decimal.js'

import { epochUptimes, EpochUptimeType, passesUptime } from '../src/uptime'

import type { AggregatedValidator, EpochStats } from '../src'
import type { EpochUptime } from '../src/uptime'

const THRESHOLD = 0.8

type StatInput = {
  epoch: number
  stake: number
  // Defaults to `stake`
  epochStake?: number | null
  credits?: number | null
  reward?: number | null
  leaderSlots?: number
}

const validator = (voteAccount: string, stats: StatInput[]): AggregatedValidator =>
  ({
    voteAccount,
    epochStats: stats.map(
      ({ epoch, stake, epochStake = stake, credits = null, reward = null, leaderSlots = 0 }): EpochStats => ({
        epoch,
        totalActivatedStake: new Decimal(stake),
        epochStake: epochStake === null ? null : new Decimal(epochStake),
        marinadeActivatedStake: new Decimal(0),
        voteCredits: credits,
        voteRewardLamports: reward,
        leaderSlots,
      }),
    ),
  }) as AggregatedValidator

const evaluate = (validators: AggregatedValidator[], minEpoch: number, maxEpoch: number) => {
  const epochs = epochUptimes(validators, minEpoch, maxEpoch, THRESHOLD)
  return {
    epochs,
    passes: new Map(validators.map(v => [v.voteAccount, passesUptime(v, epochs, THRESHOLD)])),
  }
}

const scoresOf = (epoch: EpochUptime | undefined): Map<string, number> => {
  assert(epoch?.type === EpochUptimeType.ALPENGLOW)
  return epoch.scores
}

describe('uptime', () => {
  it('keeps the tower rule: credits >= 0.8 x the stake-weighted mean', () => {
    const validators = [
      validator('a', [{ epoch: 10, stake: 300, credits: 1000 }]),
      validator('b', [{ epoch: 10, stake: 100, credits: 600 }]),
      validator('c', [{ epoch: 10, stake: 100, credits: 400 }]),
    ]
    const { epochs, passes } = evaluate(validators, 10, 10)

    // (300*1000 + 100*600 + 100*400) / 500 = 800
    expect(epochs).toEqual([{ epoch: 10, type: EpochUptimeType.TOWER, creditsThreshold: 640 }])
    expect(passes).toEqual(
      new Map([
        ['a', true],
        ['b', false],
        ['c', false],
      ]),
    )
  })

  it('skips the uptime check in the migration epoch', () => {
    const validators = [
      validator('up', [{ epoch: 10, stake: 100, credits: 1000, reward: 1000, leaderSlots: 10 }]),
      validator('down', [{ epoch: 10, stake: 100, credits: 0, reward: 0, leaderSlots: 10 }]),
      validator('no-record', []),
    ]
    const { epochs, passes } = evaluate(validators, 10, 10)

    expect(epochs).toEqual([{ epoch: 10, type: EpochUptimeType.MIGRATION }])
    expect(passes).toEqual(
      new Map([
        ['up', true],
        ['down', true],
        ['no-record', true],
      ]),
    )
  })

  it('gives full uptime to a small and a large validator in an Alpenglow epoch', () => {
    const validators = [
      validator('large', [{ epoch: 10, stake: 900, reward: 900_000, leaderSlots: 90 }]),
      validator('small', [{ epoch: 10, stake: 100, reward: 100_000, leaderSlots: 10 }]),
    ]
    const { epochs, passes } = evaluate(validators, 10, 10)

    expect(epochs[0]?.type).toBe(EpochUptimeType.ALPENGLOW)
    expect(scoresOf(epochs[0]).get('large')).toBeCloseTo(1)
    expect(scoresOf(epochs[0]).get('small')).toBeCloseTo(1)
    expect(passes.get('small')).toBe(true)
  })

  it('counts skipped leader slots as downtime', () => {
    // Equal stake and assigned slots; 'skipper' earns the voter half only
    const validators = [
      validator('a', [{ epoch: 10, stake: 100, reward: 500, leaderSlots: 10 }]),
      validator('b', [{ epoch: 10, stake: 100, reward: 500, leaderSlots: 10 }]),
      validator('c', [{ epoch: 10, stake: 100, reward: 500, leaderSlots: 10 }]),
      validator('skipper', [{ epoch: 10, stake: 100, reward: 250, leaderSlots: 10 }]),
    ]
    const { epochs, passes } = evaluate(validators, 10, 10)

    // (250 / 0.5) / (1750 / 2)
    expect(scoresOf(epochs[0]).get('skipper')).toBeCloseTo(4 / 7)
    expect(passes.get('skipper')).toBe(false)
    expect(passes.get('a')).toBe(true)
  })

  // Every validator skipped its whole first window and produced every other slot
  const firstWindowSkippers = (epoch: number) => [
    validator('a', [{ epoch, stake: 100, reward: 1100, leaderSlots: 12 }]),
    validator('b', [{ epoch, stake: 100, reward: 700, leaderSlots: 8 }]),
    validator('c', [{ epoch, stake: 100, reward: 300, leaderSlots: 4 }]),
    validator('d', [{ epoch, stake: 100, reward: 300, leaderSlots: 1 }]),
  ]

  it.each([1065, 1066, 1067, 1068, 1069, 1070])('drops the skipped first leader window in epoch %i', epoch => {
    const { epochs, passes } = evaluate(firstWindowSkippers(epoch), epoch, epoch)

    for (const voteAccount of ['a', 'b', 'c', 'd']) {
      expect(scoresOf(epochs[0]).get(voteAccount)).toBeCloseTo(1)
      expect(passes.get(voteAccount)).toBe(true)
    }
  })

  it('scores a validator without leader slots in an Agave skip epoch', () => {
    const validators = [
      validator('idle-leader', [{ epoch: 1066, stake: 100, reward: 1000, leaderSlots: 0 }]),
      validator('one-window', [{ epoch: 1066, stake: 100, reward: 1000, leaderSlots: 4 }]),
    ]
    const { epochs, passes } = evaluate(validators, 1066, 1066)

    expect(scoresOf(epochs[0]).get('idle-leader')).toBeCloseTo(1)
    expect(scoresOf(epochs[0]).get('one-window')).toBeCloseTo(1)
    expect(passes.get('idle-leader')).toBe(true)
  })

  it.each([10, 1064, 1071])('keeps every scheduled slot in epoch %i', epoch => {
    const { epochs, passes } = evaluate(firstWindowSkippers(epoch), epoch, epoch)

    // w scaled by S·N = stake·25 + slots·400: a 7300, b 5700, c 4100, d 2900, Σw = 20000, Σreward = 2400
    expect(scoresOf(epochs[0]).get('a')).toBeCloseTo((1100 * 20000) / (7300 * 2400))
    expect(scoresOf(epochs[0]).get('c')).toBeCloseTo((300 * 20000) / (4100 * 2400))
    expect(scoresOf(epochs[0]).get('d')).toBeCloseTo((300 * 20000) / (2900 * 2400))
    expect(passes.get('c')).toBe(false)
    expect(passes.get('d')).toBe(true)
  })

  it('treats a null reward as unknown and leaves it out of the sums', () => {
    const validators = [
      validator('a', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 }]),
      validator('b', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 }]),
      validator('no-reward', [{ epoch: 10, stake: 100, reward: null, leaderSlots: 10 }]),
    ]
    const { epochs, passes } = evaluate(validators, 10, 10)

    expect(scoresOf(epochs[0]).get('a')).toBeCloseTo(1)
    expect(scoresOf(epochs[0]).has('no-reward')).toBe(false)
    expect(passes.get('no-reward')).toBe(true)
  })

  it('passes a validator whose every epoch is unknown', () => {
    const validators = [
      validator('a', [
        { epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 },
        { epoch: 11, stake: 100, reward: 1000, leaderSlots: 10 },
      ]),
      validator('unknown', [
        { epoch: 10, stake: 100, reward: null, leaderSlots: 10 },
        { epoch: 11, stake: 100, reward: null, leaderSlots: 10 },
      ]),
    ]
    const { passes } = evaluate(validators, 10, 11)

    expect(passes.get('unknown')).toBe(true)
  })

  it('applies the rule of each epoch type in a mixed window', () => {
    const validators = [
      validator('good', [
        { epoch: 10, stake: 100, credits: 1000 },
        { epoch: 11, stake: 100, credits: 500, reward: 500, leaderSlots: 10 },
        { epoch: 12, stake: 100, reward: 1000, leaderSlots: 10 },
      ]),
      validator('bad-tower', [
        { epoch: 10, stake: 100, credits: 100 },
        { epoch: 11, stake: 100, credits: 500, reward: 500, leaderSlots: 10 },
        { epoch: 12, stake: 100, reward: 1000, leaderSlots: 10 },
      ]),
      validator('bad-migration', [
        { epoch: 10, stake: 100, credits: 1000 },
        { epoch: 11, stake: 100, credits: 0, reward: 0, leaderSlots: 10 },
        { epoch: 12, stake: 100, reward: 1000, leaderSlots: 10 },
      ]),
      validator('bad-alpenglow', [
        { epoch: 10, stake: 100, credits: 1000 },
        { epoch: 11, stake: 100, credits: 500, reward: 500, leaderSlots: 10 },
        { epoch: 12, stake: 100, reward: 100, leaderSlots: 10 },
      ]),
    ]
    const { epochs, passes } = evaluate(validators, 10, 12)

    expect(epochs.map(({ type }) => type)).toEqual([
      EpochUptimeType.TOWER,
      EpochUptimeType.MIGRATION,
      EpochUptimeType.ALPENGLOW,
    ])
    expect(passes).toEqual(
      new Map([
        ['good', true],
        ['bad-tower', false],
        ['bad-migration', true],
        ['bad-alpenglow', false],
      ]),
    )
  })

  it('fails a validator without a record for an epoch', () => {
    const validators = [
      validator('a', [
        { epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 },
        { epoch: 11, stake: 100, reward: 1000, leaderSlots: 10 },
      ]),
      validator('new', [{ epoch: 11, stake: 100, reward: 1000, leaderSlots: 10 }]),
    ]
    const { passes } = evaluate(validators, 10, 11)

    expect(passes.get('new')).toBe(false)
  })

  it('throws when no validator of an Alpenglow epoch has an epoch stake', () => {
    const validators = [
      validator('a', [{ epoch: 10, stake: 100, epochStake: null, reward: 1000, leaderSlots: 10 }]),
      validator('b', [{ epoch: 10, stake: 100, epochStake: null, reward: 1000, leaderSlots: 10 }]),
    ]

    expect(() => epochUptimes(validators, 10, 10, THRESHOLD)).toThrow(
      'No validator with a vote reward for epoch 10 has an epoch stake',
    )
  })

  it('throws when the Alpenglow rewards or weights sum to zero', () => {
    const zeroRewards = [validator('a', [{ epoch: 10, stake: 100, reward: 0, leaderSlots: 10 }])]
    const zeroWeights = [validator('a', [{ epoch: 10, stake: 0, reward: 1000, leaderSlots: 0 }])]

    expect(() => epochUptimes(zeroRewards, 10, 10, THRESHOLD)).toThrow(
      'Validator vote rewards for epoch 10 sum to zero',
    )
    expect(() => epochUptimes(zeroWeights, 10, 10, THRESHOLD)).toThrow(
      'Validator vote rewards for epoch 10 sum to zero',
    )
  })

  it.each([
    ['vote reward', { reward: -1 }, '-1'],
    ['vote reward', { reward: 1.5 }, '1.5'],
    ['leader slots', { leaderSlots: -2 }, '-2'],
    ['stake', { epochStake: 0.5 }, '0.5'],
  ])('names the validator whose Alpenglow %s is not a count', (field, override, got) => {
    const validators = [
      validator('a', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 }]),
      validator('bad', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10, ...override }]),
    ]

    expect(() => epochUptimes(validators, 10, 10, THRESHOLD)).toThrow(
      `Validator bad epoch 10 ${field} must be a non-negative integer, got ${got}`,
    )
  })

  it('weighs by the epoch stake, not the stake of the epoch', () => {
    // 'grown' doubles its stake in the epoch, agave pays it on the 100 of the previous epoch
    const validators = [
      validator('grown', [{ epoch: 10, stake: 200, epochStake: 100, reward: 1000, leaderSlots: 10 }]),
      validator('steady', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 }]),
    ]
    const { epochs } = evaluate(validators, 10, 10)

    expect(scoresOf(epochs[0]).get('grown')).toBeCloseTo(1)
    expect(scoresOf(epochs[0]).get('steady')).toBeCloseTo(1)
  })

  it('leaves a validator without an epoch stake unscored and out of the sums', () => {
    const validators = [
      validator('a', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 }]),
      validator('b', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 }]),
      validator('unknown', [{ epoch: 10, stake: 100, epochStake: null, reward: 10, leaderSlots: 10 }]),
    ]
    const { epochs, passes } = evaluate(validators, 10, 10)

    expect(scoresOf(epochs[0]).get('a')).toBeCloseTo(1)
    expect(scoresOf(epochs[0]).has('unknown')).toBe(false)
    expect(passes.get('unknown')).toBe(true)
  })

  it('leaves a zero-weight validator unscored', () => {
    const validators = [
      validator('a', [{ epoch: 10, stake: 100, reward: 1000, leaderSlots: 10 }]),
      validator('idle', [{ epoch: 10, stake: 0, reward: 0, leaderSlots: 0 }]),
    ]
    const { epochs } = evaluate(validators, 10, 10)

    expect(scoresOf(epochs[0]).get('a')).toBeCloseTo(1)
    expect(scoresOf(epochs[0]).has('idle')).toBe(false)
  })

  it('throws when an epoch has neither credits nor vote rewards', () => {
    const validators = [validator('a', [{ epoch: 10, stake: 100 }])]

    expect(() => epochUptimes(validators, 10, 10, THRESHOLD)).toThrow(
      'Validator credits and vote rewards data for epoch 10 not available',
    )
  })
})
