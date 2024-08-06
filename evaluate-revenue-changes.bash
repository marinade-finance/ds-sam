#!/bin/bash

SAM_EPOCH=652

# GCP_PATH="gs://marinade-validator-bonds-mainnet/$SAM_EPOCH/validators.json"
# SNAPSHOT_VALIDATORS="${SAM_EPOCH}_validators.json"

# TMP SETUP TO HELP SHOWCASE INTEGRATION
GCP_PATH="gs://marinade-validator-bonds-mainnet/650/validators.json"
SNAPSHOT_VALIDATORS="650_validators.json"

gcloud storage cp "gs://marinade-validator-bonds-mainnet/650/validators.json" "$SNAPSHOT_VALIDATORS"

# TODO: handle cases where the scoring is N/A for that specific epoch by iterating back in time epoch by epoch
SAM_RESPONSE=$(curl -sfLS "https://scoring.marinade.finance/api/v1/scores/sam?epoch=$SAM_EPOCH")

SAM_RUN_ID=(<<<"$SAM_RESPONSE" jq '.[0].metadata.scoringId' -r)
SAM_INPUTS_DIR="tmp-sam-inputs"
SAM_OUTPUTS_DIR="tmp-sam-outputs"

mkdir -p "$SAM_INPUTS_DIR"
mkdir -p "$SAM_OUTPUTS_DIR"

cat <<EOF | wget --base "https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/auction/0.0/auctions/$SAM_RUN_ID/inputs/" --input-file - --no-clobber --directory-prefix "$SAM_INPUTS_DIR"
blacklist.csv
bonds.json
config.json
mev-info.json
mnde-votes.json
rewards.json
tvl-info.json
validators.json
EOF

cat <<EOF | wget --base "https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/auction/0.0/auctions/$SAM_RUN_ID/outputs/" --input-file - --no-clobber --directory-prefix "$SAM_OUTPUTS_DIR"
results.json
EOF

pnpm i
pnpm -r build
pnpm run cli -- analyze-revenues \
    --cache-dir-path "$SAM_INPUTS_DIR" \
    --results-fixture-file-path "$SAM_OUTPUTS_DIR/results.json" \
    --snapshot-validators-file-path "$SNAPSHOT_VALIDATORS" \
    --results-file-path evaluation.json | tee out.log
