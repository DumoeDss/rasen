# Verification Report: standalone-retention-context-freeze

Schema: `spec-driven`. Verified 2026-08-05 on branch `feature/standalone-retention-context-freeze` (uncommitted working tree).

Artifacts verified against: `proposal.md`, `design.md` (D1-D8 + ADR-1/2/3/4), `specs/retention-context-preparation/spec.md` (7 ADDED requirements), `specs/opsx-pipeline-registry/spec.md` (2 MODIFIED + 1 ADDED), `tasks.md` (39 items), and the source report `local_docs/rasen-retention-standalone-run-state/report.md` (8 acceptance criteria + regression matrix).

Verification was performed by two independent audits (a read-only spec-coverage matrix and an adversarial diff review) plus a CLI end-to-end reproduction of the reported blocker. The author did not self-certify coverage.

## Summary

| Dimension | Status |
|---|---|
| Completeness | 40/40 tasks complete; 10/10 requirements implemented |
| Correctness | 28/28 scenarios covered by an automated test; 2 Blockers found and fixed pre-review, 5 Major found and fixed in review |
| Coherence | D1-D8 followed, with 4 departures recorded as ADR-1/2/3/4 and each justification re-verified against the code |

`VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0`

All findings raised during verification were fixed and re-verified in this same session; none are left open.

## Review pass (`/rasen-review`, 2026-08-05)

A pre-landing review after this report found five Major items this verification missed, all now fixed with tests (`tasks.md` §7). They are recorded here because each one contradicts a claim above:

- The no-run-state branch published with a replacing `renameSync` after an async identity resolution, so a record seeded meanwhile — a LEAD's pipeline name and every stage record — was silently destroyed. Creating is now exclusive (`createRunStateExclusive`), and a record that appeared meanwhile is merged into.
- An ownership refusal printed the shared resolver's `Pass --project <id> or --store <id>`, which ADR-2 reassigned to planning-root selection on this command; the remediation could not settle the refusal it was attached to. It now names `--owner-project`/`--owner-store`.
- A root-selection refusal under `--json` carried neither `ok` nor a code, on the `--store-path` path this command registers precisely to refuse. It now carries `ok: false`.
- `updateRunStateKnowledgeContext` reported every read failure as `absent`, which the caller renders as a false `no auto-run.json found`. Only `ENOENT` is now an absence.
- Preparation wrote for **every** retention mode, though only `codify` reads what it writes. Both built-in profiles therefore wrote: `full` resolves to `report`, `core` to `off`. A change that never ran a pipeline was left holding an `auto-run.json` no run produced — `pipeline resume` reports `hasRunState: true` for it, the board reports run files, and the frozen identity is authoritative at any version and never upgraded in place, so it was pinned permanently for a branch that never reads it. That contradicts the router's own step 3, which calls `off` a successful no-op that changes no learned-skill state. The write is now gated on the union of the two modes preparation reports (ADR-4, task 7.8): unless the effective mode — or a mode already frozen in run-state for a canonical `retain` stage — is `codify`, the command resolves nothing, validates nothing, and writes nothing, reporting `contextSource: 'skipped'` with no `knowledgeContext`, `owner`, or `planningRoot`. Proven load-bearing twice: neutralizing the gate fails the three new mode tests, and dropping `frozenRetention` from it fails the frozen-`codify` arm. Also corrected the copy the gate exposed — `retain.messages.noPipeline` claimed "the run-state carries retention identity only", which is false for a change no record was written for.

Two claims below were also corrected rather than defended:

- **Not 26/26.** The scenario *A moved checkout still resolves* had no automated test; only its negative (no absolute path is persisted) was asserted. **Closed pre-ship** — see "Pre-ship coverage closure" below; the count is now 28/28.
- **Not a uniform refusal surface.** The four Rasen-owned refusals are localized; the `knowledge_owner_*` / `knowledge_selector_conflict` diagnostics pass through as English literals from `context.ts`, and those are the refusals the fail-closed requirement is about.

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
- **A genuine write I/O failure fell through to the generic `retain_error`** with no `runStatePath`, while the shipped workflow instructs the worker to "report the condition it named". Both write sites now map a thrown filesystem error to `retention_context_write_failed` with `{ runStatePath, reason }`. Covered by a test that plants a file where the ephemera directory belongs (portable; the original proof was a manual `chmod 500`).
- **`sessionStage`'s new pipeline-less branch had no test.** Added one to `packages/ui/test/board/columns.test.ts`.
- **`retention_owner_selector_conflict` was the only Rasen-owned refusal still unlocalized.** Added `retain.messages.ownerSelectorConflict` to all three locales and routed it through the same mechanism, so all four Rasen-owned refusals render in the caller's locale. The `knowledge_owner_*` / `knowledge_selector_conflict` diagnostics still pass through as English literals from `context.ts` — deliberate (they are core data, not this command's copy), but it means the refusal surface as a whole is not localized.

### Trivial (1) — fixed

- `tasks.md` item 3.6 named a `hasPipeline` payload field the implementation never emitted (it emits `pipeline: pipeline ?? null`, which `docs/cli.md` already documented). Task text corrected to `pipeline`.

## Pre-ship coverage closure (2026-08-06)

The one scenario this report left uncovered now has a test, so the change ships at 28/28 rather than 27/28.

- **Scenario:** *A moved checkout still resolves* (`specs/retention-context-preparation/spec.md:130`) — a prepared change read from a different absolute location than the one it was prepared in must still resolve to the same planning root and owner.
- **Test:** `test/commands/retain-prepare.test.ts` — *resolves the recorded identity after the checkout moves to another absolute path*. It prepares a change, releases the working directory (a cwd cannot be renamed on Windows), renames the whole checkout, and re-runs preparation from the new path: `contextSource: 'recorded'`, the `knowledgeContext` deep-equal to the pre-move one, the same reported owner and planning root, the record byte-identical, and `runStateDir`/`runStatePath` composed with `path.join` under the new location. Restored in a `finally` so the suite's own cleanup reaches it.
- **Proven load-bearing.** Neutralizing the moved-repo rebind in `src/core/project-registry.ts` (the `2b` branch that re-keys a same-`projectId` entry whose path is gone) makes exactly this test fail — `expected 1 to be undefined`, the refusal exit code, because the surviving stale entry makes the frozen project owner resolve to two roots (`knowledge_owner_ambiguous`). Every other test in the file still passed under that sabotage, so the assertion is specific to the moved-checkout path and not to preparation in general.

Recorded as task 7.9.

### A Windows-only test defect CI caught that no local run could (task 7.10)

The first CI run on this branch — the first one ever, since the branch had no PR until ship time — failed one Windows shard on a test this change added: *propagates a read failure instead of reporting the record absent*. The production discrimination is correct; the fixture was not portable. It pointed the seam at a run-state path underneath a regular file, which the OS reports as `ENOTDIR` on POSIX and as `ENOENT` on Windows — precisely the code the seam is required to treat as a genuine absence. So on Windows the call returned `{ kind: 'absent' }`, the assertion `toThrow()` failed, and the local macOS evidence in this report could not have predicted it.

The errno is now injected through the same partial-`node:fs` mock the crash-safety tests already use (`readFault.eacces`), so the test exercises the discrimination itself rather than a platform's errno mapping, and it additionally asserts the record is untouched. Proven load-bearing: making the seam return `absent` for every read error fails exactly this test and nothing else in the file.

