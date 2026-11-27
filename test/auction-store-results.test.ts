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
    unknownVatVerdict: [],
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

  describe('VAT section', () => {
    const vatValidator = (
      voteAccount: string,
      samIneligibilityGates: string[],
      {
        vatEligible = false,
        marinadeActivatedStakeSol = 0,
        bondBalanceSol = 0 as number | null,
        vatRejectionReason = 'low_balance' as string | null,
      } = {},
    ) => ({
      voteAccount,
      vatEligible,
      samIneligibilityGates,
      marinadeActivatedStakeSol,
      bondBalanceSol,
      vatRejectionReason,
      samEligible: false,
      auctionStake: { marinadeSamTargetSol: 0 },
      values: { samBlacklisted: false },
      revShare: { blacklistPenaltyPmpe: 0 },
    })
    const summaryWith = (validators: unknown[], unknownVatVerdict: string[] = []) =>
      new AuctionCommand(new CliUtilityService()).formatResultSummary({
        ...auctionResult,
        auctionData: { ...auctionResult.auctionData, validators, unknownVatVerdict },
      } as AuctionResult)

    it('is omitted without a VAT-ineligible validator or an unknown verdict', () => {
      const summary = summaryWith([vatValidator('E'.repeat(32), [], { vatEligible: true })])
      expect(summary).not.toContain('### VAT')
    })

    it('lists only the validators without a chain verdict when no validator is VAT-ineligible', () => {
      const summary = summaryWith([], ['U'.repeat(32)])
      expect(summary).toContain('### VAT\n- VAT-ineligible validators = `0`')
      expect(summary).toContain('- No chain VAT verdict, not cut = `1`')
      expect(summary).toContain(
        `<details><summary>No chain VAT verdict, not cut</summary>\n\n- \`${'U'.repeat(32)}\`\n\n</details>`,
      )
      expect(summary).not.toContain('<details><summary>VAT-ineligible validators</summary>')
    })

    it('names every failing gate of a row', () => {
      const summary = summaryWith([
        vatValidator('A'.repeat(32), ['uptime', 'vatIneligible']),
        vatValidator('B'.repeat(32), ['vatIneligible', 'noBond']),
        vatValidator('C'.repeat(32), ['uptime', 'vatIneligible', 'noBond']),
        vatValidator('D'.repeat(32), ['vatIneligible']),
      ])
      expect(summary).toContain(`- \`${'A'.repeat(32)}\` uptime (also: vatIneligible): \`low_balance\``)
      expect(summary).toContain(`- \`${'B'.repeat(32)}\` vatIneligible (also: noBond): \`low_balance\``)
      expect(summary).toContain(`- \`${'C'.repeat(32)}\` uptime (also: vatIneligible, noBond): \`low_balance\``)
      expect(summary).toContain(`- \`${'D'.repeat(32)}\` vatIneligible: \`low_balance\``)
    })

    it('flags a staked validator with a bond that VAT alone refuses', () => {
      const summary = summaryWith([
        vatValidator('W'.repeat(32), ['vatIneligible'], { marinadeActivatedStakeSol: 500_000, bondBalanceSol: 150 }),
        vatValidator('X'.repeat(32), ['vatIneligible'], { bondBalanceSol: 150 }),
        vatValidator('Y'.repeat(32), ['vatIneligible', 'noBond'], { marinadeActivatedStakeSol: 35_000 }),
        vatValidator('Z'.repeat(32), ['uptime', 'vatIneligible'], {
          marinadeActivatedStakeSol: 30_000,
          bondBalanceSol: 22,
        }),
      ])
      expect(summary).toContain('- ⚠ VAT is the only gate, with Marinade stake = `1`')
      expect(summary).toContain(
        `- ⚠ \`${'W'.repeat(32)}\` vatIneligible: \`low_balance\`, Marinade stake \`${(500_000).toLocaleString()}\` SOL, bond \`150\` SOL`,
      )
      expect(summary).toContain(`- \`${'X'.repeat(32)}\` vatIneligible`)
      expect(summary).toContain(`- \`${'Y'.repeat(32)}\` vatIneligible (also: noBond)`)
      expect(summary).toContain(`- \`${'Z'.repeat(32)}\` uptime (also: vatIneligible)`)
      expect(summary).not.toContain(`⚠ \`${'X'.repeat(32)}\``)
      expect(summary).not.toContain(`⚠ \`${'Y'.repeat(32)}\``)
      expect(summary).not.toContain(`⚠ \`${'Z'.repeat(32)}\``)
    })

    it('counts no VAT-only validator without a warning', () => {
      const summary = summaryWith([vatValidator('Y'.repeat(32), ['vatIneligible', 'noBond'])])
      expect(summary).toContain('- VAT is the only gate, with Marinade stake = `0`')
      expect(summary).not.toContain('⚠ VAT is the only gate, with Marinade stake')
    })

    it('prints a missing bond and a missing reason', () => {
      const summary = summaryWith([
        vatValidator('N'.repeat(32), ['vatIneligible', 'noBond'], { bondBalanceSol: null, vatRejectionReason: null }),
      ])
      expect(summary).toContain(
        `- \`${'N'.repeat(32)}\` vatIneligible (also: noBond): \`unknown reason\`, Marinade stake \`0\` SOL, bond none`,
      )
    })

    it('lists the higher Marinade stake first', () => {
      const summary = summaryWith([
        vatValidator('L'.repeat(32), ['vatIneligible', 'noBond'], { marinadeActivatedStakeSol: 10 }),
        vatValidator('H'.repeat(32), ['vatIneligible', 'noBond'], { marinadeActivatedStakeSol: 1000 }),
      ])
      expect(summary.indexOf('H'.repeat(32))).toBeLessThan(summary.indexOf('L'.repeat(32)))
    })

    it('collapses the rows and explains the gate before the blacklist section', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary({
        ...auctionResult,
        auctionData: {
          ...auctionResult.auctionData,
          validators: [vatValidator('A'.repeat(32), ['vatIneligible', 'noBond'])],
          blacklistDecision: {
            auctionEpoch: 641,
            evaluatedEpoch: 640,
            missingEpochs: [],
            maxNewListings: 0,
            added: [],
            held: [],
            kept: [],
            removed: [],
            carried: [],
          },
        },
      } as unknown as AuctionResult)
      const opened = summary.indexOf('<details><summary>VAT-ineligible validators</summary>')
      const row = summary.indexOf(`\`${'A'.repeat(32)}\``)
      const closed = summary.indexOf('</details>', row)
      const explainer = summary.indexOf('<details><summary>ⓘ How it works</summary>')
      expect(opened).toBeGreaterThan(summary.indexOf('- No chain VAT verdict, not cut = `0`'))
      expect(row).toBeGreaterThan(opened)
      expect(closed).toBeGreaterThan(row)
      expect(explainer).toBeGreaterThan(closed)
      expect(summary.indexOf('### Blacklist')).toBeGreaterThan(explainer)
      expect(summary).toContain('(`vat_admitted` false)')
    })

    it.each([true, null, undefined])('does not list a validator with vatEligible %p', vatEligible => {
      const summary = summaryWith([{ ...vatValidator('E'.repeat(32), []), vatEligible }], ['U'.repeat(32)])
      expect(summary).toContain('- VAT-ineligible validators = `0`')
      expect(summary).not.toContain('E'.repeat(32))
    })
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
            maxNewListings: 10,
            added: [],
            held: [],
            kept: [],
            removed: [],
            carried: [],
            newAccounts: [],
            alreadyListed: [],
            ...decision,
          },
        },
      }) as AuctionResult

    it('writes the added rows and lists their evidence in the summary', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      const result = withDecision({ added: [sandwichHit, slowHit], newAccounts: ['A'.repeat(32), 'B'.repeat(32)] })
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
        expect(summary).toContain(
          '### Blacklist\n- Evaluated windows ending at epochs `640`, `639`\n- Added = `2` hits on `2` new accounts (`blacklistRules.maxNewListings` `10`)\n',
        )
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

    it('writes the held hits to their own file', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      try {
        new AuctionCommand(new CliUtilityService()).storeResults(
          withDecision({ maxNewListings: 0, held: [sandwichHit, slowHit] }),
          path.join(outDir, 'results.json'),
          path.join(outDir, 'summary.md'),
          path.join(outDir, 'blacklist-added.csv'),
          path.join(outDir, 'blacklist-held.csv'),
        )
        expect(fs.readFileSync(path.join(outDir, 'blacklist-held.csv')).toString()).toBe(
          `vote_account,code\n${'A'.repeat(32)},SLOW_SLOTS_640\n${'B'.repeat(32)},MALICIOUS_SM_640\n`,
        )
        expect(fs.readFileSync(path.join(outDir, 'blacklist-added.csv')).toString()).toBe('vote_account,code\n')
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    })

    it('writes a header-only held file when nothing was held', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      try {
        new AuctionCommand(new CliUtilityService()).storeResults(
          withDecision({ added: [sandwichHit] }),
          path.join(outDir, 'results.json'),
          path.join(outDir, 'summary.md'),
          path.join(outDir, 'blacklist-added.csv'),
          path.join(outDir, 'blacklist-held.csv'),
        )
        expect(fs.readFileSync(path.join(outDir, 'blacklist-held.csv')).toString()).toBe('vote_account,code\n')
        expect(fs.readFileSync(path.join(outDir, 'blacklist-added.csv')).toString()).toBe(
          `vote_account,code\n${'B'.repeat(32)},MALICIOUS_SM_640\n`,
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
      expect(summary).toContain('- Added = `0` hits on `0` new accounts (`blacklistRules.maxNewListings` `10`)\n')
      expect(summary).toContain(
        '- ⚠ Held = `1`: more new accounts than `blacklistRules.maxNewListings`. Approve by adding them as manual entries of the blacklist config. Exempt the rejected ones with until_epoch, or the next auction judges them again.',
      )
      expect(summary).toContain(`  - \`${'B'.repeat(32)}\` MALICIOUS_SM_640: single 8%`)
    })

    it('lists held hits of a dry run as not for approval', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 0, held: [sandwichHit] }),
      )
      expect(summary).toContain(
        '- Held = `1`: dry run (`blacklistRules.maxNewListings` is 0), would-be listings, not for approval.',
      )
      expect(summary).not.toContain('Approve')
      expect(summary).not.toContain('from the window ending')
      expect(summary).toContain(`  - \`${'B'.repeat(32)}\` MALICIOUS_SM_640: single 8%`)
    })

    it('counts the dry-run held hits of the earlier window', () => {
      const earlierHit = { ...slowHit, code: 'SLOW_SLOTS_639', epochs: [638, 639] }
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 0, held: [sandwichHit, earlierHit] }),
      )
      expect(summary).toContain(
        '- Held = `2`: dry run (`blacklistRules.maxNewListings` is 0), would-be listings, not for approval.' +
          ' `1` from the window ending at epoch `639`, reported by the previous auction unless its data was late.',
      )
    })

    const listedRow = (voteAccount: string, code: string) => ({
      voteAccount,
      code,
      source: BlacklistRowSource.LEGACY,
      auctionEpoch: null,
    })
    const A = 'A'.repeat(32)
    const B = 'B'.repeat(32)

    it('splits the held accounts into new and already listed and marks the listed ones', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({
          maxNewListings: 0,
          held: [sandwichHit, slowHit],
          newAccounts: [B],
          alreadyListed: [listedRow(A, 'MALICIOUS_SM_600')],
        }),
      )
      expect(summary).toContain(
        '- Held = `2`: dry run (`blacklistRules.maxNewListings` is 0), would-be listings, not for approval.' +
          ' `1` new accounts, `1` already blacklisted.\n',
      )
      expect(summary).toContain(
        `  - \`${A}\` SLOW_SLOTS_640: epoch 639 245ms vs network 200ms; epoch 640 250ms vs network 200ms (already listed: MALICIOUS_SM_600)\n`,
      )
      expect(summary).toContain(
        `  - \`${B}\` MALICIOUS_SM_640: single 8% (400/5000 blocks, cluster median 0.80%, p=1.50e-90)\n`,
      )
    })

    it('splits the held accounts on a hold above maxNewListings', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 1, held: [sandwichHit, slowHit], newAccounts: [A, B] }),
      )
      expect(summary).toContain(' or the next auction judges them again. `2` new accounts, `0` already blacklisted.\n')
    })

    it('counts the new accounts whose hits are all carried', () => {
      const C = 'C'.repeat(32)
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({
          maxNewListings: 2,
          held: [sandwichHit, slowHit],
          newAccounts: [A, B, C],
          carried: [
            { voteAccount: C, code: 'MALICIOUS_SM_640', source: BlacklistRowSource.AUCTION, auctionEpoch: 641 },
          ],
        }),
      )
      expect(summary).toContain(' `2` new accounts, `0` already blacklisted. `1` more new accounts are carried.\n')
    })

    it('counts an account with two held hits once', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 0, held: [sandwichHit, { ...slowHit, voteAccount: B }], newAccounts: [B] }),
      )
      expect(summary).toContain('`1` new accounts, `0` already blacklisted.')
    })

    it('marks a held account of the previous auction without a current row', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 0, held: [sandwichHit, slowHit], newAccounts: [A] }),
      )
      expect(summary).toContain('`1` new accounts, `1` already blacklisted.')
      expect(summary).toContain('p=1.50e-90) (blacklisted in previous auction)\n')
    })

    it('names every current code of an already listed account', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({
          maxNewListings: 0,
          held: [slowHit],
          alreadyListed: [listedRow(A, 'BLACKLIST_COMMISSION_RUG'), listedRow(A, 'MALICIOUS_SM_600')],
        }),
      )
      expect(summary).toContain('(already listed: BLACKLIST_COMMISSION_RUG, MALICIOUS_SM_600)')
    })

    it('collapses the held hits and leaves the added ones outside', () => {
      const added = { ...slowHit, voteAccount: 'C'.repeat(32) }
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 0, added: [added], held: [sandwichHit], newAccounts: [B] }),
      )
      const header = summary.indexOf('- Held = `1`')
      const opened = summary.indexOf('<details><summary>Held hits</summary>')
      const hitLine = summary.indexOf(`  - \`${B}\``)
      const closed = summary.indexOf('</details>', hitLine)
      const addedLine = summary.indexOf(`  - \`${'C'.repeat(32)}\``)
      expect(header).toBeLessThan(opened)
      expect(opened).toBeLessThan(hitLine)
      expect(hitLine).toBeLessThan(closed)
      expect(addedLine).toBeLessThan(header)
      expect(summary).toContain(
        `  - \`${'C'.repeat(32)}\` SLOW_SLOTS_640: epoch 639 245ms vs network 200ms; epoch 640 250ms vs network 200ms\n`,
      )
    })

    it('shows the cap on the added line of a dry run without hits', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 0 }),
      )
      expect(summary).toContain('- Added = `0` hits on `0` new accounts (`blacklistRules.maxNewListings` `0`)\n')
      expect(summary).not.toContain('- Held')
    })

    it('counts an account with two added hits once', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ added: [sandwichHit, { ...slowHit, voteAccount: B }], newAccounts: [B] }),
      )
      expect(summary).toContain('- Added = `2` hits on `1` new accounts (`blacklistRules.maxNewListings` `10`)\n')
    })

    it('leaves an added hit of an already blacklisted account out of the new accounts', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({
          added: [sandwichHit, slowHit],
          newAccounts: [B],
          alreadyListed: [listedRow(A, 'MALICIOUS_SM_600')],
        }),
      )
      expect(summary).toContain('- Added = `2` hits on `1` new accounts (`blacklistRules.maxNewListings` `10`)\n')
    })

    it('has no held block without held hits', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(withDecision({}))
      expect(summary).not.toContain('Held hits')
    })

    it('explains the rules with the configured maxNewListings after the penalties', () => {
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 7 }),
      )
      const explainer = summary.indexOf('<details><summary>ⓘ How it works</summary>')
      expect(explainer).toBeGreaterThan(summary.indexOf('- Penalties'))
      expect(summary).toContain('`blacklistRules.maxNewListings` (now `7`) holds every hit and adds none')
    })

    it('keeps the earlier-window sentence before the split', () => {
      const earlierHit = { ...slowHit, code: 'SLOW_SLOTS_639', epochs: [638, 639] }
      const summary = new AuctionCommand(new CliUtilityService()).formatResultSummary(
        withDecision({ maxNewListings: 0, held: [sandwichHit, earlierHit], newAccounts: [A, B] }),
      )
      expect(summary).toContain(
        ' `1` from the window ending at epoch `639`, reported by the previous auction unless its data was late.' +
          ' `2` new accounts, `0` already blacklisted.',
      )
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
        '- ⚠ Kept = `1`: blacklisted in the previous auction and missing from the served list. Unlist with an exemption without until_epoch in the blacklist config.',
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
      const summary = summaryOf({ removed: ['R'.repeat(32)] }, [
        validator('S'.repeat(32), true, false),
        validator('T'.repeat(32), false, false),
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
      expect(summary).toContain(
        '- ⚠ Missing sandwich rows, slot times or stake for epochs 639, 640; a rule window that lacks them gave no hits',
      )
    })

    it('has no blacklist section and no file without a decision', () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sam-store-results-'))
      try {
        new AuctionCommand(new CliUtilityService()).storeResults(
          auctionResult,
          path.join(outDir, 'results.json'),
          path.join(outDir, 'summary.md'),
          path.join(outDir, 'blacklist-added.csv'),
          path.join(outDir, 'blacklist-held.csv'),
        )
        expect(fs.existsSync(path.join(outDir, 'blacklist-added.csv'))).toBe(false)
        expect(fs.existsSync(path.join(outDir, 'blacklist-held.csv'))).toBe(false)
        const summary = fs.readFileSync(path.join(outDir, 'summary.md')).toString()
        expect(summary).not.toContain('### Blacklist')
        expect(summary).not.toContain('Removed')
        expect(summary).not.toContain('Penalties')
        expect(summary).not.toContain('How it works')
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
