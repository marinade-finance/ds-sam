import fs from 'fs'

import { Logger } from '@nestjs/common'
import { CliUtilityService, Command, CommandRunner, Option } from 'nest-commander'

import {
  AuctionResult,
  AuctionValidator,
  BlacklistAuctionDecision,
  BlacklistHit,
  BlacklistRuleId,
  DsSamConfig,
  DsSamSDK,
  EPSILON,
  InputsSource,
  SandwichEvidence,
  SandwichObservation,
  SlowSlotsEvidence,
  blacklistPenaltySol,
  formatLastCapConstraint,
  renderBlacklistCsv,
} from '@marinade.finance/ds-sam-sdk'

const COMMAND_NAME = 'auction'

const formatSandwich = (kind: string, o: SandwichObservation) =>
  `${kind} ${o.rate30dPct}% (${o.blocksWithSandwiches}/${o.blocksProduced} blocks, cluster median ${o.clusterMedianPct.toFixed(2)}%, p=${o.pValue.toExponential(2)})`

const formatHit = (hit: BlacklistHit, note = ''): string => {
  if (hit.rule === BlacklistRuleId.SANDWICH) {
    const { single, wide } = hit.evidence as SandwichEvidence
    const observed = [single && formatSandwich('single', single), wide && formatSandwich('wide', wide)]
    return `  - \`${hit.voteAccount}\` ${hit.code}: ${observed.filter(Boolean).join('; ')}${note}`
  }
  const { epochs } = hit.evidence as SlowSlotsEvidence
  const observed = Object.entries(epochs).map(
    ([epoch, { slotDurationMedianMs, networkMedianMs }]) =>
      `epoch ${epoch} ${slotDurationMedianMs}ms vs network ${networkMedianMs}ms`,
  )
  return `  - \`${hit.voteAccount}\` ${hit.code}: ${observed.join('; ')}${note}`
}

const details = (summary: string, lines: string[]): string[] => [
  '',
  `<details><summary>${summary}</summary>`,
  '',
  ...lines,
  '',
  '</details>',
]

type AuctionCommandOptions = Partial<
  DsSamConfig & {
    configFilePath: string
    outputDirPath: string
  }
>

@Command({
  name: COMMAND_NAME,
  description: 'Run the auction (see README for SDK config details)',
})
export class AuctionCommand extends CommandRunner {
  private readonly logger = new Logger()

  constructor(private readonly nestCliUtilSvc: CliUtilityService) {
    super()
  }

  async run(_inputs: string[], options: AuctionCommandOptions): Promise<void> {
    const fileConfig: AuctionCommandOptions = options.configFilePath
      ? (JSON.parse(fs.readFileSync(options.configFilePath).toString()) as AuctionCommandOptions)
      : {}
    const config: AuctionCommandOptions = { ...fileConfig, ...options }

    if (config.outputDirPath && !fs.existsSync(config.outputDirPath)) {
      throw new Error(`Output directory path "${config.outputDirPath}" does not exist`)
    }

    this.logger.log(`Running "${COMMAND_NAME}" command...`, { ...config })
    const dsSam = new DsSamSDK({ ...config })
    const result = await dsSam.run()
    this.logger.log(`Finished "${COMMAND_NAME}" command`, { ...config })

    for (const validator of result.auctionData.validators) {
      console.log(
        `${validator.voteAccount}  \t${validator.auctionStake.marinadeSamTargetSol}\t${validator.revShare.totalPmpe}\t${formatLastCapConstraint(validator.lastCapConstraint)}`,
      )
    }

    if (config.outputDirPath) {
      this.storeResults(
        result,
        `${config.outputDirPath}/results.json`,
        `${config.outputDirPath}/summary.md`,
        `${config.outputDirPath}/blacklist-added.csv`,
        `${config.outputDirPath}/blacklist-held.csv`,
      )
    }
  }

