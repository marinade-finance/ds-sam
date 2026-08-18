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
    stakeAmounts: { networkTotalSol: 1e6, marinadeSamTvlSol: 1000, marinadeRemainingSamSol: 1000 },
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
        auctionData: { epoch: number; slotParams: SlotParams }
      }
      expect(stored.auctionData.slotParams).toEqual(SLOT_PARAMS)
      expect(stored.auctionData.slotParams.epoch).toBe(stored.auctionData.epoch)
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  })
})
