param(
    [string]$ManifestPath = "docs/baselines/legacy/manifest.json",
    [string]$ReferencePath = "docs/baselines/legacy/reference/summary.json",
    [string]$OutputRoot = "out/baseline-legacy"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (!(Test-Path $ManifestPath)) {
    throw "找不到 legacy baseline manifest: $ManifestPath"
}
if (!(Test-Path $ReferencePath)) {
    throw "找不到 legacy baseline reference: $ReferencePath"
}

cargo build -p pbn-cli | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "无法构建 pbn-cli"
}
$cliExe = Join-Path $repoRoot "target/debug/pbn-cli.exe"

$cases = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$references = Get-Content $ReferencePath -Raw | ConvertFrom-Json
$referenceByName = @{}
foreach ($reference in $references) {
    $referenceByName[[string]$reference.name] = $reference
}

$results = @()
foreach ($case in $cases) {
    $caseName = [string]$case.name
    if (-not $referenceByName.ContainsKey($caseName)) {
        throw "legacy baseline reference 缺少 case: $caseName"
    }

    $caseDir = Join-Path $OutputRoot $caseName
    New-Item -ItemType Directory -Force -Path $caseDir | Out-Null

    Write-Host "[baseline-legacy] running $caseName"
    & $cliExe --input $case.input --output $caseDir --config $case.config --format "svg,palette.json,debug.json,quantized.png" --log-level warn
    if ($LASTEXITCODE -ne 0) {
        throw "legacy baseline 执行失败: $caseName"
    }

    $svgPath = Join-Path $caseDir "result.svg"
    $palettePath = Join-Path $caseDir "result.palette.json"
    $debugPath = Join-Path $caseDir "result.debug.json"
    $svg = Get-Content $svgPath -Raw
    $palette = Get-Content $palettePath -Raw | ConvertFrom-Json
    $debug = Get-Content $debugPath -Raw | ConvertFrom-Json

    # legacy baseline 只冻结语义摘要：palette/facet/label 计数、area 分布与 facet 面积。
    # 这样既能约束 parity，又不会把 Q 曲线控制点等几何实现细节硬编码成逐字符快照。
    $actual = [PSCustomObject]@{
        name = $caseName
        input = $case.input
        palette_size = @($palette).Count
        facet_count = [int]$debug.facet_count
        label_count = @($debug.label_bounds).Count
        has_evenodd = $svg.Contains('fill-rule="evenodd"')
        svg_bytes = [int](Get-Item $svgPath).Length
        palette_frequencies = @($palette | ForEach-Object { [int]$_.frequency })
facet_point_counts = @($debug.facets_summary | ForEach-Object { [int]$_.point_count })
        total_ms = [int64]$debug.metrics.stage_timings.total_ms
        quantize_ms = [int64]$debug.metrics.stage_timings.quantize_ms
        cleanup_ms = [int64]$debug.metrics.stage_timings.cleanup_ms
        regions_ms = [int64]$debug.metrics.stage_timings.regions_ms
        reduction_ms = [int64]$debug.metrics.stage_timings.reduction_ms
        labels_ms = [int64]$debug.metrics.stage_timings.labels_ms
        render_ms = [int64]$debug.metrics.stage_timings.render_ms
    }

    $expected = $referenceByName[$caseName].expected
    if ($actual.palette_size -ne [int]$expected.palette_size) {
        throw "case=$caseName palette_size=$($actual.palette_size) 不匹配 expected=$($expected.palette_size)"
    }
    if ($actual.facet_count -ne [int]$expected.facet_count) {
        throw "case=$caseName facet_count=$($actual.facet_count) 不匹配 expected=$($expected.facet_count)"
    }
    if ($actual.label_count -ne [int]$expected.label_count) {
        throw "case=$caseName label_count=$($actual.label_count) 不匹配 expected=$($expected.label_count)"
    }
    if ($actual.has_evenodd -ne [bool]$expected.has_evenodd) {
        throw "case=$caseName evenodd 语义不匹配"
    }
    if ($actual.svg_bytes -ne [int]$expected.svg_bytes) {
        throw "case=$caseName svg_bytes=$($actual.svg_bytes) 不匹配 expected=$($expected.svg_bytes)"
    }
    $actualPaletteFrequencies = [string]::Join(',', $actual.palette_frequencies)
    $expectedPaletteFrequencies = [string]::Join(',', @($expected.palette_frequencies))
    if ($actualPaletteFrequencies -ne $expectedPaletteFrequencies) {
        throw "case=$caseName palette_frequencies 不匹配"
    }
    $actualFacetPointCounts = [string]::Join(',', $actual.facet_point_counts)
    $expectedFacetPointCounts = [string]::Join(',', @($expected.facet_point_counts))
    if ($actualFacetPointCounts -ne $expectedFacetPointCounts) {
        throw "case=$caseName facet_point_counts 不匹配"
    }

    $results += $actual
}

$summaryPath = Join-Path $OutputRoot "summary.json"
$results | ConvertTo-Json -Depth 6 | Set-Content $summaryPath
Write-Host "[baseline-legacy] summary written to $summaryPath"

