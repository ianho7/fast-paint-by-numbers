param(
    [int]$Port = 4173,
    [string]$Root = (Resolve-Path ".").Path
)

$listener = [System.Net.HttpListener]::new()
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "SERVING:$prefix"
Write-Output "ROOT:$Root"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $requestPath = $context.Request.Url.AbsolutePath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($requestPath)) {
            $requestPath = 'packages/web-demo/index.html'
        }

        $safeSegments = $requestPath -split '/' | Where-Object { $_ -ne '' -and $_ -ne '.' -and $_ -ne '..' }
        $resolvedPath = Join-Path $Root ($safeSegments -join [IO.Path]::DirectorySeparatorChar)

        if ((Test-Path $resolvedPath) -and -not (Get-Item $resolvedPath).PSIsContainer) {
            $extension = [IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()
            $contentType = switch ($extension) {
                '.html' { 'text/html; charset=utf-8' }
                '.js' { 'text/javascript; charset=utf-8' }
                '.mjs' { 'text/javascript; charset=utf-8' }
                '.css' { 'text/css; charset=utf-8' }
                '.json' { 'application/json; charset=utf-8' }
                '.wasm' { 'application/wasm' }
                '.svg' { 'image/svg+xml' }
                '.png' { 'image/png' }
                '.jpg' { 'image/jpeg' }
                '.jpeg' { 'image/jpeg' }
                '.webp' { 'image/webp' }
                default { 'application/octet-stream' }
            }

            $bytes = [IO.File]::ReadAllBytes($resolvedPath)
            $context.Response.StatusCode = 200
            $context.Response.ContentType = $contentType
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.OutputStream.Close()
            Write-Output "200 $requestPath"
            continue
        }

        $context.Response.StatusCode = 404
        $buffer = [Text.Encoding]::UTF8.GetBytes("Not Found: $requestPath")
        $context.Response.ContentType = 'text/plain; charset=utf-8'
        $context.Response.ContentLength64 = $buffer.Length
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
        $context.Response.OutputStream.Close()
        Write-Output "404 $requestPath"
    }
}
finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
