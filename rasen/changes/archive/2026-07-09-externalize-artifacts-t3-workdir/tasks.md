# Tasks: externalize-artifacts-t3-workdir

> Shared-working-tree discipline (applies to EVERY task): before editing or committing any file — especially under `src/core/templates/**` — run `git status --porcelain` on it and touch it only if clean of foreign modifications; commit with explicit pathspec (`git commit -- <paths>`) and verify with `git show --stat`. If foreign dirt appears on a needed file, wait or escalate; never commit or revert foreign edits.
>
> Groups are ordered by dependency but internally self-contained, so apply can hand off cleanly at any group boundary: 1 (foundation) → 2 (CLI exposure) → 3 (CLI readers) → 4-5 (template writers) → 6 (template readers/compat) → 7 (regeneration) → 8 (verification). After touching `src/`, always run `node build.js` before CLI-spawning tests (`ensureCliBuilt` only rebuilds when `dist/` is missing).

## 1. Foundation: work-dir resolution helper

- [x] 1.1 Create `src/core/change-work.ts` exporting `resolveChangeWorkDir(projectRoot, changeName, {globalDataDir?, ensure?}) → Promise<string | null>`: probe first via `resolveProjectHome(projectRoot, {ensure:false})` (pure read, no lock); only when that returns null AND `ensure` is true, call `resolveProjectHome(projectRoot, {ensure:true})`; return `home.workDir(changeName)`; never pre-create the directory. Use `FileSystemUtils`/platform path joins only (design D1).
- [x] 1.2 Unit tests for the helper (per-test temp `globalDataDir`, store-code isolation pattern): probe miss returns null without any write; `ensure:true` mints once and second call takes the probe path (no registry write — assert registry file mtime/content unchanged); resolved path equals the frozen `<home>/changes/<name>/work` layout via `path.join`; works for a store-root `projectRoot`.

## 2. CLI exposure: workDir in change-scoped payloads

- [x] 2.1 `src/commands/workflow/status.ts`: resolve workDir with `ensure:false` semantics (probe-only — status must not write; design D2) and add top-level `workDir` to the `--json` payload (absent when null, never null/empty); add a `Work dir:` line to the human output when present.
- [x] 2.2 `src/commands/workflow/instructions.ts`: both `instructionsCommand` and `applyInstructionsCommand` resolve workDir with `ensure:true` (the designated minting surface, design D2) and add top-level `workDir` to their JSON payloads; mention the path once in the text renderers.
- [x] 2.3 `src/commands/context.ts`: add `machineHome` (probe-only) to the working-set root object in `--json` output and a line in the human listing; omitted entirely when unregistered.
- [x] 2.4 Tests: status JSON carries `workDir` for a registered project and omits it (with zero writes) for an unregistered one; instructions JSON mints identity on first call in a fresh project (config gains `projectId`, home exists) and carries `workDir`; apply-instructions parity; context `machineHome` present/absent. Windows path expectations built with `path.join`.

## 3. CLI readers: run-state resolution in pipeline resume

- [x] 3.1 `src/core/pipeline-registry/run-state.ts` + `portfolio-state.ts`: add candidate-resolution helpers (e.g. `resolveRunStateLocation(changeDir, workDir?)` returning `{dir, path} | null` with workDir-first read order); keep existing `readRunState(changeDir)`/`writeRunState(changeDir, ...)` signatures working unchanged.
- [x] 3.2 `src/commands/pipeline.ts` `resume`: probe workDir (`ensure:false`), read portfolio-state then run-state through the candidate helpers, and add `runStateDir` to the JSON result (both portfolio and single-change shapes) naming the directory actually read; human output mentions it. No repository/registry writes on resume.
- [x] 3.3 Tests: resume finds run-state in workDir (new-style change); finds legacy run-state in changeDir with `runStateDir` = change dir (fallback scenario from the `opsx-pipeline-registry` delta); workDir copy wins when both exist; store-root resume unaffected; portfolio-state same matrix.

## 4. Template writers: run-state, handoff, orchestration playbook

- [x] 4.1 `src/core/templates/workflows/_orchestration.ts`: teach the playbook the two-location blackboard — `changeRoot` (T2 review material) vs `workDir` (ephemera) both from `rasen status --change <n> --json`, with the compact sticky-legacy fallback rule stated ONCE (read workDir-first; a file already in the change dir stays there; no `workDir` → change dir); switch the Step F run-state contract (`<changeRoot>/auto-run.json` → resolved work dir), the portfolio-run planner-pointer wording, the Step L goal-run/`loop.runArtifact` location, Step H handoff record paths, and the inter-stage blackboard sentence (reports listed there move to the work dir).
- [x] 4.2 `src/core/templates/workflows/handoff.ts`: handoff document path (`handoff/lead-<n>.md`), numbering scan, `relay-prompt.txt`, and the `sessionHandoff` run-state update all target the resolved work dir with the fallback rule; the no-active-change fallback (`rasen/handoff/<topic>.md`) stays unchanged (out of scope).
- [x] 4.3 `src/core/templates/workflows/auto.ts`: portfolio run-state (`portfolio-run.json`) location wording follows the resolved work dir.
- [x] 4.4 `src/core/templates/workflows/goal-command.ts`, `goal-iterate.ts`, `goal-report.ts`: `goal-run.json` / run artifact and implementer-handoff paths reference the resolved work dir (LEAD single-writer invariant unchanged). (Review finding F2: `goal-report.ts` had zero diff when this was first ticked despite the claim — fixed in the F1/F2 review-response round; its Input/Constraints sections now name the work-directory location for `goal-run.json` with sticky-legacy fallback.)

