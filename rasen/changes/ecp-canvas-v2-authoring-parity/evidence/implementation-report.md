# Canvas v2 authoring parity — implementation report

Date: 2026-08-02

## Outcome

The apply stage is complete. A fresh/not-found Canvas can visibly author one shared v2 definition containing definition and declaration contracts plus all eight kernel node kinds (`AtomicStage`, `CompositeRef`, `BoundedLoop`, `Choice`, `Gate`, `Finish`, `FanOut`, and `Join`). The exact browser request is accepted by real core preparation and Management validation/save/detail, is written by the canonical serializer, survives portable export/import, and has stable source/capability/plan digests across no-op round trips.

This report does not claim independent review, the following canonical Run proof, or parent-PR cross-platform CI. Those remain tasks 9.1–9.6.

## Authority and boundaries

- The browser continues to edit one `WirePipelineDefinitionV2` draft. It does not own another validator, serializer, execution projection, lifecycle policy, or digest implementation.
- `EcpDefinitionModule.prepare`, the Management API, and `serializeAuthoredPipelineDefinition` are the authoritative preparation, persistence, and canonical-writing seams used by the acceptance test.
- `Gate` is the only gate authority. No authoring path emits the retired `AtomicStage.execution.gate` field.
- Declaration bodies remain AtomicStage-only while the root palette exposes exactly the eight closed kernel kinds.
- Authored v1 remains v1 through duplicate, edit, save, and detail reload; compatibility origin/fields are retained and no implicit migration occurs.
- `pipelines/auto-decompose/pipeline.yaml` remains authored v1 and is outside this Change. Issue/Dispatch and portfolio-producing auto-decompose semantics remain 0.3.0 scope.

## Acceptance matrix

| Contract | Positive proof | Negative/refusal proof | Result |
|---|---|---|---|
| Blank v2 and all-eight vocabulary | `authors the shared all-eight v2 request from a real blank Canvas and submits it unchanged to validate and save`; shared fixture `canvas-v2-authoring.ts` | Pure model rejects blank/duplicate identities and non-positive limits | Pass |
| Definition/declaration contracts | Visible inputs, artifacts, outcomes, limits, custom declaration, body stage, exact capability, and execution policy are present in the exact request | Duplicate declaration, blank declaration, referenced-delete, incompatible phase/capability/access diagnostics remain visible | Pass |
| AtomicStage and Gate | Complete execution-v1 plus role/workspace/handoff policy; Gate target and every disposition are authored | Gate target/refusal tests keep same-graph Atomic authority and prove no `execution.gate` | Pass |
| BoundedLoop | Body reference, domain exits, all limits, complete `bounded-loop-lifecycle/1`, six mechanical dispositions, and exact optional strategy capability | Incomplete lifecycle and positive-attempt/missing-capability journeys are diagnosed; zero attempts omit strategy capability | Pass |
| FanOut/Join | One paired transaction authors members, paths, required/optional partitions, conditions, cap/budget, Join reference, and distinct outcomes | Empty membership, incoherent rename/remove, mismatched partitions, missing Join reference, and independent half deletion are refused/diagnosed | Pass |
| Diagnostic navigation | JSON-Pointer paths reach definition, declaration, body, root, execution, lifecycle, and parallel controls | Malformed, out-of-range, and newer unmapped paths retain severity/code/message/full path/related locations without false selection | Pass |
| v1 compatibility | `keeps an authored-v1 duplicate on the compatibility path through edit, save, and detail reload` | Asserts absence of v2 id/sourceId/declarations/root migration fields | Pass |
| Canonical no-op round trip | Real Management validate/save/detail and canonical re-read have equal preparation digests and canonical bytes | Canonical ordering is compared through canonical reparse, not browser insertion-order assumptions | Pass |
| Intentional edit | Changing only `limits.budget` from 32 to 33 changes source and plan digests, keeps the capability digest, and stabilizes on the next save/detail | Projection equality after replacing only limits proves no unrelated semantic drift | Pass |
| Portable path | Export/import uses `path.join`/`path.resolve`, package bytes equal the canonical file, and imported detail/digests remain equal | No hard-coded Windows or POSIX separator is asserted | Pass |
| Extension losslessness | Mounted unrelated edits preserve sentinels at definition, root graph/node, declaration/body graph/node, execution, and lifecycle owners through save/reload | Unknown paths are not guessed into a known control | Pass |
| Fresh-path parity | Canvas blank factory and core blank-v2 parity tests agree; not-found enters v2 | Duplicate from authored v1 explicitly stays on compatibility path | Pass |

## Shared oracle and real round trip

`packages/ui/test/fixtures/canvas-v2-authoring.ts` is dependency-free and shared by the mounted browser test and root Management integration test. It fixes one exact capability revision:

`skill:rasen-apply-change@sha256:a4559817d3de2f554890a24d53e4a26827086a0e0f51371213be1db4686c0e8f`

The root test first verifies that revision against the production workflow catalog. It then:

1. prepares the exact Canvas request with `EcpDefinitionModule.prepare`;
2. serializes canonical LF bytes with a final newline and reparses them to equal digests;
3. calls real Management validation and receives `valid: true` with zero issues;
4. saves and reads the actual user `pipeline.yaml`, byte-equal to the canonical writer output;
5. reloads detail and confirms all eight root kinds and equal preparation digests;
6. force-saves the reloaded definition with unchanged source/capability/plan digests;
7. exports and imports a native-path `.rasenpkg` whose pipeline manifest is byte-equal to the canonical file;
8. edits only definition budget `32 -> 33`, observes changed source/plan digests and unchanged capability digest, and proves the next save/detail is stable.

The canonical writer may reorder semantically unordered collections such as named outcomes and root nodes. The test therefore compares the browser's exact outbound request before persistence, then compares persisted meaning against a canonical reparse. It does not misclassify canonical ordering as semantic drift.

## Red-to-green evidence

The final tree intentionally contains no failing tests. Historical red evidence is retained in the role handoffs and this summary:

- Implementer 1 introduced the pure v2 model boundary at **11 failed / 2 passed**, then reached 4 files / 119 green tests.
- Implementer 2 introduced missing mounted controls at **4 expected failures / 55 passed**, then reached 4 files / 127 green tests.
- Implementer 3's first real core preparation of the shared all-eight fixture returned **12 diagnostics**: an unreachable declaration/outcome, a budget below max-actions, undeclared produced outcomes, and incomplete loop exit coverage. After correcting those semantics, one remaining undeclared iteration-limit outcome failed. The next run reached persistence and exposed canonical reordering. The final assertion distinguishes exact browser request shape from canonical semantic equality, and the full Management file is now 48/48 green.

These failures were discriminating: a fixture that merely contained eight JSON shapes was not accepted as executable v2.

## Verification evidence

| Gate | Result |
|---|---|
| `pnpm --dir packages/ui exec vitest run test/canvas/pipeline-canvas-page.test.tsx --reporter=dot` | 1 file / 64 tests passed |
| Focused Canvas model/layout/page/declaration-export/build-split/engine-support matrix | 7 files / 139 tests passed |
| `pnpm --dir packages/ui typecheck` | Passed |
| `pnpm --dir packages/ui test -- --reporter=dot` | 58 files / 638 tests passed |
| `pnpm exec vitest run test/core/management-api/pipelines-api.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` | 1 file / 48 tests passed |
| Focused Definition/canonical/Management/Composite/native-v2/parallel/Gate/lifecycle matrix | 8 files / 249 tests passed |
| Clean full root, default worker pool, isolated `E:\\` TEMP, JSON reporter | 433 test files/results; 1,788/1,788 suites passed; 6,809 passed, 34 pending, 0 failed, 6,843 total; `success: true` |
| `pnpm build` | Passed |
| `pnpm exec tsc --noEmit` | Passed |
| `pnpm lint` | Exit 0; 0 errors, 1 warning |
| `git diff --check` | Exit 0; only repository LF-to-CRLF notices |
| `node bin/rasen.js validate ecp-canvas-v2-authoring-parity --strict` | Valid |
| `git hash-object pipelines/auto-decompose/pipeline.yaml` | `6f306544010a8950508f1223acfca5d62de407f5` |
| `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml` | Clean |

The full-root authoritative report is retained at:

`E:\rasen-ecp6-root-temp-20260802-0833-clean-default-pool\root-suite.json`

### Full-root strategy correction

Two isolated single-worker attempts remained healthy and continued creating new workers/TEMP state but exceeded outer limits at 904 seconds and 1,802 seconds. Lead correctly reclassified this as serial throughput rather than a test failure and interrupted a third 60-minute attempt. On Windows, interrupting the outer cell did not stop that attempt's Vitest child tree; the exact worktree-scoped Vitest/worker/CLI PIDs were identified and stopped child-to-parent, after which a read-only process check found no remaining Node command line for this worktree. An initial default-pool attempt that overlapped that orphan was therefore discarded as resource-contended. The clean default-pool rerun then completed in 727.9 seconds with the green counts above. All attempt TEMP directories were preserved; none were deleted.

## Accepted limitations and follow-up gates

- Passing jsdom suites still print the repository's existing `window.scrollTo` and navigation-not-implemented notices. They are test-environment notices, not failed assertions.
- Lint reports one warning at `test/core/change-run/facade-settle-completeness.test.ts:139` for an unused disable directive. It existed in the shared dirty tree outside Implementer 3's files; lint has zero errors.
- Mounted sentinel coverage proves Canvas-side losslessness through the exercised controls and mocked reload. It does not claim that an arbitrary future closed execution/lifecycle field is already accepted by the current server validator.
- This Change proves authoring, preparation, canonical persistence, and portable round trips. Child 4 owns the canonical Run proof for the saved loop-plus-parallel definition.
- Independent review/remediation and the parent portfolio PR's Windows/Linux/macOS CI remain tasks 9.1–9.6.
