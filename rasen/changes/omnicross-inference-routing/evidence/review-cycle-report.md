# Review cycle report: `omnicross-inference-routing`

## Round

Review round 1 — FIXER response to the two open Major findings in `evidence/review-report.md`.

## Exact files changed for this fix

- `src/core/frozen-action-executor/production-executor.ts`
- `src/core/frozen-action-executor/index.ts`
- `src/core/management-api/frozen-action-executor.ts`
- `src/core/omnicross/lease-execution.ts`
- `test/core/frozen-action-executor/production-executor.test.ts`
- `test/core/management-api/frozen-action-executor.test.ts`
- `test/core/omnicross/omnicross.test.ts`
- `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md`

## Finding resolutions

### Major 1 — shipped frozen-Action daemon face lacked a route-aware process bridge

Resolved in source.

- Added `createProductionRoutedTurnExecutor()`, which dispatches a validated one-attempt route binding through the existing real `runCodexExec()` or `runClaudePrint()` runner selected by the frozen Action runtime.
- The bridge derives runtime, model, sandbox, and reasoning effort from the granted frozen Action, and accepts route authority only from the validated closed `RuntimeRouteBinding`.
- The child environment is built with `buildRoutedChildEnvironment()`: the named OmniCross Admin/control credential is removed, and only the reduced route environment is added.
- Codex receives the reduced in-memory provider override and route-token env key; no `config.toml` or `auth.json` mutation was introduced. Claude receives only the reduced child environment; no settings or credential-file path is consulted or changed.
- Route-token values are passed to both runners as explicit secrets for diagnostic redaction.
- The hosted production constructor in `handleFrozenActionDispatch()` now supplies this bridge to the real hosted seam. Unrouted Actions retain the existing SessionHost path.
- The in-tool injectable seam remains supported by `createProductionExecutor()` when a real launcher-liveness probe is supplied. The Management API does not fabricate such a probe or advertise a live in-tool seam.
- Added a Management API integration test for each runtime. Each test starts at `handleFrozenActionDispatch()`, acquires a lease from the fake OmniCross daemon, reaches the real Claude/Codex runner and fake executable without injecting a turn callback, bypasses the unrouted SessionHost dispatch, releases the lease, and checks returned output for route/Admin secrets.

The bridge currently uses the existing leaf worker contract. The closed canonical Action schema freezes result/evidence contract digests but does not carry the runtime bridge's `WorkerContract` discriminator; this matches the currently executable leaf-turn surface rather than widening that schema during a review fix.

### Major 2 — cancellation could be reported as success when the callback ignored abort

Resolved in source.

- After the runtime callback settles, `withOmniCrossRoute()` now checks its supervised signal.
- If external cancellation occurred and no typed route-loss failure won the race, a callback that ignored abort and resolved is classified as non-retryable `cancelled`, not success.
- Existing route-loss precedence is preserved: a renewal/route-loss failure remains authoritative over ordinary cancellation.
- Existing best-effort release behavior is unchanged.
- Added a discriminating test whose callback deliberately ignores abort, resolves successfully afterward, and is nevertheless returned as `cancelled`; the test also checks exactly one release.

## Checks and results

| Check | Result |
| --- | --- |
| Static trace of the shipped Management API constructor to the hosted seam and real Claude/Codex runners | Completed. The constructor now supplies `createProductionRoutedTurnExecutor()` and routed turns bypass the unrouted SessionHost dispatch. |
| Static trace of cancellation settlement and final precedence | Completed. Post-settlement cancellation is recorded before final result selection, while `routeFailure` remains first. |
| `git diff --check` | Passed (exit 0). Git emitted only working-copy LF-to-CRLF warnings. |
| `pnpm exec vitest run test/core/management-api/frozen-action-executor.test.ts test/core/frozen-action-executor/production-executor.test.ts test/core/omnicross/omnicross.test.ts` | Not executed: terminal permission approval was required and was not granted. No passing result is claimed. |
| Direct local Vitest executable with the same three files | Not executed for the same permission reason. No passing result is claimed. |
| `tsc --noEmit` through pnpm and the local executable | Not executed: terminal permission approval was required and was not granted. No passing result is claimed. |
| `node build.js` | Not executed: terminal permission approval was required and was not granted. No passing result is claimed. |

## Residual concerns

- Dynamic verification remains outstanding because the environment denied every focused test, typecheck, and build command before execution. The next verifier must run the commands listed above before accepting the change as fully verified.
- The canonical Action schema does not freeze a `leaf` versus `evaluate` runner discriminator. This fix therefore preserves the currently executable leaf-turn contract and does not infer a different contract from mutable state or widen a closed descriptor during review repair.
- No user Claude/Codex credential or configuration files and no sibling OmniCross repository files were read, written, or modified by this fix.

