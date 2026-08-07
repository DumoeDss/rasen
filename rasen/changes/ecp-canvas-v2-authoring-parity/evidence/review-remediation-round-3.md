# Review remediation - round 3

Status: **READY_FOR_REREVIEW**

This final bounded fixer pass addresses only `RC2-M1`. It does not change the
review verdict or tasks, self-certify the Change, alter machine run state or
portfolio state, commit, push, ship, archive, create a Run, remove any TEMP, or
modify the frozen `auto-decompose` pipeline.

## RC2-M1 - declaration outcomes left referencing BoundedLoop exits stale

### Root cause

The declaration editor correctly committed its complete outcomes array through
`updateDeclaration`, but that mutation replaced only the matching declaration.
Root `BoundedLoop` nodes whose `body` referenced the declaration retained their
old exit object. The panel then rendered the new declaration outcomes with a
visual-only `continue` fallback, so the submitted Definition could retain a
hidden removed outcome and omit a newly visible outcome.

The sibling body-selector path had already solved the same dependency inside
`updateBoundedLoopContract`, but its exit reconciliation algorithm was inline
and therefore unavailable to declaration-contract edits.

### Remediation

- Extracted one pure `reconcileBoundedLoopExits` primitive from the existing
  body-switch behavior.
- `updateBoundedLoopContract` continues to use that primitive when `body`
  changes. Its explicit `patch.exits` behavior remains merge-only and is still
  applied last; this pass does not expand the loop editor's scope.
- `updateDeclaration` now updates the declaration and every root
  `BoundedLoop` whose `body` names it in one immutable Definition mutation.
- Retained outcomes preserve their exact authored mapping, removed outcomes
  disappear, and new outcomes receive the same deterministic visible default
  as body switching. If a retained terminal exit exists, new outcomes default
  to `continue`; otherwise the last new outcome receives the existing default
  terminal mapping.
- Multiple referencing loops reconcile independently from their own prior exit
  maps. Non-referencing loops, other declarations, root connections, graph
  nodes, lifecycle/limit data, and extension-bearing siblings remain intact.

No component-specific reconciliation branch, second Definition model,
serializer, validator, lifecycle policy, or execution projection was added.
Shared preparation remains authoritative for graph-produced outcomes and all
semantic legality.

## Discriminating RED evidence

All three regressions were written and executed against the old production
mutation before the fix.

| Seam | RED command | Old-code failure |
|---|---|---|
| Pure public draft mutation | `pnpm --dir packages/ui exec vitest run test/canvas/v2-authoring-model.test.ts -t "reconciles every referencing BoundedLoop when declaration outcomes change" --reporter=dot` | **1 failed / 18 skipped**. The first loop retained hidden `retry` and omitted `partial`; the test also covers two referencing loops, a non-referencing loop, another declaration, root connections, and extension-bearing siblings. |
| Mounted declaration editor/page | `pnpm --dir packages/ui exec vitest run test/canvas/pipeline-canvas-page.test.tsx -t "reconciles a referencing BoundedLoop when declaration outcomes are edited and reloads it" --reporter=dot` | **1 failed / 70 skipped** after using the real focus/input/blur commit path. The loop panel displayed `done,partial`, but the actual save request still serialized hidden `retry` and omitted `partial`. |
| Shared real preparation + Management persistence | `pnpm exec vitest run test/core/management-api/pipelines-api.test.ts -t "prepares and persists declaration-outcome reconciliation for a saved BoundedLoop" --reporter=dot --maxWorkers=1 --minWorkers=1` | **1 failed / 49 skipped**. A real saved `small-feature` ReviewCycle body changed from the synthetic stale contract to `clean,needs_fix`, but the old helper omitted the required `needs_fix` mapping before preparation/save could proceed. |

The mounted test initially needed one harness correction: the outcomes input
must receive focus before `.blur()` can exercise the component's real commit
seam. After that correction, the RED reached the product defect above rather
than passing or failing on test setup.

## GREEN evidence

| Gate | Result |
|---|---|
| Targeted pure + mounted reconciliation set | PASS - 2 files; **3 passed / 87 skipped** (the filter also includes the existing body-switch primitive regression) |
| Targeted real prepare + Management validation/save/detail reload | PASS - **1 passed / 49 skipped** |
| `pnpm --dir packages/ui exec vitest run test/canvas/v2-authoring-model.test.ts test/canvas/draft.test.ts test/canvas/layout.test.ts test/canvas/pipeline-canvas-page.test.tsx --reporter=dot` | PASS - **4 files / 140 tests** |
| `pnpm exec vitest run test/core/pipeline-registry/canvas-control-port-provenance.test.ts test/core/management-api/pipelines-api.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` | PASS - **2 files / 52 tests** |
| `pnpm --dir packages/ui test -- --reporter=dot` | PASS - **58 files / 648 tests**; existing jsdom `window.scrollTo` and navigation notices only |
| `pnpm --dir packages/ui typecheck` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm build` | PASS |
| `pnpm lint` | PASS - **0 errors / 1 existing warning**, the unrelated unused disable at `test/core/change-run/facade-settle-completeness.test.ts:139` |
| `node bin/rasen.js validate ecp-canvas-v2-authoring-parity --strict` | PASS |
| `git diff --check` | PASS; Windows LF-to-CRLF working-copy notices only |
| `git hash-object pipelines/auto-decompose/pipeline.yaml` | PASS - `6f306544010a8950508f1223acfca5d62de407f5` |
| `git diff --exit-code a1306828a23b2c4adc0db81f92b09498a5e92710 -- pipelines/auto-decompose/pipeline.yaml` | PASS - byte-identical authored v1 |

## Prior-contract regression check

- B1's production input-less AtomicStage target remains covered by the focused
  Canvas/provenance/Management matrices.
- M1 and RC-M1's raw invalid integer blockers remain covered by the mounted
  Canvas matrix and full UI suite.
- M2's body-selector transition now exercises the exact same extracted exit
  reconciliation primitive as RC2-M1.
- M3/N1 and RC-M2's exact diagnostic row, severity, and declaration ownership
  routing remain covered by the mounted Canvas matrix.
- Gate remains the sole authority; no `AtomicStage.execution.gate` field was
  introduced.
- Paired FanOut/Join authoring, v1 edit/save/duplicate compatibility, unknown
  field losslessness, and blank-v2 parity remain green in the full UI suite.

## Remaining boundary

- This fixer does not self-certify `RC2-M1`; a fresh non-author reviewer must
  inspect the delta and decide the Round 3 verdict.
- Per the Round 3 brief, this fixer did not rerun the full root suite. The final
  independent reviewer must run one fresh full-root suite against the post-fix
  tree before a `CLEAN` verdict.
- Parent-PR Windows/Linux/macOS CI remains the delivery gate. The following
  vertical-proof Change still owns the canonical Run proof; this remediation
  claims only Canvas mutation, shared preparation, and persistence behavior.

**READY_FOR_REREVIEW**
