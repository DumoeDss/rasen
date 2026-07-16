# Design: codex-latest-probe

## Context

`rasen agent context` already reads both transcript kinds: `detectTranscriptKind` routes to `computeContextFromRollout` (Codex, via `readRolloutOccupancy` — E03-pinned `token_count` events with inline `model_context_window`) or `computeContextFromTranscript` (Claude). What is missing is DISCOVERY: `resolveTranscriptPath` (`src/core/agent-context.ts:379`) only knows `findLatestMainTranscript(baseDir)` over the cwd-derived Claude projects directory. A Codex LEAD probing itself with `--latest` therefore always hits fix-codex-host-compat's D2 degradation (`{available:false}`), never a real number.

Verified facts this design rests on (this worktree, HEAD of `feat/codex-latest-probe`):

- Codex rollouts live at `<codexHome>/sessions/<YYYY>/<MM>/<DD>/rollout-<local-ts>-<threadId>.jsonl` (`src/core/codex/rollout.ts` module doc; local-time dating live-verified there). `resolveCodexHome()` (`src/core/codex/codex-home.ts`) handles `CODEX_HOME` env override, default `~/.codex`. `scanForRollout` already implements the bounded fixed-depth tree walk.
- A rollout's first row is `session_meta`; its payload carries `cwd` (live-verified on this machine: `{"type":"session_meta","payload":{"session_id":..., "cwd":"/Users/sayo/repos/rasen-site", ...}}`) — a per-session project identity.
- Forked child (subagent) rollouts carry `forked_from_id` and `parent_thread_id` in `session_meta` (E11 Finding 3) — the Codex analog of Claude's `agent-*.jsonl` subagent files.
- D2 (archived `2026-07-16-fix-codex-host-compat`): environmental absence under `--latest` throws `AgentContextUnavailableError`, which `probeAgentContextSafe` maps to exit-0 `{available:false, reason:"no-transcript"}`. Input errors stay hard.
- All CLI flags already exist (`--latest`, `--runtime`, `--dir`, `--limit`, `--transcript`); no Commander surface changes.

## Goals / Non-Goals

**Goals:**
- `rasen agent context --latest --runtime codex` resolves the newest Codex rollout belonging to *this project's own session* and probes it with the existing rollout reader.
- Absence composes with D2 unchanged: exit 0 `{available:false}` naming what was probed.
- Templates tell a Codex LEAD the discovery incantation exists.

