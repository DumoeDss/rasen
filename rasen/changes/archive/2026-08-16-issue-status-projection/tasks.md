## 1. Module foundation

- [x] 1.1 Create `src/core/issue-status/types.ts`: closed vocabularies (`IssuePhase`, `IssueHealth`, `IssueNodeObservation`), `IssueProgress`, `IssueNodeStatus`, `IssueStatusProblem`, `IssueStatus` (with `runStateVisibility` and `complete`), and the `ProjectIssueStatusInput` shape from design D2 — explicit path inputs only, no ambient reads.
- [x] 1.2 Create `src/core/issue-status/projection.ts` skeleton + `index.ts` barrel exporting the projection and types; wire no CLI yet.

## 2. Node observation from real run-state

- [x] 2.1 Implement the per-node run-state locator (design D3): committed claimant alias (fallback `node.changeAlias`), `ephemeraDir(executionRoot, alias)`, `resolveChangeWorkDir(…, {ensure:false})` via injectable `workDirFor`, planning change dir tail, then `resolveRunStateLocation` / `resolvePortfolioStateLocation`. Use `path.join` throughout; no pattern matching — explicit alias per node.
- [x] 2.2 Implement the observation mapping table (design D4): portfolio-authoritative-where-present, stage statuses otherwise; `finalized` from committed evidence first; terminality = all stages/children done|skipped (+ delivery `done`); escalations split per D5 (`failed` vs `waiting-human`); invalid run-state ⇒ `unknown` + `IssueStatusProblem` naming file and reason.
- [x] 2.3 Unit tests over a real-Git store fixture (`store-workspace-fixture`) plus real run-state files written into a temp execution root: cover every table row, the detailed-vs-absent distinction, and `unknown` on a corrupt `auto-run.json`.

## 3. Tri-axis derivation

- [x] 3.1 Implement phase precedence (`done > review > active > ready > planning`) with the planning edge cases (no revision, unreadable revision + problem, zero nodes, all-intent) and `done` gated on operator-resolved state only.
- [x] 3.2 Implement health precedence (`failed > waiting-human > healthy`, `review ⇒ waiting-human`) and progress counting (`finalized | run-terminal` count; unreadable latest revision ⇒ `progress: null` with reason; carry `complete` and `statusProblems` from the underlying detail).
- [x] 3.3 Unit tests: the derivation table as scenarios from `specs/issue-status-projection/spec.md` (failure-among-running, serial-chain healthy, review-waits-for-human, done-not-from-archive, 1-of-3 progress, unchanged-evidence determinism, no-write read).

## 4. CLI surface

- [x] 4.1 In `src/commands/store-issue.ts`: resolve the execution root best-effort for `list`/`show` (non-throwing; degrade to visibility-none), resolve each issue's latest plan for `list`, and compute status via the new module.
- [x] 4.2 Enrich renderers: `list` line gains `phase/health completed/total`; `show` gains the status block with one line per node (id, kind, alias, observation, blockedBy, diagnostic); keep English literals consistent with the file's existing style; no new options, no locale changes.
- [x] 4.3 Additive `--json` payloads: `status` object on both commands carrying phase, health, progress, per-node observations, problems, and run-state visibility — same facts as the human form.
- [x] 4.4 CLI tests (real `runCLI` + fixture): human/JSON parity for list and show, status column presence, degraded mode from an unrelated cwd (visibility labelled, committed evidence still derived), corrupt run-state surfaced as a problem, exit codes unchanged on success paths.

## 5. Guards and cross-platform

- [x] 5.1 Add `test/core/issue-status/issue-status-read-only-guard.test.ts` in the `store-query-read-only-guard` family: a status projection mutates nothing on disk (issue records, plan revisions, run-state files byte-identical).
- [x] 5.2 Verify path handling cross-platform: expectations built with `path.join`, Windows-semantics ephemera paths asserted, and the existing Windows CI leg green (config rule: file-path changes need Windows verification). — local assertions done (all suites green on win32; runStatePath expectations are path.join-built Windows paths); CI leg pending push

## 6. Dogfood — the portfolio as Issue #1

- [x] 6.1 Stand up the dogfood store per design D10 (setup inside `<worktree>/.rasen/dogfood/`, layout-v2 declaration with the named fallback, `add-project` membership only, `target-line add|set-ref`), and author + commit the three child Changes in the store (store-scoped `new change`, fallback: explicit-list copy + seeded identity).
- [x] 6.2 `store issue new issue-layer-phase1` + read status ⇒ `planning` (receipt 1); publish the Execution Plan naming the three committed instances; read status from the worktree ⇒ `active/healthy 0/3` with child 1 `in-flight` from the live run-state (receipt 2 — the real transition).
- [x] 6.3 During verify, re-read status after a real stage transition of the live portfolio and capture the changed projection (receipt 3); store all receipts under `evidence/` with commands and outputs; `store remove` the dogfood store afterward, receipts preserved.

## 7. Bookkeeping

- [x] 7.1 Update the `architecture-index` skill: `src/core/issue-status/` in the module map + `detail/quick-locate.md` row + the store-engine module detail file.
- [x] 7.2 Run `node bin/rasen.js validate issue-status-projection` and the full affected test set (`issue-status` units + store-issue CLI suites) green; confirm no version numbers changed and `src/core/pipeline-registry/` is byte-identical to its pre-change state.
