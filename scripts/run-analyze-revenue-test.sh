#!/usr/bin/env bash
#
# run-analyze-revenue-test.sh
#
# Two-step test: first runs ds-sam auction to generate fresh results from
# pipeline inputs, then runs analyze-revenues against those results to compare
# expected vs actual commissions and find false commission increase detections.
#
# Usage:
#   ./scripts/run-analyze-revenue-test.sh -d DATA_DIR [OPTIONS]
#
# Options:
#   -d, --data-dir PATH      Path to ds-sam-pipeline/auctions directory (required)
#   -o, --output-dir PATH    Path to output directory (default: /tmp/analyze-revenue-test)
#   -s, --epoch-start NUM    Start epoch number (optional)
#   -e, --epoch-end NUM      End epoch number (optional)
#   -l, --latest             Process only the latest epoch
#   --settlements-dir PATH   Path to regression-data directory with settlement data
#   --skip-build             Skip building the project
#   -v, --verbose            Enable verbose output
#   -h, --help               Show this help message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR=""
OUT_DIR="/tmp/analyze-revenue-test"
SETTLEMENTS_DIR=""
EPOCH_START=""
EPOCH_END=""
LATEST_ONLY=false
SKIP_BUILD=false
VERBOSE=false

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2; }
error() { echo "[ERROR] $*" >&2; }
die() { error "$@"; exit 1; }

usage() {
  cat << 'EOF'
Usage: run-analyze-revenue-test.sh -d DATA_DIR [OPTIONS]

Options:
  -d, --data-dir PATH      Path to ds-sam-pipeline/auctions directory (required)
  -o, --output-dir PATH    Path to output directory (default: /tmp/analyze-revenue-test)
  -s, --epoch-start NUM    Start epoch number
  -e, --epoch-end NUM      End epoch number
  -l, --latest             Process only the latest epoch
  --settlements-dir PATH   Path to regression-data directory with settlement data
  --skip-build             Skip building the project
  -v, --verbose            Enable verbose output
  -h, --help               Show this help message
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d|--data-dir) DATA_DIR="$2"; shift 2 ;;
      -o|--output-dir) OUT_DIR="$2"; shift 2 ;;
      -s|--epoch-start) EPOCH_START="$2"; shift 2 ;;
      -e|--epoch-end) EPOCH_END="$2"; shift 2 ;;
      -l|--latest) LATEST_ONLY=true; shift ;;
      --settlements-dir) SETTLEMENTS_DIR="$2"; shift 2 ;;
      --skip-build) SKIP_BUILD=true; shift ;;
      -v|--verbose) VERBOSE=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  done
}

get_epoch_folders() {
  ls -1 "$DATA_DIR" 2>/dev/null | grep -E '^[0-9]+\.' | sort -t. -k1,1n
}

get_epoch_num() {
  echo "$1" | cut -d. -f1
}

# Find the auction folder for a given epoch number
find_epoch_folder() {
  local epoch_num="$1"
  get_epoch_folders | grep -E "^${epoch_num}\." | tail -1
}

determine_epochs() {
  local folders=""

  if [[ -z "$EPOCH_START" && -z "$EPOCH_END" ]] || [[ "$LATEST_ONLY" == true ]]; then
    folders=$(get_epoch_folders | tail -1)
    log "Running on latest epoch: ${folders}"
  else
    for folder in $(get_epoch_folders); do
      local epoch_num
      epoch_num=$(get_epoch_num "$folder")
      [[ -n "$EPOCH_START" && "$epoch_num" -lt "$EPOCH_START" ]] && continue
      [[ -n "$EPOCH_END" && "$epoch_num" -gt "$EPOCH_END" ]] && continue
      folders="${folders:+$folders }$folder"
    done
    log "Running on epochs: ${folders}"
  fi

  echo "$folders"
}

build_project() {
  if [[ "$SKIP_BUILD" == true ]]; then
    log "Skipping build (--skip-build)"
    return 0
  fi
  log "Building project..."
  cd "$PROJECT_ROOT"
  pnpm install --frozen-lockfile
  pnpm -r build
}