**Non-Goals:**
- Session relay / warm continuation on the Codex side (parity #13).
- Implicit runtime fallback for `--latest` (no Claude-then-Codex cascade).
- Any change to the read side (`computeContextFromRollout`, `readRolloutOccupancy`) or to `--transcript` behavior.
- Version bumps.

## Decisions

### D1 — Explicit discovery only: `--runtime codex` gates the Codex scan

`--latest` without `--runtime` keeps today's Claude-only behavior; `--latest --runtime codex` scans the Codex sessions tree. Alternative considered: implicit fallback (Claude probe unavailable → try Codex). Rejected: on a machine with both runtimes' sessions (this one, for instance), an implicit pick answers "how full is MY context" with possibly someone else's session — a silently wrong number is strictly worse than an honest `available:false`, and the LEAD always knows its own runtime (its instructions are generated per-runtime). `--runtime` also already has exactly the right semantics: it forces the reader today; extending it to force the *finder* is the same contract one step earlier. As a cheap bridge, the Claude-side unavailable `detail` gains "…on a Codex host, pass --runtime codex with --latest", so even an untold LEAD gets routed on first contact.

### D2 — "Latest main session" on Codex = newest mtime, cwd-matched, fork-excluded

New core function (e.g. `findLatestRollout(sessionsDir, cwd)`) in `agent-context.ts`, reusing the fixed-depth `sessions/<Y>/<M>/<D>` walk pattern from `rollout.ts`:

1. Collect all `rollout-*.jsonl` files in the tree (same bounded three-level walk as `scanForRollout`; tolerant `safeReadDir` semantics), sorted by mtime descending.
2. Walk that order candidate-lazily — each inspected candidate's file is read whole (`readJsonlLines` convention) to obtain its first non-empty line (`session_meta`); the laziness is early termination of the walk, not a partial file read: **skip** rollouts whose payload carries `forked_from_id`/`parent_thread_id` (subagent threads — the analog of excluding `agent-*.jsonl`), and **accept** the first whose `payload.cwd`, `path.resolve`d, equals the `path.resolve`d probe cwd.
3. No match → throw `AgentContextUnavailableError` naming the sessions root and the cwd filter.

Why cwd matching rather than bare newest-mtime: Claude's `--latest` is scoped to "this project's sessions" by construction (the projects dir is derived from cwd); the bare-newest alternative loses that scoping and, on a machine where rasen's own codex exec bridge is running workers concurrently, would happily return a *worker's* rollout mid-pipeline. `session_meta.cwd` restores exact parity semantics for the price of one file read per inspected candidate — and the lazy newest-first walk means in practice one or two reads, since the probing LEAD's own rollout is among the newest. A malformed/unreadable first line skips the candidate (tolerant-reader convention, rollout.ts D8).

Known residual (accepted, documented in code): a bridge worker exec'd with the *same* cwd as the LEAD and touched more recently would win the mtime race. Step-0 probes run before workers spawn; workers normally run in worktrees (different cwd); and the failure is bounded — a plausible occupancy number for a sibling session on the same project, not garbage.

### D3 — `--dir` overrides the sessions root under `--runtime codex`

Under `--runtime codex --latest`, `--dir` replaces `path.join(resolveCodexHome(), 'sessions')` as the scanned root; the cwd filter still applies (`--dir` answers "where are sessions stored", the cwd answers "whose session"). Alternative — `--dir` pointing at a single day directory or disabling the cwd filter — rejected: it forks the flag's meaning per runtime beyond "override the base directory `--latest` searches", which is its documented Claude semantics. Tests inject `cwd` via the existing `ProbeOptions.cwd` seam, so fixtures don't need to fake `process.cwd()`.

### D4 — Absence reuses the D2 unavailable contract verbatim

Every discovery miss — sessions root missing, empty tree, no rollout with matching cwd (all non-fork candidates filtered out included) — throws `AgentContextUnavailableError` from the finder, flowing through the existing `probeAgentContextSafe` catch to exit-0 `{available:false, reason:"no-transcript", detail}`. No new reason code: a threshold consumer's handling ("record unavailable and proceed") is identical, and the `detail` string carries the human-relevant difference. Explicit `--transcript` failures remain hard errors, unchanged.

### D5 — One-line template guidance, D4-pattern (fix-codex-host-compat)

`auto.ts` / `_orchestration.ts` probe guidance (Step 0 and the self-probe guidance that cites `agent context --latest`) gains one line: on a Codex host, pass `--runtime codex` with `--latest` to discover the live rollout instead of recording unavailable. Template-only text change; `test/core/templates/skill-templates-parity.test.ts` hashes bumped manually by running the test and copying the diff values (repo convention). Like the previous change, this guidance edit is design/tasks scope, not a spec requirement.

### D6 — Placement: finder lives in `agent-context.ts`, walk helper shared from `codex/rollout.ts`

The generic "walk the dated tree, collect candidates" loop is exported from `rollout.ts` (refactor of `scanForRollout`'s body into a shared enumerator it also uses) rather than duplicated. The *policy* (cwd match, fork exclusion, unavailable error) stays in `agent-context.ts` next to `findLatestMainTranscript`, keeping the two runtimes' "find latest" siblings and keeping `rollout.ts` policy-free. Alternative — whole finder in `codex/`: rejected; `AgentContextUnavailableError` and the probe's semantics are agent-context concerns, and `codex/` modules deliberately know nothing about the probe contract.

## Risks / Trade-offs

- [First-line reads on a big sessions tree] → lazy newest-first walk stops at the first match; only misses (already-degraded cases) pay the full scan. Tree depth is fixed; no unbounded recursion.
- [`session_meta.cwd` shape drift on newer codex-cli] → behavior pinned to `CODEX_CLI_VERSION_PREMISE` (0.144.1) like all of `src/core/codex/`; a missing `cwd` field skips the candidate, degrading to `available:false` rather than mis-selecting.
- [Same-cwd concurrent sibling session wins mtime] → accepted residual per D2; documented at the finder.
- [Windows] → all paths via `path.join`/`path.resolve`; cwd comparison uses resolved absolute paths (case sensitivity follows the platform's `path.resolve` output — exact string compare, consistent with how the Claude slug derivation already treats the cwd string).
- [Template hash churn] → manual parity bump is an established convention; the test output supplies the exact expected values.

## Migration Plan

Purely additive behavior behind an existing flag combination that previously always degraded to `available:false`. No consumer could have relied on that combination succeeding differently. Rollback = revert the commit.

## Open Questions

- (none blocking)
