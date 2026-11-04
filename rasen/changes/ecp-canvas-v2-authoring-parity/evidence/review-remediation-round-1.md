# Review remediation — round 1

Status: **READY_FOR_REREVIEW**

This remediation addresses only the six findings recorded in `review-report.md`. It does not change the review verdict, self-certify the Change, alter run state, commit, push, ship, archive, or modify the frozen `auto-decompose` pipeline.

## B1 — production-shaped input-less AtomicStage could not accept a Canvas connection

### Root cause

Canvas port projection treated every empty capability `inputs` list as meaning “no target handle”. The connection handler then rejected null source/target handles before its documented control-port fallback could run. Production-shaped AtomicStage descriptors therefore rendered no target handle and could not author the control connection accepted by the Definition layer.

### Remediation

- `layout.ts` now projects the canonical `input` control target for a resolved AtomicStage capability whose declared input list is empty, while preserving explicit typed inputs and avoiding invented handles for unresolved capabilities.
- `PipelineCanvasPage.tsx` now resolves null React Flow handles through the canonical `output`/`input` control-port fallback before validating the connection.
- Mounted tests render the real `StageNode` through the React Flow mock and derive their connection handles from the rendered node model, so the journey cannot pass by fabricating ports in the test.

### Discriminating red → green evidence

- Red: a production-shaped AtomicStage with `inputs: []` had no `input` target; the mounted two-stage connect/save/reload journey could not create the connection.
- Green: `layout.test.ts` asserts the rendered `input` target plus `done` source, and `pipeline-canvas-page.test.tsx` connects two production-shaped stages, saves, reloads detail, and verifies the canonical control connection survives.
- Real-core proof: `pipelines-api.test.ts` validates, saves, and reloads that control connection through the production Management API.

## M1 — invalid positive limits were silently deleted

### Root cause

The positive-integer fields parsed an invalid nonblank string to `null`, which was indistinguishable from an intentional clear. Invalid `0`, negative, and fractional text therefore deleted the previously valid wire value and could be saved.

### Remediation

- `DefinitionContractPanel.tsx` keeps the raw nonblank text locally, validates it as a positive integer, and leaves the last valid numeric draft value intact while invalid.
- Blank input remains the explicit clear operation.
- `PipelineCanvasPage.tsx` incorporates definition-field errors into dirty state and blocks Validate, Save, and Export until repaired or intentionally cleared.
- Invalid fields have `aria-invalid`, field-local error text, and visible invalid styling.

### Discriminating red → green evidence

- Red: mounted edits to `0`, `-2`, and `1.5` silently cleared the stored limit and allowed save.
- Green: the mounted test verifies all three raw values remain visible, the prior valid value is retained, save is blocked, a valid repair saves, and blank input deliberately removes the field.

## M2 — switching a bounded-loop body retained invisible stale exits

### Root cause

`updateBoundedLoopContract` changed `body` without rebuilding `exits`. Exit mappings from outcomes of the previous declaration remained serialized even though the new declaration could not display or emit those outcomes.

### Remediation

- A body change now rebuilds exits against the destination declaration's actual outcomes.
- Mappings for the outcome intersection are preserved, stale mappings are removed, and newly reachable outcomes receive visible mappings.
- When a preserved terminal exit already exists, new outcomes default to `continue`; otherwise the last new outcome receives the initial terminal mapping. Explicit exit patches are applied last.

The `continue` default is important: the first implementation mapped a newly introduced outcome to the same terminal output as a preserved exit, and real Definition preparation correctly rejected that with `DUPLICATE_ID`. The final behavior avoids manufacturing duplicate terminal identities while keeping every new outcome editable.

### Discriminating red → green evidence

- Red: both the pure helper and mounted Canvas journey retained an old-only outcome after switching between declarations with different outcomes.
- Green: the helper and mounted save/reload journey prove intersection preservation, stale removal, and creation of the new visible mapping.
- Real Definition proof: `pipelines-api.test.ts` prepares a custom-catalog definition whose bodies expose `retry/done` versus `done/partial`; it preserves `done`, removes `retry`, adds `partial: continue`, and passes preparation.
- Real Management proof: a separate production-shaped definition starts with a stale exit, switches body, then validates, saves, and reloads successfully through the Management API.