  storeResults(
    result: AuctionResult,
    resultsPath: string,
    summaryPath: string,
    blacklistAddedPath?: string,
    blacklistHeldPath?: string,
  ) {
    const decision = result.auctionData.blacklistDecision
    if (decision && blacklistAddedPath) {
      fs.writeFileSync(blacklistAddedPath, renderBlacklistCsv([...decision.added, ...decision.carried]))
    }
    if (decision && blacklistHeldPath) {
      fs.writeFileSync(blacklistHeldPath, renderBlacklistCsv(decision.held))
    }
    const resultsStr = JSON.stringify(
      {
        ...result,
        auctionData: {
          ...result.auctionData,
          blacklist: Array.from(result.auctionData.blacklist),
          validators: result.auctionData.validators.map(({ lastCapConstraint, epochStats: _, ...validator }) => ({
            ...validator,
            lastCapConstraint: lastCapConstraint && {
              ...lastCapConstraint,
              validators: lastCapConstraint.validators.length,
            },
          })),
        },
      },
      null,
      2,
    )

    fs.writeFileSync(resultsPath, resultsStr)
    fs.writeFileSync(summaryPath, this.formatResultSummary(result))
  }

  formatResultSummary(result: AuctionResult): string {
    const {
      validators,
      stakeAmounts: { networkTotalSol, marinadeSamTvlSol, marinadeRemainingSamSol },
    } = result.auctionData
    const eligibleValidators = validators.filter(({ samEligible }) => samEligible).length
    const stakedValidators = validators.filter(
      ({ auctionStake: { marinadeSamTargetSol } }) => marinadeSamTargetSol > 0,
    ).length
    const unallocatedSamSol = marinadeRemainingSamSol < EPSILON ? 0 : marinadeRemainingSamSol
    return [
      '## Auction summary',
      '\n### Stake amounts',
      `- Total network stake = \`${networkTotalSol.toLocaleString()}\` SOL`,
      `- Total Marinade stake = \`${marinadeSamTvlSol.toLocaleString()}\` SOL`,
      `  - SAM stake = \`${marinadeSamTvlSol.toLocaleString()}\` SOL`,
      `  - ${unallocatedSamSol > 0 ? '⚠ ' : ''}Unallocated SAM stake (no auction target) = \`${unallocatedSamSol.toLocaleString(undefined, { maximumFractionDigits: 4 })}\` SOL`,
      '\n### Results stats',
      `- Auction winning rev share = \`${result.winningTotalPmpe}\` PMPE`,
      `- Eligible validators count = \`${eligibleValidators.toLocaleString()}\``,
      `- Staked validators count = \`${stakedValidators.toLocaleString()}\``,
      ...this.formatVatSummary(validators, result.auctionData.unknownVatVerdict),
      ...this.formatBlacklistSummary(result.auctionData.blacklistDecision, validators),
      '',
    ].join('\n')
  }

