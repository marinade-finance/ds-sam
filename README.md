# ds-sam

Marinade's Stake Auction for Solana validators.

<a href="https://www.npmjs.com/package/@marinade.finance/ds-sam-sdk">
  <img src="https://img.shields.io/npm/v/%40marinade.finance%2Fds-sam-sdk?logo=npm&color=377CC0" />
</a>

Validators bid PMPE (parts per mile per epoch) to receive Marinade
stake. Allocation proceeds lowest to highest PMPE until stake
depletes or constraints bind.

## Install

```bash
pnpm install
pnpm -r build
```

## Running Simulations

```bash
# baseline: fetch fresh API data
scripts/evaluate-auction.bash 20260225_experiment/main -b

# variants: reuse baseline inputs, different config
scripts/evaluate-auction.bash 20260225_experiment/maxcap8 \
  -c config-8pct.json

# results in report/<tag>/ with summary.md and results.json
scripts/evaluate-auction.bash -h
```

Other scripts:
- `evaluate-blacklist`: blacklist impact comparison
- `simulate-auction <epoch>`: historical revenue from GCP snapshots
- `evaluate-revenue-changes.bash`: revenue impact from production

## Configuration

Pass via `-c config.json`.
Defaults to `../ds-sam-pipeline/auction-config.json`.

Key parameters:

| Parameter | Description |
|-----------|-------------|
| `maxMarinadeTvlSharePerValidatorDec` | Per-validator stake cap |
| `maxUnprotectedStakePerValidatorDec` | Unprotected stake cap |
| `minBondBalanceSol` | Minimum bond balance |
| `minBondEpochs` / `idealBondEpochs` | Bond reserve epochs |
| `bondRiskFeeMult` | Bond risk fee multiplier |
| `bondObligationSafetyMult` | Bond obligation safety [1.0-2.0] |
| `maxNetworkStakeConcentrationPerCountryDec` | Country cap |
| `maxNetworkStakeConcentrationPerAsoDec` | ASO cap |
| `validatorsUptimeThresholdDec` | Minimum uptime |

All options: [config.ts](./packages/ds-sam-sdk/src/config.ts).
Production:
[auction-config.json](https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json).

## Publishing SDK

```bash
cd packages/ds-sam-sdk
npm publish
```

See ARCHITECTURE.md for algorithm details.
