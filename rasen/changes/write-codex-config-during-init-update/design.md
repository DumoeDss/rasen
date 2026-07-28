## Context

Rasen's Codex workflows use `wait_agent` as an event-driven dependency barrier. The workflow prompt already asks the lead agent to wait once, but Codex also supplies generic developer guidance that discourages blocking waits longer than 60 seconds. In a live session that conflict produced 85 consecutive one-minute waits. After a project-local `.codex/config.toml` raised the minimum, default, and maximum wait values to one hour, Codex exposed a `3600000ms` tool bound and one wait returned as soon as the worker completed after 100.814 seconds.

The experiment also included a custom `multi_agent_mode_hint_text`, but source inspection showed that this setting replaces Codex's effort-derived multi-agent policy across ordinary project sessions. Rasen will therefore not generate or manage that field. The wait-bound fix must remain mechanical and must not alter Codex's native proactive versus explicit-request-only delegation behavior.

Rasen currently installs Codex skills during `init` and refreshes them during `update`, but it does not own any Codex runtime settings. This change crosses the shared Codex integration, init reporting, update drift detection, configuration-file safety, and Windows/macOS/Linux path handling. The existing `tools:` field in `rasen/config.yaml` remains the authority for whether a project opted into Codex.

The implementation must coexist with arbitrary user-authored Codex settings. Re-serializing the entire TOML document would risk losing comments, ordering, quoting, and formatting, while blind text replacement could corrupt valid TOML. The reconciliation boundary therefore needs to be both lossless outside the managed fields and conservative when the target structure cannot be identified safely.

## Goals / Non-Goals

**Goals:**

- Make a Rasen-configured Codex project expose one-hour wait bounds that permit one long, interruptible `wait_agent` call for dependency barriers.
- Reconcile the three wait bounds during both explicit Codex initialization and manifest-authorized updates.
- Treat missing or stale managed values as update drift, even when all generated skills are current.
- Preserve all non-managed Codex configuration bytes and the existing newline convention.
- Make reconciliation idempotent, atomic, cross-platform, and testable without launching Codex.
- Tell users when a Codex restart is required for newly written wait bounds to affect future sessions.

**Non-Goals:**

- Modifying Codex source code or the user's global Codex configuration.
- Writing, replacing, or removing `multi_agent_mode_hint_text` or any other Codex delegation prompt.
- Enabling Codex merely because a `.codex/` directory is detected.
- Removing the managed project configuration when Codex is later deselected or Rasen is uninstalled.
- Providing a general-purpose TOML formatter or editor.
- Launching, restarting, or terminating a user's Codex session.
- Guaranteeing short `wait_agent` timeouts in a Rasen-configured Codex project; the one-hour minimum is intentional.

## Decisions

### 1. Manage three wait fields in the project-local Codex V2 table

Rasen will own only these fields under `[features.multi_agent_v2]`:

```toml
min_wait_timeout_ms = 3600000
default_wait_timeout_ms = 3600000
max_wait_timeout_ms = 3600000
```

The numeric values align the tool schema and default invocation at one hour. `wait_agent` remains event-driven, so worker completion or user steer returns immediately rather than sleeping for the full hour.

The canonical values and managed field names will live in one shared Codex project-config module and be referenced by inspection, reconciliation, and tests. Existing values for these three exact fields are replaced because they conflict with the Rasen runtime contract; every other field remains user-owned. In particular, an existing `multi_agent_mode_hint_text` is preserved byte-for-byte and remains entirely user-owned.

Alternatives considered:

- A skill-only instruction was already present when repeated polling occurred, so the tool bounds provide the mechanical guarantee.
- A project-level `multi_agent_mode_hint_text` could explicitly discuss Rasen barriers, but Codex treats it as a replacement for the normal multi-agent mode across reasoning efforts and daily tasks. Rasen therefore leaves it unset and unmanaged.
- A global `~/.codex/config.toml` mutation would affect unrelated projects and is outside Rasen's project-scoped authority.
- Different minimum/default/maximum values would permit Codex to normalize or choose a short wait again; pinning all three removes that ambiguity.

### 2. Use explicit project-tool authority at both entry points

`init` will reconcile the config only when Codex is in the validated, explicitly selected tool set for that invocation. This includes an explicit tool-only setup at the root of an externalized planning repository.

`update` will reconcile the config only when the authoritative `tools:` manifest resolves Codex as configured. When migration seeds a missing manifest and includes Codex, reconciliation may run after that seed. A stray `.codex/` directory remains advisory-only and does not authorize a write.

Alternatives considered:

- Directory detection is convenient but would silently opt projects into a runtime policy they did not select.
- Making configuration a separate command would leave normal init/update installs incomplete and allow drift to persist.

### 3. Separate inspection from reconciliation

The shared module will expose a read-only inspection result such as `current`, `missing`, `drifted`, or `blocked`, and a reconciliation result such as `unchanged`, `created`, or `updated`.

