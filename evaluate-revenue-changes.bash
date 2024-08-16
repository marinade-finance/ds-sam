#!/bin/bash

SAM_EPOCH=652
PAST_EPOCH=$((SAM_EPOCH - 1))

GCP_PATH="gs://marinade-validator-bonds-mainnet/"
SNAPSHOT_VALIDATORS="${SAM_EPOCH}_validators.json"
gcloud storage cp "${GCP_PATH}/${SAM_EPOCH}/validators.json" "${SNAPSHOT_VALIDATORS}"

SNAPSHOT_PAST_VALIDATORS="${PAST_EPOCH}_validators.json"
gcloud storage cp "${GCP_PATH}/${PAST_EPOCH}/validators.json" "${SNAPSHOT_PAST_VALIDATORS}"


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
    --sam-results-fixture-file-path "$SAM_OUTPUTS_DIR/results.json" \
    --snapshot-validators-file-path "$SNAPSHOT_VALIDATORS" \
    ${SNAPSHOT_PAST_VALIDATORS:+"--snapshot-past-validators-file-path $SNAPSHOT_PAST_VALIDATORS"} \
    --results-file-path evaluation.json | tee out.log
