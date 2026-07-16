## Why

`rasen agent context --latest` can only discover Claude Code transcripts: it derives a Claude projects directory from the cwd and scans it. On a Codex CLI host the read side already works end-to-end (a Codex rollout probed via `--transcript` reports real occupancy), but a Codex LEAD has no way to *find* its own latest rollout — so its self-probe always lands in the `{available: false}` degradation that fix-codex-host-compat (D2) defined, and the LEAD flies blind on real context occupancy. This closes that one parity gap: latest-rollout discovery.

## What Changes

- `rasen agent context --latest --runtime codex` discovers the newest Codex rollout for the current project: it scans the Codex sessions tree (`$CODEX_HOME/sessions`, default `~/.codex/sessions`) and selects the newest-by-mtime rollout whose recorded session cwd matches the probe cwd, excluding forked-child (subagent) rollouts — the Codex analog of Claude's "newest main-session transcript for this project's directory".
- Discovery is explicit only: `--latest` without `--runtime codex` keeps its current Claude-only behavior. No implicit Claude-then-Codex fallback — on a machine with both runtimes' sessions present, silently picking the wrong host's session is worse than reporting unavailable.
- `--dir` composes with `--runtime codex --latest` by overriding the sessions root that is scanned (parallel to how it overrides the Claude projects base directory today).
- Environmental absence under `--runtime codex --latest` (no sessions tree, no rollouts, or none matching the probe cwd) degrades exactly per the existing D2 contract: exit 0, `{"available": false, "reason": "no-transcript", "detail": ...}` naming the probed location.
- The Claude-side unavailable `detail` message gains a pointer to `--runtime codex --latest`, so a Codex LEAD that hits the degradation learns the discovery path exists.
- The auto/orchestration workflow templates' probe guidance gains a one-line Codex-host note (use `--latest --runtime codex`), the same writer-guidance pattern as fix-codex-host-compat D4.

Out of scope: session relay / warm continuation on the Codex side (parity #13), any implicit runtime auto-detection for `--latest`, version bumps.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-agent-context`: the "Probe the current main session" behavior extends to Codex hosts — `--latest --runtime codex` discovers the newest matching rollout in the Codex sessions tree; `--dir` maps to the sessions root under that runtime; the graceful-degradation requirement covers Codex-side environmental absence.

## Impact

- `src/core/agent-context.ts` — a Codex-side latest-rollout finder alongside `findLatestMainTranscript`; `resolveTranscriptPath` routes on the validated runtime; unavailable-detail message extended.
- `src/core/codex/` — reuses `resolveCodexHome` and the existing fixed-depth sessions-tree scan pattern (`rollout.ts`); may export a shared scan helper.
- `src/core/templates/workflows/auto.ts`, `_orchestration.ts` — one-line probe-guidance addition; `test/core/templates/skill-templates-parity.test.ts` hash updated manually.
- `src/commands/agent.ts` / CLI wiring — no flag changes (all flags already exist); behavior of the existing flag combination changes.
- Tests: unit coverage for the finder (cwd matching, fork exclusion, mtime ordering, absence cases) and CLI-level coverage for the new combination; `runCLI`-style tests need `pnpm run build` first (dist/ premise).
