import fs from 'fs'
import os from 'os'
import path from 'path'

import { CliUtilityService } from 'nest-commander'

import { BlacklistRowSource, BlacklistRuleId, EPSILON } from '@marinade.finance/ds-sam-sdk'

import { AuctionCommand } from '../src/commands/auction.cmd'

import type { AuctionResult, BlacklistAuctionDecision, BlacklistHit, SlotParams } from '@marinade.finance/ds-sam-sdk'

const SLOT_PARAMS: SlotParams = { slotsPerYear: 78892314.984, epoch: 641 }

const auctionResult = {
  winningTotalPmpe: 0.45,
  auctionData: {
    epoch: SLOT_PARAMS.epoch,
    validators: [],
    rewards: { inflationPmpe: 0.4, mevPmpe: 0.05, blockPmpe: 0 },
    slotParams: SLOT_PARAMS,
    stakeAmounts: { networkTotalSol: 1e6, marinadeSamTvlSol: 1000, marinadeRemainingSamSol: 250.5 },
    blacklist: new Set<string>(),
  },
} as unknown as AuctionResult

describe('auction storeResults', () => {
  it('carries slotParams into the stored results', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
    const resultsPath = path.join(outDir, 'results.json')
    try {
      new AuctionCommand(new CliUtilityService()).storeResults(
        auctionResult,
        resultsPath,
        path.join(outDir, 'summary.md'),
      )
      const stored = JSON.parse(fs.readFileSync(resultsPath).toString()) as {
        auctionData: { slotParams: SlotParams }
      }
      expect(stored.auctionData.slotParams).toEqual(SLOT_PARAMS)
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('warns about unallocated SAM stake in the summary', () => {
    const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(auctionResult)
    expect(summary).toContain(`  - ⚠ Unallocated SAM stake (no auction target) = \`${(250.5).toLocaleString()}\` SOL`)
  })

  it('warns about SAM stake remaining exactly at EPSILON without rounding it to zero', () => {
    const atEpsilon = {
      ...auctionResult,
      auctionData: {
        ...auctionResult.auctionData,
        stakeAmounts: { ...auctionResult.auctionData.stakeAmounts, marinadeRemainingSamSol: EPSILON },
      },
    } as AuctionResult
    const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(atEpsilon)
    expect(summary).toContain(
      `  - ⚠ Unallocated SAM stake (no auction target) = \`${(0.0001).toLocaleString(undefined, { maximumFractionDigits: 4 })}\` SOL`,
    )
    expect(summary).not.toContain('= `0` SOL')
  })

  describe('blacklist decision', () => {
    const sandwichHit: BlacklistHit = {
      voteAccount: 'B'.repeat(32),
      rule: BlacklistRuleId.SANDWICH,
      code: 'MALICIOUS_SM_640',
      epochs: [640],
      evidence: {
        epoch: 640,
        single: {
          rate30dPct: 8,
          blocksProduced: 5000,
          blocksWithSandwiches: 400,
          clusterMedianPct: 0.8,
          clusterPooledPct: 0.77,
          pValue: 1.5e-90,
        },
        wide: null,
      },
    }
    const slowHit: BlacklistHit = {
      voteAccount: 'A'.repeat(32),
      rule: BlacklistRuleId.SLOW_SLOTS,
      code: 'SLOW_SLOTS_640',
      epochs: [639, 640],
      evidence: {
        epochs: {
          '639': { slotDurationMedianMs: 245, networkMedianMs: 200 },
          '640': { slotDurationMedianMs: 250, networkMedianMs: 200 },
        },
      },
    }
    const withDecision = (decision: Partial<BlacklistAuctionDecision>, validators: unknown[] = []) =>
      ({
        ...auctionResult,
        auctionData: {
          ...auctionResult.auctionData,
          validators,
          blacklistDecision: {
            auctionEpoch: 641,
            evaluatedEpoch: 640,
            missingEpochs: [],
            added: [],
            held: [],
            kept: [],
            carried: [],
            ...decision,
          },
        },
      }) as AuctionResult

    it('writes the added rows and lists their evidence in the summary', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      const result = withDecision({ added: [sandwichHit, slowHit] })
      try {
        new AuctionCommand(new CliUtilityService()).storeResults(
          result,
          path.join(outDir, 'results.json'),
          path.join(outDir, 'summary.md'),
          path.join(outDir, 'blacklist-added.csv'),
        )
        expect(fs.readFileSync(path.join(outDir, 'blacklist-added.csv')).toString()).toBe(
          `vote_account,code\n${'A'.repeat(32)},SLOW_SLOTS_640\n${'B'.repeat(32)},MALICIOUS_SM_640\n`,
        )
        const summary = fs.readFileSync(path.join(outDir, 'summary.md')).toString()
        expect(summary).toContain('### Blacklist\n- Evaluated epoch = `640`\n- Added = `2`')
        expect(summary).toContain(
          `  - \`${'B'.repeat(32)}\` MALICIOUS_SM_640: single 8% (400/5000 blocks, cluster median 0.80%, p=1.50e-90)`,
        )
        expect(summary).toContain(
          `  - \`${'A'.repeat(32)}\` SLOW_SLOTS_640: epoch 639 245ms vs network 200ms; epoch 640 250ms vs network 200ms`,
        )
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    })

    it('writes a header-only file when nothing was added', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      try {
        new AuctionCommand(new CliUtilityService()).storeResults(
          withDecision({}),
          path.join(outDir, 'results.json'),
          path.join(outDir, 'summary.md'),
          path.join(outDir, 'blacklist-added.csv'),
        )
        expect(fs.readFileSync(path.join(outDir, 'blacklist-added.csv')).toString()).toBe('vote_account,code\n')
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    })

    it('re-emits carried rows with their codes', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      try {
        new AuctionCommand(new CliUtilityService()).storeResults(
          withDecision({
            carried: [
              {
                voteAccount: 'C'.repeat(32),
                code: 'MALICIOUS_SM_639',
                source: BlacklistRowSource.AUCTION,
                auctionEpoch: 641,
              },
            ],
            held: [sandwichHit],
          }),
          path.join(outDir, 'results.json'),
          path.join(outDir, 'summary.md'),
          path.join(outDir, 'blacklist-added.csv'),
        )
        expect(fs.readFileSync(path.join(outDir, 'blacklist-added.csv')).toString()).toBe(
          `vote_account,code\n${'C'.repeat(32)},MALICIOUS_SM_639\n`,
        )
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    })

    it('lists held hits and how to approve them', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ held: [sandwichHit] }),
      )
      expect(summary).toContain('- Added = `0`')
      expect(summary).toContain('- ⚠ Held = `1`: more new accounts than `blacklistRules.maxNewListings`.')
      expect(summary).toContain(`  - \`${'B'.repeat(32)}\` MALICIOUS_SM_640: single 8%`)
    })

    const validator = (
      voteAccount: string,
      lastSamBlacklisted: boolean | null,
      samBlacklisted: boolean,
      marinadeActivatedStakeSol = 0,
      blacklistPenaltyPmpe = 0,
    ) => ({
      voteAccount,
      lastSamBlacklisted,
      marinadeActivatedStakeSol,
      samEligible: false,
      auctionStake: { marinadeSamTargetSol: 0 },
      values: { samBlacklisted },
      revShare: { blacklistPenaltyPmpe },
    })

    const summaryOf = (decision: Partial<BlacklistAuctionDecision>, validators: unknown[] = []) =>
      new AuctionCommand(new CliUtilityService()).formatResultSummary(withDecision(decision, validators))

    it('flags kept accounts and how to unlist them', () => {
      const summary = summaryOf({ kept: ['K'.repeat(32)] })
      expect(summary).toContain(
        '- ⚠ Kept = `1`: blacklisted in the previous auction and missing from the served list. Unlist with an exemption in the blacklist config.',
      )
      expect(summary).toContain(`  - \`${'K'.repeat(32)}\``)
    })

    it('lists no kept or carried line when there is none', () => {
      const summary = summaryOf({})
      expect(summary).not.toContain('Kept')
      expect(summary).not.toContain('Carried')
    })

    it('lists carried rows', () => {
      const summary = summaryOf({
        carried: [
          {
            voteAccount: 'C'.repeat(32),
            code: 'MALICIOUS_SM_639',
            source: BlacklistRowSource.AUCTION,
            auctionEpoch: 641,
          },
        ],
      })
      expect(summary).toContain(
        '- Carried = `1`: listings of an earlier run of this auction, kept while its hits are held',
      )
      expect(summary).toContain(`  - \`${'C'.repeat(32)}\` MALICIOUS_SM_639`)
    })

    it('lists accounts removed since the previous auction', () => {
      const summary = summaryOf({}, [
        validator('R'.repeat(32), true, false),
        validator('S'.repeat(32), true, true),
        validator('T'.repeat(32), false, false),
        validator('U'.repeat(32), null, false),
      ])
      expect(summary).toContain(`- Removed = \`1\`\n  - \`${'R'.repeat(32)}\`\n- Penalties`)
    })

    it('totals the blacklist penalties', () => {
      const summary = summaryOf({}, [
        validator('P'.repeat(32), false, true, 1000, 2),
        validator('Q'.repeat(32), false, false, 500, 0),
        validator('V'.repeat(32), false, true, 250, 4),
      ])
      expect(summary).toContain('- Penalties = `2` validators, estimated `3` SOL')
    })

    it('reports zero removed and zero penalties', () => {
      const summary = summaryOf({})
      expect(summary).toContain('- Removed = `0`')
      expect(summary).toContain('- Penalties = `0` validators, estimated `0` SOL')
    })

    it('names the epochs without data', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ missingEpochs: [639, 640] }),
      )
      expect(summary).toContain('- ⚠ No validator quality data for epochs 639, 640; their rules did not run')
    })

    it('has no blacklist section and no file without a decision', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      try {
        new AuctionCommand(new CliUtilityService()).storeResults(
          auctionResult,
          path.join(outDir, 'results.json'),
          path.join(outDir, 'summary.md'),
          path.join(outDir, 'blacklist-added.csv'),
        )
        expect(fs.existsSync(path.join(outDir, 'blacklist-added.csv'))).toBe(false)
        const summary = fs.readFileSync(path.join(outDir, 'summary.md')).toString()
        expect(summary).not.toContain('### Blacklist')
        expect(summary).not.toContain('Removed')
        expect(summary).not.toContain('Penalties')
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    })
  })

  it.each([0, 1e-9, -1e-9])('reports fully allocated SAM stake (remaining %p) without a warning', remaining => {
    const fullyAllocated = {
      ...auctionResult,
      auctionData: {
        ...auctionResult.auctionData,
        stakeAmounts: { ...auctionResult.auctionData.stakeAmounts, marinadeRemainingSamSol: remaining },
      },
    } as AuctionResult
    const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(fullyAllocated)
    expect(summary).toContain('  - Unallocated SAM stake (no auction target) = `0` SOL')
    expect(summary).not.toContain('⚠')
  })
})
