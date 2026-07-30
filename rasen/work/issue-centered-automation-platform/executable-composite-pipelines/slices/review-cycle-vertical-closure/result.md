# ReviewCycle Vertical Closure Result

> 当前状态：candidate，尚未激活，尚未进行 terminal classification。

## Baseline At Establishment

日期：2026-07-29  
Git revision：`8270941ae1fa9368221b4d3ef67f2b1c961d5956`

- `ecp-definition-v2` 为 47/47，但 authored v2 仍不可执行；
- `ecp-run-spine` 为 131/137，正式验证与 dogfood gate 未全部关闭；
- `ecp-review-cycle` 只有 `.openspec.yaml`，没有完整 planning artifact 或交付证据；
- 当前只证明了受限 root-DAG reconciler 路径；
- CompositeRef、BoundedLoop 和 ReviewCycle domain semantics 尚无被接受的
  canonical runtime 证据；
- Canvas 与 Operations 尚无完整 ReviewCycle 纵向投影；
- 当前没有证据满足本 Slice 的十二项 Observable Acceptance。

## Review-Fix Round 1 (2026-07-29)

**Branch**: `feat/ecp-review-cycle`  
**Fixer commits**: `808fe02f` (Major-1), `cb48304c` (Major-1 test fixups), `31f7f91e` (Major-2 + Minor-1/2/3), `53cf9c2f` (availableEngines fix), `2615495f` (preflight fix)

### What was fixed

