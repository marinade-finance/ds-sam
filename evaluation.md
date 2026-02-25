# Analyze-Revenue Test: Data Requirements for GH Actions

## Context

The `analyze-revenue` command was fixed (commits `54e3e3e`, `bf1d6df`) to address a bug where
`getValidatorOverrides()` used raw on-chain commissions for snapshot overrides, while the SDK's
native computation applied `Math.min(bond, onchain)` (bond-capped commissions). This caused
validators with bond commission < on-chain commission to appear as if they had increased their
commission — a false positive. See `false-charges.md` for the financial impact analysis.

Goal: create a GH Actions workflow for analyze-revenue testing, similar to `test-auction.yml`.

## How the Auction Test Pattern Works

The auction test workflow (`test-auction.yml` + `run-auction-test.sh`) has a clean diff loop:

1. Pipeline repo (`marinade-finance/ds-sam-pipeline`) stores `inputs/` + `outputs/` per epoch
2. Run auction CLI against `inputs/` → produce new `outputs/`
3. Diff new outputs against stored `outputs/` (the "golden" expected results)

## What Analyze-Revenue Needs as Inputs

| Input                                                                              | Source                                                                  | Already in pipeline?                                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `--cache-dir-path` (config.json, validators.json, bonds.json, mev-info.json, etc.) | `{epoch}/inputs/`                                                       | Yes                                                                          |
| `--sam-results-fixture-file-path` (results.json)                                   | `{epoch}/outputs/results.json`                                          | Yes                                                                          |
| `--snapshot-validators-file-path`                                                  | Built on-the-fly from `inputs/validators.json` + `inputs/mev-info.json` | **Derivable** (`build_snapshot_validators` in `run-analyze-revenue-test.sh`) |
| `--snapshot-past-validators-file-path`                                             | Same, but for epoch N-1                                                 | **Derivable** (same function, previous epoch folder)                         |

**All inputs are already available** in the existing pipeline data. The `snapshot-validators.json`
is a deterministic transformation of existing input files — the script already generates it
on-the-fly. No new input data is needed.

## What's Missing: Expected Outputs to Diff Against

The auction test diffs against stored `outputs/results.json`. For analyze-revenue to follow the
same pattern, stored **`evaluation.json`** files per epoch are needed as the "golden" expected output.

Current pipeline repo structure:

```
auctions/{epoch}/
├── inputs/      ← has everything needed
└── outputs/     ← results.json, summary.md (auction outputs only)
```

## Options for Diffing

### Option A — Store evaluation outputs in the pipeline repo (recommended)

```
auctions/{epoch}/
├── inputs/
├── outputs/          ← existing auction outputs
└── evaluation/       ← NEW: store evaluation.json here
```

Generate once from a known-good run, commit to pipeline repo. The GH action then diffs new
output against this stored golden file. This mirrors exactly how the auction test works.

**Pros:** Simple, consistent with existing pattern, fast CI (single build).
**Cons:** Requires one-time generation and commit to pipeline repo.

### Option B — No stored golden files, just run-and-report

Run analyze-revenue, check that it succeeds, report results (commission diffs, false positives
count, etc.) as artifacts — but don't diff against stored expected values.

**Pros:** No pipeline repo changes needed.
**Cons:** Weaker regression detection — only catches crashes, not silent behavioral changes.

### Option C — Generate evaluation from `main` branch and diff against PR branch

Build the project at `main`, run analyze-revenue → store as "expected". Then build at PR HEAD,
run again → diff. No stored golden files needed in the pipeline repo.

**Pros:** Fully self-contained, no pipeline repo changes.
**Cons:** Two full builds per CI run (slower, more CI resources).

## Recommendation

**Option A** is the most straightforward and consistent with the existing auction test pattern.

Steps to implement:

1. Run `run-analyze-revenue-test.sh` once against all relevant epochs to generate `evaluation.json` files
2. Commit those files to `ds-sam-pipeline` under `auctions/{epoch}/evaluation/`
3. Create `run-analyze-revenue-diff-test.sh` — similar to `run-auction-test.sh` but:
   - Runs auction CLI (to get `results.json`)
   - Builds `snapshot-validators.json` from inputs (reuse `build_snapshot_validators`)
   - Runs `analyze-revenues` CLI
   - Diffs output `evaluation.json` against stored golden file
4. Create `.github/workflows/test-analyze-revenue.yml` — mirrors `test-auction.yml`
