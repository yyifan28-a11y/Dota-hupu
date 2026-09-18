[CmdletBinding()]
param(
  [ValidateSet("s2", "s3")]
  [string]$Season = "s3",
  [string]$CloudHost = "111.229.211.110",
  [string]$CloudUser = "ubuntu",
  [string]$RemoteDatabasePath = "",
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\id_ed25519_dota_tencent"
)

$ErrorActionPreference = "Stop"

if (-not $RemoteDatabasePath) {
  $RemoteDatabasePath = if ($Season -eq "s2") {
    "/home/ubuntu/Dota-hupu/data/dota.db"
  }
  else {
    "/home/ubuntu/Dota-hupu/data/dota-s3.db"
  }
}
$databaseFileName = if ($Season -eq "s2") { "dota.db" } else { "dota-s3.db" }
$seasonLabel = $Season.ToUpperInvariant()

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$localDatabase = [IO.Path]::GetFullPath((Join-Path $projectRoot $databaseFileName))
$backupDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot "backups\db-sync"))
$identityPath = [IO.Path]::GetFullPath($IdentityFile)

if (-not $localDatabase.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to replace a database outside the project directory: $localDatabase"
}
if (-not $backupDirectory.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write backups outside the project directory: $backupDirectory"
}
if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) {
  throw "SSH identity file was not found: $identityPath"
}
if ($RemoteDatabasePath -notmatch '^/[A-Za-z0-9._/-]+$') {
  throw "Remote database path contains unsupported characters: $RemoteDatabasePath"
}

$restartLocalServer = $false
$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $listenerProcessIds = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($listenerProcessId in $listenerProcessIds) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId"
    if ($listenerProcess.Name -ne "node.exe" -or $listenerProcess.CommandLine -notmatch 'server\.js') {
      throw "Port 3000 belongs to another program (PID $listenerProcessId). Refusing to stop it."
    }
  }
  Write-Host "Temporarily stopping the local Dota server..."
  foreach ($listenerProcessId in $listenerProcessIds) {
    Stop-Process -Id $listenerProcessId -Force
  }
  $restartLocalServer = $true
}

$syncId = [Guid]::NewGuid().ToString("N")
$remoteSnapshot = "/tmp/dota-$Season-sync-$syncId.db"
$localTemporary = [IO.Path]::GetFullPath((Join-Path $projectRoot ".dota-$Season-sync-$syncId.db"))
$remoteTarget = "${CloudUser}@${CloudHost}"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$snapshotPython = @"
import json, sqlite3
source = sqlite3.connect('file:${RemoteDatabasePath}?mode=ro', uri=True)
target = sqlite3.connect('$remoteSnapshot')
source.backup(target)
integrity = target.execute('PRAGMA integrity_check').fetchone()[0]
players = target.execute('SELECT COUNT(*) FROM players').fetchone()[0]
matches = target.execute('SELECT COUNT(*) FROM matches').fetchone()[0]
target.close()
source.close()
print(json.dumps({'integrity': integrity, 'players': players, 'matches': matches}))
"@
$encodedSnapshotPython = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($snapshotPython))
$remoteSnapshotCommand = "echo $encodedSnapshotPython | base64 -d | python3"
$remoteCleanupCommand = "rm -f -- '$remoteSnapshot'"

try {
  Write-Host "Creating a consistent $seasonLabel SQLite snapshot on Tencent Cloud..."
  Invoke-NativeCommand -Command "ssh" -Arguments @(
    "-i", $identityPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    $remoteTarget,
    $remoteSnapshotCommand
  )

  Write-Host "Downloading the snapshot..."
  $remoteSource = "${remoteTarget}:$remoteSnapshot"
  Invoke-NativeCommand -Command "scp" -Arguments @(
    "-i", $identityPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    $remoteSource,
    $localTemporary
  )

  $verifyScript = @"
import { DatabaseSync } from 'node:sqlite';
const database = new DatabaseSync(process.argv[1], { readOnly: true });
const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
const players = Number(database.prepare('SELECT COUNT(*) AS count FROM players').get().count);
const matches = Number(database.prepare('SELECT COUNT(*) AS count FROM matches').get().count);
database.close();
console.log(JSON.stringify({ integrity, players, matches }));
if (integrity !== 'ok') process.exit(2);
"@
  Write-Host "Verifying the downloaded database..."
  Invoke-NativeCommand -Command "node" -Arguments @(
    "--input-type=module",
    "-e",
    $verifyScript,
    $localTemporary
  )

  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $localDatabase -PathType Leaf) {
    $backupPath = Join-Path $backupDirectory "dota-$Season-$timestamp.db"
    Copy-Item -LiteralPath $localDatabase -Destination $backupPath
    Write-Host "Previous local database backed up to: $backupPath"
  }

  Move-Item -LiteralPath $localTemporary -Destination $localDatabase -Force
  Write-Host "$seasonLabel database synchronized successfully: $localDatabase"
}
finally {
  & ssh -i $identityPath -o IdentitiesOnly=yes -o BatchMode=yes $remoteTarget $remoteCleanupCommand 2>$null
  if (Test-Path -LiteralPath $localTemporary -PathType Leaf) {
    Write-Warning "A downloaded temporary database remains at: $localTemporary"
  }
  if ($restartLocalServer) {
    Write-Host "Restarting the local Dota server..."
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    Start-Process -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $projectRoot -WindowStyle Hidden
  }
}

if ($restartLocalServer) {
  $serverHealthy = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $state = Invoke-RestMethod -Uri "http://localhost:3000/api/state?season=$Season" -TimeoutSec 2
      $serverHealthy = $true
      break
    }
    catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $serverHealthy) {
    throw "The database was synchronized, but the local server did not become healthy on port 3000."
  }
  Write-Host "Local server is healthy: $(@($state.players).Count) players, $(@($state.matches).Count) matches."
}
