param(
    [string]$LegacySummaryPath = "out/baseline-legacy/summary.json",
    [string]$OptimizedSummaryPath = "out/baseline-optimized/summary.json",
    [string]$OutputPath = "out/comparisons/legacy-vs-optimized-summary.json"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $LegacySummaryPath)) {
    throw "找不到 legacy summary: $LegacySummaryPath"
}
if (!(Test-Path $OptimizedSummaryPath)) {
    throw "找不到 optimized summary: $OptimizedSummaryPath"
}

$legacyItems = Get-Content $LegacySummaryPath -Raw | ConvertFrom-Json
$optimizedItems = Get-Content $OptimizedSummaryPath -Raw | ConvertFrom-Json
$optimizedByName = @{}
foreach ($item in $optimizedItems) {
    $optimizedByName[[string]$item.name] = $item
}

$comparisons = @()
foreach ($legacy in $legacyItems) {
    $name = [string]$legacy.name
    if (-not $optimizedByName.ContainsKey($name)) {
        continue
    }

    $optimized = $optimizedByName[$name]
    $comparisons += [PSCustomObject]@{
        name = $name
        legacy = $legacy
        optimized = $optimized
        delta = [PSCustomObject]@{
            palette_size = ([int]$optimized.palette_size) - ([int]$legacy.palette_size)
            facet_count = ([int]$optimized.facet_count) - ([int]$legacy.facet_count)
            svg_bytes = ([int]$optimized.svg_bytes) - ([int]$legacy.svg_bytes)
            total_ms = ([int64]$optimized.total_ms) - ([int64]$legacy.total_ms)
            quantize_ms = ([int64]$optimized.quantize_ms) - ([int64]$legacy.quantize_ms)
            regions_ms = ([int64]$optimized.regions_ms) - ([int64]$legacy.regions_ms)
            reduction_ms = ([int64]$optimized.reduction_ms) - ([int64]$legacy.reduction_ms)
            labels_ms = ([int64]$optimized.labels_ms) - ([int64]$legacy.labels_ms)
            render_ms = ([int64]$optimized.render_ms) - ([int64]$legacy.render_ms)
        }
    }
}

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}
$comparisons | ConvertTo-Json -Depth 8 | Set-Content $OutputPath
Write-Host "[compare-baselines] summary written to $OutputPath"
