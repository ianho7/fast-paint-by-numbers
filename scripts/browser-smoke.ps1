param(
    [int]$Port = 4173,
    [string]$Sample = "/docs/paintbynumbersgenerator/src-cli/testinput.png"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

bun run build | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "无法构建 web-demo / sdk / wasm 产物"
}

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (!(Test-Path $edgePath)) {
    throw "找不到 Microsoft Edge: $edgePath"
}

$server = Start-Process -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList "-Command", "Set-Location '$repoRoot'; bun ./scripts/serve-web-demo.mjs $Port ." `
    -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 2
try {
    $index = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/packages/web-demo/index.html" -UseBasicParsing
    if ($index.StatusCode -ne 200) {
        throw "静态服务未正常启动"
    }

    $smokeUrl = "http://127.0.0.1:$Port/packages/web-demo/index.html?autorun=1&sample=$([uri]::EscapeDataString($Sample))&clusters=8&smoothing=2"
    $dom = & $edgePath --headless --disable-gpu --virtual-time-budget=30000 --dump-dom $smokeUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Edge headless 冒烟执行失败"
    }

    if ($dom -notmatch 'data-smoke="pass"') {
        throw "浏览器 smoke 未通过，DOM 中缺少 data-smoke=pass"
    }
    if ($dom -notmatch 'Facet 数量') {
        throw "浏览器 smoke 未渲染结果摘要"
    }

    $output = [PSCustomObject]@{
        url = $smokeUrl
        passed = $true
        checked_at = (Get-Date).ToString("s")
    }
    New-Item -ItemType Directory -Force -Path "out/browser-smoke" | Out-Null
    $output | ConvertTo-Json -Depth 4 | Set-Content "out/browser-smoke/summary.json"
    Write-Host "[browser-smoke] passed"
}
finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id
    }
}
