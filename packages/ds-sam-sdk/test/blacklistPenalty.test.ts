import { Auction } from '../src/auction'
import { Debug } from '../src/debug'

import type { DsSamConfig } from '../src/config'
import type { AuctionConstraints } from '../src/constraints'
import type { AuctionData, AuctionValidator } from '../src/types'

describe('setBlacklistPenalties', () => {
  it('applies penalties only to newly blacklisted validators', () => {
    const winningTotalPmpe = 1234.5

    const validators = [
      {
        voteAccount: 'newly-blacklisted',
        revShare: { effParticipatingBidPmpe: 100, blacklistPenaltyPmpe: 0 },
        values: { samBlacklisted: true },
        lastSamBlacklisted: false,
      },
      {
        voteAccount: 'still-blacklisted',
        revShare: { effParticipatingBidPmpe: 200, blacklistPenaltyPmpe: 0 },
        values: { samBlacklisted: true },
        lastSamBlacklisted: true,
      },
      {
        voteAccount: 'not-blacklisted',
        revShare: { effParticipatingBidPmpe: 300, blacklistPenaltyPmpe: 0 },
        values: { samBlacklisted: false },
        lastSamBlacklisted: false,
      },
      {
        voteAccount: 'newly-blacklisted-zero-eff',
        revShare: { effParticipatingBidPmpe: 0, blacklistPenaltyPmpe: 0 },
        values: { samBlacklisted: true },
        lastSamBlacklisted: false,
      },
    ] as unknown as AuctionValidator[]

    const data = { validators } as unknown as AuctionData
    const auction = new Auction(
      data,
      {} as unknown as AuctionConstraints,
      {} as unknown as DsSamConfig,
      new Debug(new Set()),
    )

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
