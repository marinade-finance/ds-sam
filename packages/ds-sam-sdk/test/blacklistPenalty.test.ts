/* eslint-disable @typescript-eslint/no-explicit-any */
import { Auction } from '../src/auction'
import { Debug } from '../src/debug'

describe('setBlacklistPenalties', () => {
  it('applies penalties only to newly blacklisted validators', () => {
    const winningTotalPmpe = 1234.5

    const validators = [
      {
        voteAccount: 'newly-blacklisted',
        revShare: {
          effParticipatingBidPmpe: 100,
          blacklistPenaltyPmpe: 0,
        },
        values: { samBlacklisted: true } as any,
        lastSamBlacklisted: false,
      },
      {
        voteAccount: 'still-blacklisted',
        revShare: {
          effParticipatingBidPmpe: 200,
          blacklistPenaltyPmpe: 0,
        },
        values: { samBlacklisted: true } as any,
        lastSamBlacklisted: true,
      },
      {
        voteAccount: 'not-blacklisted',
        revShare: {
          effParticipatingBidPmpe: 300,
          blacklistPenaltyPmpe: 0,
        },
        values: { samBlacklisted: false } as any,
        lastSamBlacklisted: false,
      },
      {
        voteAccount: 'newly-blacklisted-zero-eff',
        revShare: {
          effParticipatingBidPmpe: 0,
          blacklistPenaltyPmpe: 0,
        },
        values: { samBlacklisted: true } as any,
        lastSamBlacklisted: false,
      },
    ] as any[]

    const data = { validators } as any

    const auction = new Auction(data, {} as any, {} as any, new Debug(new Set()))

    auction.setBlacklistPenalties(winningTotalPmpe)

    expect(
      validators.map(v => ({
        voteAccount: v.voteAccount,
        blacklistPenaltyPmpe: v.revShare.blacklistPenaltyPmpe,
      })),
    ).toEqual([
      { voteAccount: 'newly-blacklisted', blacklistPenaltyPmpe: 1534.5 },
      { voteAccount: 'still-blacklisted', blacklistPenaltyPmpe: 0 },
      { voteAccount: 'not-blacklisted', blacklistPenaltyPmpe: 0 },
      {
        voteAccount: 'newly-blacklisted-zero-eff',
        blacklistPenaltyPmpe: 1234.5,
      },
    ])
  })
})
