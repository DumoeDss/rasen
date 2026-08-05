# Verification Report: standalone-retention-context-freeze

Schema: `spec-driven`. Verified 2026-08-05 on branch `feature/standalone-retention-context-freeze` (uncommitted working tree).

Artifacts verified against: `proposal.md`, `design.md` (D1-D8 + ADR-1/2/3), `specs/retention-context-preparation/spec.md` (6 ADDED requirements), `specs/opsx-pipeline-registry/spec.md` (2 MODIFIED + 1 ADDED), `tasks.md` (30 items), and the source report `local_docs/rasen-retention-standalone-run-state/report.md` (8 acceptance criteria + regression matrix).

Verification was performed by two independent audits (a read-only spec-coverage matrix and an adversarial diff review) plus a CLI end-to-end reproduction of the reported blocker. The author did not self-certify coverage.

## Summary

| Dimension | Status |
|---|---|
| Completeness | 30/30 tasks complete; 9/9 requirements implemented |
| Correctness | 26/26 scenarios covered; 2 Blockers found and fixed |
| Coherence | D1-D8 followed, with 3 departures recorded as ADR-1/2/3 and each justification re-verified against the code |

`VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0`

All findings raised during verification were fixed and re-verified in this same session; none are left open.

## Findings raised and resolved

### Blocker (2) — both fixed

**B1. `SessionRow` leaked a raw i18n template token for a pipeline-less run-state.**
`packages/ui/src/components/SessionRow.tsx:86` called `t('session.run_no_stages', { pipeline })` unconditionally. Once `RunStateSchema.pipeline` became optional (`src/core/pipeline-registry/run-state.ts:200`), a change prepared by `rasen retain prepare` — which writes `{ knowledgeContext }` only — reached that branch with `pipeline === undefined`. `formatMessage` (`packages/ui/src/i18n/format.ts:16`) leaves a placeholder intact when its value is `undefined`, so the session row rendered the literal string `"{pipeline} — no stages reported yet."` to the user.
Fixed: the note now branches on the pipeline and renders a new `session.run_no_pipeline` message (added to all three UI locales) when none is named. Regression test: `packages/ui/test/components/task-detail-page.test.tsx` — *reports a pipeline-less run-state without leaking a template placeholder*. Proven load-bearing: restoring the unguarded call makes it fail with `expected '{pipeline} — no stages reported yet.' not to contain '{pipeline}'`.

**B2. `describeStage` returned `undefined` from a `: string` function, blanking the session label.**
`packages/ui/src/components/RunningSessionsMenu.tsx:31` was `return active ? \`${pipeline} · ${active}\` : pipeline;`. With no pipeline and no in-progress stage it returned `undefined`, which Preact renders as nothing — bypassing the `entry.session.changeName ?? noChangeLabel` fallback that exists two lines above precisely to avoid an empty label. The identical expression in `packages/ui/src/board/columns.ts` *was* guarded by task 2.5; this sibling copy was missed.
Fixed: same guard added before computing `active`. Regression test: `packages/ui/test/components/running-sessions-menu.test.tsx` — *falls back to the change label when the joined run-state names no pipeline*. Proven load-bearing: removing the guard makes it fail with `expected 'task a1m 5s' to contain 'change-a'`.

**Root cause of both, also fixed.** `packages/ui/src/api/types.ts:490` is the hand-maintained mirror of `src/core/management-api/wire-types.ts` and still declared `pipeline: string`. Because `src/core/management-api/runs.ts:136` serves the parsed `RunState` verbatim, the stale mirror is what hid both readers from `tsc` — both typechecks passed clean while the defect shipped. Relaxing the mirror to `pipeline?: string` surfaced exactly these two readers and no others.

### Major (1) — fixed

**M1. Stale wire mirror.** Covered above: `packages/ui/src/api/types.ts` now declares `pipeline?: string` with a comment stating why every reader must handle its absence.

### Minor (8) — all fixed