Shard mapping, for the record: the three changed suites split across the three Windows shards — `test/commands/pipeline.test.ts` (shard 1, green), `test/commands/retain-prepare.test.ts` (shard 2, green — so task 7.9's moved-checkout test passes on Windows), and `test/core/pipeline-registry/run-state.test.ts` (shard 3, the failure above).

The second corrected claim — the non-uniform refusal surface — is unchanged and remains deliberate: no requirement in either spec asks for localized refusals, and the `knowledge_owner_*` / `knowledge_selector_conflict` diagnostics stay English literals owned by `context.ts`.

## Coherence

D1-D8 are followed. Four departures were recorded in `design.md` under "Deviations proven during implementation"; each justification was re-verified against the code during this audit and all four hold:

- **ADR-1** — `writeFileAtomically` is async while `writeRunState` is synchronous with synchronous callers, so atomicity is a synchronous temp-write + `renameSync` (the `writeSessionRuntimeContext` precedent). Confirmed: `run-state.ts` `writeRunState` is `: void` and its helper is synchronous throughout.
- **ADR-2** — root-selection `--project` addresses only a `store add-project`-registered project, while knowledge `--project` addresses any project identity; they are different namespaces, so the selectors are separate flag pairs. Confirmed at `root-selection.ts:705-707`.
- **ADR-3** — the identity resolver derives both planning and ownership from one directory, so passing a store root as `launchDirectory` misreports a store-planned change as `knowledge_owner_ambiguous`. `process.cwd()` is used with an explicit `retention_planning_root_mismatch` guard. Confirmed at `context.ts:799-804`; both arms are tested.
- **ADR-4** — freezing is a write and only `codify` reads it, so preparation writes only when the effective mode or a run-state-frozen mode is `codify`; D3's steps 3-4 were unconditional. The order cannot simply be swapped, because preparation is itself what reports the mode. Confirmed at `retain.ts:347` — the gate sits between the mode resolution and the first write-bearing step, and `report.md` contains no reference to run-state while `codify.md` step 1 is the only reader of `runStateDir`.

## Acceptance criteria from the source report

| # | Criterion | Evidence |
|---|---|---|
| 1 | A change with no `auto-run.json` and mode `codify` can initialize a frozen project context through a documented CLI operation | CLI e2e step 1; `retain-prepare.test.ts` *freezes a durable context…* |
| 2 | An accepted project candidate can run `knowledge apply` using the returned `runStateDir` | CLI e2e step 2 (`ok=true outcome=created source=run-state`); `retain-prepare.test.ts` *lets an accepted project candidate apply…* |
| 3 | A zero-candidate run completes without creating placeholder learned skills | `retain-prepare.test.ts` *leaves no learned skill behind when a run accepts no candidate* |
| 4 | Repeating preparation reuses the same typed identities, no duplicate state | CLI e2e step 3 (`contextSource=recorded`, record unchanged); `retain-prepare.test.ts` *is idempotent…* |
| 5 | Ambiguous, missing, renamed, or stale owners fail before candidate creation | 5 refusal tests, each asserting an exact code and that nothing was written |
| 6 | Existing pipeline run-states and their `knowledgeContext` remain byte-for-byte authoritative, never implicitly upgraded | `retain-prepare.test.ts` *reports an existing pipeline run-state unchanged, at any context version* (loops v1/v2/v3, byte-identical assert) |
| 7 | No absolute planning or owner root is persisted | `retain-prepare.test.ts` *records durable identity only* (walks the record for absolute paths); the positive half is *resolves the recorded identity after the checkout moves to another absolute path* |
| 8 | Tests cover project and store ownership, including two stores with the same display name | *resolves the right store through durable identity when two stores share a display name* (resolves by uid, not the shared name) |

## Out-of-scope observation (not a finding against this change)

Two working-tree observations, neither a finding against this change and neither swept into it:

- The uncommitted `rasen/config.yaml` modification this report recorded earlier (a YAML reflow of two `rules.specs` entries plus an appended `tools: [claude]` block) is **gone** — the working tree no longer carries it, and it was never committed on this branch (`git show --stat 83d90747 -- rasen/config.yaml` is empty). Someone reverted it outside this change.
- `test/fixtures/claude/fake-claude.mjs` carries a mode-only change (`100644` → `100755`) with no content diff, produced by running the suite rather than by any edit here. `.idea/` is likewise untracked and absent from `.gitignore`. Both predate this pass and are left untouched per the repo's dirty-worktree policy.

## TEST EVIDENCE

- scope: full repository (root package) + full `packages/ui` package + typecheck + lint + CLI end-to-end reproduction
- rationale: the change relaxes a schema field consumed across the CLI, the management API, and the UI, so package-local runs cannot bound the risk; the CLI e2e exercises the exact path the source report proved impossible
- command: `pnpm build` && `npx tsc --noEmit -p tsconfig.json` && `npx eslint src/ test/ vitest.config.ts vitest.setup.ts` && `npx vitest run` && `cd packages/ui && npx tsc --noEmit && npx vitest run`
- result: pass — root 5972 passed / 27 skipped / 26 failed (6025 total); `packages/ui` 501 passed / 0 failed; typecheck and lint clean in both packages. All 26 root failures are pre-existing on the base branch `dev/0.1.7`, verified by running the same suites in a `git worktree` at that commit: they are git-clone and linked-worktree environment failures in `test/core/store/bootstrap-obtain.test.ts` (18), `test/commands/bootstrap.test.ts` (3), `test/core/learned-skills/store-scope.test.ts` (1), `test/core/session-runtime-context-e2e.test.ts` (1), `test/core/management-api/session-launch-context.test.ts` (1), `test/core/management-api/sessions-space.test.ts` (1), `test/core/store/bootstrap-bundle-import.test.ts` (1). The failing-test list is byte-identical before and after this change, re-confirmed after the ADR-4 gate landed.
- CLI end-to-end (ADR-4): in a temp project, `retain prepare` under the default `full` profile reported `contextSource: "skipped"` and left no file under `.rasen` at all, with `pipeline resume` still reporting `hasRunState: false`; after `config set retention codify` the same command froze a v3 context (`hasRunState: true`, `pipeline: null`); repeating it reported `recorded`; unsetting the key back to `report` reported `skipped` with the record byte-identical (md5 unchanged); and planting `retention: "codify"` in that record under a `report` profile reported `frozenRetention: "codify"` with `contextSource: "prepared"`, proving the union arm on the real CLI.
### Pre-ship re-verification (2026-08-06, after the work was committed)

- scope: the three suites that own the changed contracts, plus root typecheck and lint on the touched files
- rationale: the evidence above was taken on the uncommitted working tree; the work has since been committed as `83d90747`, `2448c966`, `a27a3e3d`, `5a8297c3`, `2d4d56f5`, and task 7.9 added a test. The full-suite baseline (including its 26 pre-existing failures) is not re-established here — this run bounds the new test and the contracts it touches, nothing wider.
- command: `pnpm build` && `npx vitest run test/commands/pipeline.test.ts test/commands/retain-prepare.test.ts test/core/pipeline-registry/run-state.test.ts` && `npx tsc --noEmit -p tsconfig.json` && `npx eslint test/commands/retain-prepare.test.ts src/core/project-registry.ts`
- result: pass — 248 passed / 0 failed across the three files (29 in `retain-prepare.test.ts`); typecheck and lint clean
- note: `pnpm build` is a prerequisite, not a formality. `test/commands/pipeline.test.ts` spawns the built CLI, and the checkout's `dist/` predated this change (no `dist/commands/retain.js` at all), which produced 8 failures that were purely stale-build artifacts and disappeared after rebuilding. Anyone re-running these suites must build first.
- tree: `4967e3adcf21bc51986b4b86b282cf80de2e891b` (`git rev-parse HEAD^{tree}`) with uncommitted work. The verified working tree is identified by the `git diff` digest `e0a94c5f2a645542` (sha256, first 16 hex) computed with this report excluded — `git diff -- . ':(exclude)rasen/changes/standalone-retention-context-freeze/evidence/verification-report.md'` — because a digest over the whole diff would be invalidated by writing it here.
