# @marinade.finance/ds-sam-psr

Pure, IO-free estimator for Marinade PSR (protected staking rewards) settlements. It predicts what the bonds pipeline
will settle for epochs it has not processed yet, so dashboards can show unsettled payments before they land.

- **No IO, no UI** — inputs and outputs are plain typed data. Fetching, schemas and labels stay in the consumers.
- Depends on `@marinade.finance/ds-sam-calc` (`finite`, `LAMPORTS_PER_SOL`, auction types) and
  `@marinade.finance/ts-common` (`lamportsToSol`).

## What it computes

- **PSR estimates** — `calculateProtectedEventEstimates` builds `LowCredits` and `CommissionIncrease` events from the
  settlement configs (covered bps ranges, grace, minimum settlement lamports), a stake-weighted target of vote credits
  per epoch and per-epoch EPR calculators.
- **Unsettled selection** — `selectLatestProcessedEpoch`, `selectUnsettledEstimates` and `selectCurrentEpochEstimates`
  drop estimates for epochs the bonds API already settled.
- **Auction penalty estimates** — `estimateAuctionPenalties` turns bid-too-low, blacklist and bond-risk-fee values from
  scoring rows (past epochs) and the current auction (live epoch) into settlement-shaped events.
- **Rows** — `buildProtectedEventRows` merges settlements (`fact` / `dryrun`) and estimates into one list joined to
  each validator.

## Inputs

- `ValidatorWithEpochs[]` — validators API `/validators?epochs=N` rows; stakes are lamport strings.
- `EpochRewards[]` — `rewards_inflation_est` from the validators API `/rewards`.
- `ProtectedEvent[]` — bonds API `/v1/protected-events` rows.
- `ScoringEntry[]` — scoring API `/api/v1/scores/sam` rows; `AuctionPenaltyInput[]` — `AuctionValidator`s of the
  current auction.

## Outputs

`ProtectedEvent` (amount in lamports) and `ProtectedEventRow` (`status`, `protectedEvent`, `validator`).

## Usage

```ts
import { buildProtectedEventRows, calculateProtectedEventEstimates } from '@marinade.finance/ds-sam-psr'

const estimates = calculateProtectedEventEstimates(validators, rewards.rewards_inflation_est)
const rows = buildProtectedEventRows({
  validators,
  settlements: protectedEvents,
  estimates,
  scoring,
  auctionValidators: auctionResult.auctionData.validators,
})
```
