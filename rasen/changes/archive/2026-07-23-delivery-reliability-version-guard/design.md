## Context

Every installed skill file already carries a `generatedBy: "<version>"` field in its YAML frontmatter, written by `generateSkillContent()` (`src/core/shared/skill-generation.ts`) and called from both `rasen init` (`src/core/init.ts`) and `rasen update` (`src/core/update.ts`), always sourced from `package.json`'s version. `getToolVersionStatus()` / `getAllToolVersionStatus()` (`src/core/shared/tool-detection.ts`) already read the first existing skill file per tool and report `needsUpdate: boolean` against the running CLI's version. Today the only caller of this detection is `update.ts` itself.

Ten project-scoped commands (`doctor`, `show`, `validate`, `work`, `context`, `pipeline`, `pipeline-library`, `workflow instructions`, `workflow new-change`, `workflow status`) already funnel through `resolveRootForCommand()` (`src/core/root-selection.ts`), which already has two precedents for exactly this kind of addition: `emitStoreRootBanner(root, output.reporter)`, gated on `!output.json` so machine-readable callers stay silent, and `touchProjectRegistry(...)`, documented as "best-effort, throttled... every failure is swallowed... must never fail or visibly slow a user command."

The incident's actual victim was an AI-agent session running many project-scoped commands back-to-back on a stale install. A per-invocation warning would be correct but noisy for that shape of session; a real human running one `rasen show` a day would barely notice it either way.

## Goals / Non-Goals

**Goals:**
- Surface the existing (already-detected) skill/CLI version mismatch at every project-scoped command, not just `update`.
- Do so without adding a second detection mechanism, a new stamp format, or per-command overhead beyond what `getToolVersionStatus` already costs (bounded to the first existing skill file per tool).
- Never warn twice for the same mismatch inside one command-heavy session; re-arm automatically when the mismatch changes (resolved by `update`, or the CLI is upgraded again mid-session).
- Give `rasen doctor` an explicit, on-demand check for the same condition (human + `--json`), independent of the ambient warning and its debounce state.

**Non-Goals:**
- No new stamping mechanism — `generatedBy` frontmatter is the single source of truth; this change only adds a new *reader* of it.
- No CLI-vs-npm-registry "is a newer release published" check — this is about the installed skills lagging the CLI that's actually running, not about whether a newer CLI exists upstream.
- No new user-settable config key or opt-out flag — not requested by the incident's fix direction; keeps `config-key-registry` untouched.
- No change to `update`'s own output — it already states "up to date (vX)" / "Updated: ... (vX)" and already shows the version transition in its plan preview.

## Decisions

**Hook point: inside `resolveRootForCommand`, next to `emitStoreRootBanner`.** This is the single choke point ten commands already share, it already has the `!json` gating precedent, and it already runs once per command invocation (not per skill file, not in a loop) so there's no risk of firing the warning multiple times per command. Alternative considered: hook it into each command file individually — rejected, that's ten call sites to keep in sync versus one, and precisely the kind of drift `resolveRootForCommand`'s existing helpers were centralized to avoid.

**Reuse `getAllToolVersionStatus(root.path, OPENSPEC_VERSION)` verbatim.** It already exists, is already exported, is already unused outside `update.ts`, and already does the cheap thing (first-file-only read, early break). No new detection code. The warning fires when any configured tool's `needsUpdate` is true; the message names the mismatched stamp version and the running CLI version from the first mismatched tool's status (not every tool — one line, not a per-tool dump).

**Debounce by (stampVersion, cliVersion) pair, not by time.** The failure mode this guards against is an AI-agent session issuing dozens of project-scoped commands in a few minutes — a wall-clock TTL (the `touchProjectRegistry` pattern uses 24h) would either nag through the whole session or, if short, still nag several times. Keying on the *version pair* means: warn once for "0.1.2 vs 0.1.5", stay silent for the rest of that session's commands, and automatically warn again only if the pair changes — either because `update` resolved it (stamp catches up) or the global CLI was bumped again mid-session (a new, genuinely different mismatch). Marker storage follows the `expert-selection-state.ts` precedent exactly: a small JSON file in the project's machine-local home directory (`resolveProjectHome(root.path, { ensure: false })`), read/written best-effort and silently skipped if no project home is registered yet (a project with no machine home is not the session shape this guards against, and the warning fires — un-debounced — rather than failing the command). New module `src/core/version-guard-state.ts` mirroring `hasExpertSelectionAck`/`writeExpertSelectionAck`'s shape: `readLastWarnedVersionPair(homeDir)` / `writeLastWarnedVersionPair(homeDir, { stampVersion, cliVersion })`.

**`rasen doctor` gets its own, undebounced check.** Doctor is an explicit, on-demand health report — its whole contract is "tell me everything that's wrong right now," so it re-derives the same `getAllToolVersionStatus` result directly (not reading the debounce marker) and reports it as a new finding alongside the existing `machineRootRelocation`/`migratableEphemera`-style entries in `relationship-health.ts`, rendered in `printHumanHealth` with a `Fix: rasen update` line, and included in the `--json` payload's `status` array.

**New `ConfigDiagnosticKey`, following `expertSelectionMigration` exactly.** `reportConfigDiagnostic()` is already the established shape for a locale-backed, fallback-carrying, warn-level notice (see `update.ts`'s use of `expertSelectionMigration`). Add `skillVersionMismatch` to `CONFIG_DIAGNOSTIC_KEYS` in `config-diagnostics.ts`, with `values: { stampVersion, cliVersion }` interpolated into the message, and add the corresponding string to `configErrors.diagnostics` in all three locale files (`en`, `ja`, `zh-cn`).

**`cli-init`/`cli-update` spec additions are documentation-only.** The `generatedBy` write already happens, unconditionally, in both commands' existing skill-generation code paths. Since the new guard now depends on it as load-bearing infrastructure, both specs gain a scenario describing the existing write — no code changes, no new tests beyond confirming the existing behavior (which already has coverage; this is a spec-parity fix, not a new-code fix).

## Risks / Trade-offs

- [Risk] A project with no machine-local home registered gets no debounce, so a heavy-command session against such a project could still see the warning repeatedly. → Mitigation: this is the same population `touchProjectRegistry` already treats as best-effort/unregistered; scope stays narrow (warn every time, never crash) rather than forcing a home registration as a side effect of a warning feature.
- [Risk] The debounce marker could go stale/incorrect if a project is moved or its machine home is shared across worktrees in an unexpected way. → Mitigation: worst case is an extra or missing warning line, never a wrong command result — the marker only gates a `console.warn`, nothing else reads it.
- [Risk] Adding a call inside `resolveRootForCommand` touches a function shared by ten commands; a bug here has broad blast radius. → Mitigation: wrap the entire check in try/catch exactly like `touchProjectRegistry`, so any failure is silently swallowed and never surfaces as a command failure; add a unit test asserting a thrown error inside the version-status lookup does not propagate.

## Migration Plan

No data migration. The change is additive: existing `generatedBy` stamps already carry everything needed. First run after this ships will, at most, print one new warning line for any project already out of sync — a true positive, not a regression.

## Open Questions

None blocking — the debounce-by-version-pair and doctor-is-undebounced decisions above were made directly rather than left open, since the incident evidence (an AI-agent session, not an interactive human) makes the trade-off concrete.
