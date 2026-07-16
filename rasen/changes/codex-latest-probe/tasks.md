# Tasks: codex-latest-probe

## 1. Shared rollout enumeration (design D6)

- [x] 1.1 In `src/core/codex/rollout.ts`, refactor `scanForRollout`'s fixed-depth tree walk into an exported enumerator (e.g. `listRolloutFiles(sessionsDir): Array<{path, mtimeMs}>`) that collects all `rollout-*.jsonl`-suffixed files with tolerant `safeReadDir`/stat semantics; keep `scanForRollout` behavior identical by reimplementing it on the enumerator (existing rollout tests stay green)

## 2. Codex latest-rollout finder (design D1, D2, D3, D4)

- [x] 2.1 In `src/core/agent-context.ts`, add `findLatestRollout(sessionsDir, cwd)`: sort enumerated rollouts by mtime descending; lazily read each candidate's first non-empty line; skip non-`session_meta` / unreadable first lines, skip payloads carrying `forked_from_id` or `parent_thread_id`, accept the first whose `payload.cwd` resolves (`path.resolve`) equal to the resolved probe cwd; on no match throw `AgentContextUnavailableError` naming the sessions root and cwd filter
- [x] 2.2 Route discovery in `resolveTranscriptPath`: when `latest` and validated runtime is `codex`, resolve the base as `--dir` override else `path.join(resolveCodexHome(), 'sessions')`, and call `findLatestRollout` with the probe cwd; runtime absent/`claude` keeps the existing Claude path (note: `probeAgentContext` must pass its validated runtime into resolution)
- [x] 2.3 Extend `findLatestMainTranscript`'s unavailable messages with the Codex pointer ("on a Codex host, pass --runtime codex with --latest") per spec

## 3. Tests

- [x] 3.1 Unit tests for `findLatestRollout` with fixture sessions trees (all paths built with `path.join`, cwd expectations via `path.resolve` so they hold on Windows): newest-mtime wins among cwd matches; newer rollout with a different `cwd` is skipped; forked-child (`parent_thread_id`) rollout is skipped; malformed first line is skipped; missing/empty sessions root and no-cwd-match each throw `AgentContextUnavailableError`
- [x] 3.2 Probe-level tests: `probeAgentContextSafe({latest:true, runtime:'codex', dir, cwd})` returns real occupancy from a discovered fixture rollout (kind detection still lands on the codex reader); absence returns `{available:false, reason:'no-transcript'}`; `--dir` override retargets the sessions root; Claude `--latest` behavior unchanged and its unavailable detail mentions the Codex pointer
- [x] 3.3 CLI-level test for `agent context --latest --runtime codex --json` (success and unavailable exit 0); remember `runCLI`-style tests execute `dist/` — run `pnpm run build` first
- [x] 3.4 Confirm the full suite passes locally and note that CI's node matrix covers Windows path handling for the new finder (no hardcoded separators anywhere in code or tests)

## 4. Template guidance (design D5)

- [x] 4.1 Add the one-line Codex-host probe note (use `--runtime codex` with `--latest`) to the probe guidance in `src/core/templates/workflows/auto.ts` and `src/core/templates/workflows/_orchestration.ts`
- [x] 4.2 Manually bump the affected hashes in `test/core/templates/skill-templates-parity.test.ts` by running the test and copying the reported diff values; verify the parity test passes

## 5. Verification

- [x] 5.1 `pnpm run build && pnpm test` green in the worktree
- [x] 5.2 Live smoke on this machine: from a directory with a real Codex session (e.g. one under `~/.codex/sessions`), `node dist/cli/index.js agent context --latest --runtime codex --json` reports a real rollout; from a directory with none, it prints the unavailable shape and exits 0