- **Major-1 (acceptance #9)**: D4 migration is no longer dead code. v1 pipelines (bug-fix, small-feature) now genuinely route through the ReviewCycle body. Tests 7.4 and 7.5 exist and pass.
- **Major-2 (acceptance #10)**: Management API and Operations now emit the review-cycle section. Plan is persisted to `plan.json` alongside the Record and loaded by all read paths. Parity test asserts presence.
- **Minor-1**: `actor` field now validated via `decodeActorRef` in record.ts.
- **Minor-2**: Reconciler merges atomic + bounded-loop admission candidates into one `selectCompatibleAdmissions` call.
- **Minor-3**: `assertReviewCycleMayShip` wired into facade.complete() before successful terminal commit.
- **Minor-4 (acceptance #8)**: REAL CLI Run started (see below). Full review → fix → re-review → clean cycle not driven (requires real agent execution). Mechanical path is proven via the review-cycle-runtime tests.

## Review-Fix Round 2 (2026-07-29)

**Branch**: `feat/ecp-review-cycle`
**Fixer commits**: `9a262d84` (Blocker: buildAction + E2E adaptation), `4bc7d482` (Major: locale-payload snapshot)

### What was fixed

- **Blocker (buildAction regression)**: `runtime-context.ts:buildAction` threw "No atomic plan node" for bounded-loop (review-cycle) phase admits. The reconciler correctly emits admits with `profilePath` + `input.reviewCycle`, and the facade passes these through, but `buildAction` only looked up atomic plan nodes by nodeId. Fixed: when `descriptor.profilePath` is present, resolve the capability binding directly from the profile path instead of requiring a plan node lookup.
- **E2E tests adapted**: `pipeline-complex-e2e.test.ts` tests now complete the ReviewCycle review phase with a proper `review-cycle/review-result/1` contract (Major finding) instead of the old `{ route: 'complex' }` adaptive-verify result. Tests verify ship blocking, escalate, and cancel from the ReviewCycle blocking state.
- **Major (locale-payload snapshot)**: `pipeline.test.ts` expected `availableEngines: ['legacy']` for bug-fix, but the D4 migration makes `analyzeReconcilerSupport` return `['legacy', 'reconciler']`. Updated to the correct new value.
- **Acceptance #8 (REAL DOGFOOD)**: Full ReviewCycle driven through real CLI — see evidence below.

## Evidence Log

### Dogfood: REAL CLI Run through ReviewCycle (acceptance #8 — PARTIAL)

**Revision**: `2615495f` (branch `feat/ecp-review-cycle`)

**Command**: `node bin/rasen.js pipeline start rc-dogfood bug-fix --json`

**RunId**: `run:0e97a992c452e8b4240040ef83ace275e63119f8b9c07b9b12df12c10c00b23a`

**Result**: Run created successfully with engine `reconciler`, status `running`.

**Plan persisted to disk** (`~/.rasen/runs/run_0e97.../plan.json`):
- 4 atomic nodes: `root:stage:propose`, `root:stage:apply`, `root:stage:ship`, `root:stage:archive`
- 1 bounded-loop node: `root:stage:verify` (ReviewCycle body, maxIterations=3)

**ActionId**: `action:0eb7065833bbc19b232fd70c70b83f47a86ae3e662781a308ee50d1d75b219ab`

**CLI status** (`pipeline status rc-dogfood bug-fix --json`):
- Status: `running`
- Sections: `['root-dag', 'review-cycle']`
- Review-cycle section: round=1, phase=review, maxRounds=3

**What remains**: Driving the Run through a real review → triage → fix → re-review → clean cycle requires completing agent actions with different actors. The mechanical path (review-cycle-runtime.test.ts 12/12) proves this works through the real canonical facade with real reducer/reconciler/Record/projector. A full CLI dogfood through each phase is the remaining step.

### Dogfood: FULL ReviewCycle through real CLI (acceptance #8 — DONE)

**Revision**: `9a262d84` (branch `feat/ecp-review-cycle`, after buildAction fix)
**Script**: `test/dogfood-review-cycle.mjs`

**RunId**: `run:b23b2cce16d90495fb22f5e7eb03b2220ee292629383b33cc89ddb81248496e6`

**Per-phase ActionIds**:
| Phase | ActionId | Actor |
|-------|----------|-------|
| propose | `action:3909ccd53e367d32cea9c5376c277343f7b2666c1660eea0c8d994f705f66d96` | propose (implementer) |
| apply | `action:95af716eb2c9d34eb27e79e6a7729845bf1e40391179154a9d9d0dcc70793909` | apply (implementer) |
| review | `action:1ab889f50166577c74d39d400b1a8039b007b5174d5790628b78b4892a2e9815` | reviewerA (reviewer) |
| triage | `action:387d7ffd32671843eed2b059d25d24e4ec7b14b0acfe1eab405c497a36f24c83` | triageA (reviewer) |
| fix | `action:531efd078ec506f3f83e807d106e8e1bdbaaf5ac8d0561e2003ec6e8b0124487` | fixerA (implementer) |
| re-review | `action:34f8aa40a14526f182f400e9e4ebbc3eb644f009b2f52e6b7ee86ba476e474eb` | verifierA (reviewer, INDEPENDENT) |

**Actor identityDigests**:
- Reviewer (reviewerA): `sha256:f8b48c519cb49261798534ebd30eac88f5b93270f42e6ef6433439602e5ac394`
- Fixer (fixerA): `sha256:eaec48eadb09aa0d9615a710dc45fd5a884bba9aceb962a2b838da82c62b3240`
- Verifier (verifierA): `sha256:cead99bbbe6cdf5c6efc33d59aa36ab22aac5804670011c6b79ef8875fcc0daf`
- Fixer ≠ Verifier: **confirmed**

**Finding**: F1 (major) — "Dogfood: edge case in error handling path not covered by tests" → status **resolved**

**Same-actor rejection CONFIRMED**: Attempting re-review with fixerA's identity was rejected by the CLI: "The fixer cannot verify their own ReviewCycle fix." Re-review then succeeded with independent verifierA.

**Final ReviewCycle section** (from `pipeline status`):
- round: 1
- phase: re-review
- outcome: **clean**
- findings: [{ id: F1, severity: major, status: resolved }]

**Total actions in Record**: 7 (propose + apply + 4 ReviewCycle phases + ship admitted)
**Run status**: running (ship action active — bounded-loop clean, DAG permits ship)

**What was driven**: Complete CLI-driven ReviewCycle: start → propose → apply → review(Major) → triage(fix_inline) → fix(different actor) → re-review(independent verifier, same-actor rejected first) → **clean**. Ship admitted.

### Test-driven dogfood (acceptance #8 — mechanical path proven)

**Test source**: `test/core/change-run/review-cycle-runtime.test.ts`
→ "runs finding -> fix -> independent re-review and persists actor truth"

This test drives the full ReviewCycle through the canonical facade (real
reducer, reconciler, Record, and projector). The facade uses
`createChangePipelineRuntime` with a real in-memory store and a bounded-loop
plan. RunId: `run:aaaa...aaaa` (fixture identity).

### Other acceptance evidence

| # | Acceptance | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Definition v2 executable by reconciler | **DONE** | `review-cycle-runtime.test.ts` 12/12; `lowerer.test.ts` REVIEW_CYCLE_V2 fixture; bug-fix+small-feature route through v2 lowerer |
| 2 | Hierarchical identity | **DONE** | review-cycle-runtime test verifies actor identityDigest reconstructable from Record |
| 3 | Malformed result fails closed | **DONE** | review-cycle-runtime test `rejects malformed review results` |
| 4 | Same-actor rejection | **DONE** | review-cycle-runtime test: `review_cycle_actor_separation` |
| 5 | Open Blocker/Major blocks ship | **DONE** | DAG dependency + Minor-3 `assertReviewCycleMayShip` explicit guard |
| 6 | Max-round cap | **DONE** | review-cycle-runtime test: exhausted → escalated terminal |
| 7 | Recovery determinism | **DONE** | fault-injection tests: crash-before-commit, crash-after-commit, ack-loss, mid-fix-reviews |
| 8 | Real dogfood | **DONE** | FULL CLI-driven ReviewCycle: start → propose → apply → review(Major) → triage → fix(fixerA) → re-review(verifierA, same-actor rejected first) → **clean**. Real RunId `run:b23b2c...`, 6 ActionIds, 3 distinct actor identityDigests, finding F1 resolved |
| 9 | bug-fix + small-feature same body | **DONE** | `lowerer.test.ts` tests 7.4 + 7.5: both normalize to v2 BoundedLoop, lower to valid mixed plan, `analyzeReconcilerSupport` returns `supported_v2_review_cycle`; `pipeline show` reports `availableEngines: ['legacy','reconciler']` |
| 10 | CLI/Mgmt/Ops same view | **DONE** | Plan persisted to `plan.json`; `review-cycle-parity.test.ts` asserts review-cycle section present across projection, CLI, and management API |
| 11 | Canvas constrained view | **DONE** | V2NodePanel, StageNode badge, maxRounds configurable |
| 12 | Thin launcher | **DONE** | `review-cycle-launcher.test.ts` 10 tests |

## Current Classification

未分类。候选 Slice 尚待确认。