## Round 1 continuation — hosted callback compile repair

LEAD's independent `pnpm exec tsc --noEmit` exposed a callback variance defect in the M1 wiring: `createProductionRoutedTurnExecutor()` was annotated as `InToolRoutedTurnExecutor`, whose return intentionally permits `undefined`, and therefore could not satisfy the hosted seam's required `Promise<TurnResult>` callback.

### Exact continuation delta

- `src/core/frozen-action-executor/production-executor.ts`
  - Added the narrow `RoutedTurnExecutor` type returning `Promise<TurnResult>`.
  - Reused that type for `HostedBackendSeamOptions.executeRoutedTurn`.
  - Changed `createProductionRoutedTurnExecutor()` to return `RoutedTurnExecutor`, matching its real implementation: every successful runner call returns a settled success result and every failed runner call returns a settled failure result; validation/configuration errors throw and are typed by the route lifecycle.
  - Kept `InToolRoutedTurnExecutor` unchanged as `Promise<TurnResult | undefined>` because an in-tool launcher can genuinely have no settled turn and liveness reconciliation owns that state.
- `src/core/frozen-action-executor/index.ts`
  - Exported the new `RoutedTurnExecutor` type.
- `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md`
  - Recorded this continuation and its check outcomes.

No assertion, cast, fallback, or `undefined` normalization was added. The hosted routed bridge remains fail-closed and cannot silently produce a no-turn result. The mismatch did not reveal a runtime branch in `createProductionRoutedTurnExecutor()` that returns `undefined`, so no runtime test was added; the discriminating check for this defect is TypeScript assignability at the shipped Management API constructor.

### Continuation checks

| Check | Result |
| --- | --- |
| Static type trace | Completed. The production bridge and hosted callback now share `RoutedTurnExecutor -> Promise<TurnResult>`; only the in-tool callback retains `TurnResult | undefined`. |
| `pnpm exec tsc --noEmit` | Re-attempted, but terminal permission approval was required and the command was not executed. LEAD must rerun to record the post-fix compiler result. |
| `pnpm exec vitest run test/core/management-api/frozen-action-executor.test.ts test/core/frozen-action-executor/production-executor.test.ts` | Re-attempted, but terminal permission approval was required and the command was not executed. No passing result is claimed. |

## Round 1 continuation — Management API routed-test harness repair

LEAD ran the post-type-fix focused suite on the latest tree and reported:

- `test/core/omnicross/omnicross.test.ts`: 42/42 passed.
- `test/core/frozen-action-executor/production-executor.test.ts`: 16/16 passed.
- `test/core/management-api/frozen-action-executor.test.ts`: 7/9 passed; both new routed production cases failed in `writeGrantedRecord()` before dispatch with `TypeError: reduceCanonicalRunRecord is not a function`.
- Aggregate: 65 passed, 2 failed.
- `pnpm exec tsc --noEmit`: passed on the latest tree.
- Build: passed on the latest tree.

### Diagnosis

The harness imported `reduceCanonicalRunRecord` from `change-run/internal/record.ts`. That module owns the canonical Record contract, creation, decoding, and digest functions; it does not export the state-transition reducer. The reducer's production module is `change-run/internal/reducer.ts`, so the named ESM import resolved to `undefined` at runtime in the test transform and failed when called. The same helper also hand-published a JSON head revision instead of exercising the canonical filesystem RunStore publication seam.

### Exact repair

Only `test/core/management-api/frozen-action-executor.test.ts` changed for this continuation:

- Import `reduceCanonicalRunRecord` from its canonical `internal/reducer.ts` module.
- Construct `createFilesystemRunStore(storeRoot)`, publish the v0 Record with `store.create()`, admit/grant the routed Action through the real reducer stimulus, and publish the resulting v1 head with `store.commit()`. This preserves admission/grant and predecessor-digest invariants rather than fabricating a granted Record or writing JSON directly.
- Add a per-runtime process marker to the turn input and assert the fake Claude/Codex executable wrote a numeric PID/PPID marker. Together with the existing zero-SessionHost-dispatch assertion, exact fake-daemon POST/DELETE counts, successful executed outcome, and empty active-lease set, this proves each case reaches `handleFrozenActionDispatch()`, acquires a lease, invokes the real runner/fake process without callback injection, and releases the lease.

No internal API was exported, no cast/assertion or admission bypass was added, and production code was unchanged.

### Harness-repair checks

