# ds-sam

Marinade's Stake Auction Marketplace for Solana validators.

<a href="https://www.npmjs.com/package/@marinade.finance/ds-sam-sdk">
  <img src="https://img.shields.io/npm/v/%40marinade.finance%2Fds-sam-sdk?logo=npm&color=377CC0" />
</a>

Validators bid PMPE (price per mSOL epoch) to receive Marinade stake. Top bids win allocation subject to constraints: validator caps, country/ASO concentration limits, bond requirements, and uptime thresholds.

## Key Concepts

**PMPE**: Price per mSOL epoch. Revenue share validators offer to mSOL holders, expressed per 1000 SOL staked per epoch. Includes inflation rewards, MEV, bid amount, and block production rewards.

**Bond protection**: Validators post bonds to cover PMPE obligations. Bond must cover on-chain commission + PMPE bid + reserve for N epochs. Insufficient bond caps stake allocation.

**Unprotected stake**: Matching stake for validator's existing foundation/delegated stake. No bond protection required. Per-validator cap based on existing delegation.

**Winning PMPE**: Highest PMPE group that received stake. All validators in that group get equal allocation until constraints hit.

## Installation

```bash
pnpm install
pnpm -r build
```

## Running Simulations

Evaluate auction with current on-chain data:

```bash
pnpm run cli -- auction --inputs-source APIS --cache-inputs \
  --cache-dir-path ./cache -c config.json -o ./output
```

Re-run with cached data:

```bash
pnpm run cli -- auction --inputs-source FILES \
  --cache-dir-path ./cache -c config.json -o ./output
```

Compare scenarios:

```bash
# Baseline run
pnpm run cli -- auction --inputs-source FILES \
  --cache-dir-path ./cache -c baseline.json -o ./baseline

# Modified run (e.g., 8% validator cap)
pnpm run cli -- auction --inputs-source FILES \
  --cache-dir-path ./cache -c modified.json -o ./modified

# Compare results
diff ./baseline/summary.md ./modified/summary.md
```

## Configuration

Pass config via `-c config.json` file. CLI options override file values.

Key parameters:

- `maxMarinadeTvlSharePerValidatorDec`: Per-validator stake cap (e.g., 0.04 = 4% of Marinade TVL)
- `maxUnprotectedStakePerValidatorDec`: Unprotected stake cap as fraction of delegated stake
- `minBondBalanceSol`: Minimum bond balance to receive any stake
- `minBondEpochs`/`idealBondEpochs`: Reserve requirements (1 min, 12 ideal)
- `maxNetworkStakeConcentrationPerCountryDec`: Country stake cap (default 0.3 = 30%)
- `maxNetworkStakeConcentrationPerAsoDec`: ASO stake cap (default 0.3)
- `validatorsUptimeThresholdDec`: Minimum uptime for eligibility (default 0.8)

See [config.ts](./packages/ds-sam-sdk/src/config.ts) for defaults and [ds-sam-pipeline config](https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json) for production values.

## Example Results

4% → 8% validator cap impact (Feb 2026 analysis):
- Deploys 383K more SOL (6% unallocated → 0.12%)
- PMPE unchanged (0.3758) because cap bound inframarginal validators
- Bond coverage ~17 epochs at current bids
- 70 validators receive stake (unchanged)

## Development

```bash
pnpm -r build          # Build all packages
pnpm test              # Run tests
FILE='*.test.ts' pnpm test  # Single test file
pnpm lint              # Lint
pnpm fix               # Fix lint and format
```

## Publishing SDK

```bash
cd packages/ds-sam-sdk
npm publish
```

See ARCHITECTURE.md for technical details.
