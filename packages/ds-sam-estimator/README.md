# @marinade.finance/ds-sam-estimator

Pure, IO-free estimator for Marinade PSR (protected staking rewards) settlements. It predicts what the bonds pipeline
will settle for epochs it has not processed yet, so dashboards can show unsettled payments before they land.

- **No IO, no UI** — inputs and outputs are plain typed data. Fetching, schemas and labels stay in the consumers.
- Depends on `@marinade.finance/ds-sam-calc` (`evaluateRevenueExpectations`, `LAMPORTS_PER_SOL`, auction types),
  `@marinade.finance/ts-common` (`alpenglowExpectedCredits`) and `decimal.js`.

## What it computes

- **PSR estimates** — `calculateProtectedEventEstimates` ports validator-bonds `protected_events.rs` and
  `psr_events.rs`: `CommissionSamIncrease` and `DowntimeRevenueImpact` events, the grace matcher, the covered bps
  range with the commission markup, and the minimum settlement. It uses one claim over the Marinade stake instead of
  per-staker groups, so an amount can exceed the settled one by at most a lamport per group. The revenue expectations
  come from calc `evaluateRevenueExpectations`, the same code `analyze-revenues` writes validator-bonds' input with.
- **Scoring-row adapters** — `samRunFromScores` and `pastCommissionsFromScores` turn public `scores/sam` rows into the
  SAM-run and past-commission inputs.
- **Unsettled selection** — `selectLatestProcessedEpoch`, `selectUnsettledEstimates` and `selectCurrentEpochEstimates`
  drop estimates for epochs the bonds API already settled.
- **Auction penalty estimates** — `estimateAuctionPenalties` turns bid-too-low, blacklist and bond-risk-fee values from
  scoring rows (past epochs) and the current auction (live epoch) into settlement-shaped events.
- **Rows** — `buildProtectedEventRows` merges settlements (`fact` / `dryrun`) and estimates into one list joined to
  each validator.

## Inputs

- `ValidatorWithEpochs[]` — validators API `/validators?epochs=N` rows; stakes are lamport strings.
- `PsrValidatorMeta[]` — the live epoch's `epoch_stats` (`commission_advertised`, `activated_stake`, `credits`,
  `vote_reward_lamports`, `leader_slots`) of every vote account. The epoch type follows calc `uptimeTypeOf`. In Tower
  `expected_credits` is the stake-weighted mean of credits, so partial mid-epoch credits compare fairly. In Alpenglow
  the vote reward is compared with ts-common `alpenglowExpectedCredits` over validators with a vote reward; a null
  vote reward is unknown and gets no downtime estimate. The migration epoch gets none.
- `samRun` — `samRunFromScores(rows, epoch)` over scoring API `/api/v1/scores/sam` rows.
- `pastCommissions` — `pastCommissionsFromScores(rows, epoch - 1)` over the same rows.
- `currentValidators`, `rewards` — `auctionData.validators` and `auctionData.rewards` of a live `DsSamSDK` run.
- `marinadeStakeLamports` — Marinade liquid + native stake per vote account.
- `ProtectedEvent[]` — bonds API `/v1/protected-events` rows.
- `ScoringEntry[]` — scoring API `/api/v1/scores/sam` rows; `AuctionPenaltyInput[]` — `AuctionValidator`s of the
  current auction.
- `SettlementConfig[]` — the `DowntimeRevenueImpactSettlement` and `CommissionSamIncreaseSettlement` entries of
  validator-bonds `settlement-config.yaml`, as-is; no defaults in the lib.
- `lastDryrunEpoch` — required on `buildProtectedEventRows`; settlements at or below it are `dryrun`, above it `fact`.

PSR amounts are estimates for the live epoch: validator-bonds compares the SAM run with the end-of-epoch snapshot,
this package with the state at the time of the call.

## Outputs

`ProtectedEvent` (amount in lamports) and `ProtectedEventRow` (`status`, `protectedEvent`, `validator`).
`SettlementReason` is open: `ProtectedEventSettlement | KnownSettlementReason | (string & {})`, so an unrecognised
reason string still passes through rather than being rejected.

## Not included

`selectSamBiddingSettlements` — a SAM-only filter on fetched settlement rows — is a consumer concern, not part of
this package.

## Usage

```ts
import {
  buildProtectedEventRows,
  calculateProtectedEventEstimates,
  pastCommissionsFromScores,
  samRunFromScores,
} from '@marinade.finance/ds-sam-estimator'

const estimates = calculateProtectedEventEstimates({
  epoch,
  validatorMetas,
  samRun: samRunFromScores(scoring, epoch),
  currentValidators: auctionResult.auctionData.validators,
  pastCommissions: pastCommissionsFromScores(scoring, epoch - 1),
  rewards: auctionResult.auctionData.rewards,
  marinadeStakeLamports,
  settlementConfigs,
})
const rows = buildProtectedEventRows({
  validators,
  settlements: protectedEvents,
  estimates,
  scoring,
  auctionValidators: auctionResult.auctionData.validators,
  lastDryrunEpoch,
})
```
