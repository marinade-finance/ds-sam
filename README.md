# ds-sam

Marinade's Stake Auction Marketplace for Solana validators.

<a href="https://www.npmjs.com/package/@marinade.finance/ds-sam-sdk">
  <img src="https://img.shields.io/npm/v/%40marinade.finance%2Fds-sam-sdk?logo=npm&color=377CC0" />
</a>

Validators bid PMPE (price per mSOL epoch) to receive Marinade stake. Allocation proceeds from lowest to highest PMPE until stake depletes or constraints bind: validator caps, country/ASO concentration limits, bond requirements, and uptime thresholds.

## Installation

```bash
pnpm install
pnpm -r build
```

## Running Simulations

Use `evaluate-auction` for organized baseline/comparison workflows:

```bash
# Create baseline with fresh API data
./evaluate-auction 20260213_experiment/main -b

# Run variants using baseline inputs
./evaluate-auction 20260213_experiment/maxcap8 -c config-8pct.json
./evaluate-auction 20260213_experiment/test2

# Show usage
./evaluate-auction -h
```

Results appear in `report/<tag>/` with inputs, outputs, summary.md, and report.md.

**Other workflows:**
- `evaluate-blacklist`: Compare main vs blacklist scenarios
- `simulate-auction <epoch>`: Historical replay from GCP snapshots
- `evaluate-revenue-changes.bash`: Revenue impact analysis from production run

## Configuration

Pass config via `-c config.json`. Defaults to `../ds-sam-pipeline/auction-config.json`.

Key parameters:

- `maxMarinadeTvlSharePerValidatorDec`: Per-validator stake cap (0.04 = 4%)
- `maxUnprotectedStakePerValidatorDec`: Unprotected stake cap (0.06 = 6% of delegated stake)
- `minBondBalanceSol`: Minimum bond balance required
- `minBondEpochs`/`idealBondEpochs`: Reserve requirements (1 min, 12 ideal)
- `maxNetworkStakeConcentrationPerCountryDec`: Country stake cap (0.3 = 30%)
- `maxNetworkStakeConcentrationPerAsoDec`: ASO stake cap (0.3 = 30%)
- `validatorsUptimeThresholdDec`: Minimum uptime eligibility (0.8 = 80%)

See [config.ts](./packages/ds-sam-sdk/src/config.ts) for all options and [ds-sam-pipeline config](https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json) for production values.

## Example: 4% → 8% Validator Cap

Feb 2026 analysis increasing per-validator stake cap:

- Deploys 383K more SOL (unallocated: 6% → 0.12%)
- PMPE unchanged (0.3758) - cap bound inframarginal validators
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
