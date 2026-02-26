#!/usr/bin/env bash
set -euo pipefail

_help() {
  cat <<'EOF'
usage: evaluate-auction <tag> [-c config] [-b|--baseline]

run auction simulations with tag-based organization

arguments:
  <tag>              path like "experiment/variant" (required)

options:
  -c, --config       config file path (default: ../ds-sam-pipeline/auction-config.json)
  -b, --baseline     baseline mode: fetch fresh inputs and save them
  -h, --help         show this help

modes:
  baseline (-b):     fetches fresh API data, saves to report/<tag>/inputs/
  comparison:        uses existing inputs from report/<parent>/main/inputs/

tags:
  structure is <group>/<variant>, where "main" is the baseline
  variants reuse inputs from report/<group>/main/inputs/,
  keeping API data stable across all runs in the group

examples:
  # create baseline with fresh data
  ./evaluate-auction 20260225_tvl_cap/main -b

  # run variants using baseline inputs
  ./evaluate-auction 20260225_tvl_cap/maxcap8 -c config-8pct.json
  ./evaluate-auction 20260225_tvl_cap/unpro06 -c config-unpro06.json

  # results in report/20260225_tvl_cap/{main,maxcap8,unpro06}/
EOF
}

config="../ds-sam-pipeline/auction-config.json"
baseline=false
tag=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) _help; exit 0 ;;
    -c|--config)
      config="$2"
      shift 2
      ;;
    -b|--baseline)
      baseline=true
      shift
      ;;
    -*)
      echo "unknown option: $1" >&2
      echo "usage: evaluate-auction <tag> [-c config] [-b|--baseline]" >&2
      exit 1
      ;;
    *)
      if [[ -z "$tag" ]]; then
        tag="$1"
      else
        echo "unexpected argument: $1" >&2
        echo "usage: evaluate-auction <tag> [-c config] [-b|--baseline]" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$tag" ]]; then
  echo "usage: evaluate-auction <tag> [-c config] [-b|--baseline]" >&2
  exit 1
fi

if [[ ! -f "$config" ]]; then
  echo "config file not found: $config" >&2
  exit 1
fi

output_dir="report/$tag"
parent="${tag%/*}"

if $baseline; then
  cache_dir="$output_dir/inputs"
  mkdir -p "$cache_dir"
  inputs_source="APIS"
  cache_flag="--cache-inputs"
else
  if [[ "$parent" == "$tag" ]]; then
    echo "tag must contain slash for comparison mode (e.g., parent/variant)" >&2
    exit 1
  fi
  cache_dir="report/$parent/main/inputs"
  inputs_source="FILES"
  cache_flag=""

  if [[ ! -d "$cache_dir" ]]; then
    echo "baseline inputs not found at $cache_dir. run with -b first." >&2
    exit 1
  fi
fi

mkdir -p "$output_dir"

((cd packages/ds-sam-sdk/; pnpm build); pnpm run cli -- auction \
  -c "$config" \
  -o "$output_dir" \
  -i "$inputs_source" \
  --cache-dir-path "$cache_dir" \
  ${cache_flag:+"$cache_flag"})

echo
echo "# $tag"
cat "$output_dir/summary.md"
