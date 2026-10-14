# Servidor local para probar De Peón a Rey en Windows sin instalar nada.
# Uso: abre PowerShell en la carpeta del proyecto y ejecuta
#   powershell -ExecutionPolicy Bypass -File .\servidor.ps1
# Sirve la carpeta docs\ (el sitio listo para publicar). Si la ventana se abre dentro de otra carpeta
# que tenga un index.html, sirve esa. Luego abre http://localhost:8000. Para detenerlo, cierra la ventana.

$port = 8000
$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root 'index.html'))) { $root = Join-Path $PSScriptRoot 'docs' }
if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host "No encuentro index.html. Corre primero: python tools\build.py" -ForegroundColor Red
  exit 1
}
$root = (Resolve-Path $root).Path

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript'
  '.json' = 'application/json'
  '.wasm' = 'application/wasm'
  '.txt'  = 'text/plain; charset=utf-8'
  '.css'  = 'text/css'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json'
  '.woff2' = 'font/woff2'
  '.md'    = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Listo: abre http://localhost:$port en tu navegador (cierra esta ventana para detenerlo)." -ForegroundColor Green

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] } else { $ctx.Response.ContentType = 'application/octet-stream' }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
} finally {
  $listener.Stop()
}