| Check | Result |
| --- | --- |
| `git diff --check -- test/core/management-api/frozen-action-executor.test.ts rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md` | Passed (exit 0). |
| `pnpm exec vitest run test/core/management-api/frozen-action-executor.test.ts` | Attempted twice after the repair, including a sandbox-override request, but terminal permission approval was required and neither command executed. No post-repair pass is claimed. |
| Full three-file focused command | Not run because the exact-file prerequisite could not execute under terminal permissions. The last completed full-suite result remains LEAD's pre-repair 65 passed / 2 failed listed above. |

### Remaining verification list

There are no known remaining source or harness defects after the static repair. Dynamic status remains unverified; the exact Management API file must pass 9/9, then the full three-file suite must pass 67/67 before round 1 can be marked fully verified.

## Round 2 fix

### Findings resolved

#### Major 3 — routed bridge hardcoded the leaf worker contract

- Added the shared validated `WorkerContractZodSchema` and an additive optional `workerContract` field to canonical effective policy stages and agent Actions. Optionality is decode-only compatibility: all newly resolved stages freeze an explicit value.
- Native and compatibility-normalized profiles derive `evaluate` only from immutable Definition authority: a judge phase inside a `goalCycleVariant: evaluate` bounded loop. Every other new stage freezes `leaf`; role, prompt text, and current mutable Pipeline state are not consulted.
- The field participates in the existing effective-policy digest and therefore the runtime-profile digest, is copied into each new Action, and is compared against the committed Action during frozen-Action authority validation.
- Both production Codex and Claude routed process branches now pass the Action's frozen discriminator to their existing structured-output runners. Their validated worker payload is propagated through `TurnResult` and the typed Management API outcome.
- Historical profiles and Actions without the field still decode. Historical unrouted Actions retain the SessionHost path. A historical routed Action without enough authority to distinguish leaf from evaluate returns a non-retryable typed `invalid-input` route failure before lease acquisition.
- Added discriminating tests for Action propagation/closed decoding, profile and policy digest changes, immutable evaluate-judge derivation, committed/granted authority mismatch, old routed fail-closed behavior, and real Management API → fake daemon → real Claude/Codex runner evaluate payloads. The evaluate fixtures return `{ satisfied, gaps, summary }`, which the former hardcoded leaf schema rejects.

#### Minor 1 — routed hosted turns bypassed `maxInputBytes`

- Extracted `validateTurnInputBytes()` from the SessionHost command validator so unrouted and routed hosted turns share the exact UTF-8 byte policy and stable message.
- The production executor applies the bound after frozen-Action/backend authority checks but before `RoutedActionLifecycle.execute()`, so oversized routed input requests no lease and reaches no runtime process. The process bridge repeats the same validation as defense in depth for direct callers.
- Added production-executor and real Management API multibyte coverage. The Management API test asserts the typed `route-failed` / `invalid-input` outcome, zero fake-daemon requests (including zero lease creates), no process marker, and no active lease.

### Exact Round 2 delta

- `src/core/worker-contracts.ts`
- `src/core/pipeline-registry/execution-plan-internal.ts`
- `src/core/pipeline-registry/profile-resolver.ts`
- `src/core/change-run/contracts.ts`
- `src/core/change-run/internal/actions.ts`
- `src/core/session-host/contracts.ts`
- `src/core/frozen-action-executor/action-outcome.ts`
- `src/core/frozen-action-executor/authority.ts`
- `src/core/frozen-action-executor/executor.ts`
- `src/core/frozen-action-executor/production-executor.ts`
- `test/core/change-run/actions.test.ts`
- `test/core/change-run/execution-plan.test.ts`
- `test/core/change-run/lowerer-native-v2.test.ts`
- `test/core/frozen-action-executor/authority.test.ts`
- `test/core/frozen-action-executor/production-executor.test.ts`
- `test/core/management-api/frozen-action-executor.test.ts`
- `rasen/changes/omnicross-inference-routing/specs/frozen-action-session-executor/spec.md`
- `rasen/changes/omnicross-inference-routing/tasks.md`
- `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md`

### Round 2 checks actually executed

| Check | Result |
| --- | --- |
| Static trace: Definition GoalCycle variant/phase → profile policy → policy/profile digest → Action creation → committed authority check → Claude/Codex runner | Completed. The only `evaluate` derivation is the immutable evaluate GoalCycle judge; both routed runner calls consume `action.agent.workerContract`. |
| Static trace: Management API hosted limits → production executor → pre-lease validation → routed lifecycle → process bridge | Completed. The shared UTF-8 check occurs before `routedActionLifecycle.execute()` and is repeated before binary resolution/spawn. |
| `git diff --check` | Passed (exit 0). Git emitted only working-copy LF-to-CRLF warnings. |

### Remaining risk

