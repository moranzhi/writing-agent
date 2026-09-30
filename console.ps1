# Start and stop the local writing-agent web server. File watch stays off.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("query", "start", "stop", "restart", "status", "log")]
  [string]$Action
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 23337
$Log = Join-Path $env:USERPROFILE ".writing-agent\logs\runtime.log"

function Get-ListenerPid {
  $lines = netstat -ano -p tcp | Select-String ":$Port\s" | Select-String "LISTENING"
  foreach ($line in $lines) {
    if ("$line" -match '\sLISTENING\s+(\d+)\s*$') {
      return [int]$Matches[1]
    }
  }
  return $null
}

function Get-ProcessById([int]$ProcessId) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Test-ServerCommand([string]$CommandLine) {
  if (-not $CommandLine) { return $false }
  if ($CommandLine -match 'Cursor|cursor-agent') { return $false }
  return $CommandLine -match 'src[\\/]+server[\\/]+web-server|web:watch|tsx(\.cmd)?\s+watch|npm(\.cmd)?\s+run\s+web'
}

function Get-ChainText([int]$ProcessId) {
  $parts = New-Object System.Collections.Generic.List[string]
  $current = $ProcessId
  for ($i = 0; $i -lt 10; $i++) {
    $proc = Get-ProcessById $current
    if (-not $proc) { break }
    $cmd = [string]$proc.CommandLine
    $parts.Add($cmd)
    if ($cmd -match 'Cursor|cursor-agent') { break }
    $parent = [int]$proc.ParentProcessId
    if ($parent -le 0 -or $parent -eq $current) { break }
    $current = $parent
  }
  return ($parts -join "`n")
}

function Get-ProtectedPids {
  $protected = New-Object 'System.Collections.Generic.HashSet[int]'
  $current = $PID
  for ($i = 0; $i -lt 8; $i++) {
    if ($current -le 0 -or -not $protected.Add($current)) { break }
    $proc = Get-ProcessById $current
    if (-not $proc) { break }
    $parent = [int]$proc.ParentProcessId
    if ($parent -le 0 -or $parent -eq $current) { break }
    $current = $parent
  }
  return $protected
}

function Test-ForeignConsole([string]$CommandLine) {
  if (-not $CommandLine) { return $false }
  return $CommandLine -match 'tunnel\.ps1|ops-menu|srv\.bat|console\.bat'
}

function Get-StopRoot([int]$ProcessId, $Protected) {
  $current = $ProcessId
  $root = $ProcessId
  $matched = $false
  for ($i = 0; $i -lt 10; $i++) {
    if ($Protected.Contains($current)) { break }
    $proc = Get-ProcessById $current
    if (-not $proc) { break }
    $cmd = [string]$proc.CommandLine
    if ($cmd -match 'Cursor|cursor-agent') { break }
    if (Test-ForeignConsole $cmd) { break }
    if (Test-ServerCommand $cmd) {
      $root = $current
      $matched = $true
    }
    $parent = [int]$proc.ParentProcessId
    if ($parent -le 0 -or $parent -eq $current) { break }
    $current = $parent
  }
  if (-not $matched) { return $null }
  if ($Protected.Contains($root)) { return $null }
  return $root
}

function Stop-Server {
  $listener = Get-ListenerPid
  if (-not $listener) {
    Write-Output "down"
    return
  }
  $root = Get-StopRoot $listener (Get-ProtectedPids)
  if (-not $root) {
    throw "Port $Port is in use by another process (pid $listener)."
  }
  & taskkill.exe /F /T /PID $root | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "taskkill failed ($LASTEXITCODE)" }
  Start-Sleep -Seconds 1
  if (Get-ListenerPid) { throw "Port $Port is still in use." }
  Write-Output "stopped"
}

function Get-Mode {
  $listener = Get-ListenerPid
  if (-not $listener) { return "down" }
  $chain = Get-ChainText $listener
  if ($chain -notmatch 'web-server|npm(\.cmd)?\s+run\s+web') { return "other" }
  if ($chain -match 'web:watch|tsx(\.cmd)?\s+watch') { return "watch" }
  return "web"
}

function Start-Server {
  $mode = Get-Mode
  if ($mode -eq "other") {
    throw "Port $Port is in use by another process (pid $(Get-ListenerPid))."
  }
  if ($mode -eq "watch") { Stop-Server | Out-Null }
  if ($mode -eq "web") {
    Write-Output "already"
    return
  }
  $npm = "D:\tool\node\npm.cmd"
  $found = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($found) { $npm = $found.Source }
  if (-not (Test-Path $npm)) { throw "npm.cmd not found" }
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$npm`" run web" -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds(40)
  do {
    Start-Sleep -Seconds 1
    $listener = Get-ListenerPid
    if ($listener) {
      $chain = Get-ChainText $listener
      if ($chain -notmatch 'ssh\.exe') {
        Write-Output "started"
        return
      }
    }
  } while ((Get-Date) -lt $deadline)
  throw "Server did not listen on $Port."
}

switch ($Action) {
  "query" { Write-Output (Get-Mode) }
  "start" { Start-Server }
  "stop" { Stop-Server }
  "restart" {
    Stop-Server | Out-Null
    Start-Server
  }
  "status" {
    Write-Output ("mode=" + (Get-Mode))
    Push-Location $Root
    try { git status -sb } finally { Pop-Location }
  }
  "log" {
    if (-not (Test-Path $Log)) { Write-Output "no log: $Log"; break }
    Get-Content -Path $Log -Tail 40
  }
}
