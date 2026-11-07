param(
  [Parameter(Mandatory = $true)][string]$Resources,
  [Parameter(Mandatory = $true)][string]$UpdateAsar,
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $true)][string]$StartedPath
)

# 仅由 update-helper.cjs 在需要提权时调用：把暂存的 update.asar 复制进安装目录并替换 app.asar。
# 应用进程的退出等待/重启由 helper 负责，避免本脚本拉起的应用继承控制台。
$ErrorActionPreference = 'SilentlyContinue'

$target = Join-Path $Resources 'update.asar'
$appAsar = Join-Path $Resources 'app.asar'
$bakAsar = Join-Path $Resources 'app-bak.asar'

function Write-Result($value) {
  Set-Content -LiteralPath $ResultPath -Value $value -Encoding ASCII
}

Set-Content -LiteralPath $StartedPath -Value 'started' -Encoding ASCII

if ([System.IO.Path]::GetFullPath($UpdateAsar) -ne [System.IO.Path]::GetFullPath($target)) {
  Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
  try {
    Copy-Item -LiteralPath $UpdateAsar -Destination $target -Force -ErrorAction Stop
  } catch {
    Write-Result ('copy-failed: ' + $_.Exception.Message)
    exit 1
  }
}

$swapped = $false
for ($i = 0; $i -lt 30; $i++) {
  Remove-Item -LiteralPath $bakAsar -Force -ErrorAction SilentlyContinue
  try {
    Rename-Item -LiteralPath $appAsar -NewName 'app-bak.asar' -ErrorAction Stop
    $swapped = $true
    break
  } catch {
    Start-Sleep -Milliseconds 1000
  }
}

if (-not $swapped) {
  Write-Result 'locked'
  exit 1
}

try {
  Rename-Item -LiteralPath $target -NewName 'app.asar' -ErrorAction Stop
  Write-Result 'ok'
  exit 0
} catch {
  Write-Result ('rename-failed: ' + $_.Exception.Message)
  try { Rename-Item -LiteralPath $bakAsar -NewName 'app.asar' -ErrorAction Stop } catch { }
  exit 1
}
