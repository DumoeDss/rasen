## Context

Rasen's CLI and management UI are separate npm packages with separate dependency graphs and a lockstep compatibility contract. A local CLI link resolves through the source worktree's real path, so installing the UI beside a target-project symlink does not necessarily make the UI visible to the CLI. The current 0.2.0 test scripts work around this with target-project package mutations and a source-local junction, but they hard-code one source, version, home, platform layout, and bootstrap sequence.

The harness must work from a dirty source worktree, preserve a stable global Rasen for daily work, keep the target project free of harness package metadata, and launch interactive Codex/Claude commands that may be PowerShell functions rather than standalone executables. Filesystem, package-manager, Git, and child-process dependencies are local-substitutable; their seams remain inside the harness implementation.

Three interface alternatives were considered using the design-it-twice method: one `-Tool` command, a policy-rich pack/link interface, and three discoverable launchers over one shared runtime module. The selected design combines the third option's common-case ergonomics with the first option's pack-only narrowness and the second option's daemon isolation.

## Goals / Non-Goals

**Goals:**

- Prepare an arbitrary local Rasen source worktree as a paired CLI/UI runtime without changing the target project's Node package state.
- Make warm reuse fast and deterministic while invalidating the runtime when relevant source or toolchain content changes.
- Give Rasen commands and agent child processes a version-specific executable path, machine home, daemon port, working directory, and telemetry isolation.
- Preserve interactive agent functions, arguments, standard I/O, exit codes, authentication, and user configuration.
- Verify the installed package shape and the CLI's actual UI resolver before any user command or agent starts.
- Keep the deep implementation cross-platform in Node while providing PowerShell 5.1-compatible adapters for the current Windows workflow.

**Non-Goals:**

- Add a production `rasen dev` CLI command or change the published package surface.
- Support source-link mode in the first version; pack mode is the only materialization contract.
- Run the full CLI/UI test suites on every preparation; this harness validates packaging and runtime integration, while CI owns release qualification.
- Mutate or replace the user's global Rasen, `~/.rasen`, `CODEX_HOME`, Claude home, or shell profile.
- Automatically prune cached runtimes or homes; cleanup requires a future explicit, safety-reviewed interface.
- Serve as the primary way to test telemetry; local harness child processes disable telemetry by default.

## Decisions

### D1 — Three thin PowerShell adapters over one deep Node module

Add `scripts/local-version/local-runtime.mjs` as the single deep module and expose three discoverable adapters: `rasen-local.ps1`, `start-codex-local.ps1`, and `start-claude-local.ps1`. Source defaults to the repository that owns the scripts, project defaults to the caller's current directory, and remaining arguments pass through unchanged.

The Node module exposes a machine-readable `prepare` action. PowerShell adapters consume its JSON result, overlay `PATH`, `RASEN_HOME`, `RASEN_DAEMON_PORT`, and `RASEN_TELEMETRY` only for the child scope, and invoke `rasen`, `codex`, or `claude`. Agent invocation stays in PowerShell so profile-defined functions remain usable. Build, fingerprint, cache, pairing, and validation logic is never duplicated in the adapters.

Alternative: one Node process launches every target. Rejected because Node cannot invoke a PowerShell function that supplies the user's Codex/Claude proxy or authentication setup.

Alternative: duplicate self-contained logic in three portable scripts. Rejected because fixes would drift across shallow implementations.

### D2 — Pack and install both packages into an immutable cache runtime

Preparation performs the release-shaped sequence for the selected source: validate package manifests, install/build each independent dependency graph as needed, pack the CLI and UI, install both tarballs beside each other in a private staging package, and validate the result. A successful staging directory is atomically committed to the cache and treated as immutable.

This arrangement matches the CLI UI resolver's normal npm layout and avoids symlink realpath and junction ownership problems. The harness reuses the existing package names and paired version/asset expectations but does not apply release-only tag or changelog requirements. Any npm-valid version is accepted when the CLI manifest, UI manifest, packed manifests, and installed CLI agree exactly.

Alternative: generalize the current `pnpm link` flow. Rejected for the first version because it is less release-faithful and requires a second UI resolution path.

### D3 — Content- and toolchain-addressed runtime cache

The runtime key includes a harness schema version, relevant CLI/UI package and build inputs, platform, architecture, Node ABI/version, npm version, and pnpm version. Relevant files are hashed by normalized relative path and contents; `.git`, `node_modules`, `dist`, docs, planning artifacts, and target-project content are excluded unless they are published/build inputs. The source's declared version is a readable label, not the cache identity.

