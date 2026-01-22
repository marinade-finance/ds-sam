#!/usr/bin/env bash
#
# run-auction-test.sh
#
# Runs auction CLI against pipeline data and diffs results against original outputs.
# Can be called manually or from GitHub Actions.
#
# Usage:
#   ./scripts/run-auction-test.sh -d DATA_DIR [OPTIONS]
#
# Options:
#   -d, --data-dir PATH      Path to auction data directory (required), possibly checked out from https://github.com/marinade-finance/ds-sam-pipeline
#   -o, --output-dir PATH    Path to output directory (default: /tmp/auction-test-outputs/outputs)
#   -s, --epoch-start NUM    Start epoch number (optional)
#   -e, --epoch-end NUM      End epoch number (optional)
#   -l, --latest             Process only the latest epoch (default if no epoch specified)
#   --skip-diff              Skip diffing against original outputs
#   --skip-build             Skip building the project (useful for repeated runs)
#   -v, --verbose            Enable verbose output
#   -h, --help               Show this help message
#
# Examples:
#   # Run on latest epoch
#   ./scripts/run-auction-test.sh -d data-repo/auctions
#
#   # Run on specific epoch range
#   ./scripts/run-auction-test.sh -d data-repo/auctions --epoch-start 100 --epoch-end 105
#
#   # Run with custom data directory
#   ./scripts/run-auction-test.sh -d /path/to/auctions -o /path/to/outputs
#

set -euo pipefail

# =============================================================================
# Configuration defaults
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR=""
OUT_DIR="/tmp/auction-test-outputs"
OUTPUT_BASE_DIR="outputs"
DIFFS_BASE_DIR="diffs"
OUTPUT_DIR="${OUT_DIR}/${OUTPUT_BASE_DIR}"
DIFFS_DIR="${OUT_DIR}/${DIFFS_BASE_DIR}"
EPOCH_START=""
EPOCH_END=""
LATEST_ONLY=false
SKIP_DIFF=false
SKIP_BUILD=false
VERBOSE=false

# =============================================================================
# Helper functions
# =============================================================================
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

log_verbose() {
  if [[ "$VERBOSE" == true ]]; then
    log "$@"
  fi
}

error() {
  echo "[ERROR] $*" >&2
}

die() {
  error "$@"
  exit 1
}

print_separator() {
  echo "==============================================" >&2
}

usage() {
  cat << EOF
Usage: $(basename "$0") -d DATA_DIR [OPTIONS]

Runs auction CLI against pipeline data and diffs results against original outputs.

Options:
  -d, --data-dir PATH      Path to auction data directory (required), possibly checked out
                           from https://github.com/marinade-finance/ds-sam-pipeline
  -o, --output-dir PATH    Path to output directory (default: /tmp/auction-test-outputs/outputs)
  -s, --epoch-start NUM    Start epoch number (optional)
  -e, --epoch-end NUM      End epoch number (optional)
  -l, --latest             Process only the latest epoch (default if no epoch specified)
  --skip-diff              Skip diffing against original outputs
  --skip-build             Skip building the project (useful for repeated runs)
  -v, --verbose            Enable verbose output
  -h, --help               Show this help message

Examples:
  # Run on latest epoch
  $(basename "$0") -d data-repo/auctions

  # Run on specific epoch range
  $(basename "$0") -d data-repo/auctions --epoch-start 100 --epoch-end 105

  # Run with custom output directory
  $(basename "$0") -d /path/to/auctions -o /path/to/outputs

  # Quick re-run without rebuilding
  $(basename "$0") -d data-repo/auctions --skip-build --latest
EOF
}

# =============================================================================
# Argument parsing
# =============================================================================
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d|--data-dir)
        DATA_DIR="$2"
        shift 2
        ;;
      -o|--output-dir)
        OUT_DIR="$2"
        shift 2
        ;;
      -s|--epoch-start)
        EPOCH_START="$2"
        shift 2
        ;;
      -e|--epoch-end)
        EPOCH_END="$2"
        shift 2
        ;;
      -l|--latest)
        LATEST_ONLY=true
        shift
        ;;
      --skip-diff)
        SKIP_DIFF=true
        shift
        ;;
      --skip-build)
        SKIP_BUILD=true
        shift
        ;;
      -v|--verbose)
        VERBOSE=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1. Use --help for usage."
        ;;
    esac
  done
  # Set derived paths after parsing
  OUTPUT_DIR="${OUT_DIR}/${OUTPUT_BASE_DIR}"
  DIFFS_DIR="${OUT_DIR}/${DIFFS_BASE_DIR}"
}

# =============================================================================
# Core functions
# =============================================================================

get_epoch_folders() {
  ls -1 "$DATA_DIR" 2>/dev/null | grep -E '^[0-9]+\.' | sort -t. -k1,1n
}

get_epoch_num() {
  echo "$1" | cut -d. -f1
}