# Construct SnapshotValidatorsCollection JSON from SDK inputs
build_snapshot_validators() {
  local inputs_dir="$1"
  local output_file="$2"
  local epoch_num="$3"

  python3 -c "
import json, sys

epoch = int(sys.argv[1])
inputs_dir = sys.argv[2]
output_file = sys.argv[3]

with open(f'{inputs_dir}/validators.json') as f:
    sdk_data = json.load(f)

mev_map = {}
try:
    with open(f'{inputs_dir}/mev-info.json') as f:
        mev_data = json.load(f)
    for v in mev_data.get('validators', []):
        mev_map[v['vote_account']] = v.get('mev_commission_bps')
except FileNotFoundError:
    pass

validator_metas = []
for v in sdk_data['validators']:
    commission = v.get('commission_effective')
    if commission is None:
        commission = v.get('commission_advertised')
    if commission is None:
        commission = 100

    mev_commission = mev_map.get(v['vote_account'])

    validator_metas.append({
        'vote_account': v['vote_account'],
        'commission': commission,
        'mev_commission': mev_commission,
        'stake': int(v.get('activated_stake', '0')),
        'credits': v.get('credits', 0),
    })

result = {
    'epoch': epoch,
    'slot': 0,
    'capitalization': 0,
    'epoch_duration_in_years': 0,
    'validator_rate': 0,
    'validator_rewards': 0,
    'validator_metas': validator_metas,
}

with open(output_file, 'w') as f:
    json.dump(result, f)
" "$epoch_num" "$inputs_dir" "$output_file"
}

run_auction() {
  local folders="$1"
  local failed=0
  local processed=0

  mkdir -p "$OUT_DIR"

  for folder in $folders; do
    local epoch_num
    epoch_num=$(get_epoch_num "$folder")
    local inputs_dir="${DATA_DIR}/${folder}/inputs"
    local auction_output_dir="${OUT_DIR}/${folder}/auction"
    local log_file="${OUT_DIR}/${folder}/auction.log"

    log "Running auction for epoch ${epoch_num} (${folder})..."

    if [[ ! -d "$inputs_dir" ]]; then
      log "  Inputs dir not found, skipping"
      continue
    fi

    mkdir -p "$auction_output_dir"

    if pnpm run cli -- auction \
      --inputs-source FILES \
      --cache-dir-path "$inputs_dir" \
      -c "${inputs_dir}/config.json" \
      -o "$auction_output_dir" > "$log_file" 2>&1; then
      log "  Auction OK: ${folder}"
      processed=$((processed + 1))
    else
      log "  Auction FAILED: ${folder} (see $log_file)"
      failed=$((failed + 1))
      if [[ "$VERBOSE" == true ]]; then
        tail -20 "$log_file"
      fi
    fi
  done

  log "Auction summary: Processed=$processed, Failed=$failed"
}

