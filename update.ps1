param(
  [string]$Resources,
  [string]$ExePath,
  [string]$LogPath
)

$ErrorActionPreference = 'SilentlyContinue'

$appAsar = Join-Path $Resources 'app.asar'
$bakAsar = Join-Path $Resources 'app-bak.asar'
$updateAsar = Join-Path $Resources 'update.asar'
$appName = [System.IO.Path]::GetFileNameWithoutExtension($ExePath)

function Write-Log($message) {
  if ($LogPath) { Add-Content -LiteralPath $LogPath -Value $message }
}

if (Test-Path -LiteralPath $updateAsar) {
  $swapped = $false
  for ($i = 0; $i -lt 30; $i++) {
    Remove-Item -LiteralPath $bakAsar -Force
    try {
      Rename-Item -LiteralPath $appAsar -NewName 'app-bak.asar' -ErrorAction Stop
      $swapped = $true
      break
    } catch {
      Start-Sleep -Milliseconds 1000
    }
  }

  if ($swapped) {
    try {
      Rename-Item -LiteralPath $updateAsar -NewName 'app.asar' -ErrorAction Stop
    } catch {
      Write-Log ('failed to apply update.asar: ' + $_)
      try { Rename-Item -LiteralPath $bakAsar -NewName 'app.asar' -ErrorAction Stop } catch { }
    }
  } else {
    Write-Log 'app.asar stayed locked, update skipped'
  }
}

for ($i = 0; $i -lt 15; $i++) {
  $running = Get-Process -Name $appName -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID }
  if (-not $running) { break }
  Start-Sleep -Milliseconds 1000
}

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $ExePath