determine_epochs() {
  local folders=""

  if [[ -z "$EPOCH_START" && -z "$EPOCH_END" ]] || [[ "$LATEST_ONLY" == true ]]; then
    folders=$(get_epoch_folders | tail -1)
    log "📌 Running on latest epoch: ${folders}"
  else
    for folder in $(get_epoch_folders); do
      local epoch_num
      epoch_num=$(get_epoch_num "$folder")

      if [[ -n "$EPOCH_START" && "$epoch_num" -lt "$EPOCH_START" ]]; then
        continue
      fi
      if [[ -n "$EPOCH_END" && "$epoch_num" -gt "$EPOCH_END" ]]; then
        continue
      fi

      if [[ -z "$folders" ]]; then
        folders="$folder"
      else
        folders="${folders} ${folder}"
      fi
    done
    log "📌 Running on epochs: ${folders}"
  fi

  echo "$folders"
}

build_project() {
  if [[ "$SKIP_BUILD" == true ]]; then
    log "⏭️  Skipping build (--skip-build)"
    return 0
  fi

  log "🏋️ Installing dependencies..."
  cd "$PROJECT_ROOT"
  pnpm install --frozen-lockfile

  log "🏗️  Building project..."
  pnpm -r build
}

run_auction_cli() {
  local folders="$1"
  local outputs_base="${OUTPUT_DIR}/out"
  local failed=0
  local processed=0
  local processed_folders=""

  mkdir -p "$outputs_base"

  for folder in $folders; do
    local inputs_dir="${DATA_DIR}/${folder}/inputs"
    local outputs_dir="${outputs_base}/${folder}"
    local log_file="${OUTPUT_DIR}/${folder}.log"

    print_separator
    log "📂 Processing: $folder"
    log "   Inputs:  $inputs_dir"
    log "   Outputs: $outputs_dir"
    print_separator

    if [[ ! -d "$inputs_dir" ]]; then
      log "⚠️  Inputs directory not found, skipping"
      continue
    fi

    mkdir -p "$outputs_dir"

    if pnpm run cli -- auction \
      --inputs-source FILES \
      --cache-dir-path "$inputs_dir" \
      -c "${inputs_dir}/config.json" \
      -o "$outputs_dir" > "$log_file" 2>&1; then
      log "✅ Success: $folder"
      processed=$((processed + 1))
      if [[ -z "$processed_folders" ]]; then
        processed_folders="$folder"
      else
        processed_folders="${processed_folders} ${folder}"
      fi
    else
      log "❌ Failed: $folder (see $log_file for details)"
      failed=$((failed + 1))
      if [[ "$VERBOSE" == true ]]; then
        tail -20 "$log_file"
      fi
    fi
  done

  print_separator
  log "📊 Summary: Processed=$processed, Failed=$failed"
  print_separator

  # Return values via global variables (bash limitation)
  RESULT_PROCESSED=$processed
  RESULT_FAILED=$failed
  RESULT_PROCESSED_FOLDERS="$processed_folders"
}

extract_stakes() {
  local input="$1"
  local output="$2"
  jq -r '[.auctionData.validators[] | select(.auctionStake.marinadeSamTargetSol > 0)] |
    sort_by(.voteAccount) | .[] |
    "\(.voteAccount): \(.auctionStake.marinadeSamTargetSol)"' "$input" > "$output"
}

extract_bid_too_low() {
  local input="$1"
  local output="$2"
  jq -r '.auctionData.validators[] |
    select(.revShare.bidTooLowPenaltyPmpe > 0) |
    "\(.voteAccount): \(.revShare.bidTooLowPenaltyPmpe)"' "$input" | sort > "$output"
}

