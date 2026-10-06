import assert from 'node:assert'

import Decimal from 'decimal.js'

import { epochUptimes, EpochUptimeType, passesUptime } from '../src/uptime'

import type { AggregatedValidator, EpochStats } from '../src'
import type { EpochUptime } from '../src/uptime'

const THRESHOLD = 0.8

type StatInput = {
  epoch: number
  stake: number
  credits?: number | null
  reward?: number | null
  leaderSlots?: number
}

const validator = (voteAccount: string, stats: StatInput[]): AggregatedValidator =>
  ({
    voteAccount,
    epochStats: stats.map(
      ({ epoch, stake, credits = null, reward = null, leaderSlots = 0 }): EpochStats => ({
        epoch,
        totalActivatedStake: new Decimal(stake),
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

  it('throws when an epoch has neither credits nor vote rewards', () => {
    const validators = [validator('a', [{ epoch: 10, stake: 100 }])]

    expect(() => epochUptimes(validators, 10, 10, THRESHOLD)).toThrow(
      'Validator credits and vote rewards data for epoch 10 not available',
    )
  })
})