Dynamic verification is still outstanding because terminal permission was not granted for typecheck, focused tests, or build; none executed and no passing result is claimed. No user Claude/Codex credential or configuration file and no sibling OmniCross repository file was read or modified.

## Round 3 fix

### Design decision

The canonical Record is now the only Action object authority at dispatch. Both the caller receipt and committed Action have already passed the same strict closed `RunAction` decoder, so authority validation compares their complete `canonicalJson()` representations instead of maintaining another security-sensitive list of selected fields. A successful validation returns `committed.action`, and the executor uses that Record-owned object for route detection, worker-contract checks, Route Lease creation, and both routed and unrouted backend calls. The caller object is never dispatched.

This deliberately preserves historical compatibility without weakening decoding: an old receipt equals an old committed Action when both omit the same additive optional fields. A historical routed Action still fails closed before leasing when `workerContract` is absent. Attempt and retry semantics are unchanged because separately admitted attempts remain separately committed Actions with their canonical attempt/action identities; equality is applied only within the selected committed Action.

Typed worker-result redaction is now separate from diagnostic bounding. `sanitizeAgentDiagnostic()` retains the existing depth/breadth/byte limits for rendered diagnostics. `sanitizeAgentDiagnosticValue()` recursively redacts strings and sensitive-key values without slicing arrays, dropping object fields, or replacing deep valid structure, so a value cast back to its validated worker-result type has not been structurally truncated.

### Exact Round 3 delta

- `src/core/frozen-action-executor/authority.ts`
  - Replaced partial identity/authority comparisons with complete canonical Action equality.
  - Changed successful validation to return the committed Record's Action.
  - Bound the actual-workspace check to the committed Action.
- `src/core/frozen-action-executor/executor.ts`
  - Uses only `validation.action` for route selection, worker-contract validation, lifecycle acquisition, and backend dispatch.
- `src/core/agent-diagnostics.ts`
  - Split bounded diagnostic redaction from structure-preserving typed-value redaction.
- `test/core/frozen-action-executor/authority.test.ts`
  - Added complete-Action mutation coverage and an object-authority assertion proving the Record object is returned.
- `test/core/management-api/frozen-action-executor.test.ts`
  - Added pre-lease/pre-process mutation coverage through the shipped face.
  - Added real Claude and Codex evaluate paths with 105 gaps and nested route-secret echoes, followed by schema revalidation.
- `test/core/agent-diagnostics.test.ts`
  - Added a direct structure-preservation/redaction guard beyond the former breadth and depth limits.
- `test/fixtures/claude/fake-claude.mjs`
- `test/fixtures/codex/fake-codex.mjs`
  - Added `evaluate-many` outputs containing 105 secret-bearing gaps.
- `rasen/changes/omnicross-inference-routing/specs/frozen-action-session-executor/spec.md`
  - Added complete committed-Action authority and historical equality scenarios.
- `rasen/changes/omnicross-inference-routing/specs/omnicross-inference-routing/spec.md`
  - Added typed worker-result structure-preservation requirements.
- `rasen/changes/omnicross-inference-routing/tasks.md`
  - Recorded complete Action authority and typed-result preservation work.
- `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md`
  - Added this Round 3 fix record.

### Exhaustive mutation matrix

The authority-level parameterized matrix independently changes all agent execution-bearing fields in the closed Action contract:

| Group | Independent mutations |
| --- | --- |
| Agent selection | `role`, `model`, `reasoningEffort`, `runtime`, `sandbox`, `workerContract` |
| Frozen inference | upstream Provider, inference model, endpoint, control-token environment identity, request timeout, lease TTL, config revision |
| Work input | complete `agent.input` value |
| Session authority | `reuse`, additive `sessionReuseAuthored`, `handoffTokenLimit`, `reuseRoundLimit` |

Every candidate is decoded again through `decodeRunAction()` before validation, so the cases prove that strictly decodable mutations—not malformed input—fail with typed `receipt_conflict`. Existing per-field guards continue to cover Action/run/invocation identity, expected workspace, capability contract digest, policy digest, effects, and the broader canonical Action surface. A separate guard asserts that a canonically equal transport copy is accepted but the returned execution object is the committed Action by object identity.

The shipped Management API matrix independently changes inference, runtime, model, sandbox, reasoning effort, input, and session, plus role as a broad canonical-equality guard. For each of its eight cases it requires `receipt_conflict`, no new fake-daemon request, no active lease, and no process marker. Thus the reviewed execution-bearing fields are rejected before lease or process through the real face rather than only by the pure validator.

### Verification and counts

