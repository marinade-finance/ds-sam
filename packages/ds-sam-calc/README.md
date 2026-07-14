# @marinade.finance/ds-sam-calc

Pure, IO-free calculation, decision and type library shared across the Marinade
directed-stake tooling. It is the single source of truth for the auction data
model and the per-validator math behind the PSR dashboard and the validator
bonds CLI.

- **No IO, no UI, no SDK dependency** — depends only on `decimal.js`.
- Consumed by `@marinade.finance/ds-sam-sdk` (auction engine + data providers),
  the PSR dashboard, and the validator-bonds CLI.

## What lives here

- **Types** — `AuctionValidator`, `AuctionResult`, `RevShare`, `DsSamConfig`,
  `AuctionConstraintType`, …
- **Pure formulas** — revenue share, bid-too-low penalty, bond risk fee,
  effective participating bid.
- **Decisions / CTA** — `getValidatorTip`, `computeBondCoverage`,
  `bondHealthFromAuction`, `computeBidPenalty`, expected-stake-change /
  redelegation projection.
- **Primitives** — `pmpeToSol`, SOL formatters, APY compounding.

The auction orchestration (`DsSamSDK.run()`, constraints engine, data fetching)
stays in `@marinade.finance/ds-sam-sdk`; UI styling stays in the consumers.
