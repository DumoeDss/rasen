# Local-version test harness

This directory prepares a release-shaped local Rasen runtime without changing
the target project's `package.json`, lockfiles, or `node_modules`. It builds and
packs both `@atelierai/rasen` and `@atelierai/rasen-ui`, installs the tarballs
beside each other in a private cache, validates the CLI version and UI resolver,
then launches Rasen, Codex, or Claude with isolated Rasen state.

## Quick start

Run these commands from the project that should use the local Rasen version:

```powershell
# The scripts live in the Rasen source being tested, so -Source is optional.
& 'E:\path\to\rasen\scripts\local-version\rasen-local.ps1' init
& 'E:\path\to\rasen\scripts\local-version\rasen-local.ps1' ui
& 'E:\path\to\rasen\scripts\local-version\start-codex-local.ps1'
& 'E:\path\to\rasen\scripts\local-version\start-claude-local.ps1'
```

To keep one shared copy of the harness or test another worktree, select both
paths explicitly:

```powershell
$harness = 'E:\tools\rasen-local-version'
& "$harness\rasen-local.ps1" `
  -Source 'E:\worktrees\rasen-0.2.0' `
  -Project 'E:\projects\my app' `
  init

& "$harness\start-codex-local.ps1" `
  -Source 'E:\worktrees\rasen-next' `
  -Project 'E:\projects\my app'
```

`-Source` defaults to the directory two levels above this harness, and
`-Project` defaults to the current PowerShell directory. Arguments that are not
harness options are forwarded unchanged. Use `-Refresh` before the forwarded
arguments to force a rebuild of the selected cache entry.

## Copying the harness

The **whole `scripts/local-version` directory** is portable. The three `.ps1`
files depend on the adjacent `local-runtime.mjs`; copying only the launchers is
not sufficient. A copied directory can live anywhere when every call supplies
`-Source`. Node.js 20.19 or newer, npm, pnpm, and PowerShell are required.

Do not run `npm init`, `pnpm link`, or install Rasen into the target project.
The harness owns all temporary npm package state outside that project and
includes the matching UI package automatically.

## Cache and isolation

Cold preparation builds both package graphs, packs both packages, and installs
them into an immutable content-addressed runtime. Warm preparation hashes the
relevant source and toolchain inputs, validates the cached CLI/UI pair, and
reuses it. Dirty source edits produce a new runtime even when `package.json`
still has the same version. A corrupt or incomplete entry is rebuilt; it never
falls back to the global `rasen` command.

On Windows the default root is:

```text
%LOCALAPPDATA%\Rasen\local-harness
```

Set `RASEN_LOCAL_HARNESS_ROOT` to override it. Runtime packages live under
`runtimes/`. Rasen machine state lives under `homes/`, keyed by the canonical
source path, project path, and declared version, so state survives source edits
but is not shared between projects or worktrees. Each identity also receives a
stable high `RASEN_DAEMON_PORT`. Harness children receive
`RASEN_TELEMETRY=0`; the parent shell environment is restored afterward.

The harness does not delete old runtimes or homes automatically.

## Diagnostics and troubleshooting

Preparation progress and package-manager output go to stderr. The underlying
machine-readable interface writes one JSON object to stdout:

```powershell
node .\scripts\local-version\local-runtime.mjs prepare `
  --source 'E:\worktrees\rasen-next' `
  --project (Get-Location).Path `
  --json
```

The result reports the fingerprint, runtime, executable, UI assets, home, port,
and whether the cache was `built` or a `hit`. Failures report a stable error
code and phase. Common fixes:

- `VERSION_MISMATCH`: make the root and `packages/ui` manifest versions equal.
- `COMMAND_FAILED` in `build`, `pack`, or `install`: run the printed command in
  the named source package and fix that dependency/build failure.
- `UI_RESOLVER_*`: rebuild the UI and check that `dist/index.html` is packaged.
- `LOCK_TIMEOUT`: another cold preparation is still running, or a machine-local
  cache lock cannot be accessed.
- PowerShell execution-policy errors: invoke with
  `powershell -ExecutionPolicy Bypass -File <launcher>` or use an appropriate
  user-scoped signed-script policy.

## Migrating from the 0.2.0 prototype

Replace `rasen-020.ps1`, `start-codex-020.ps1`, and
`start-claude-020.ps1` with the corresponding `*-local.ps1` commands. Remove
the prototype's `npm init`, `pnpm link`, source-local UI junction, and hard-coded
home setup; none of them are needed. Your global daily Rasen remains unchanged.
