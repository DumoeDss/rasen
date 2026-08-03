[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Project = (Get-Location).Path,
  [switch]$Refresh,
  [Parameter(ValueFromRemainingArguments = $true)]
  [object[]]$ClaudeArgs
)

$runtimeScript = Join-Path $PSScriptRoot 'local-runtime.mjs'
$prepareArgs = @($runtimeScript, 'prepare', '--source', $Source, '--project', $Project, '--json')
if ($Refresh) { $prepareArgs += '--refresh' }

$runtimeJson = & node @prepareArgs
$prepareExitCode = $LASTEXITCODE
if ($prepareExitCode -ne 0) {
  if ($MyInvocation.InvocationName -eq '.') { return }
  exit $prepareExitCode
}

try {
  $runtime = $runtimeJson | ConvertFrom-Json -ErrorAction Stop
  $null = Get-Command claude -ErrorAction Stop
} catch {
  Write-Error "Cannot prepare Claude local-version session: $($_.Exception.Message)"
  if ($MyInvocation.InvocationName -eq '.') { return }
  exit 1
}

$names = @('Path', 'RASEN_HOME', 'RASEN_DAEMON_PORT', 'RASEN_TELEMETRY')
$savedEnvironment = @{}
foreach ($name in $names) {
  $item = Get-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
  $savedEnvironment[$name] = @{
    Exists = $null -ne $item
    Value = if ($null -ne $item) { $item.Value } else { $null }
  }
}

$exitCode = 1
Push-Location -LiteralPath $runtime.projectRoot
try {
  $env:Path = "$($runtime.binDir)$([IO.Path]::PathSeparator)$env:Path"
  $env:RASEN_HOME = $runtime.rasenHome
  $env:RASEN_DAEMON_PORT = [string]$runtime.daemonPort
  $env:RASEN_TELEMETRY = '0'
  & claude @ClaudeArgs
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
  foreach ($name in $names) {
    $saved = $savedEnvironment[$name]
    if ($saved.Exists) {
      Set-Item -LiteralPath "Env:$name" -Value $saved.Value
    } else {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
  }
}

$global:LASTEXITCODE = $exitCode
if ($MyInvocation.InvocationName -eq '.') { return }
exit $exitCode
