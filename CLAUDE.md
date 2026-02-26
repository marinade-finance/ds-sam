# CLAUDE.md

ds-sam: TypeScript monorepo for Marinade's directed stake auction.

## Layout

```
packages/ds-sam-sdk/src/
  auction.ts         # Auction.distributeSamStake() - main algorithm
  constraints.ts     # AuctionConstraints - stake caps, bond requirements
  calculations.ts    # Revenue share, penalties, fees
  config.ts          # DEFAULT_CONFIG
  sdk.ts             # DsSamSDK entry point
  data-provider/     # Fetch from APIs or cached files
src/
  commands/auction.cmd.ts          # Main CLI command
  commands/analyze-revenue.cmd.ts  # Revenue analysis
test/                              # CLI integration tests
packages/ds-sam-sdk/test/          # SDK unit tests
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

## Non-obvious Patterns

### PMPE Group Iteration (auction.ts)

Iterates PMPE groups LOWEST to HIGHEST (counter-intuitive):

1. `findNextPmpeGroup(previousPmpe)` finds max PMPE < previousPmpe
2. Distribute evenly within group until constraints hit
3. Remove capped validators, continue to next group
4. Last group to receive stake = winning group (highest PMPE that got stake)

### Unstake Priority (auction.ts:189-207)

Three tiers (lower = unstake first):

1. Ineligible validators (`!samEligible`) -> priority 0
2. Underfunded bonds (`bondSamHealth < 1`) sorted by health ascending
3. Funded bonds sorted by APY ascending, then health ascending

Counter-intuitive: lower APY unstaked first.

### Bond Hysteresis (constraints.ts:273-283)

Prevents stake flapping near `minBondBalanceSol`:

- `< 0.8 * min`: cap = 0 (full unstake)
- `0.8-1.0 * min`: cap = current stake (freeze)
- `>= min`: normal cap

### bondGoodForNEpochs (constraints.ts:238-245)

`(bondBalance - onchainPmpe * protectedStake) / expectedMaxBidPmpe`

Only counts protected stake (excludes unprotected/matching). Used in health calculations,
NOT directly in stake caps.

### Unprotected Stake

"Unprotected" = matching stake covering foundation/delegated stake (NO bond required).
Confusing name: sounds risky, actually reduces bond requirements.

### Blacklist Penalty (auction.ts:400-408)

`winningPmpe + min(3 * effParticipatingBidPmpe, winningPmpe)`

Makes validator 2-4x uncompetitive but not infinite (allows un-blacklisting).

### Commission Layers (calculations.ts:30-44)

1. **On-chain**: current validator commission
2. **Override**: Marinade-specific (via bonds program)
3. **Bond obligation**: what validator pays from bond claims

`onchainDistributedPmpe` = override if exists, else on-chain. `bondObligationPmpe` = additional
from bonds (override diff + bond diff). Total PMPE = inflation + MEV + bid + block (NOT reduced
by commissions).

## Config

- CLI: `-c config.json` (base) + CLI flags (override)
- SDK: `DEFAULT_CONFIG` in config.ts
- InputsSource: `APIS` (live) vs `FILES` (cached)
- Production: https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json

## Dev Notes

- Pre-commit reformats on first run - retry commit (2 attempts)
- Publish SDK: `cd packages/ds-sam-sdk && npm publish` (NOT pnpm)
- Debug: set `debugVoteAccounts` + `logVerbosity` in config
- Cache: `--cache-inputs --cache-dir-path ./cache`
- Helper scripts: `scripts/evaluate-auction.bash`, `evaluate-blacklist`, `simulate-auction`