| Check | Result |
| --- | --- |
| Static Record-authority trace | Completed: strict body decode -> head Record decode -> complete canonical equality -> `validation.action` -> route/lifecycle/backend. No post-validation executor reference to the caller Action remains. |
| Static result-preservation trace | Completed: Claude and Codex parse the full evaluate value, structure-preserving redaction runs in each runner, the production bridge repeats only structure-preserving redaction, and the Management API test revalidates all 105 gaps with `EvaluateGateZodSchema`. |
| Added authority mutation cases | 18 strict-decoder unit cases, covering every agent field/group above, plus 1 Record-object identity case. |
| Added shipped-face authority cases | 8 mutations in one real-face test; each asserts zero lease/process effects. |
| Added result-preservation paths | 2 real process paths (Claude and Codex), each preserving 105/105 gaps and revalidating the redacted result; plus 1 direct redactor guard. |
| Focused Vitest suite | Attempted first with 6 files and then with the final 9-file Action/authority/executor/Management API/diagnostics/Claude/Codex set, but terminal permission approval was required and neither command executed. 0 dynamic tests are claimed. |
| `pnpm exec tsc --noEmit` / local `tsc.cmd --noEmit` | Both forms were attempted, but terminal permission approval was required and neither command executed. No pass is claimed. |
| `node build.js` | Attempted, but terminal permission approval was required and the command did not execute. No pass is claimed. |
| `git diff --check` | Passed (exit 0). Git emitted only working-copy LF-to-CRLF warnings. |

### Residual risks

- Dynamic verification remains mandatory: run the focused authority/executor/Management API/Claude/Codex/diagnostics tests, TypeScript check, build, and diff-check before accepting Round 3. This fixer claims no unexecuted pass.
- `sanitizeAgentDiagnosticValue()` assumes validated typed results are acyclic JSON-compatible values. Its cycle map prevents runaway recursion for defensive callers, but cycles are outside every worker-result schema and are not a supported output contract.
- The dispatch API still carries `turnInput` as the existing driver-rendered string while `agent.input` remains frozen Action data. Round 3 binds the entire Action and dispatches the Record-owned object; it does not redesign the pre-existing Action-input rendering interface.
- M1-M3 and Minor-1 control flow remains intact: production routed wiring, post-settlement cancellation authority, frozen worker-contract selection, and the pre-lease UTF-8 bound were not weakened.
- No user credential/configuration file or sibling OmniCross repository file was read, written, or modified.

## Post-cap strategy attempt 2 fix

The successor repaired the five candidate-preview failures reported by LEAD without weakening receipt or stale-frontier invariants:

- corrected the valid receipt candidate fixture to match its view's Run and Record version;
- preserved thrown Action-builder errors while extending pending-reservation cleanup across collection, reduction, and store-failure boundaries;
- made explicit admission validate the exact agent frontier while allowing the same transaction to reconcile non-agent workspace contention into a durable wait;
- updated contention proofs to require zero partial Actions, one durable wait, post-mutation candidate identity, idempotent repeated resume, and eventual serialization after release;
- corrected the runtime-context preview fixture so its first stage is actually ready rather than gated, retaining assertions for zero admitted Actions and stable repeated preview identity.

A follow-up audit corrected the earlier command/host conclusion. `RuntimeCapabilityBindingSchema`, the lowerer, runtime plan, and reconciler all admit `agent | command | host`, but `prepareRuntimeContext` unconditionally called `buildAgentAction` and fabricated `non-agent-adapter-owned-input`. The profile previously froze only `actionKind`, which was insufficient for command/host construction: the ECP run-spine design explicitly requires exact executable/argv/env/workdir/timeout authority and forbids deriving commands, Adapter paths, or validators from Definition/capability names.

The fix makes the frozen capability binding a closed discriminated union. Agent bindings remain byte-shape compatible. Command bindings additionally freeze exact executable identity/digest, argv, env allowlist, relative working directory, and timeout; host bindings freeze the allowed host operation. `prepareRuntimeContext` now verifies descriptor kind equals frozen capability kind and dispatches exhaustively: agent still requires the exact trusted `renderedTurnInput`; command calls `buildCommandAction` with the sealed command authority plus the launch-frozen `WorkspaceInstanceId`; host calls `buildHostAction` with the sealed operation and descriptor input. No placeholder input, cross-kind stage cast, capability-name inference, or agent preview/turn-input weakening remains.

`test/core/change-run/runtime-context.test.ts` now creates reachable first-stage command and host profiles. Both are admitted directly with no agent candidate; assertions discriminate their exact closed Action fields and prove absence of `agent`, `turnInput`, and the old placeholder. The existing agent preview test remains unchanged in authority: zero Actions before explicit admission, stable candidate identity over resume, and exact rendered-byte binding.