## 5. Template writers: reports (ship, verify, experts)

- [x] 5.1 `src/core/templates/workflows/ship.ts`: write `ship-log.md` to the work dir (fallback rule); pre-flight verification-evidence and test-skip-evidence reads check work dir first, change dir fallback.
- [x] 5.2 `src/core/templates/workflows/verify-change.ts` (both sites): `verification-report.md` written to the work dir with fallback; keep the `VERIFY VERDICT:` contract wording intact.
- [x] 5.3 `src/core/templates/workflows/verify-enhanced.ts`: report read/write paths (`review-report.md`, `cso-report.md`, `qa-report.md`, `design-review-report.md`) move to the work dir with fallback.
- [x] 5.4 `src/core/templates/experts/_shared.ts`: the canonical `<skill>-report.md` rule in the dispatched-mode PREAMBLE section points at the work dir (CLI-reported `workDir`, change-dir fallback); standalone-path prohibition unchanged.
- [x] 5.5 Dispatched-mode report lines in `src/core/templates/experts/{review,cso,qa,qa-only,benchmark,design-review}.ts`: "in the change directory" → the resolved work dir wording (consistent with 5.4).
- [x] 5.6 `src/core/templates/workflows/review-cycle.ts`: cycle report (`review-cycle-report.md`) and its "lives alongside" sentence point at the work dir.

## 6. Template readers + compat guidance

- [x] 6.1 `src/core/templates/workflows/archive-change.ts` (both sites): the verification-verdict gate and ship-log delivery check read from the work dir (`workDir` from status JSON) with change-dir fallback; archive timing/destination language untouched (children 3/4 own it).
- [x] 6.2 `src/core/templates/workflows/retro.ts`: change-scoped retro reads ephemera (reports, ship-log) from the work dir with legacy fallback; T2 artifacts and `retro.md` output location unchanged.
- [x] 6.3 Q2 guidance: add the one-line bulky-raw-research rule (raw dumps → work dir `research/`, distilled conclusions stay committed) to the propose and explore templates (`propose.ts`, `explore.ts`).
- [x] 6.4 Sweep check: grep `src/core/templates/**` for remaining change-dir-relative references to the ephemera set (`auto-run.json`, `portfolio-run.json`, `goal-run.json`, `handoff/`, `ship-log.md`, `verification-report.md`, `*-report.md`, `relay-prompt.txt`) and fix stragglers (e.g. `ff-change.ts`, `continue-change.ts`, `apply-change.ts`, `new-change.ts`, `office-hours.ts` if any) — T2/T4 references stay.

## 7. Regeneration and parity

- [x] 7.1 Run the build → update flow to regenerate `.claude/skills/**` and `.codex/**` from templates; hand-edit nothing generated. (`.codex/` is not a configured delivery target in this repo — nothing to regenerate there.)
- [x] 7.2 Update `test/core/templates/skill-templates-parity.test.ts` expected hashes for exactly the affected templates; `npx vitest run test/core/templates/` passes with only those hashes moved.

## 8. Verification

- [x] 8.1 `node bin/rasen.js validate externalize-artifacts-t3-workdir` passes; `pnpm build` clean. (`pnpm` itself is broken machine-wide in this environment — "packages field missing or empty" on `pnpm --version` even, pre-existing and unrelated to this change; used `node build.js`, the equivalent underlying command, which is clean.)
- [x] 8.2 Full `pnpm test` green (Windows: isolate-rerun CLI-spawning EBUSY/ENOTEMPTY flakes after clearing stale tmp dirs before trusting a failure; `node build.js` first so spawned CLI runs fresh code). (Used `npx vitest run` directly — same underlying command as `pnpm test`, since `pnpm` itself is broken; 123 files / 2245 tests passed, 22 skipped, 0 failed, no flakes.)
- [x] 8.3 Live smoke on a scratch project (per-test/scratch `globalDataDir`): init → new change → confirm instructions JSON reports `workDir` → write run-state + a report there per the templates → `pipeline resume` reads it (`runStateDir` = work dir) → `git status` shows no ephemera; repeat with a pre-seeded legacy `auto-run.json` in the change dir and confirm sticky-legacy behavior end to end. All verified live against the built CLI: init registered a machine home, instructions reported `workDir`, `git status` showed only proposal.md/.openspec.yaml/config.yaml (zero ephemera), `pipeline resume` reported `runStateDir` = work dir for the new-style change and = change dir for the legacy-seeded one.
- [x] 8.4 Cross-platform check: new/changed tests build all expected paths with `path.join`; no hardcoded separators; note Windows CI matrix backfill is a known-open item — do not gate on it, but keep tests Windows-safe.