run_diffs() {
  local processed_folders="$1"
  local outputs_base="${OUTPUT_DIR}/out"

  mkdir -p "$DIFFS_DIR"

  for folder in $processed_folders; do
    echo "" >&2  # Blank line before epoch
    print_separator
    log "🔬 Diffing: $folder"
    print_separator

    local new_dir="${outputs_base}/${folder}"
    local orig_dir="${DATA_DIR}/${folder}/outputs"
    local diff_out="${DIFFS_DIR}/${folder}"
    mkdir -p "$diff_out"

    # Initialize diff report
    local report="${diff_out}/diff-report.md"
    {
      echo "# Diff Report for Epoch ${folder}"
      echo ""
      echo "Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
      echo ""
    } > "$report"

    # --- summary.md diff ---
    echo "## summary.md" >> "$report"
    if [[ -f "$new_dir/summary.md" && -f "$orig_dir/summary.md" ]]; then
      if diff -u "$orig_dir/summary.md" "$new_dir/summary.md" > "$diff_out/summary.diff" 2>&1; then
        log "✅ summary.md: identical"
        echo "✅ No differences" >> "$report"
      else
        log "❌ summary.md: differences found (diff $orig_dir/summary.md $new_dir/summary.md)"
        {
          echo '```diff'
          head -100 "$diff_out/summary.diff"
          echo '```'
        } >> "$report"
      fi
    else
      log "❌ summary.md: missing file(s)"
      echo "❌ Missing file(s)" >> "$report"
    fi
    echo "" >> "$report"

    # --- results.json diff ---
    echo "## results.json" >> "$report"
    if [[ -f "$new_dir/results.json" && -f "$orig_dir/results.json" ]]; then
      if diff -u "$orig_dir/results.json" "$new_dir/results.json" > "$diff_out/results.diff" 2>&1; then
        log "✅ results.json: identical"
        echo "✅ No differences" >> "$report"
      else
        local diff_lines
        diff_lines=$(wc -l < "$diff_out/results.diff")
        log "⚠️  results.json: ${diff_lines} diff lines (diff $orig_dir/results.json $new_dir/results.json)"
        echo "⚠️ ${diff_lines} diff lines (see results.diff)" >> "$report"
      fi
    else
      log "⚠️  results.json: missing file(s)"
      echo "⚠️ Missing file(s)" >> "$report"
    fi
    echo "" >> "$report"

    # --- Stake comparison ---
    echo "## Stake Allocation" >> "$report"
    if [[ -f "$new_dir/results.json" && -f "$orig_dir/results.json" ]]; then
      extract_stakes "$new_dir/results.json" "$diff_out/new-stakes.txt"
      extract_stakes "$orig_dir/results.json" "$diff_out/orig-stakes.txt"

      local new_total orig_total
      new_total=$(cut -d':' -f2 "$diff_out/new-stakes.txt" | paste -sd+ | bc 2>/dev/null || echo "0")
      orig_total=$(cut -d':' -f2 "$diff_out/orig-stakes.txt" | paste -sd+ | bc 2>/dev/null || echo "0")

      {
        echo "| Source | Total Stake |"
        echo "|--------|-------------|"
        echo "| Original | ${orig_total} |"
        echo "| New | ${new_total} |"
        echo ""
      } >> "$report"

      log "   Original total stake: $orig_total"
      log "   New total stake:      $new_total"

      if diff -u "$diff_out/orig-stakes.txt" "$diff_out/new-stakes.txt" > "$diff_out/stakes.diff" 2>&1; then
        log "✅ Stakes: identical"
        echo "✅ Stake allocations identical" >> "$report"
      else
        local stake_changes
        stake_changes=$(grep -c '^[-+]' "$diff_out/stakes.diff" || echo "0")
        log "⚠️  Stakes: ${stake_changes} changes (diff $diff_out/orig-stakes.txt $diff_out/new-stakes.txt)"
        echo "⚠️ ${stake_changes} stake changes (see stakes.diff)" >> "$report"
      fi
    fi
    echo "" >> "$report"

    # --- bidTooLow penalties ---
    echo "## Bid Too Low Penalties" >> "$report"
    if [[ -f "$new_dir/results.json" && -f "$orig_dir/results.json" ]]; then
      extract_bid_too_low "$new_dir/results.json" "$diff_out/new-bidTooLow.txt"
      extract_bid_too_low "$orig_dir/results.json" "$diff_out/orig-bidTooLow.txt"

      if diff -u "$diff_out/orig-bidTooLow.txt" "$diff_out/new-bidTooLow.txt" > "$diff_out/bidTooLow.diff" 2>&1; then
        log "✅ bidTooLow: identical"
        echo "✅ No differences" >> "$report"
      else
        log "⚠️  bidTooLow: differences found (diff $diff_out/orig-bidTooLow.txt $diff_out/new-bidTooLow.txt)"
        {
          echo '```diff'
          cat "$diff_out/bidTooLow.diff"
          echo '```'
        } >> "$report"
      fi
    fi

    log "📄 Report saved: $report"
    echo ""  # Add blank line between epochs
  done

  print_separator
  log "✅ All diffs completed"
  print_separator
}

# =============================================================================
# Main
# =============================================================================
main() {
  parse_args "$@"

  # Validate required arguments
  if [[ -z "$DATA_DIR" ]]; then
    error "Missing required argument: -d, --data-dir"
    echo ""
    usage
    exit 1
  fi

  log "🚀 Auction Test Runner"
  log "   Data dir:   $DATA_DIR"
  log "   Output dir: $OUTPUT_DIR"
  log "   Diffs dir:  $DIFFS_DIR"

  # Validate data directory exists
  if [[ ! -d "$DATA_DIR" ]]; then
    die "Data directory not found: $DATA_DIR"
  fi

  # Determine which epochs to process
  local folders
  folders=$(determine_epochs)

  if [[ -z "$folders" ]]; then
    die "No epoch folders found to process"
  fi

  # Build project
  build_project

  # Create output directory
  mkdir -p "$OUTPUT_DIR"

  # Run auction CLI
  run_auction_cli "$folders"

  # Run diffs if we processed any epochs and not skipped
  if [[ "$SKIP_DIFF" != true && "$RESULT_PROCESSED" -gt 0 ]]; then
    run_diffs "$RESULT_PROCESSED_FOLDERS"
  fi

  # Final summary
  print_separator
  log "🏁 Finished!"
  log "   Results: ${OUTPUT_DIR}/out/"
  log "   Logs:    ${OUTPUT_DIR}/*.log"
  if [[ "$SKIP_DIFF" != true ]]; then
    log "   Diffs:   ${DIFFS_DIR}/"
  fi
  print_separator

  # Exit with error if any failed
  if [[ "$RESULT_FAILED" -gt 0 ]]; then
    exit 1
  fi
}

main "$@"