  formatVatSummary(validators: AuctionValidator[], unknownVatVerdict: string[]): string[] {
    const refused = validators
      .filter(({ vatEligible }) => vatEligible === false)
      .sort(
        (a, b) => b.marinadeActivatedStakeSol - a.marinadeActivatedStakeSol || (a.voteAccount < b.voteAccount ? -1 : 1),
      )
    if (refused.length === 0 && unknownVatVerdict.length === 0) {
      return []
    }
    const vatOnly = (v: AuctionValidator) =>
      v.samIneligibilityGates.length === 1 &&
      v.samIneligibilityGates[0] === 'vatIneligible' &&
      v.marinadeActivatedStakeSol > 0
    const vatOnlyCount = refused.filter(vatOnly).length
    const sol = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 })
    const row = (v: AuctionValidator) => {
      const [first, ...rest] = v.samIneligibilityGates
      const gates = rest.length > 0 ? `${first} (also: ${rest.join(', ')})` : String(first)
      const bond = v.bondBalanceSol === null ? 'bond none' : `bond \`${sol(v.bondBalanceSol)}\` SOL`
      return `- ${vatOnly(v) ? '⚠ ' : ''}\`${v.voteAccount}\` ${gates}: \`${v.vatRejectionReason ?? 'unknown reason'}\`, Marinade stake \`${sol(v.marinadeActivatedStakeSol)}\` SOL, ${bond}`
    }
    return [
      '\n### VAT',
      `- VAT-ineligible validators = \`${refused.length}\``,
      `- ${vatOnlyCount > 0 ? '⚠ ' : ''}VAT is the only gate, with Marinade stake = \`${vatOnlyCount}\``,
      `- No chain VAT verdict, not cut = \`${unknownVatVerdict.length}\``,
      ...(refused.length > 0 ? details('VAT-ineligible validators', refused.map(row)) : []),
      ...(unknownVatVerdict.length > 0
        ? details(
            'No chain VAT verdict, not cut',
            unknownVatVerdict.map(account => `- \`${account}\``),
          )
        : []),
      ...details('ⓘ How it works', [
        'A validator is cut only when the chain refused it at the last epoch boundary (`vat_admitted` false) and it still fails VAT in the running epoch.' +
          ' Without a chain verdict it is not cut.' +
          ' ⚠ marks a validator with a bond and Marinade stake whose only failing gate is VAT; the bid floor is not checked for it.',
      ]),
    ]
  }

  formatBlacklistSummary(decision: BlacklistAuctionDecision | undefined, validators: AuctionValidator[]): string[] {
    if (!decision) {
      return []
    }
    const lines = [
      '\n### Blacklist',
      `- Evaluated windows ending at epochs \`${decision.evaluatedEpoch}\`, \`${decision.evaluatedEpoch - 1}\``,
    ]
    if (decision.missingEpochs.length > 0) {
      lines.push(
        `- ⚠ Missing sandwich rows, slot times or stake for epochs ${decision.missingEpochs.join(', ')}; a rule window that lacks them gave no hits`,
      )
    }
    const newAccounts = new Set(decision.newAccounts)
    const addedNewCount = new Set(
      decision.added.map(hit => hit.voteAccount).filter(account => newAccounts.has(account)),
    ).size
    lines.push(
      `- Added = \`${decision.added.length}\` hits on \`${addedNewCount}\` new accounts (\`blacklistRules.maxNewListings\` \`${decision.maxNewListings}\`)`,
      ...decision.added.map(hit => formatHit(hit)),
    )
    if (decision.held.length > 0) {
      const isOlder = (hit: BlacklistHit) => Math.max(...hit.epochs) < decision.evaluatedEpoch
      const earlierWindow = decision.held.filter(isOlder).length
      const heldAccounts = new Set(decision.held.map(hit => hit.voteAccount))
      const newCount = [...heldAccounts].filter(account => newAccounts.has(account)).length
      const carriedNewCount = newAccounts.size - newCount
      const evaluated = decision.evaluatedEpoch
      const missingNote = decision.missingEpochs.includes(evaluated) ? `, or epoch ${evaluated} data was missing` : ''
      const olderTag = ` (window ending ${evaluated - 1} only; not hit in newest window ending ${evaluated}${missingNote})`
      const listedNote = (hit: BlacklistHit) => {
        if (newAccounts.has(hit.voteAccount)) {
          return ''
        }
        const codes = decision.alreadyListed.filter(row => row.voteAccount === hit.voteAccount).map(row => row.code)
        return codes.length > 0 ? ` (already listed: ${codes.join(', ')})` : ' (blacklisted in previous auction)'
      }
      const note = (hit: BlacklistHit) => listedNote(hit) + (isOlder(hit) ? olderTag : '')
      const held = `Held = \`${decision.held.length}\` hits on \`${newCount}\` new and \`${heldAccounts.size - newCount}\` already blacklisted accounts:`
      lines.push(
        (decision.maxNewListings === 0
          ? `- ${held} dry run (\`blacklistRules.maxNewListings\` is 0), no held hit is listed.` +
            ` Listing all of them needs \`blacklistRules.maxNewListings\` ≥ \`${Math.max(1, newAccounts.size)}\`.`
          : `- ⚠ ${held} \`${newAccounts.size}\` new accounts exceed \`blacklistRules.maxNewListings\` \`${decision.maxNewListings}\`, so no held hit is listed.` +
            ' Approving some by manual entry in the blacklist config can bring the rest under the cap, and the next auction lists those that still hit.' +
            ' Exempt the rejected ones with until_epoch.') +
          (earlierWindow > 0
            ? ` \`${earlierWindow}\` hits come only from the older window ending \`${evaluated - 1}\`, not from the newest one.`
            : '') +
          (carriedNewCount > 0 ? ` \`${carriedNewCount}\` more new accounts are carried.` : ''),
        ...details(
          'Held hits',
          decision.held.map(hit => formatHit(hit, note(hit))),
        ),
        '',
      )
    }
    if (decision.kept.length > 0) {
      lines.push(
        `- ⚠ Kept = \`${decision.kept.length}\`: blacklisted in the previous auction and missing from the served list.` +
          ' Unlist with an exemption without until_epoch in the blacklist config.',
        ...decision.kept.map(account => `  - \`${account}\``),
      )
    }
    if (decision.carried.length > 0) {
      lines.push(
        `- Carried = \`${decision.carried.length}\`: listings of an earlier run of this auction, kept while its hits are held`,
        ...decision.carried.map(row => `  - \`${row.voteAccount}\` ${row.code}`),
      )
    }
    const penalized = validators.filter(v => v.revShare.blacklistPenaltyPmpe > 0)
    const penaltySol = penalized.reduce((sum, v) => sum + blacklistPenaltySol(v), 0)
    lines.push(
      `- Removed = \`${decision.removed.length}\``,
      ...decision.removed.map(account => `  - \`${account}\``),
      `- Penalties = \`${penalized.length}\` validators, estimated \`${penaltySol.toLocaleString(undefined, { maximumFractionDigits: 4 })}\` SOL`,
      ...details('ⓘ How it works', [
        `Each hit is one rule matching one validator. More new accounts than \`blacklistRules.maxNewListings\` (now \`${decision.maxNewListings}\`) holds every hit and adds none; \`0\` is a dry run.` +
          ' An account already listed under the same rule gives no hit.' +
          " A hit only from the older window was already judged by the previous auction, unless that auction's summary reports missing epochs.",
      ]),
    )
    return lines
  }

  @Option({
    flags: '-c, --config-file-path <string>',
    name: 'configFilePath',
    description: 'File to read base config from (overridden by other options)',
  })
  parseOptConfigFilePath(val: string) {
    return val
  }
  @Option({
    flags: '-o, --output-dir-path <string>',
    name: 'outputDirPath',
    description: 'File to write the results into',
  })
  parseOptOutputFilePath(val: string) {
    return val
  }

  @Option({
    flags: '-i, --inputs-source <string>',
    name: 'inputsSource',
    description: 'SDK param `inputsSource`',
    choices: Object.values(InputsSource),
  })
  parseOptInputsSource(val: string) {
    return val
  }
  @Option({
    flags: '--cache-dir-path <string>',
    name: 'inputsCacheDirPath',
    description: 'SDK param `inputsCacheDirPath`',
  })
  parseOptInputsCacheDirPath(val: string) {
    return val
  }
  @Option({
    flags: '--cache-inputs',
    name: 'cacheInputs',
    description: 'SDK param `cacheInputs`',
  })
  parseOptCacheInputs() {
    return true
  }

  @Option({
    flags: '--validators-url <string>',
    name: 'validatorsApiBaseUrl',
    description: 'SDK param `validatorsApiBaseUrl`',
  })
  parseOptValidatorsApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--bonds-url <string>',
    name: 'bondsApiBaseUrl',
    description: 'SDK param `bondsApiBaseUrl`',
  })
  parseOptBondsApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--tvl-url <string>',
    name: 'tvlInfoApiBaseUrl',
    description: 'SDK param `tvlInfoApiBaseUrl`',
  })
  parseOptTvlInfoApiBaseUrl(val: string) {
    return val
  }
  @Option({
    flags: '--blacklist-url <string>',
    name: 'blacklistApiBaseUrl',
    description: 'SDK param `blacklistApiBaseUrl`',
  })
  parseOptBlacklistApiBaseUrl(val: string) {
    return val
  }

  @Option({
    flags: '--blacklist-file <string>',
    name: 'blacklistFilePath',
    description:
      'SDK param `blacklistFilePath` (local CSV with a `vote_account,code` header row; the first line is dropped as the header)',
  })
  parseOptBlacklistFilePath(val: string) {
    return val
  }
  @Option({
    flags: '--snapshots-url <string>',
    name: 'snapshotsApiBaseUrl',
    description: 'SDK param `snapshotsApiBaseUrl`',
  })
  parseOptSnapshotsApiBaseUrl(val: string) {
    return val
  }

  @Option({
    flags: '--rewards-epochs <number>',
    name: 'rewardsEpochsCount',
    description: 'SDK param `rewardsEpochsCount`',
  })
  parseOptRewardsEpochsCount(val: string) {
    return this.nestCliUtilSvc.parseInt(val)
  }
  @Option({
    flags: '--uptime-epochs <number>',
    name: 'validatorsUptimeEpochsCount',
    description: 'SDK param `validatorsUptimeEpochsCount`',
  })
  parseOptValidatorsUptimeEpochsCount(val: string) {
    return this.nestCliUtilSvc.parseInt(val)
  }
  @Option({
    flags: '--uptime-threshold <number>',
    name: 'validatorsUptimeThreshold',
    description: 'SDK param `validatorsUptimeThreshold`',
  })
  parseOptValidatorsUptimeThreshold(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--client-version-expr <string>',
    name: 'validatorsClientVersionSemverExpr',
    description: 'SDK param `validatorsClientVersionSemverExpr`',
  })
  parseOptValidatorsClientVersionSemverExpr(val: string) {
    return val
  }
  @Option({
    flags: '--max-effective-commission <number>',
    name: 'validatorsMaxEffectiveCommissionDec',
    description: 'SDK param `validatorsMaxEffectiveCommissionDec`',
  })
  parseOptValidatorsMaxEffectiveCommissionDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }

  @Option({
    flags: '--marinade-country-cap <number>',
    name: 'maxMarinadeStakeConcentrationPerCountryDec',
    description: 'SDK param `maxMarinadeStakeConcentrationPerCountryDec`',
  })
  parseOptMaxMarinadeStakeConcentrationPerCountryDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--marinade-aso-cap <number>',
    name: 'maxMarinadeStakeConcentrationPerAsoDec',
    description: 'SDK param `maxMarinadeStakeConcentrationPerAsoDec`',
  })
  parseOptMaxMarinadeStakeConcentrationPerAsoDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--global-country-cap <number>',
    name: 'maxNetworkStakeConcentrationPerCountryDec',
    description: 'SDK param `maxNetworkStakeConcentrationPerCountryDec`',
  })
  parseOptMaxNetworkStakeConcentrationPerCountryDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--global-aso-cap <number>',
    name: 'maxNetworkStakeConcentrationPerAsoDec',
    description: 'SDK param `maxNetworkStakeConcentrationPerAsoDec`',
  })
  parseOptMaxNetworkStakeConcentrationPerAsoDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }
  @Option({
    flags: '--marinade-validator-cap <number>',
    name: 'maxMarinadeTvlSharePerValidatorDec',
    description: 'SDK param `maxMarinadeTvlSharePerValidatorDec`',
  })
  parseOptMaxMarinadeTvlSharePerValidatorDec(val: string) {
    return this.nestCliUtilSvc.parseFloat(val)
  }

  @Option({
    flags: '--debug-vote-accounts <string...>',
    name: 'debugVoteAccounts',
    description: 'SDK param `debugVoteAccounts` (space separated)',
  })
  parseOptDebugVoteAccounts(option: string, optionsAccumulator: string[] = []): string[] {
    optionsAccumulator.push(option)
    return optionsAccumulator
  }
}
