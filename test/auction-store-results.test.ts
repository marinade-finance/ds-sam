import fs from 'fs'
import os from 'os'
import path from 'path'

import { CliUtilityService } from 'nest-commander'

import { BlacklistRuleId, EPSILON } from '@marinade.finance/ds-sam-sdk'

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
    const withDecision = (decision: Partial<BlacklistAuctionDecision>) =>
      ({
        ...auctionResult,
        auctionData: {
          ...auctionResult.auctionData,
          blacklistDecision: {
            auctionEpoch: 641,
            evaluatedEpoch: 640,
            missingEpochs: [],
            added: [],
            held: [],
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

    it('lists held hits and how to approve them', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ held: [sandwichHit] }),
      )
      expect(summary).toContain('- Added = `0`')
      expect(summary).toContain('- ⚠ Held = `1`: more new accounts than `blacklistRules.maxNewListings`.')
      expect(summary).toContain(`  - \`${'B'.repeat(32)}\` MALICIOUS_SM_640: single 8%`)
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
        expect(fs.readFileSync(path.join(outDir, 'summary.md')).toString()).not.toContain('### Blacklist')
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
