#Requires -Version 5.1
<#
Session cache probe: KC1a/b/c + KC4.
See docs\experiments\session-cache-probe.md for protocol, judgement rules and reporting.

Run from the repo root of the worktree (cwd is an experiment variable), as a
BACKGROUND task (total runtime ~4h05m):

  powershell -NoProfile -ExecutionPolicy Bypass -File docs\experiments\session-cache-probe.ps1
#>
[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path $env:USERPROFILE '.rasen\probe\session-cache'),
  [string]$Model = 'sonnet',
  [switch]$NoSkipPermissions,
  # Gaps (seconds) before each wake step, in order:
  # 7min, 30min, 55min, 65min (expect MISS), 50min (then touch), 35min (after touch)
  [int[]]$GapsSeconds = @(420, 1800, 3300, 3900, 3000, 2100),
  [string[]]$PayloadFiles = @(
    'src\core\templates\workflows\_orchestration.ts',
    'src\commands\agent.ts',
    'src\core\pipeline-registry\run-state.ts',
    'src\core\keepalive\index.ts',
    'docs\session-execution-layer-design.md'
  )
)

$ErrorActionPreference = 'Stop'
$WorkDir = (Get-Location).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$log = Join-Path $OutDir 'probe-log.txt'
$runStart = Get-Date

function Log([string]$msg) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Host $line
}

# Ensure UTF-8 when piping payload to the native claude binary (PS 5.1 defaults to ASCII).
$global:OutputEncoding = [System.Text.Encoding]::UTF8

# Keep the machine awake for the duration of the probe (no global power-setting change).
Add-Type -Namespace Probe -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
# NB: PS 5.1 parses 0x80000003 as a negative Int32, so [uint32] cast throws; convert from hex text.
$ES_CONTINUOUS = [Convert]::ToUInt32('80000000', 16)
$ES_KEEPAWAKE = [Convert]::ToUInt32('80000003', 16)
[void][Probe.Power]::SetThreadExecutionState($ES_KEEPAWAKE) # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

function Invoke-ClaudeArgs([string]$OutFile, [string[]]$CliArgs) {
  Log ('call -> {0}: claude {1}' -f $OutFile, ($CliArgs -join ' '))
  $t0 = Get-Date
  $raw = (& claude @CliArgs | Out-String).Trim()
  $t1 = Get-Date
  Set-Content -Path (Join-Path $OutDir $OutFile) -Value $raw -Encoding utf8
  $obj = $null
  try { $obj = $raw | ConvertFrom-Json } catch { Log ('WARN: stdout of {0} is not JSON' -f $OutFile) }
  Log ('done <- {0} ({1:n0}s)' -f $OutFile, ($t1 - $t0).TotalSeconds)
  [pscustomobject]@{ file = $OutFile; startedAt = $t0; endedAt = $t1; json = $obj }
}

function Invoke-ClaudeStdin([string]$OutFile, [string]$StdinPath, [string[]]$CliArgs) {
  Log ('call -> {0}: (stdin {1}) claude {2}' -f $OutFile, $StdinPath, ($CliArgs -join ' '))
  $t0 = Get-Date
  $raw = (Get-Content -Path $StdinPath -Raw -Encoding utf8 | & claude @CliArgs | Out-String).Trim()
  $t1 = Get-Date
  Set-Content -Path (Join-Path $OutDir $OutFile) -Value $raw -Encoding utf8
  $obj = $null
  try { $obj = $raw | ConvertFrom-Json } catch { Log ('WARN: stdout of {0} is not JSON' -f $OutFile) }
  Log ('done <- {0} ({1:n0}s)' -f $OutFile, ($t1 - $t0).TotalSeconds)
  [pscustomobject]@{ file = $OutFile; startedAt = $t0; endedAt = $t1; json = $obj }
}

function UsageOf($call) {
  if ($null -eq $call -or $null -eq $call.json) { return $null }
  $u = $call.json.usage
  if ($null -eq $u) { return $null }
  [pscustomobject]@{
    input      = [long]($u.input_tokens)
    cacheWrite = [long]($u.cache_creation_input_tokens)
    cacheRead  = [long]($u.cache_read_input_tokens)
    output     = [long]($u.output_tokens)
  }
}

function CtxOf($usage) {
  if ($null -eq $usage) { return 0 }
  return $usage.input + $usage.cacheWrite + $usage.cacheRead + $usage.output
}

