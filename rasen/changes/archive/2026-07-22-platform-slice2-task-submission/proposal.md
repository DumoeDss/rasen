# platform-slice2-task-submission

## Why

Slice 1 delivered a read-only management platform: the board shows real changes and runs, but every action still requires opening a terminal. Slice 2 (roadmap §6, user-approved) adds the platform's first write path — submitting a task from the web UI — while preserving the core discipline: the CLI remains the ONLY write entry. The server shells out to the existing `rasen` CLI as a subprocess (argv arrays, never shell strings) and never duplicates business logic or writes workspace files directly.

## What Changes

- **First write endpoint**: `POST /api/v1/changes` on the management server — accepts `{ name, description }`, validates input, spawns `rasen new change <name> --proposal <description> --json` as a subprocess with the launch project as cwd, and returns the created change (201) or the CLI's error verbatim (stderr and exit code never swallowed). Synchronous acceptance: `new change` is a fast filesystem command; no job queue in this slice.
- **`--proposal <text>` flag on `rasen new change`**: writes a minimal human-seeded `proposal.md` into the new change. Without it, a submitted change would be invisible on the board — `getActiveChangeIds` requires `proposal.md`, and both the endpoint and board carry SHALL NOT clauses forbidding a wider scan. The flag closes the loop through the CLI, not around it. (New visible flag ⇒ completions command-registry entry + en/ja locale catalog entries.)
- **Subprocess security model**: single-operation whitelist (create-change only), server-side name/description validation before spawn, cwd locked to the launch project, hard timeout, in-flight concurrency cap, `shell: false` argv arrays. Long-running LLM commands (`auto`/`goal` runs, claudecode sessions) are explicitly OUT — that is slice 3's session-supervision scope.
- **Board submission form**: a "New change" affordance on the board page (inline form/dialog) with name + description fields; on success the board refetches and the real new change card appears; on failure the CLI error is shown as-is.
- **Spec posture change**: the management API is no longer strictly read-only — the read-only requirement is replaced by "loopback + bearer security with a single CLI-backed write endpoint"; all other methods/paths still reject writes.

## Capabilities

### New Capabilities
- `change-submission`: the CLI-backed write path — endpoint contract, subprocess execution model (whitelist, argv, cwd, timeout, concurrency, error passthrough), and its security posture.

### Modified Capabilities
- `management-http-api`: the "read-only, no mutating endpoint" requirement is replaced with a security requirement that admits exactly one write endpoint (`POST /api/v1/changes`) backed by the CLI subprocess; all other write methods still 405.
- `board-ui`: board gains the submission form and post-submit refresh behavior.
- `change-creation`: `rasen new change` gains the `--proposal <text>` flag that seeds `proposal.md`, making the created change active by the workflow's definition.

## Impact

- `src/core/management-api/`: new `submit.ts` (subprocess bridge) + router accepts POST on `/api/v1/changes`; `server.ts` composition untouched in shape.
- `src/commands/workflow/new-change.ts`, `src/cli/index.ts`: `--proposal` flag.
- `src/core/completions/command-registry.ts` + `src/locales/{en,ja}.json`: flag registry + locale entries (PR #10 parity tests enforce).
- `packages/ui/src/`: board form component, `api/client.ts` `createChange`, wire types.
- Specs: 1 new, 3 deltas. No config-api changes; slice 1 read behavior, identity headers, and `getActiveChangeIds` scope all preserved.