- **Crash-safety tests were proxies, not interruption tests.** The only test performed two *successful* writes and asserted no `.tmp` survived — it would still pass against a truncate-then-write that tears. Added `describe('interrupted writes (design D5)')` covering both writers through the shared helper, injecting a `renameSync` fault via the `vi.mock('node:fs', importOriginal)` pattern (ESM forbids `vi.spyOn` on a module namespace export). Decisive anti-tautology proof: under a truncate-then-write sabotage the pre-existing test still **passed** while all three new tests **failed** on real torn bytes.
- **Temp file leaked when `writeFileSync` itself failed.** `writeRunStateFileAtomically` cleaned up only on a failed `renameSync`. A partial temp write (ENOSPC/EACCES) left `.auto-run.json.<pid>.<ts>.tmp` behind, which `classifyEphemera` preserves as `unknown` and which would therefore block the archive cleaner. Both `writeFileSync` and `renameSync` are now inside one try/catch that removes the temp before rethrowing.
- **An untested refusal arm of `updateRunStateKnowledgeContext`.** The arm where `record.knowledgeContext` exists but fails `FrozenKnowledgeContextSchema` (a hand-written `null`, or a truncated ref) was uncovered — the difference between preserving and clobbering a LEAD's record. Two cases added, both asserting `kind === 'invalid'` and a byte-identical file.
- **`Ambiguous ownership blocks preparation` was never actually reached.** The only ownership-failure test used an unregistered orphan root and asserted `/^knowledge_owner_/`, which resolves to `knowledge_owner_stale` — the ambiguous arm was never exercised. Added a store-root fixture that reaches `knowledge_owner_ambiguous` exactly, and tightened the existing assertion to exact code equality.
- **`Stale ownership blocks preparation` never exercised the recorded-owner arm.** The spec says "the **recorded** or resolved owner". Added a case with a `knowledgeContext` naming an unregistered `projectId`, asserting `knowledge_owner_stale` and a byte-identical file.
- **Mode/authorization agreement was only tested in the passing direction.** Added the refusal direction: under an effective `report` mode, `prepare` reports `retention: 'report'` and `knowledge apply --run-state-dir <the reported dir>` fails `codify_required` — binding the two surfaces for a non-`codify` mode.
- **No positive test for the second selector pair** (ADR-2's whole justification). Added a case where the planning root resolves to a store while `--owner-project` names a different registered project, asserting `planningRoot` follows the root and `owner` follows the selector.
- **Refusal messages were hardcoded English**, so the `ja`/`zh-cn` translations this change added for `invalidRunState` / `planningRootMismatch` / `writeRefused` were unreachable. Refusals now carry a typed catalog key alongside the English message: `--json` reports the English string (a machine contract must not shift with locale) and the human line renders in the caller's locale. Verified live: `RASEN_LANG=ja` prints the Japanese refusal while the JSON `message` stays English.
- **A genuine write I/O failure fell through to the generic `retain_error`** with no `runStatePath`, while the shipped workflow instructs the worker to "report the condition it named". Both write sites now map a thrown filesystem error to `retention_context_write_failed` with `{ runStatePath, reason }`. Verified live with a `chmod 500` ephemera directory.
- **`sessionStage`'s new pipeline-less branch had no test.** Added one to `packages/ui/test/board/columns.test.ts`.
- **`retention_owner_selector_conflict` was the only refusal still unlocalized.** Added `retain.messages.ownerSelectorConflict` to all three locales and routed it through the same mechanism, so the refusal surface is uniform.

### Trivial (1) — fixed

- `tasks.md` item 3.6 named a `hasPipeline` payload field the implementation never emitted (it emits `pipeline: pipeline ?? null`, which `docs/cli.md` already documented). Task text corrected to `pipeline`.

## Coherence

D1-D8 are followed. Three departures were recorded in `design.md` under "Deviations proven during implementation"; each justification was re-verified against the code during this audit and all three hold:

- **ADR-1** — `writeFileAtomically` is async while `writeRunState` is synchronous with synchronous callers, so atomicity is a synchronous temp-write + `renameSync` (the `writeSessionRuntimeContext` precedent). Confirmed: `run-state.ts` `writeRunState` is `: void` and its helper is synchronous throughout.
- **ADR-2** — root-selection `--project` addresses only a `store add-project`-registered project, while knowledge `--project` addresses any project identity; they are different namespaces, so the selectors are separate flag pairs. Confirmed at `root-selection.ts:705-707`.
- **ADR-3** — the identity resolver derives both planning and ownership from one directory, so passing a store root as `launchDirectory` misreports a store-planned change as `knowledge_owner_ambiguous`. `process.cwd()` is used with an explicit `retention_planning_root_mismatch` guard. Confirmed at `context.ts:799-804`; both arms are tested.

## Acceptance criteria from the source report

| # | Criterion | Evidence |
|---|---|---|
| 1 | A change with no `auto-run.json` and mode `codify` can initialize a frozen project context through a documented CLI operation | CLI e2e step 1; `retain-prepare.test.ts` *freezes a durable context…* |
| 2 | An accepted project candidate can run `knowledge apply` using the returned `runStateDir` | CLI e2e step 2 (`ok=true outcome=created source=run-state`); `retain-prepare.test.ts` *lets an accepted project candidate apply…* |
| 3 | A zero-candidate run completes without creating placeholder learned skills | `retain-prepare.test.ts` *leaves no learned skill behind when a run accepts no candidate* |
| 4 | Repeating preparation reuses the same typed identities, no duplicate state | CLI e2e step 3 (`contextSource=recorded`, record unchanged); `retain-prepare.test.ts` *is idempotent…* |
| 5 | Ambiguous, missing, renamed, or stale owners fail before candidate creation | 5 refusal tests, each asserting an exact code and that nothing was written |
| 6 | Existing pipeline run-states and their `knowledgeContext` remain byte-for-byte authoritative, never implicitly upgraded | `retain-prepare.test.ts` *reports an existing pipeline run-state unchanged, at any context version* (loops v1/v2/v3, byte-identical assert) |
| 7 | No absolute planning or owner root is persisted | `retain-prepare.test.ts` *records durable identity only* (walks the record for absolute paths) |
| 8 | Tests cover project and store ownership, including two stores with the same display name | *resolves the right store through durable identity when two stores share a display name* (resolves by uid, not the shared name) |

## Out-of-scope observation (not a finding against this change)

`rasen/config.yaml` carries an uncommitted modification — a YAML reflow of two `rules.specs` entries plus an appended `tools: [claude]` block. It was already present in the working tree before this change began, is unrelated to standalone retention, and was deliberately left untouched per the repo's dirty-worktree policy. It should not be swept into this change's commit. (`.idea/` is likewise untracked and absent from `.gitignore`.)

## TEST EVIDENCE

- scope: full repository (root package) + full `packages/ui` package + typecheck + lint + CLI end-to-end reproduction
- rationale: the change relaxes a schema field consumed across the CLI, the management API, and the UI, so package-local runs cannot bound the risk; the CLI e2e exercises the exact path the source report proved impossible
- command: `pnpm build` && `npx tsc --noEmit -p tsconfig.json` && `npx eslint src/ test/ vitest.config.ts vitest.setup.ts` && `npx vitest run` && `cd packages/ui && npx tsc --noEmit && npx vitest run`
- result: pass — root 5959 passed / 27 skipped / 26 failed; `packages/ui` 501 passed / 0 failed; typecheck and lint clean in both packages. All 26 root failures are pre-existing on the base branch `dev/0.1.7`, verified by running the same suites in a `git worktree` at that commit: they are git-clone and linked-worktree environment failures in `test/core/store/bootstrap-obtain.test.ts` (18), `test/commands/bootstrap.test.ts` (3), `test/core/learned-skills/store-scope.test.ts` (1), `test/core/session-runtime-context-e2e.test.ts` (1), `test/core/management-api/session-launch-context.test.ts` (1), `test/core/management-api/sessions-space.test.ts` (1), `test/core/store/bootstrap-bundle-import.test.ts` (1). The failing-test list is byte-identical before and after this change.
- tree: `0e0aceb345e7e9326207747bc6dcf5724c056013` (`git rev-parse HEAD^{tree}`) with uncommitted work; `git diff` digest `dceb8b75f3459852` (sha256, first 16 hex) identifies the verified working tree