## M3 — body-connection diagnostics did not identify the row, field, or severity

### Root cause

Issue selection carried only a locator target. Body-connection issues could be redirected to the consuming stage editor, and the body-connection row had no field-level focus marker or severity-specific presentation.

### Remediation

- `PipelineCanvasPage.tsx` keeps the selected issue severity with the target and resolves body-connection diagnostics to a connection-specific `{ id, field, severity }` selection.
- `DeclarationsPanel.tsx` marks the exact connection row and the closest `from` or `to` endpoint with `data-focused-field` and the actual `data-issue` severity.
- Connection rows show the precise `node:port → node:port` identity and warning/error styles are visually distinct.
- `IssuesDrawer.tsx` forwards the selected issue's real severity.

### Discriminating red → green evidence

- Red: selecting a body-connection issue neither identified the exact row/endpoint nor preserved warning versus error severity.
- Green: mounted warning and error cases assert the exact row, exact field marker, and corresponding severity attributes/styles.

## N1 — bounded-loop body node warnings were rendered as errors

### Root cause

The body-stage editor received a hard-coded `error` severity whenever any selected body-stage issue existed.

### Remediation

- The selected issue severity now flows from `IssuesDrawer` through `PipelineCanvasPage` and `DeclarationsPanel` into `V2ExecutionEditor`.
- Body-node highlighting therefore reflects the diagnostic's actual warning/error level.

### Discriminating red → green evidence

- Red: selecting a warning diagnostic produced an error marker on the body node.
- Green: the mounted test selects a warning and asserts the node is marked `warning`, not `error`.

## T1 — stale V2NodePanel comments contradicted current support

### Root cause

Comments still described FanOut, Join, and bounded-loop fields as excluded/read-only after those authoring surfaces had been implemented.

### Remediation

- Removed the obsolete FanOut/Join exclusion comment.
- Replaced duplicate bounded-loop exclusion/read-only comments with a current description of the complete bounded-loop contract editor.

### Discriminating evidence

- Source inspection now matches the implemented authoring surface; TypeScript and build validation cover the edited component.

## Verification

Red baseline captured before implementation:

- Focused UI: 3 files / 92 tests — **6 failed, 86 passed**.
- Focused real Management case: **1 failed, 48 skipped**.

Green verification after implementation:

- `pnpm --dir packages/ui exec vitest run test/canvas/layout.test.ts test/canvas/v2-authoring-model.test.ts test/canvas/pipeline-canvas-page.test.tsx --reporter=dot` — **3 files / 92 passed**.
- `pnpm --dir packages/ui exec vitest run test/canvas/v2-authoring-model.test.ts test/canvas/draft.test.ts test/canvas/layout.test.ts test/canvas/pipeline-canvas-page.test.tsx --reporter=dot` — **4 files / 135 passed**.
- `pnpm exec vitest run test/core/management-api/pipelines-api.test.ts -t "accepts Canvas control handles and a body-switched loop" --reporter=dot --maxWorkers=1 --minWorkers=1` — **1 passed, 48 skipped**.
- `pnpm exec vitest run test/core/pipeline-registry/canvas-control-port-provenance.test.ts test/core/management-api/pipelines-api.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — **2 files / 51 passed**.
- `pnpm --dir packages/ui test -- --reporter=dot` — **58 files / 643 passed**. Existing jsdom `window.scrollTo` and navigation notices remain non-failing.
- `pnpm --dir packages/ui typecheck` — passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm build` — passed.
- `pnpm lint` — passed with zero errors; one unrelated pre-existing unused `eslint-disable` warning remains in `test/core/change-run/facade-settle-completeness.test.ts`.
- `node bin/rasen.js validate ecp-canvas-v2-authoring-parity --strict` — passed.
- `git diff --check` — passed; only existing Windows LF→CRLF notices were emitted.

Frozen pipeline guard:

- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml` — passed.
- `git hash-object pipelines/auto-decompose/pipeline.yaml` — `6f306544010a8950508f1223acfca5d62de407f5`.

## Remaining review boundary

No known regression remains within these six findings. The reviewer should independently re-run the discriminating tests and assess the frozen tree. The full root suite and any final acceptance verdict remain the fresh non-author reviewer/LEAD boundary; this fixer does not change the prior review verdict or self-certify completion.
