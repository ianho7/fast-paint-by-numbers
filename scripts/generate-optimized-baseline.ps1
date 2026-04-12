param(
    [string]$ManifestPath = "docs/baselines/optimized/manifest.json",
    [string]$OutputRoot = "out/baseline-optimized"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (!(Test-Path $ManifestPath)) {
    throw "找不到 baseline manifest: $ManifestPath"
}

cargo build -p pbn-cli | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "无法构建 pbn-cli"
}
$cliExe = Join-Path $repoRoot "target/debug/pbn-cli.exe"

$cases = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$results = @()

foreach ($case in $cases) {
    $caseName = [string]$case.name
    $caseDir = Join-Path $OutputRoot $caseName
    New-Item -ItemType Directory -Force -Path $caseDir | Out-Null

    Write-Host "[baseline-optimized] running $caseName"
    & $cliExe --input $case.input --output $caseDir --config $case.config --format "svg,palette.json,debug.json,quantized.png" --log-level info
    if ($LASTEXITCODE -ne 0) {
        throw "CLI 执行失败: $caseName"
    }

    $svgPath = Join-Path $caseDir "result.svg"
    $palettePath = Join-Path $caseDir "result.palette.json"
    $debugPath = Join-Path $caseDir "result.debug.json"

    $svg = Get-Content $svgPath -Raw
    $palette = Get-Content $palettePath -Raw | ConvertFrom-Json
    $debug = Get-Content $debugPath -Raw | ConvertFrom-Json

    $facetCount = [int]$debug.facet_count
    $paletteSize = @($palette).Count
    $hasEvenOdd = $svg.Contains('fill-rule="evenodd"')

    if ($paletteSize -lt [int]$case.expected.min_palette_size) {
        throw "case=$caseName palette_size=$paletteSize 低于预期"
    }
    if ($facetCount -lt [int]$case.expected.min_facet_count) {
        throw "case=$caseName facet_count=$facetCount 低于预期"
    }
    if ([bool]$case.expected.require_evenodd -and -not $hasEvenOdd) {
        throw "case=$caseName 缺少 evenodd 路径输出"
    }

    $results += [PSCustomObject]@{
        name = $caseName
        input = $case.input
        palette_size = $paletteSize
        facet_count = $facetCount
        svg_bytes = $svg.Length
        total_ms = [int64]$debug.metrics.stage_timings.total_ms
        quantize_ms = [int64]$debug.metrics.stage_timings.quantize_ms
        cleanup_ms = [int64]$debug.metrics.stage_timings.cleanup_ms
        regions_ms = [int64]$debug.metrics.stage_timings.regions_ms
        reduction_ms = [int64]$debug.metrics.stage_timings.reduction_ms
        labels_ms = [int64]$debug.metrics.stage_timings.labels_ms
        render_ms = [int64]$debug.metrics.stage_timings.render_ms
        has_evenodd = $hasEvenOdd
    }
}

$summaryPath = Join-Path $OutputRoot "summary.json"
$results | ConvertTo-Json -Depth 5 | Set-Content $summaryPath
Write-Host "[baseline-optimized] summary written to $summaryPath"
