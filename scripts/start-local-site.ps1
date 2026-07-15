$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = 3000
$LogDir = Join-Path $ProjectRoot ".local"
$LogFile = Join-Path $LogDir "local-site.log"
$PidFile = Join-Path $LogDir "local-site.pid"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-LocalLog {
  param([string] $Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "[$stamp] $Message"
}

function Get-ListeningProcessId {
  $connection = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($connection) {
    return [int] $connection.OwningProcess
  }
  return $null
}

$existingPid = Get-ListeningProcessId
if ($existingPid) {
  Write-LocalLog "Port $Port already listening by process $existingPid. No new server started."
  Set-Content -LiteralPath $PidFile -Encoding ASCII -Value $existingPid
  exit 0
}

$npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $npm) {
  $npm = Get-Command "npm" -ErrorAction SilentlyContinue
}
if (-not $npm) {
  Write-LocalLog "npm was not found in PATH. Cannot start local site."
  exit 1
}

$serverLog = Join-Path $LogDir "dev-server.log"
$serverErr = Join-Path $LogDir "dev-server.err.log"
$arguments = @("run", "dev", "--", "--hostname", "127.0.0.1", "--port", "$Port")

$refresh = Start-Process `
  -FilePath $npm.Source `
  -ArgumentList @("run", "refresh:results") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $LogDir "result-sync.log") `
  -RedirectStandardError (Join-Path $LogDir "result-sync.err.log") `
  -PassThru
Write-LocalLog "Startup result sync started in background with process $($refresh.Id)."

Write-LocalLog "Starting local site from $ProjectRoot with $($npm.Source)."
$processPath = [System.Environment]::GetEnvironmentVariable("Path", "Process")
if ($processPath) {
  [System.Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [System.Environment]::SetEnvironmentVariable("Path", $processPath, "Process")
}
$process = Start-Process `
  -FilePath $npm.Source `
  -ArgumentList $arguments `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $serverLog `
  -RedirectStandardError $serverErr `
  -PassThru

Set-Content -LiteralPath $PidFile -Encoding ASCII -Value $process.Id

for ($attempt = 1; $attempt -le 90; $attempt += 1) {
  Start-Sleep -Seconds 1
  $listeningPid = Get-ListeningProcessId
  if ($listeningPid) {
    Write-LocalLog "Local site is listening at http://127.0.0.1:$Port/ with process $listeningPid."
    Set-Content -LiteralPath $PidFile -Encoding ASCII -Value $listeningPid
    $snapshot = Start-Process `
      -FilePath $npm.Source `
      -ArgumentList @("run", "snapshots:capture") `
      -WorkingDirectory $ProjectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $LogDir "snapshot-capture.log") `
      -RedirectStandardError (Join-Path $LogDir "snapshot-capture.err.log") `
      -PassThru
    Write-LocalLog "Startup pre-match snapshot capture started in background with process $($snapshot.Id)."
    exit 0
  }

  if ($process.HasExited) {
    Write-LocalLog "Started process $($process.Id), but it exited before port $Port listened. Exit code: $($process.ExitCode)."
    exit 1
  }
}

Write-LocalLog "Started process $($process.Id), but port $Port was not listening after waiting."
exit 1
