#!/usr/bin/env bash
#
# evaluate-revenue-changes.bash
#
# Replays analyze-revenues for archived auctions and diffs each evaluation against the one
# production settled on (gs://marinade-validator-bonds-mainnet/<epoch>/bid-psr-distribution-evaluation.json).
#
# Usage:
#   ./scripts/evaluate-revenue-changes.bash -d ../ds-sam-pipeline/auctions -s 1040 -e 1046
#
# Options:
#   -d, --data-dir PATH      ds-sam-pipeline auctions directory (required)
#   -s, --epoch-start NUM    first epoch (default: the latest archived epoch)
#   -e, --epoch-end NUM      last epoch (default: --epoch-start)
#   -o, --output-dir PATH    output directory (default: /tmp/revenue-test-outputs)
#   --skip-build             do not install and build first
#   -h, --help               show this help
#
# Needs gcloud access to the bucket. Per epoch it writes evaluation.json, a per-validator
# evaluation.diff and an events.diff, where an event is what validator-bonds turns into a
# CommissionSamIncrease settlement: actualNonBidPmpe < expectedNonBidPmpe + beforeSamCommissionIncreasePmpe.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="gs://marinade-validator-bonds-mainnet"
DATA_DIR=""
EPOCH_START=""
EPOCH_END=""
OUT_DIR="/tmp/revenue-test-outputs"
SKIP_BUILD=false

usage() {
  sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--data-dir) DATA_DIR="$2"; shift 2 ;;
    -s|--epoch-start) EPOCH_START="$2"; shift 2 ;;
    -e|--epoch-end) EPOCH_END="$2"; shift 2 ;;
    -o|--output-dir) OUT_DIR="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$DATA_DIR" && -d "$DATA_DIR" ]] || { echo "Missing or invalid --data-dir" >&2; usage; exit 1; }
DATA_DIR="$(cd "$DATA_DIR" && pwd)"
if [[ -z "$EPOCH_START" ]]; then
  EPOCH_START=$(ls -1 "$DATA_DIR" | grep -E '^[0-9]+\.' | cut -d. -f1 | sort -n | tail -1)
fi
EPOCH_END="${EPOCH_END:-$EPOCH_START}"

cd "$PROJECT_ROOT"
if [[ "$SKIP_BUILD" != true ]]; then
  pnpm install --frozen-lockfile
  pnpm -r build
fi

# One line per validator with every field validator-bonds settles on.
per_validator() {
  jq -r '.revenueExpectations | sort_by(.voteAccount)[] |
    "\(.voteAccount) inflation expected=\(.expectedInflationCommission) actual=\(.actualInflationCommission) past=\(.pastInflationCommission)" +
    " mev expected=\(.expectedMevCommission) actual=\(.actualMevCommission) past=\(.pastMevCommission)" +
    " nonBidPmpe expected=\(.expectedNonBidPmpe) actual=\(.actualNonBidPmpe) beforeSam=\(.beforeSamCommissionIncreasePmpe)"' "$1"
}

events() {
  jq -r '.revenueExpectations[] |
    select(.actualNonBidPmpe < .expectedNonBidPmpe + .beforeSamCommissionIncreasePmpe) | .voteAccount' "$1" | sort
}

failed=0
for epoch in $(seq "$EPOCH_START" "$EPOCH_END"); do
  folder=$(ls -1 "$DATA_DIR" | grep -E "^${epoch}\." | sort -t. -k2,2n | tail -1 || true)
  if [[ -z "$folder" ]]; then
    echo "epoch $epoch: no archived auction, skipping" >&2
    continue
  fi
  out="$OUT_DIR/$epoch"
  mkdir -p "$out"
  gcloud storage cp -q "$BUCKET/$epoch/validators.json" "$out/validators.json"
  past_args=()
  if gcloud storage cp -q "$BUCKET/$epoch/past-validators.json" "$out/past-validators.json" 2>/dev/null; then
    past_args=(--snapshot-past-validators-file-path "$out/past-validators.json")
  fi
  gcloud storage cp -q "$BUCKET/$epoch/bid-psr-distribution-evaluation.json" "$out/production-evaluation.json"

  if ! pnpm run cli -- analyze-revenues \
      --cache-dir-path "$DATA_DIR/$folder/inputs" \
      --sam-results-fixture-file-path "$DATA_DIR/$folder/outputs/results.json" \
      --snapshot-validators-file-path "$out/validators.json" \
      "${past_args[@]}" \
      --results-file-path "$out/evaluation.json" > "$out/analyze-revenues.log" 2>&1; then
    echo "epoch $epoch ($folder): analyze-revenues failed, see $out/analyze-revenues.log" >&2
    failed=$((failed + 1))
    continue
  fi

  per_validator "$out/production-evaluation.json" > "$out/production.txt"
  per_validator "$out/evaluation.json" > "$out/replay.txt"
  diff -u "$out/production.txt" "$out/replay.txt" > "$out/evaluation.diff" || true
  events "$out/production-evaluation.json" > "$out/production-events.txt"
  events "$out/evaluation.json" > "$out/replay-events.txt"
  diff -u "$out/production-events.txt" "$out/replay-events.txt" > "$out/events.diff" || true

  changed=$(grep -c '^+[^+]' "$out/evaluation.diff" || true)
  added=$(grep '^+[^+]' "$out/events.diff" | cut -c2- | paste -sd' ' || true)
  removed=$(grep '^-[^-]' "$out/events.diff" | cut -c2- | paste -sd' ' || true)
  echo "epoch $epoch ($folder): ${changed} validators changed," \
    "events $(wc -l < "$out/production-events.txt") -> $(wc -l < "$out/replay-events.txt")" \
    "${added:+| added: $added}${removed:+ | removed: $removed}"
done

echo "Outputs in $OUT_DIR/<epoch>/ (evaluation.diff, events.diff)"
[[ "$failed" -eq 0 ]]
