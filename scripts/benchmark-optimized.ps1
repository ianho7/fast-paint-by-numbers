param(
    [string]$ManifestPath = "docs/baselines/optimized/manifest.json",
    [string]$OutputRoot = "out/benchmarks",
    [int]$Runs = 3
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (!(Test-Path $ManifestPath)) {
    throw "找不到 benchmark manifest: $ManifestPath"
}

cargo build -p pbn-cli | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "无法构建 pbn-cli"
}
$cliExe = Join-Path $repoRoot "target/debug/pbn-cli.exe"

$cases = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$runSummaries = @()
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$benchmarkDir = Join-Path $OutputRoot $timestamp
New-Item -ItemType Directory -Force -Path $benchmarkDir | Out-Null

foreach ($case in $cases) {
    $caseName = [string]$case.name
    $perRun = @()
    for ($run = 1; $run -le $Runs; $run++) {
        $caseDir = Join-Path $benchmarkDir "$caseName-run$run"
        New-Item -ItemType Directory -Force -Path $caseDir | Out-Null

        Write-Host "[benchmark-optimized] running $caseName (run $run/$Runs)"
        & $cliExe --input $case.input --output $caseDir --config $case.config --format "svg,palette.json,debug.json" --log-level warn
        if ($LASTEXITCODE -ne 0) {
            throw "benchmark 执行失败: $caseName run=$run"
        }

        $debug = Get-Content (Join-Path $caseDir "result.debug.json") -Raw | ConvertFrom-Json
        $perRun += [PSCustomObject]@{
            run = $run
            total_ms = [int64]$debug.metrics.stage_timings.total_ms
            quantize_ms = [int64]$debug.metrics.stage_timings.quantize_ms
            cleanup_ms = [int64]$debug.metrics.stage_timings.cleanup_ms
            regions_ms = [int64]$debug.metrics.stage_timings.regions_ms
            reduction_ms = [int64]$debug.metrics.stage_timings.reduction_ms
            labels_ms = [int64]$debug.metrics.stage_timings.labels_ms
            render_ms = [int64]$debug.metrics.stage_timings.render_ms
            facet_count = [int]$debug.facet_count
        }
    }

    $measure = $perRun | Measure-Object -Property total_ms -Average -Minimum -Maximum
    $runSummaries += [PSCustomObject]@{
        name = $caseName
        input = $case.input
        runs = $perRun
        average_total_ms = [math]::Round($measure.Average, 2)
        min_total_ms = [int64]$measure.Minimum
        max_total_ms = [int64]$measure.Maximum
        average_regions_ms = [math]::Round((($perRun | Measure-Object -Property regions_ms -Average).Average), 2)
        average_reduction_ms = [math]::Round((($perRun | Measure-Object -Property reduction_ms -Average).Average), 2)
        average_quantize_ms = [math]::Round((($perRun | Measure-Object -Property quantize_ms -Average).Average), 2)
        average_labels_ms = [math]::Round((($perRun | Measure-Object -Property labels_ms -Average).Average), 2)
        average_render_ms = [math]::Round((($perRun | Measure-Object -Property render_ms -Average).Average), 2)
    }
}

$summaryPath = Join-Path $benchmarkDir "summary.json"
$runSummaries | ConvertTo-Json -Depth 8 | Set-Content $summaryPath
Write-Host "[benchmark-optimized] summary written to $summaryPath"