try {
  $version = (& claude --version | Out-String).Trim()
  Log ('claude version: {0}; model: {1}; cwd: {2}' -f $version, $Model, $WorkDir)

  $permArgs = @()
  if (-not $NoSkipPermissions) { $permArgs = @('--dangerously-skip-permissions') }
  $jsonArgs = @('--output-format', 'json', '--model', $Model) + $permArgs

  # --- 00 smoke: verify output schema before committing 4 hours -------------
  $smoke = Invoke-ClaudeArgs '00-smoke.json' (@('-p', 'Reply with exactly: OK. Do not use any tools.') + $jsonArgs)
  if ($null -eq $smoke.json -or [string]::IsNullOrEmpty([string]$smoke.json.session_id)) {
    throw 'SMOKE FAILED: no session_id in claude -p --output-format json output. Aborting before the long run.'
  }
  if ($null -eq (UsageOf $smoke)) {
    throw 'SMOKE FAILED: no usage field in output JSON. Aborting; see doc §3 fallback (rasen agent audit) before rerunning.'
  }

  # --- 01 bootstrap: single-request, zero-tool, large-context session ------
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('You are a cache-probe session. Below is reference material to hold in context.')
  [void]$sb.AppendLine('Do not use any tools. After the material, reply with exactly: READY')
  foreach ($rel in $PayloadFiles) {
    $abs = Join-Path $WorkDir $rel
    if (-not (Test-Path $abs)) { Log ('WARN: payload file missing, skipped: {0}' -f $rel); continue }
    [void]$sb.AppendLine(('===== FILE: {0} =====' -f $rel))
    [void]$sb.AppendLine((Get-Content -Path $abs -Raw))
  }
  $payloadPath = Join-Path $OutDir 'payload.txt'
  Set-Content -Path $payloadPath -Value $sb.ToString() -Encoding utf8
  Log ('payload size: {0:n0} bytes' -f (Get-Item $payloadPath).Length)

  $boot = Invoke-ClaudeStdin '01-bootstrap.json' $payloadPath (@('-p') + $jsonArgs)
  $sid = [string]$boot.json.session_id
  if ([string]::IsNullOrEmpty($sid)) { throw 'BOOTSTRAP FAILED: no session_id.' }
  $bootUsage = UsageOf $boot
  $ctx = CtxOf $bootUsage
  Log ('bootstrap session_id={0}; ctx estimate={1:n0} tokens' -f $sid, $ctx)
  if ($ctx -lt 30000) { Log 'WARN: ctx < 30k, discrimination will be weak. Consider adding payload files and rerunning.' }

  # --- 02..07 wake chain -----------------------------------------------------
  $steps = @(
    @{ file = '02-wake-7min.json';             prompt = 'Reply with exactly: PONG 1. Do not use any tools.' },
    @{ file = '03-wake-30min.json';            prompt = 'Reply with exactly: PONG 2. Do not use any tools.' },
    @{ file = '04-wake-55min.json';            prompt = 'Reply with exactly: PONG 3. Do not use any tools.' },
    @{ file = '05-wake-65min-expect-miss.json'; prompt = 'Reply with exactly: PONG 4. Do not use any tools.' },
    @{ file = '06-touch-50min.json';           prompt = 'Keepalive touch. Reply with exactly: OK. Do not use any tools.' },
    @{ file = '07-wake-35min-after-touch.json'; prompt = 'Reply with exactly: PONG 5. Do not use any tools.' }
  )

  $records = New-Object System.Collections.ArrayList
  [void]$records.Add([pscustomobject]@{ step = 'bootstrap'; gapSeconds = 0; sessionId = $sid; usage = $bootUsage; verdict = 'n/a'; ctxAfter = $ctx })

  for ($i = 0; $i -lt $steps.Count; $i++) {
    $gap = $GapsSeconds[$i]
    Log ('sleeping {0}s before {1}' -f $gap, $steps[$i].file)
    Start-Sleep -Seconds $gap

    $call = Invoke-ClaudeArgs $steps[$i].file (@('-p', '--resume', $sid, $steps[$i].prompt) + $jsonArgs)
    $u = UsageOf $call
    $newSid = ''
    if ($null -ne $call.json) { $newSid = [string]$call.json.session_id }
    if (-not [string]::IsNullOrEmpty($newSid) -and $newSid -ne $sid) {
      Log ('KC4: session_id changed {0} -> {1}' -f $sid, $newSid)
      $sid = $newSid
    }

    $verdict = 'AMBIGUOUS'
    if ($null -eq $u) {
      $verdict = 'NO-USAGE'
    } elseif ($ctx -gt 0) {
      if (($u.cacheRead -ge 0.85 * $ctx) -and ($u.cacheWrite -le 0.15 * $ctx)) { $verdict = 'HIT' }
      elseif ($u.cacheWrite -ge 0.7 * $ctx) { $verdict = 'MISS-rewrite' }
    }
    $ctxNew = CtxOf $u
    Log ('{0}: verdict={1} (read={2:n0} write={3:n0} vs ctxPrev={4:n0})' -f $steps[$i].file, $verdict, $u.cacheRead, $u.cacheWrite, $ctx)
    [void]$records.Add([pscustomobject]@{ step = $steps[$i].file; gapSeconds = $gap; sessionId = $sid; usage = $u; verdict = $verdict; ctxAfter = $ctxNew })
    if ($ctxNew -gt 0) { $ctx = $ctxNew }
  }

  # --- summary + KC4 transcript census --------------------------------------
  $summaryPath = Join-Path $OutDir 'summary.json'
  [pscustomobject]@{
    claudeVersion = $version; model = $Model; cwd = $WorkDir
    startedAt = $runStart; finishedAt = (Get-Date); records = $records
  } | ConvertTo-Json -Depth 8 | Out-File -FilePath $summaryPath -Encoding utf8
  Log ('summary written: {0}' -f $summaryPath)

  $census = @()
  $projRoot = Join-Path $env:USERPROFILE '.claude\projects'
  if (Test-Path $projRoot) {
    $census = Get-ChildItem -Path $projRoot -Directory |
      ForEach-Object { Get-ChildItem -Path $_.FullName -Filter '*.jsonl' -File -ErrorAction SilentlyContinue } |
      Where-Object { $_.LastWriteTime -ge $runStart } |
      Select-Object FullName, Length, LastWriteTime
  }
  $census | Format-Table -AutoSize | Out-String | Set-Content -Path (Join-Path $OutDir 'transcripts.txt') -Encoding utf8
  Log ('transcripts touched during run: {0} (see transcripts.txt)' -f @($census).Count)

  Log 'PROBE COMPLETE. Next: manual KC3 / KC2 / optional KC5 per session-cache-probe.md, then fill the report template.'
}
finally {
  [void][Probe.Power]::SetThreadExecutionState($ES_CONTINUOUS) # ES_CONTINUOUS only (release)
}