Update planning calls inspection before its existing "Already up to date." short circuit. `missing` and `drifted` are update-required states. `blocked` is also not up to date, but it is reported as an actionable failure rather than triggering a destructive rewrite.

The reconciler will:

1. Resolve `.codex/config.toml` from the project root with Node's path APIs.
2. Create the file and parent directory when absent.
3. Add the table when it is absent, or replace/insert only the three managed fields in one unambiguous standard table.
4. Preserve all content outside those fields, including comments, ordering, encoding without a BOM, LF/CRLF style, and final-newline convention.
5. Validate the candidate as TOML and verify the three resolved values before committing it.
6. Write through a temporary sibling and atomically replace the destination.
7. Return `unchanged` without writing when the policy is already current.

A syntax-aware, lossless table locator will be used rather than global regular-expression replacement or whole-document serialization. Files with duplicate target tables, duplicate managed keys, a scalar/inline-table collision at `features.multi_agent_v2`, invalid TOML, unsupported encoding, or another structure the editor cannot change without ambiguity will return `blocked` with the path and reason. The original file remains byte-for-byte unchanged.

Alternatives considered:

- Full parse-and-serialize is semantically simple but unnecessarily rewrites unrelated user content.
- Blind line replacement is dependency-light but unsafe around multiline strings, dotted keys, and duplicate definitions.
- Always replacing the whole file would solve drift but violates ownership of unrelated Codex settings.

### 4. Integrate failure and reporting with the existing tool result model

Config reconciliation is part of configuring Codex, not a best-effort post-step. If it fails, the command will identify `.codex/config.toml`, explain why it was left untouched, and will not report Codex as fully configured or the project as already current. Other independently selected tools may continue through the existing per-tool result path.

When reconciliation creates or changes the file, init/update will report the Codex configuration change and tell the user to restart Codex; a running session does not reload this project policy automatically. An unchanged policy produces no restart notice. Existing skill counts remain skill counts and will not include the TOML file.

Alternatives considered:

- A warning-only failure would leave users believing the repeated-wait fix was installed.
- Counting the config as a skill would distort existing summaries and telemetry.

### 5. Test the shared contract first, then both command seams

Unit fixtures will cover an absent file; an absent target table; an already-current table; stale and missing managed fields; unrelated tables, keys, and comments; CRLF and final-newline preservation; multiline strings containing header-like text; duplicate/inline/invalid target structures; and write failures. Paths and assertions will use `path.join`/`path.resolve`, with a Windows-specific scenario exercising backslash roots.

Init integration tests will prove that explicit Codex selection writes the policy and that non-Codex selections do not. Update tests will prove that manifest-authorized config drift bypasses the up-to-date branch, while an unmanifested `.codex/` directory remains untouched. Tests will also verify error and restart output.

The implementation can be accepted without calling an external Codex binary. A manual release check may start a fresh Codex session and repeat the greater-than-60-second canary to confirm one early-woken wait.

## Risks / Trade-offs

- [The one-hour minimum prevents intentional short waits in this project] → Document the compatibility change and scope it only to projects that explicitly configure Codex.
- [A future Codex release renames or changes these preview fields] → Keep field names and values centralized, validate the emitted TOML, and cover the currently supported contract with a release canary.
- [Lossless editing is more complex than serialization] → Limit ownership to one explicit table and three named fields, validate before replacement, and refuse ambiguous inputs.
- [Atomic replacement behaves differently across operating systems] → Use a sibling temporary file, close handles before rename, use Node path APIs, and cover Windows path and replacement behavior.
- [Config and skills could diverge after a partial failure] → Report Codex as failed/not current and make the next init/update retry idempotently.
- [A user intentionally set different values for managed keys] → Make ownership and the short-timeout consequence explicit; preserve every non-managed value and provide the exact conflicting path.
- [Existing work is already modifying init and update] → Implement through a narrow shared module and integrate at tested seams without overwriting unrelated worktree changes.

## Migration Plan

1. Ship the shared inspector/reconciler and its fixtures.
2. Add init reconciliation for newly selected and refreshed Codex installations.
3. Add update inspection before the up-to-date decision and reconciliation in the Codex update path.
4. Add summaries, restart guidance, and user documentation for the project-local policy.
5. Run focused unit/integration tests, lint, and build on the supported Node version.
6. Optionally run the fresh-session Codex canary: one child exceeds 60 seconds, the lead issues one one-hour wait, and completion wakes it early.

Existing projects migrate on their next `rasen update` if and only if Codex is present in their `tools:` manifest. Rollback removes the init/update integration and shared module; it does not automatically delete already-written project fields because doing so could erase values the user has since adopted. Users can manually restore or remove the three fields after rollback.

## Open Questions

None. Cleanup on Codex deselection/uninstall is intentionally deferred to a separate ownership-and-uninstall change.