The cache root defaults to a dedicated machine-local application-data/cache directory and can be overridden by `RASEN_LOCAL_HARNESS_ROOT` for tests and automation. Preparation uses a unique staging directory and a per-runtime lock. A cache entry becomes usable only after metadata, CLI version, UI version/assets, and actual resolver checks pass. Corrupt entries fail closed or rebuild once; no fallback reaches the global CLI.

Alternative: key only by version or Git HEAD. Rejected because dirty worktrees and two worktrees with the same manifest version would collide.

### D4 — Stable project/source/version home and daemon isolation

Machine state lives under the harness root, keyed by canonical source path, canonical project path, and declared version. It is stable across source edits within one development line so repeated `init` and UI work retain configuration, while different worktrees, projects, or declared versions do not share state. A deterministic high daemon port is derived from the same identity, excluding Rasen's normal port and known reserved preview port, and exported as `RASEN_DAEMON_PORT`.

The runtime cache is shareable across projects; the home and daemon identity are not. Telemetry is disabled for harness children with `RASEN_TELEMETRY=0`. Parent environment variables and working directory remain byte-for-byte unchanged because adapters restore them in `finally` and the Node module only constructs child/result data.

Alternative: key home by the full source fingerprint. Rejected because every code edit would discard useful local configuration and force repeated initialization.

### D5 — Target-project integrity is an explicit acceptance invariant

The harness treats the target project as the child's working directory, not an npm installation destination. Preparation snapshots any existing `package.json`, recognized lockfiles, and `node_modules` identity for focused tests and performs all package writes under the source dependency graphs or harness staging/cache roots. Target changes produced by the invoked Rasen command or agent remain normal product behavior and are outside bootstrap integrity assertions.

The project may be a non-Node directory. Paths are canonicalized with Node path/filesystem primitives, and tests cover Windows separators, spaces, and alias paths.

### D6 — Structured preparation result and fail-closed diagnostics

`prepare --json` emits exactly one JSON object on stdout; progress and child build output go to stderr. The result contains schema version, declared version, source fingerprint, runtime root, bin directory, Rasen executable, resolved UI assets, isolated home, daemon port, and cache outcome. Errors identify a stable code and phase (`resolve`, `fingerprint`, `build`, `pack`, `install`, `validate`, or `cache`) plus the failed command and exit code without dumping environment secrets.

PowerShell adapters require a successful result and validate the referenced paths before launching. Rasen/agent exit codes are passed through and are not reclassified as preparation failures.

## Risks / Trade-offs

- [Risk] Cold preparation performs two dependency builds plus pack/install and may take tens of seconds. → Cache by exact package inputs and toolchain; warm calls only fingerprint and validate metadata.
- [Risk] Source files can change during a cold build. → Fingerprint before and after packaging; discard staging and retry once on mismatch.
- [Risk] Concurrent callers build the same runtime. → Use a bounded per-key lock and recheck the cache after acquiring it.
- [Risk] Stable homes can outlive incompatible machine-data changes within one declared version. → Print the exact home path in diagnostics and metadata; never silently migrate between source/version identities.
- [Risk] Deterministic daemon ports can collide with an unrelated listener. → Existing daemon classification fails without touching foreign processes; the harness reports the derived port and identity so the user can diagnose it.
- [Risk] Building from source writes its own `node_modules` and ignored `dist`. → Limit writes to the selected Rasen worktree and harness root; the stronger source-zero-write model is deferred because it requires a copied dirty-worktree overlay.
- [Risk] Cache growth is unbounded. → Do not add implicit deletion; document the cache root and defer an explicit prune action.
- [Trade-off] PowerShell adapters are Windows-first. → Keep all substantive preparation in portable Node ESM so POSIX adapters can be added without duplicating the module.

## Migration Plan

1. Add the Node preparation module, PowerShell adapters, focused tests, and documentation under the repository.
2. Validate the new harness against the current 0.2.0 worktree and an empty target project, including the actual UI HTTP surface and mocked Codex/Claude launches.
3. Keep the external `rasen-2.0-test` prototype scripts temporarily as comparison evidence; users move to the repository-owned scripts after validation.
4. Rollback consists of removing `scripts/local-version/` and its tests/docs. Cached machine-local directories are inert and are not automatically deleted.

## Open Questions

None for the first version. Link mode, POSIX shell adapters, explicit telemetry testing, cache pruning, and source-zero-write builds require separate evidence and interfaces.
