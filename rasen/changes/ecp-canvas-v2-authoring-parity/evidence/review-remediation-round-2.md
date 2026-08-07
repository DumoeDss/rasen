# Review remediation — round 2

Status: **READY_FOR_REREVIEW**

This fixer pass addresses only Round 2 findings `RC-M1`, `RC-M2`, and
`RC-T1`, plus the report's explicit `PositiveLimitField` replacement-state
audit. It does not change the review verdict or tasks, self-certify the Change,
alter machine run state, commit, push, ship, archive, create a Run, or modify
the frozen `auto-decompose` pipeline.

## RC-M1 — nested integer edits silently retained the previous wire value

### Root cause

The loop and paired-parallel panels parsed numbers inside event handlers and
called their model patch only when parsing succeeded. Invalid non-empty text
therefore had no authoring state, no field error, and no page-level blocker.
The controlled input then rendered the prior wire value again. Required blank
values had the same silent no-op behavior. This occurred before the existing
pure model and authoritative server validation could observe the attempted
edit.

### Remediation

- Added one reusable `IntegerContractField` raw/error contract and reused it
  for top-level limits, BoundedLoop limits, lifecycle thresholds, lifecycle
  strategy attempts, and paired FanOut/Join cap and budget.
- Invalid raw text remains outside the serializable Definition and leaves the
  last valid wire number unchanged. The raw value and message are retained in
  the page's authoring-error registry across node/pair panel switches; node
  rename/removal and paired removal migrate or remove their scoped entries.
- Every invalid field now exposes `aria-invalid`, `aria-describedby`, and a
  field-local alert. The same registry disables Save and Export and prevents
  Validate from calling the API.
- Clearing follows the actual field contract rather than one blanket rule:
  top-level `maxActions`/`budget` and loop-local `maxActions`/`budget` are
  optional clears; `maxIterations`, both lifecycle thresholds, and both
  parallel scalars are required; strategy `maxAttempts` is required but
  non-negative, so `0` remains valid and still removes the unreachable
  strategy capability.
- A valid repair clears both local and parent error state before patching the
  existing pure draft model. No second Definition model, serializer, or
  validator was introduced.

### Discriminating red → green evidence

- **Red:** the new mounted matrix failed because loop/parallel fields had no
  `aria-invalid` state and silently restored the previous value. The targeted
  RED run also reproduced the separate mounted replacement error and owner
  routing failure: **1 file, 3 failed, 67 skipped**.
- **Green:** the mounted matrix exercises `0`, negative, fractional, blank,
  panel switch, and repair behavior for required loop limits, lifecycle
  thresholds, strategy attempts, parallel concurrency cap, and parallel
  budget. It also verifies optional loop limit clears, valid strategy zero,
  action blocking, and the exact repaired Definition submitted to Validate.
- The four-file Canvas matrix now passes **4 files / 138 tests** and the full UI
  suite passes **58 files / 646 tests**.

## RC-M2 — body diagnostics could cross declaration ownership

### Root cause

`definitionIssuePathTarget` correctly retained the owning `declarationId`, but
the page derived body field/stage/connection selections from only the local id.
Because local stage and connection ids are declaration-scoped, manually
opening another declaration could reuse the stale marker and severity on an
unrelated element with the same id.

### Remediation

- Manual declaration selection now clears the selected issue target and
  severity without removing the visible server issue list.
- The page derives every body field, stage, connection, and severity only when
  `target.declarationId === selectedDeclarationId`.
- `DeclarationsPanel` performs a second fail-closed ownership check against the
  rendered declaration. Body-connection selections also carry their
  `declarationId`, so an incorrectly routed prop still cannot mark another
  declaration's same-id row or endpoint.
- Existing draft mutation/dismiss behavior continues to clear stale issue
  selection through the shared `markDraftChanged`/drawer path.

### Discriminating red → green evidence

- **Red:** after selecting declaration A's body-node diagnostic and manually
  opening declaration B, B's duplicate `review` node retained
  `execution/role`; the targeted owner test failed.
- **Green:** a mounted fixture with two declarations that both contain
  `review`, `apply`, and `review-to-apply` proves that neither the node field nor
  the connection row/endpoint/severity crosses the owner boundary. The test is
  included in the **138/138** focused Canvas result.

## RC-T1 — stale layout documentation

The `layout.ts` default-case comment now states that only kinds outside the
current closed eight-kind vocabulary remain preserved read-only. It no longer
claims the editable FanOut and Join kinds are read-only.

## Additional audit — authoritative value/draft replacement

The reusable integer field tracks its last authoritative `{ resetKey, value }`.
When either the Definition identity or wire value is replaced while the same
component remains mounted, it resets raw text and local error and removes the
corresponding parent registry entry. A direct mounted regression changes an
invalid budget field from raw `0` to a replacement Definition budget of `64`
and verifies the stale error and alert disappear.

## Invariants rechecked

- The production input-less AtomicStage control target and real Management
  round trip from B1 remain green.
- BoundedLoop body switching still rebuilds only reachable exits.
- Gate remains the sole native-v2 gate authority; no
  `AtomicStage.execution.gate` field was introduced.
- Parallel cap/budget remain one paired FanOut/Join contract.
- Authored v1 behavior stays on the v1 compatibility path.
- The Canvas still edits one wire Definition and delegates all valid patches
  to the existing pure model and all semantic legality to server preparation.
- `pipelines/auto-decompose/pipeline.yaml` remains byte-identical authored v1.

## Verification

| Gate | Result |
|---|---|
| Targeted RED run for the three new mounted regressions | Expected failure: 1 file; 3 failed, 67 skipped |
| Targeted GREEN run for the same regressions | 1 file; 3 passed, 67 skipped |
| `pnpm --dir packages/ui exec vitest run test/canvas/v2-authoring-model.test.ts test/canvas/draft.test.ts test/canvas/layout.test.ts test/canvas/pipeline-canvas-page.test.tsx --reporter=dot` | PASS — 4 files / 138 tests |
| `pnpm --dir packages/ui test -- --reporter=dot` | PASS — 58 files / 646 tests |
| `pnpm --dir packages/ui typecheck` | PASS |
| `pnpm exec vitest run test/core/pipeline-registry/canvas-control-port-provenance.test.ts test/core/management-api/pipelines-api.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` | PASS — 2 files / 51 tests |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm build` | PASS |
| `pnpm lint` | PASS — 0 errors; one unrelated pre-existing unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139` |
| `node bin/rasen.js validate ecp-canvas-v2-authoring-parity --strict` | PASS |
| `git diff --check` | PASS; Windows LF-to-CRLF working-copy notices only |
| `git hash-object pipelines/auto-decompose/pipeline.yaml` | PASS — `6f306544010a8950508f1223acfca5d62de407f5` |
| `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml` | PASS — unchanged |

The jsdom suite continues to print its existing non-failing `window.scrollTo`
and navigation-not-implemented notices. The fixer did not run a new full-root
suite: the independent reviewer/LEAD must obtain fresh post-remediation
full-root evidence before changing the cycle verdict to `CLEAN` or shipping.

## Remaining review boundary

No known implementation gap remains for the three Round 2 findings or the
additional replacement-state audit. A non-author reviewer must inspect this
delta, independently re-run the discriminating checks, obtain the final
full-root evidence, and alone decide whether the review cycle is clean.

**READY_FOR_REREVIEW**