Exact replacement-lease identity proofs remain in `test/commands/agent-omnicross.test.ts`: Codex returns `threadId: vertical-thread` under both `lease-1` and replacement `lease-2`; Claude returns `sessionId: vertical-session` under both `lease-1` and replacement `lease-2`. The integration test was not rewritten.

`git diff --check` had previously passed with only LF-to-CRLF working-copy warnings. A final-two successor then tightened the rollback test so the deliberately synchronous second-build failure is captured as the exact public rejection before any cleanup assertions; the post-rejection proof compares the complete durable Record byte-for-byte-equivalent object state, requires zero Actions and unchanged Record version, and requires an empty reservation snapshot with no finalized entry. The preview test now repeats through the production `resume` path, requires the same `candidateId`, zero admitted Actions, and an exact one-entry manifest before explicit admission. No launch-conflict behavior or injected error classification was weakened.

After the command/host fix, `pnpm exec tsc --noEmit`, the focused four-file Action/runtime-context/facade/reconciler suite, and `pnpm exec vitest run test/commands/agent-omnicross.test.ts` were each attempted. All three were intercepted by the command permission layer before execution. Therefore no dynamic pass, 36/36 preservation, identity-test pass, build, AT count, full-suite result, validation result, or completed 7.1–7.8 task claim is recorded. The remaining continuation is to run those exact commands and resolve any type/test failures before acceptance.

A fresh test-only migration then repaired the three stale assertions from LEAD's five-file run. The Action happy-path now supplies stable multibyte trusted prompt bytes and independently asserts the `agent-turn-input/1` NUL-delimited domain digest, exact UTF-8 byte length, media type, and rendering contract while retaining historical omission decoding. The facade start and resume cases now prove prompt-free, stable candidate preview with a byte-logically unchanged Record; explicit `admit` resolves exact trusted bytes and grants one bound canonical agent Action; repeated admission is rejected as `candidate_stale`; repeat launch, launch-conflict, and normalized launch-intent coverage remain. The exact two-file Vitest command was attempted but intercepted by the command permission layer before execution, so no dynamic pass is claimed. Test-only `git diff --check` passed with no output; no task boxes were checked.

The compatibility migration adds two centralized test-driver seams rather than restoring auto-admission or scattering fabricated prompts. `test/helpers/change-run-admission.ts` consumes an exact receipt frontier, verifies every full candidate descriptor against its preview, renders deterministic trusted test bytes keyed by candidate identity/run/version/node/occurrence/profile/input, calls public `facade.admit`, rejects duplicate/unpreviewed/unused candidates, and wraps lifecycle mutations so goal/review helpers preserve their existing completion, actor, occurrence, recovery, and ack-loss boundaries. `test/helpers/pipeline-cli-admission.ts` drives fresh-process tests through the shipped `pipeline admit --turn-input-file` command, writes the exact no-extra manifest under the change's private `ephemera/`, and returns the admitted receipt while retaining launch metadata needed by existing assertions. Goal-cycle, review-cycle, evaluator validation, CLI completion, composite dogfood, bug-fix/complex fresh-process, ack-loss, and Canvas vertical-proof fixtures were migrated to these shared seams; the physical readiness production-entry helper now performs the same exact preview/admit transition internally because it is production preparation code rather than a CLI fixture. CLI structure/completion and orchestration guidance expectations were narrowed to include the real `admit` protocol.

Dynamic verification remains blocked by terminal permission. Reading LEAD's required full failure output at `C:/Users/Sayo/AppData/Local/Temp/claude/E--AI-ChatAI-Agents-VibeCodingProjects-workflow/Reference/OpenSpec-code/999328bd-d63f-42bc-8601-06c98da26b69/tasks/bm7pn88xv.output`, `pnpm exec vitest run test/core/change-run/goal-cycle-canonical.test.ts`, and `pnpm exec tsc --noEmit` each requested permission and were not executed. Therefore the migration has not been typechecked, no cluster/file pass count is claimed, source-template digests have not been recomputed, and tasks 7.1–7.8 remain unchecked.

### LEAD final verification of strategy attempt 2

The continuation repaired the remaining compatibility failures without restoring auto-admission:

- the fresh-process manifest helper now writes under the canonical execution-root `.rasen/changes/<change>/ephemera/` safe root;
- helper output preserves the lifecycle preview disposition while returning admitted Actions, and the composite dogfood separately asserts the `created` preview and `advanced` admission receipts;
- shared store-selection guidance names `pipeline admit`, and every affected generated-skill and shipped-pipeline content digest was recomputed from the production generators/catalog rather than copied from generated `.claude/skills` output;
- the Canvas/apply fixtures and exact capability-pin tests were rebaselined to those generated catalog digests;
- one pre-existing U+FFFD sequence in `test/core/pipeline-registry/run-state.test.ts` was repaired to an em dash before the final encoding scan.