run_analyze_revenues() {
  local folders="$1"
  local failed=0
  local processed=0

  for folder in $folders; do
    local epoch_num
    epoch_num=$(get_epoch_num "$folder")
    local inputs_dir="${DATA_DIR}/${folder}/inputs"
    local results_file="${OUT_DIR}/${folder}/auction/results.json"
    local output_file="${OUT_DIR}/${folder}/evaluation.json"
    local snapshot_file="${OUT_DIR}/${folder}/snapshot-validators.json"
    local log_file="${OUT_DIR}/${folder}/analyze.log"

    log "Analyzing epoch ${epoch_num} (${folder})..."

    if [[ ! -d "$inputs_dir" ]]; then
      log "  Inputs dir not found, skipping"
      continue
    fi
    if [[ ! -f "$results_file" ]]; then
      log "  Auction results not found (${results_file}), skipping"
      continue
    fi

    mkdir -p "${OUT_DIR}/${folder}"

    # Build snapshot validators from SDK data
    build_snapshot_validators "$inputs_dir" "$snapshot_file" "$epoch_num"

    # Find past-validators (from prior epoch)
    local past_epoch_num=$((epoch_num - 1))
    local past_folder
    past_folder=$(find_epoch_folder "$past_epoch_num")
    local past_validators_arg=""
    if [[ -n "$past_folder" ]]; then
      local past_snapshot="${OUT_DIR}/${past_folder}/snapshot-validators.json"
      local past_inputs="${DATA_DIR}/${past_folder}/inputs"
      if [[ ! -f "$past_snapshot" && -d "$past_inputs" ]]; then
        mkdir -p "${OUT_DIR}/${past_folder}"
        build_snapshot_validators "$past_inputs" "$past_snapshot" "$past_epoch_num"
      fi
      if [[ -f "$past_snapshot" ]]; then
        past_validators_arg="--snapshot-past-validators-file-path ${past_snapshot}"
      fi
    fi

    if pnpm run cli -- analyze-revenues \
      $past_validators_arg \
      --cache-dir-path "$inputs_dir" \
      --sam-results-fixture-file-path "$results_file" \
      --snapshot-validators-file-path "$snapshot_file" \
      --results-file-path "$output_file" > "$log_file" 2>&1; then
      log "  Analyze OK: ${folder}"
      processed=$((processed + 1))
    else
      log "  Analyze FAILED: ${folder} (see $log_file)"
      failed=$((failed + 1))
      if [[ "$VERBOSE" == true ]]; then
        tail -20 "$log_file"
      fi
    fi
  done

  log "Analyze summary: Processed=$processed, Failed=$failed"
}

