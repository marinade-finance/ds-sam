# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ds-sam: TypeScript monorepo for Marinade's directed stake auction.

## Layout

```
packages/ds-sam-sdk/src/
  auction.ts         # Auction.distributeSamStake() - main algorithm
  constraints.ts     # AuctionConstraints - stake caps, bond requirements
  calculations.ts    # Revenue share, penalties, fees
  types.ts           # Core types: AuctionValidator, AggregatedValidator, RevShare, etc.
  config.ts          # DEFAULT_CONFIG
  sdk.ts             # DsSamSDK entry point
  utils.ts           # Shared utilities
  data-provider/     # Fetch from APIs or cached files
src/
  commands/auction.cmd.ts          # Main CLI command
  commands/analyze-revenue.cmd.ts  # Revenue analysis
test/                              # CLI integration tests
packages/ds-sam-sdk/test/          # SDK unit tests
  helpers/validator-mock-builder.ts       # Build mock validator data for tests
  helpers/static-data-provider-builder.ts # Build test data provider
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

## Architecture

`Auction.distributeSamStake()` iterates PMPE groups highest to lowest.
Within each group, distributes stake evenly across eligible validators,
respecting constraints (stake concentration caps, bond requirements).
`AuctionConstraints` tracks per-validator and per-entity caps.
`calculations.ts` handles revenue share math (effective PMPE,
bond risk fees, bid-too-low penalties).

Data flow: `DsSamSDK.run()` → fetch/aggregate data →
build `AuctionData` → `Auction.distributeSamStake()` →
`AuctionResult` with winning PMPE and per-validator stake targets.

## Dev Notes

- Pre-commit reformats on first run - retry commit (2 attempts)
- Publish SDK: `cd packages/ds-sam-sdk && npm publish` (NOT pnpm)
- Debug: set `debugVoteAccounts` + `logVerbosity` in config
- Cache: `--cache-inputs --cache-dir-path ./cache`
- Helper scripts: `scripts/evaluate-auction.bash`, `evaluate-blacklist`, `simulate-auction`
