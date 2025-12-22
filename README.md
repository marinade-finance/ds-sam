# ds-sam

<a href="https://www.npmjs.com/package/@marinade.finance/ds-sam-sdk">
  <img src="https://img.shields.io/npm/v/%40marinade.finance%2Fds-sam-sdk?logo=npm&color=377CC0" />
</a>

## Running the CLI
Get info about available CLI options
```bash
pnpm run cli -- auction --help
```

Evaluate the auction
```bash
pnpm run cli -- auction [--options...]
```

### Example from ds-sam-pipeline

```bash
cache_dir="/tmp/cache"
rm -rf "$cache_dir" && \
  mkdir -p "${cache_dir}/inputs" "${cache_dir}/outputs" && \
  inputs_dir="${cache_dir}/inputs" && \
  outputs_dir="${cache_dir}/outputs"  && \
  curl 'https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/refs/heads/main/auction-config.json' \
    > "${inputs_dir}/config.json"

pnpm run cli -- auction --inputs-source APIS --cache-inputs --cache-dir-path "$inputs_dir" \
  -c "${inputs_dir}/config.json"  -o "$outputs_dir" > /dev/null
```

# Example to re-run with cached files

```bash
cache_dir="/tmp/cache"
inputs_dir="${cache_dir}/inputs"
outputs_dir="${cache_dir}/outputs-2"
mkdir -p "$outputs_dir"

pnpm run cli -- auction --inputs-source FILES --cache-dir-path "$inputs_dir" \
  -c "${inputs_dir}/config.json"  -o "$outputs_dir" > /dev/null
```

## CLI config
Configured using CLI options or a config file passed in via the `-c` (`--config-file-path`) option

The CLI options take precedence over the config file values

## SDK config

Config [defaults](./packages/ds-sam-sdk/src/config.ts#L35)

Configuration used in the auction evaluation pipeline can be found at
https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json


## Development

To build

```sh
pnpm -r build
```

To run tests

```sh
pnpm test

# single test file
FILE='testfile.test.ts' pnpm test
```

### Publishing SDK package

```sh
cd packages/ds-sam-sdk
npm publish
```