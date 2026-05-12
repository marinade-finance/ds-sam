# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ds-sam: TypeScript monorepo for Marinade's directed stake auction.

## Layout

```
packages/ds-sam-sdk/src/
  auction.ts         # Auction - stake distribution algorithm
  constraints.ts     # AuctionConstraints - stake caps, bond requirements
  calculations.ts    # Revenue share, penalties, fees
  types.ts           # Core types: AuctionValidator, AggregatedValidator, RevShare, etc.
  config.ts          # DEFAULT_CONFIG
  sdk.ts             # DsSamSDK entry point; transformValidators() computes eligibility
  debug.ts           # Debug logging and tracing
  utils.ts           # Shared utilities
  data-provider/
    data-provider.ts      # DataProvider - fetch/cache/aggregate source data
    data-provider.dto.ts  # Raw API response types (RawValidatorsResponseDto, etc.)
src/
  commands/auction.cmd.ts          # Main CLI command
  commands/analyze-revenue.cmd.ts  # Revenue analysis
test/                              # CLI integration tests
packages/ds-sam-sdk/test/          # SDK unit tests
  helpers/validator-mock-builder.ts       # Build mock validators
  helpers/static-data-provider.ts         # StaticDataProvider for tests
  helpers/static-data-provider-builder.ts # Builder for StaticDataProvider
  helpers/auction-test-utils.ts           # Shared test helpers
  helpers/utils.ts                        # prettyPrint* and assert helpers for tests
```

## Build & Test

```bash
pnpm -r build                     # Build monorepo
pnpm test                         # All tests
FILE='file.test.ts' pnpm test     # Single test
pnpm lint                         # Lint only
pnpm check                        # Lint + format check
pnpm fix                          # Fix lint + format
```

## CLI

```bash
pnpm run cli -- auction --help
pnpm run cli -- auction -i APIS --cache-inputs --cache-dir-path ./cache -c config.json -o ./out
pnpm run cli -- auction -i FILES --cache-dir-path ./cache -c config.json -o ./out
```

## Config

- CLI: `-c config.json` (base) + CLI flags (override)
- SDK: `DEFAULT_CONFIG` in config.ts
- InputsSource: `APIS` (live) vs `FILES` (cached)
- Production: https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json

## Key Concepts

**PMPE** = per mille per epoch: reward/stake ratio normalized per 1000 SOL per epoch.
All bids, rev-share, and penalty values are in PMPE units.

## Architecture

`DsSamSDK.run()` flow:

1. `DataProvider.fetchSourceData()` / `parseCachedSourceData()` — load raw API responses
2. `DataProvider.aggregateData()` — normalize into `AggregatedData`
3. `DsSamSDK.transformValidators()` — compute `RevShare` and eligibility flags
   (uptime check, client version semver, bond presence, min PMPE threshold)
4. `Auction.evaluate()`:
   - `updateExpectedMaxEffBidPmpe()` — dry-run sub-auction to estimate the clearing price
   - `updatePaidUndelegation()` — carry forward undelegation bookkeeping
   - `evaluateOne()` — distribute SAM stake (highest PMPE first), then backstop stake
   - `setStakeUnstakePriorities()`, `setAuctionEffectiveBids()`, `setBondRiskFee()`,
     `setBidTooLowPenalties()`, `setMaxBondDelegations()`, `setBlacklistPenalties()`
5. Returns `AuctionResult` with `winningTotalPmpe` and per-validator `auctionStake` targets

`AuctionConstraints` tracks per-validator and per-entity caps
(VALIDATOR, COUNTRY, ASO, BOND, WANT, RISK).
`calculations.ts` handles revenue share math, bond risk fees,
bid-too-low penalties.

## Dev Notes

- Pre-commit reformats on first run - retry commit (2 attempts)
- Publish SDK: `cd packages/ds-sam-sdk && npm publish` (NOT pnpm)
- Debug: set `debugVoteAccounts` + `logVerbosity` in config
- Cache: `--cache-inputs --cache-dir-path ./cache`
- Helper scripts: `scripts/evaluate-auction.bash`, `evaluate-blacklist`, `simulate-auction`
