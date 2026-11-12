import { BlacklistRowSource, ExemptRule } from '@marinade.finance/ds-sam-calc'

import type {
  RawBlacklistRulesInputs,
  RawCurrentBlacklistDto,
  RawValidatorQualityDto,
  RawValidatorsResponseDto,
} from './data-provider.dto'
import type { BlacklistRulesData, CurrentBlacklist, SandwichRow, SlotTimeRow } from '@marinade.finance/ds-sam-calc'

const VOTE_ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const CODE = /^[A-Z0-9_]+$/

const oneOf = <T extends string>(values: Record<string, T>, value: string): value is T =>
  (Object.values(values) as string[]).includes(value)

/**
 * The current blacklist with every field checked. Errors name the row, never its content, as the
 * auction runs in public CI logs.
 */
export const parseCurrentBlacklist = (dto: RawCurrentBlacklistDto, source: string): CurrentBlacklist => {
  const fail = (what: string): never => {
    throw new Error(`Invalid blacklist from ${source}: ${what}`)
  }
  if (!Array.isArray(dto?.rows) || !Array.isArray(dto?.exempt)) {
    fail('rows and exempt must be arrays')
  }
  if (dto.rows.length === 0) {
    fail('no rows; refusing to decide on an empty list')
  }
  const rows = dto.rows.map((row, i) => {
    if (!VOTE_ACCOUNT.test(row.vote_account)) fail(`row ${i}: vote account is not a base58 pubkey`)
    if (!CODE.test(row.code)) fail(`row ${i}: code is not [A-Z0-9_]+`)
    if (!oneOf(BlacklistRowSource, row.source)) fail(`row ${i}: unknown source`)
    const auction = row.source === (BlacklistRowSource.AUCTION as string)
    if (auction !== Number.isInteger(row.auction_epoch))
      fail(`row ${i}: auction_epoch must be set on auction rows only`)
    return {
      voteAccount: row.vote_account,
      code: row.code,
      source: row.source as BlacklistRowSource,
      auctionEpoch: auction ? row.auction_epoch : null,
    }
  })
  const exempt = dto.exempt.map((entry, i) => {
    if (!VOTE_ACCOUNT.test(entry.vote_account)) fail(`exempt ${i}: vote account is not a base58 pubkey`)
    if (!oneOf(ExemptRule, entry.rule)) fail(`exempt ${i}: unknown rule`)
    if (entry.until_epoch !== null && !Number.isInteger(entry.until_epoch)) fail(`exempt ${i}: until_epoch`)
    return { voteAccount: entry.vote_account, rule: entry.rule as ExemptRule, untilEpoch: entry.until_epoch }
  })
  return { rows, exempt }
}

const COUNTS = ['blocks_produced', 'blocks_with_sandwiches'] as const
const MEASURES = ['sandwich_rate_30d', 'wide_sandwich_rate_30d', 'slot_duration_median_ms'] as const

/** Checks every quality row the rules read; errors name the row, never its content. */
const validateQuality = (records: RawValidatorQualityDto[], epoch: number) => {
  const fail = (what: string): never => {
    throw new Error(`Invalid validator quality of epoch ${epoch}: ${what}`)
  }
  records.forEach((r, i) => {
    if (!VOTE_ACCOUNT.test(r.vote_account)) fail(`row ${i}: vote account is not a base58 pubkey`)
    for (const field of COUNTS) {
      const value = r[field]
      if (value !== null && !(Number.isInteger(value) && value >= 0)) fail(`row ${i}: ${field}`)
    }
    for (const field of MEASURES) {
      const value = r[field]
      if (value !== null && !(Number.isFinite(value) && value >= 0)) fail(`row ${i}: ${field}`)
    }
    if (
      r.blocks_with_sandwiches !== null &&
      r.blocks_produced !== null &&
      r.blocks_with_sandwiches > r.blocks_produced
    ) {
      fail(`row ${i}: more blocks with sandwiches than blocks produced`)
    }
  })
}

const sandwichRows = (records: RawValidatorQualityDto[]): SandwichRow[] =>
  records.flatMap(r =>
    r.blocks_produced === null || r.blocks_with_sandwiches === null || r.sandwich_rate_30d === null
      ? []
      : [
          {
            voteAccount: r.vote_account,
            blocksProduced: r.blocks_produced,
            blocksWithSandwiches: r.blocks_with_sandwiches,
            sandwichRate30d: r.sandwich_rate_30d,
            wideSandwichRate30d: r.wide_sandwich_rate_30d,
          },
        ],
  )

const slotTimeRows = (records: RawValidatorQualityDto[]): SlotTimeRow[] =>
  records.flatMap(r =>
    r.slot_duration_median_ms === null
      ? []
      : [{ voteAccount: r.vote_account, slotDurationMedianMs: r.slot_duration_median_ms }],
  )

const stakesByEpoch = (validators: RawValidatorsResponseDto): Map<number, Map<string, bigint>> => {
  const stakes = new Map<number, Map<string, bigint>>()
  for (const validator of validators.validators) {
    for (const stat of validator.epoch_stats) {
      const epochStakes = stakes.get(stat.epoch) ?? new Map<string, bigint>()
      epochStakes.set(validator.vote_account, BigInt(stat.activated_stake))
      stakes.set(stat.epoch, epochStakes)
    }
  }
  return stakes
}

export const blacklistRulesData = (
  inputs: RawBlacklistRulesInputs,
  validators: RawValidatorsResponseDto,
  source: string,
): BlacklistRulesData => {
  const epochs = Object.entries(inputs.quality).map(([epoch, records]) => [Number(epoch), records] as const)
  for (const [epoch, records] of epochs) {
    validateQuality(records, epoch)
  }
  return {
    current: parseCurrentBlacklist(inputs.current, source),
    sandwichesByEpoch: new Map(epochs.map(([epoch, records]) => [epoch, sandwichRows(records)])),
    slotTimesByEpoch: new Map(epochs.map(([epoch, records]) => [epoch, slotTimeRows(records)])),
    stakesByEpoch: stakesByEpoch(validators),
  }
}