Executed gates on the final tree:

| Check | Result |
| --- | --- |
| Seven-file lifecycle cluster | Passed: 121/121 tests. |
| CLI/E2E + template/help parity cluster | Passed: 85/85 tests. |
| Built-in package digest audit | Passed: 5/5 tests. |
| Full `pnpm test -- --reporter=dot` | Passed: 539 files, 8170 tests; 4 files / 59 tests skipped; 0 failures. |
| `pnpm exec tsc --noEmit` | Passed. |
| `pnpm build` | Passed, including source-owned ProcessCapsule build. |
| `node dist/cli/index.js validate omnicross-inference-routing --strict --json` | Passed: 1/1 valid, zero issues. |
| `git diff --check` | Passed; only working-copy LF→CRLF warnings. |
| Changed-file UTF-8 + JSON/YAML parse scan | Passed for 116 files at scan time; no U+FFFD remained after repair. |
| Prompt/secret persistence scan | No rendered prompt body, route token, control token, or credential-like assignment found in canonical change/run-state artifacts. |

Tasks 7.1–7.8 are checked only after the complete dynamic and static gate set above passed. Final independent re-review remains the last review-loop exit condition.

## Round 6 — FIXER response to the post-rebase independent re-review

Responds to "Round 6 - post-rebase independent re-review (Decision 13 + rebased seams)" in
`evidence/review-report.md` (1 Blocker, 1 Major, 3 Minor). Every disposition below was
proved by mutation from a reachable state, not by inspection.

### Blocker 1 — a consultation-eligible source Action can never execute through the shipped daemon face: `resolved`

The daemon face keyed its server-side turn-input derivation on
`participatesInConsultation()`, which is true for the eligible **source** implementer as
well as the Teacher. The source's committed binding holds the LEAD's driver-rendered
prompt, so substituting `canonicalJson(agent.input)` failed this change's own transport
authentication with `execution_input_mismatch` before any backend, making `CONSULT`
unreachable in production.

`src/core/management-api/frozen-action-executor.ts` now derives server-side **only** when
the granted Action is the bound Teacher (`teacherConsultation !== undefined`, already
computed upstream for the hosted-seam guard). Every other consultation-driven Action keeps
its caller-transported bytes, which its own `agent.turnInput` binding authenticates.
Trusting `envelope.turnInput` uniformly was rejected: it would hand the Teacher's question
back to the caller and undo Decision 13.

The reviewer's diagnosis that the fixture hid this was correct, and the masking ran deeper
than the renderer:

1. The admitting driver's renderer emitted `JSON.stringify(candidate.input)` — byte-identical
   to the substitution. Replaced with `fixtureDriverPrompt()`, a realistic prose base prompt
   that is deliberately not canonical JSON.
2. `HttpConsultationTransport.send` opened with `JSON.parse(turn.input)`, so a prose prompt
   threw and surfaced as `backend-spawn-failed`. The fake backend was structurally usable
   only by a driver that rendered canonical JSON. It now tolerates a non-JSON turn, which
   restores the production distinction: prose is the source's turn, a JSON envelope is the
   Teacher's or a continuation's.
3. Three assertion sites re-parsed every recorded turn. `decodeTurnContract()` yields an
   empty object for a prose turn, so contract filters stay exact.

Diagnosis note: the transported prompt's byte length matched its binding exactly
(167 = 167) while the dispatch still failed, which ruled out turn-input authentication as
the cause and located the JSON assumption instead.

*Mutation MUT-B1*: restore the `consultationDriven` keying, changing nothing else.
**3 RED**, all three through the real HTTP daemon face. Before the fixture repair the same
mutation — that is, the shipped code — was fully green. Mutation reverted.

Recorded as Decision 14 in `design.md` and task 7.10; a new spec scenario
("A consultation-eligible source keeps its caller-transported prompt") states the contract.

### Major 1 — the `resolveDispatchRoute` `canDispatch` guard has no discriminating test: `resolved`

`omp` and `zed` are recognized hosts that cannot dispatch, which makes them the only inputs
separating the guard's two candidate conditions; every prior case was satisfied by either.
Added four pinned cases to the routed matrix in
`test/core/pipeline-registry/omnicross-inference.test.ts`.

*Mutation MUT-7 replay*: revert the routed branch to `if (host === 'unknown')`. Previously
green across 62 tests; now **4 RED**. Mutation reverted; 58 pass restored.

### Minor 1 — the primary Decision 13 test contains no discriminating assertion: `resolved, but not as suggested`

