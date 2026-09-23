import fs from 'fs'
import os from 'os'
import path from 'path'

import { CliUtilityService } from 'nest-commander'

import { AuctionCommand } from '../src/commands/auction.cmd'

import type { AuctionResult, SlotParams } from '@marinade.finance/ds-sam-sdk'

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

  it('reports fully allocated SAM stake without a warning', () => {
    const fullyAllocated = {
      ...auctionResult,
      auctionData: {
        ...auctionResult.auctionData,
        stakeAmounts: { ...auctionResult.auctionData.stakeAmounts, marinadeRemainingSamSol: 0 },
      },
    } as AuctionResult
    const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(fullyAllocated)
    expect(summary).toContain('  - Unallocated SAM stake (no auction target) = `0` SOL')
    expect(summary).not.toContain('⚠')
  })
})
