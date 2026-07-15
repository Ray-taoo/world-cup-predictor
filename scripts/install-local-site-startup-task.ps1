$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$StartScript = Join-Path $ProjectRoot "scripts\start-local-site.ps1"
$SyncHiddenScript = Join-Path $ProjectRoot "scripts\run-result-sync-hidden.vbs"
$TaskName = "WorldCupPredictorLocalSite"
$SyncTaskName = "WorldCupPredictorResultSync"
$Description = "Start the World Cup predictor local website at http://127.0.0.1:3000/ when the user logs in."
$StartupCommand = Join-Path ([Environment]::GetFolderPath("Startup")) "WorldCupPredictorLocalSite.cmd"

if (-not (Test-Path -LiteralPath $StartScript)) {
  throw "Start script not found: $StartScript"
}
if (-not (Test-Path -LiteralPath $SyncHiddenScript)) {
  throw "Sync hidden script not found: $SyncHiddenScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`"" `
  -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT30S"

$retryTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$retryTrigger.Delay = "PT2M"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($trigger, $retryTrigger) `
  -Settings $settings `
  -Description $Description `
  -Force | Out-Null

$syncAction = New-ScheduledTaskAction `
  -Execute "wscript.exe" `
  -Argument "`"$SyncHiddenScript`"" `
  -WorkingDirectory $ProjectRoot

$syncTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 15) `
  -RepetitionDuration (New-TimeSpan -Days 1)

Register-ScheduledTask `
  -TaskName $SyncTaskName `
  -Action $syncAction `
  -Trigger $syncTrigger `
  -Settings $settings `
  -Description "Synchronize World Cup final scores every 15 minutes." `
  -Force | Out-Null

$command = @"
@echo off
start "" /min powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$StartScript"
"@
Set-Content -LiteralPath $StartupCommand -Encoding ASCII -Value $command

Start-ScheduledTask -TaskName $TaskName
Start-ScheduledTask -TaskName $SyncTaskName

Write-Host "Installed and started scheduled task: $TaskName"
Write-Host "Installed and started scheduled task: $SyncTaskName"
Write-Host "Installed startup fallback: $StartupCommand"
