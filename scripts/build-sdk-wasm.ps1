param(
  [string]$Profile = "release"
)

$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $workspace "target/wasm32-unknown-unknown/$Profile"
$outDir = Join-Path $workspace "packages/sdk/generated"

New-Item -ItemType Directory -Force $outDir | Out-Null

cargo build -p pbn-core --target wasm32-unknown-unknown --profile $Profile
wasm-bindgen `
  --target web `
  --out-dir $outDir `
  --out-name pbn_core `
  (Join-Path $targetDir "pbn_core.wasm")
