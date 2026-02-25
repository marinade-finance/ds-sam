# ds-sam

Marinade's Stake Auction for Solana validators.

<a href="https://www.npmjs.com/package/@marinade.finance/ds-sam-sdk">
  <img src="https://img.shields.io/npm/v/%40marinade.finance%2Fds-sam-sdk?logo=npm&color=377CC0" />
</a>

Validators bid PMPE (price per mSOL epoch) to receive
Marinade stake. Allocation proceeds lowest to highest PMPE
until stake depletes or constraints bind.

## Install

```bash
pnpm install
pnpm -r build
```

## Running Simulations

```bash
# baseline: fetch fresh API data
./evaluate-auction 20260225_experiment/main -b

# variants: reuse baseline inputs, different config
./evaluate-auction 20260225_experiment/maxcap8 -c config-8pct.json

# results in report/<tag>/ with summary.md and report.md
./evaluate-auction -h
```

Other scripts:
- `evaluate-blacklist`: blacklist impact comparison
- `simulate-auction <epoch>`: historical replay from GCP
  snapshots
- `evaluate-revenue-changes.bash`: revenue impact from
  production run

## Configuration

Pass via `-c config.json`. Defaults to
`../ds-sam-pipeline/auction-config.json`.

Key parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxMarinadeTvlSharePerValidatorDec` | 0.04 | Per-validator stake cap (4%) |
| `maxUnprotectedStakePerValidatorDec` | 0.06 | Unprotected stake cap (6% of delegated) |
| `minBondBalanceSol` | - | Minimum bond balance |
| `minBondEpochs` / `idealBondEpochs` | 1 / 12 | Bond reserve requirements |
| `maxNetworkStakeConcentrationPerCountryDec` | 0.3 | Country concentration cap (30%) |
| `maxNetworkStakeConcentrationPerAsoDec` | 0.3 | ASO concentration cap (30%) |
| `validatorsUptimeThresholdDec` | 0.8 | Minimum uptime (80%) |

All options:
[config.ts](./packages/ds-sam-sdk/src/config.ts).
Production values:
[auction-config.json](https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json).

## Publishing SDK

```bash
cd packages/ds-sam-sdk
npm publish
```

See ARCHITECTURE.md for algorithm details.