# Analyze evaluation results to find wrongly processed validators
analyze_results() {
  log "Analyzing results for false commission increase detections..."

  if [[ -z "$SETTLEMENTS_DIR" ]]; then
    log "No --settlements-dir provided, skipping false-charges analysis"
    return 0
  fi
  if [[ ! -d "$SETTLEMENTS_DIR" ]]; then
    die "Settlements directory not found: $SETTLEMENTS_DIR"
  fi

  python3 -c "
import json, os, sys, glob

out_dir = sys.argv[1]
settlements_dir = sys.argv[2]

# Collect clean validators (lossPerStake == 0) per epoch from new code evaluation
# These are validators the fixed code says had no commission issue
clean_validators = {}  # epoch -> set of vote accounts
for eval_file in sorted(glob.glob(f'{out_dir}/*/evaluation.json')):
    with open(eval_file) as f:
        data = json.load(f)
    epoch = data.get('epoch')
    if epoch is None:
        continue
    clean = set()
    for re in data.get('revenueExpectations', []):
        if re.get('lossPerStake', -1) == 0:
            clean.add(re['voteAccount'])
    clean_validators[epoch] = clean

# Cross-reference with settlement data
false_charges = []  # list of {epoch, vote_account, claims_amount, settlement_details}
for epoch, clean_set in sorted(clean_validators.items()):
    # Try both file naming conventions (bid-psr-distribution before epoch 930, bid-distribution from 930+)
    settlement_file = f'{settlements_dir}/{epoch}/expected/bid-psr-distribution-settlements.json'
    if not os.path.isfile(settlement_file):
        settlement_file = f'{settlements_dir}/{epoch}/expected/bid-distribution-settlements.json'
    if not os.path.isfile(settlement_file):
        print(f'Skipping epoch {epoch}: no settlement file', file=sys.stderr)
        continue

    with open(settlement_file) as f:
        sdata = json.load(f)

    for s in sdata.get('settlements', []):
        reason = s.get('reason', {})
        # Handle both formats: dict with ProtectedEvent key, or plain string (e.g. 'Bidding')
        if isinstance(reason, str):
            continue
        pe = reason.get('ProtectedEvent', {})
        if 'CommissionSamIncrease' not in pe:
            continue
        va = s['vote_account']
        if va not in clean_set:
            continue
        csi = pe['CommissionSamIncrease']
        false_charges.append({
            'epoch': epoch,
            'vote_account': va,
            'claims_amount': s['claims_amount'],
            'claims_count': s['claims_count'],
            'expected_epr': csi.get('expected_epr'),
            'actual_epr': csi.get('actual_epr'),
            'epr_loss_bps': csi.get('epr_loss_bps'),
            'stake': csi.get('stake'),
            'expected_inflation_commission': csi.get('expected_inflation_commission'),
            'actual_inflation_commission': csi.get('actual_inflation_commission'),
        })

if not false_charges:
    print('No false CommissionSamIncrease charges found.')
    sys.exit(0)

# Group by validator
by_validator = {}
for fc in false_charges:
    by_validator.setdefault(fc['vote_account'], []).append(fc)

# Generate markdown report
lines = []
lines.append('# False CommissionSamIncrease Charges')
lines.append('')
lines.append('Validators where the fixed code shows lossPerStake=0 (no commission issue),')
lines.append('but settlements were created charging validator bonds.')
lines.append('')

grand_total_lamports = 0

for va, entries in sorted(by_validator.items(), key=lambda x: -sum(e['claims_amount'] for e in x[1])):
    subtotal = sum(e['claims_amount'] for e in entries)
    grand_total_lamports += subtotal
    sample = entries[0]

    lines.append(f'## {va}')
    lines.append('')
    lines.append(f'Bond commission: {sample[\"expected_inflation_commission\"]}, on-chain commission: {sample[\"actual_inflation_commission\"]}')
    lines.append('')
    lines.append('| Epoch | Claims Amount (SOL) | EPR Loss (bps) | Stake (SOL) | Expected EPR | Actual EPR |')
    lines.append('|-------|--------------------:|---------------:|------------:|-------------:|-----------:|')

    for e in sorted(entries, key=lambda x: x['epoch']):
        sol = e['claims_amount'] / 1e9
        stake_sol = e['stake'] / 1e9 if e['stake'] else 0
        exp_epr = f'{e[\"expected_epr\"]:.12f}' if e['expected_epr'] is not None else 'N/A'
        act_epr = f'{e[\"actual_epr\"]:.12f}' if e['actual_epr'] is not None else 'N/A'
        lines.append(f'| {e[\"epoch\"]} | {sol:.4f} | {e[\"epr_loss_bps\"]} | {stake_sol:,.2f} | {exp_epr} | {act_epr} |')

    lines.append('')
    lines.append(f'**Subtotal: {subtotal / 1e9:.4f} SOL** ({len(entries)} epochs)')
    lines.append('')

lines.append('---')
lines.append('')
lines.append(f'**Grand total falsely charged: {grand_total_lamports / 1e9:.4f} SOL**')
lines.append(f'Affected validators: {len(by_validator)}, across {len(set(fc[\"epoch\"] for fc in false_charges))} epochs')

report = '\n'.join(lines)
report_file = f'{out_dir}/false-charges.md'
with open(report_file, 'w') as f:
    f.write(report + '\n')

print(report)
print()
print(f'Report saved to: {report_file}')
" "$OUT_DIR" "$SETTLEMENTS_DIR"
}

main() {
  parse_args "$@"

  if [[ -z "$DATA_DIR" ]]; then
    error "Missing required argument: -d, --data-dir"
    usage
    exit 1
  fi

  [[ ! -d "$DATA_DIR" ]] && die "Data directory not found: $DATA_DIR"

  log "Analyze Revenue Test Runner"
  log "  Data dir:        $DATA_DIR"
  log "  Output dir:      $OUT_DIR"
  log "  Settlements dir: ${SETTLEMENTS_DIR:-<not set>}"

  local folders
  folders=$(determine_epochs)
  [[ -z "$folders" ]] && die "No epoch folders found to process"

  build_project
  run_auction "$folders"
  run_analyze_revenues "$folders"
  analyze_results

  log "Done! Results in: $OUT_DIR"
}

main "$@"
