# CLAUDE.md

ds-sam (Directed Stake Auction Manager): TypeScript monorepo for Marinade's stake auction system.

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
pnpm -r build           # Build monorepo
pnpm test               # All tests
FILE='file.test.ts' pnpm test  # Single test
pnpm lint               # Lint only
pnpm check              # Lint + format check
pnpm fix                # Fix lint + format
```

## CLI

```bash
pnpm run cli -- auction --help
pnpm run cli -- auction --inputs-source APIS --cache-inputs --cache-dir-path ./cache -c config.json -o ./out
pnpm run cli -- auction --inputs-source FILES --cache-dir-path ./cache -c config.json -o ./out
```

## Non-obvious Patterns

### PMPE Group Iteration (auction.ts)

Auction distributes stake by iterating PMPE groups from LOWEST to HIGHEST (counter-intuitive):

1. `findNextPmpeGroup(previousPmpe)` finds max PMPE < previousPmpe
2. Distribute evenly within group until constraints hit
3. Remove capped validators, continue to next group
4. Last group to receive stake = winning group (highest PMPE that got stake)

### Unstake Priority Calculation (auction.ts:189-207)

Three-tier priority (lower = unstake first):

1. **Tier 0**: Ineligible validators (`!samEligible`) get priority 0
2. **Tier 1-N**: Underfunded bonds (`bondSamHealth < 1`) sorted by health (worst first)
3. **Tier N+**: Funded bonds sorted by (APY ascending, then health ascending)

Counter-intuitive: Lower APY unstaked first (worse deal for Marinade).

### Bond Hysteresis (constraints.ts:273-283)

Prevents stake flapping when bond balance oscillates near `minBondBalanceSol`:

- `< 0.8 * minBondBalance`: cap = 0 (full unstake)
- `0.8-1.0 * minBondBalance`: cap = current stake (freeze, no new stake)
- `>= minBondBalance`: normal cap calculation

### bondGoodForNEpochs (constraints.ts:238-245)

Estimates epoch coverage: `(bondBalance - onchainPmpe * protectedStake) / expectedMaxBidPmpe`

- Accounts for already-distributed rewards (`onchainDistributedPmpe`)
- Only counts protected stake (excludes unprotected/matching stake)
- Used in health calculations, NOT directly in stake caps

### Unprotected Stake Semantics

"Unprotected" = matching stake that covers foundation/delegated stake (NO bond protection required).
Confusing name: sounds risky, actually reduces bond requirements.

### Blacklist Penalty (auction.ts:400-408)

Newly blacklisted validator (`samBlacklisted && !lastSamBlacklisted`) gets penalty:
`winningPmpe + min(3 * effParticipatingBidPmpe, winningPmpe)`
Makes validator uncompetitive (2-4x winning bid) but not infinite (allows future un-blacklisting).

### Commission Overrides vs On-chain (calculations.ts:30-44)

Three commission layers:

1. **On-chain**: Current validator commission
2. **Override**: Marinade-specific commission (e.g., via bonds program)
3. **Bond obligation**: What validator promises to pay from bond claims

`onchainDistributedPmpe` = what's already paid on-chain (override if exists, else on-chain).
`bondObligationPmpe` = additional payment from bonds (override diff + bond diff).
Total PMPE = inflation + MEV + bid + block (NOT reduced by commissions - those are deductions).

## Config

- CLI: `-c config.json` (base) + CLI options (override)
- SDK: `DEFAULT_CONFIG` in config.ts
- InputsSource: `APIS` (fetch live) vs `FILES` (cached)
- Production config: https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json

## Dev Notes

- Pre-commit: `pnpm lint-staged` reformats on first run - ALWAYS retry commit (2 attempts)
- Publishing SDK: `cd packages/ds-sam-sdk && npm publish` (NOT pnpm)
- Debug: Set `debugVoteAccounts` + `logVerbosity` in config
- Cache data: `--cache-inputs --cache-dir-path ./cache` (avoids re-fetching during dev)
- Helper scripts: `simulate-auction`, `evaluate-blacklist`, `evaluate-auction`