The suggested repair — assert `.message` in the first test too — was applied and **failed**:
by that point the consultation is `teacher-active`, the Teacher is already admitted and the
frontier is empty, so `admit` reaches the pre-existing generic emptiness rejection. The
Teacher-specific message is not merely unasserted there, it is untrue.

The first test now pins the generic message (`no agent candidates to admit`) with a comment
recording why this state cannot reach the runtime-owned refusal, so the two same-code
rejections are distinguished rather than blurred. The runtime-owned refusal remains proved
by the blocked-Teacher test, which is the only state that reaches it.

The reviewer's second suggestion — release the forced reservation conflict and re-admit —
is **not implemented**; that path remains untested and is recorded below.

### Minor 2 — the spec scenario overclaims the transport assertion: `resolved`

Correct: on the shipped path `dispatchAction` short-circuits to
`exactTeacherAttemptModule.executeAndSettle` whenever the module is present, and the
Management API always supplies it, so `dispatchGrantedAction` is never entered for a
Teacher and the length/digest comparison does not run. The scenario now states that the
exact-Teacher route pins its bytes by server-side construction from the committed Action
rather than by a transport comparison.

### Minor 3 — the executor's `renderingContract` argument is inert: `resolved`

The argument is removed. The comment now records why it is deliberately *not* passed: the
contract is excluded from the digest preimage, so supplying it could not affect either
compared field; it is authority, enforced by complete canonical Action equality, not by
this comparison.

### Checks and results

| Check | Command | Result |
| --- | --- | --- |
| Consultation journey + executor + Management API | focused `vitest run` over the three paths | **67 files / 835 passed, 1 skipped** |
| Routed matrix + runtime adapters + safe-path | focused `vitest run` over the three files | **58 passed** |
| Full suite | `npx vitest run` | **8400 passed / 2 failed / 59 skipped (8461)** |
| Both full-suite failures re-run in isolation | `capstone-journeys`, `legacy-groups-removed` | **Both pass** (2/2 and 6/6); each timed out at ~30 s under parallel load only |
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npx eslint <changed src + test>` | clean |
| Whitespace | `git diff --check` | clean |
| Change validation | `node bin/rasen.js validate omnicross-inference-routing --strict` | valid |

### Residual concerns

1. The safe-root alias repair below **cannot be proved locally**: `canvas-v2-vertical-proof`
   passes on this machine and failed only in the CI path-alias environment. Synthetic
   plumbing proves the alias logic; only CI can prove the original failure is gone. It is
   not claimed as verified.
2. The reviewer's untested state stands: releasing the forced `reserveConsultationRead`
   conflict and then calling `admit` — the case where admission would otherwise mint the
   Teacher — has no coverage.
3. `consultationReconcileCandidates`'s global short-circuit remains load-bearing for three
   separate safety arguments and is still not called out in the design.
4. All mutations in this round were executed by the LEAD and by two subagents of this
   session. The standing limitation that separately dispatched `rasen agent` workers are
   refused `pnpm`/`npx`/`node -e` at the permission layer is unchanged.

### Separate defect fixed in the same pass: safe-root rejects alias-spelled roots

Not from the review; found by enumerating PR #156's per-job CI failures.
`canvas-v2-vertical-proof` failed on macos-shard-3 and windows-shard-2 with
`Target lexical path escapes the safe root.` The containment test in `assertSafeRunPath`
was purely lexical and ran before the realpath walk, so one directory spelled two ways
(macOS `/var` vs `/private/var`, Windows 8.3 names) was rejected. That test file is touched
by this branch — it was switched to the Decision 12 admission helper — and
`_orchestration.ts` directs real LEADs to the same path, so this is a product defect, not a
test artifact.

`safe-path.ts` now asks, when the lexical form does not match, whether some **ancestor** of
the target *is* the root under another name: a non-link directory whose realpath equals the
root's. Only ancestors are resolved; everything below the root stays lexical and walked, so
a link inside the root still cannot resolve its way into containment, and a link pointing
into the root is refused because the link itself is not accepted as the root.

*Mutation MUT-SP1* (drop the whole link rejection): **3 RED**, including a real-filesystem
escape test. *Mutation MUT-SP2* (drop **only** the explicit symlink/reparse rejection,
keeping `!isDirectory`): **2 RED**, both from synthetic-plumbing tests, with the
real-filesystem test green. That second result is the important one — node's `lstat`
reports `isDirectory: false` for a link, so real-filesystem tests are structurally blind to
this guard, while the `SafePathStat` contract models a junction as `isDirectory: true` plus
`isReparsePoint: true`. Only synthetic plumbing discriminates it. Both mutations reverted;
16/16 pass.
