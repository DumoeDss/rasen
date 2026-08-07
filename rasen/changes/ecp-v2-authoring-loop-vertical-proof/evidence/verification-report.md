# Verification Report: ecp-v2-authoring-loop-vertical-proof

Verified independently on 2026-08-02 in
`wip/ecp-shared-bounded-loop-lifecycle-resume` at
`050fc84332b26a75a07f441efd6b235842f89e1e`. The exact worktree contains the
cumulative ECP-6 implementation; this verification reviewed the Child 4 seams in that
context and did not modify production code, tests, task checkboxes, or run state.

## Verdict

**FAIL.** The connected Canvas-to-Run proof, public observation boundary, durable
recovery, failure closure, and single projection all pass fresh verification. One
Major workspace-authorization finding remains open: an identity-derivation failure is
treated as an unrestricted/current workspace and can admit control of another
worktree's Run.

VERIFY VERDICT: BLOCKED — Blocker:0 Major:1 Minor:0 Trivial:0

## Summary scorecard

| Dimension | Status | Evidence |
| --- | --- | --- |
| Completeness | PASS | 66/69 tasks are checked. All 66 implementation/evidence tasks through 9.7 have direct evidence; 9.8 independent review, 9.9 review-clean closure, and 9.10 parent PR/CI/merge/archive are intentionally open workflow-tail tasks. |
| Correctness | FAIL | 4/4 requirements and 12/12 scenarios have public-boundary assertions and fresh focused coverage, but workspace-scope authorization fails closed only when identity derivation succeeds. |
| Coherence | PASS, subject to Major | The implementation follows the single-Definition, production launch, trusted-host, fresh-process, failure-run, and single-projector decisions. No second runtime model or private completion path was found. |
| ECP-6 scope | PASS | No Session executor, agent/worker dispatch, automatic effect observation, worker reuse/handoff, usage accounting, ECP self-hosting, Issue/ExecutionPlan/portfolio migration, or `auto-decompose` migration was introduced. |
| Evidence freshness | PASS | Retained full-suite JSON was parsed independently; strict/diff/hash/typecheck and high-signal root/UI/product-boundary suites were rerun fresh. |

## Major findings

### M1 — Workspace identity derivation fails open and can admit cross-worktree control

**Evidence**

- `src/core/management-api/run-workspace-identity.ts:48-73` wraps all identity
  derivation and archive enumeration in one `try`, then returns `[]` for every error at
  lines 71-72. A missing selected root reproduces this result against the built product:
  `deriveRunWorkspaceIds(<missing-root>, null, "ecp6-vertical-proof")` returned `[]`.
- `src/core/management-api/runs.ts:398-405` treats an empty result as no list filter and
  includes every Run.
- `src/core/management-api/runs.ts:503-515` sets `isOtherWorkspace` only when the result
  is non-empty, so an indeterminate identity returns the unredacted current-workspace
  view with granted Actions and controls.
- `src/core/management-api/run-control.ts:310-323` rejects a mutation only when the
  result is non-empty and mismatched; an empty result therefore admits control.

**Impact**

An unavailable, unreadable, stale, or concurrently moved selected root/archive path
turns an authorization failure into an unrestricted workspace match. Management can
misclassify a Run from another worktree as current and allow a control mutation, which
violates the required fail-closed workspace identity boundary.

**Recommendation**

Represent identity derivation failure distinctly from a valid empty candidate set and
fail closed in list, detail, and control. Add discriminating regressions for an
unavailable/unreadable root and archive-enumeration failure proving: list does not leak
the Run, detail projects `workspace.scope: "other"` with no granted Actions/controls
(or returns a typed unavailable error), and control returns a typed rejection without
Record mutation.

## Blocker findings

None.

## Minor findings

None.

## Trivial findings

None.

## Requirement and design verification

- **One Canvas-authored Definition:**
  `packages/ui/test/fixtures/canvas-v2-authoring.ts:46-195` is the sole definition
  oracle and contains seven authored connections. The mounted Canvas journey compares
  Validate and Save directly with that export at
  `packages/ui/test/canvas/pipeline-canvas-page.test.tsx:1145-1177`.
  The vertical test imports only that export (`test/core/change-run/canvas-v2-vertical-proof.test.ts:20-23`),
  saves it through Management (`:338-390`), and launches the saved pipeline through the
  built CLI (`:619-669`). No inline second Definition was found.
- **Trusted observations:** `src/core/change-run/internal/facade-runtime.ts:539-621`
  verifies the admitted action/completion, observation authority, completion slot, and
  routes effect/infrastructure observations through the canonical reducer stimuli.
  Fresh focused tests cover exact action/invocation/effect/evidence/attestation binding,
  receipt replay/conflict/no mutation, infrastructure classification, and
  effect-before-domain. Observation alone does not synthesize a domain result.
- **Fresh-process recovery:** every public command uses `runCLI`, which spawns a new
  Node process; the driver records one distinct process ordinal per command
  (`test/core/change-run/canvas-v2-vertical-proof.test.ts:435-520`). Repeated reads,
  frozen plan equality, and persisted Record-head equality are asserted across the
  named process-loss boundary (`:1009-1027`) and after terminal closure (`:1136-1168`).
  Plan/Record files are read only for comparison; the test never imports or calls the
  private reducer or store mutation APIs.
- **Fail-closed loop/parallel behavior and projection ownership:** malformed and
  identity-mismatched completions plus effect ordering are checked without Record
  mutation (`:699-1059`). The successful loop/required-member/Join/Finish projection is
  asserted at `:1102-1157`; the distinct required-member-failure Run and identical five
  frozen digests are asserted at `:1177-1415`. CLI status is compared by deep equality
  with real Management detail at `:538-548`. Operations consumes the checked-in,
  lossless Management capture and fresh UI tests prove rendering/refetch without a
  second projector.
- **Scope exclusions:** source/test search and exact diff inspection found only the
  explicitly trusted test host performing deterministic effects. No Session executor,
  automatic observer, worker lifecycle, usage accounting, Issue/ExecutionPlan, or
  product portfolio implementation was added. `pipelines/auto-decompose/pipeline.yaml`
  has no diff and remains blob
  `6f306544010a8950508f1223acfca5d62de407f5`.

## Retained machine evidence audit

- Root JSON:
  `E:\rasen-ecp6-root-temp-20260802-final-serial\root-suite.json`,
  SHA-256 `0FA384E12ED33C780282DFC57A8259965D4AC32E3251D7F12B96751E9B588599`,
  `success=true`, 435 files, 1793/1793 suites, 6855 tests = 6821 passed +
  34 pending + 0 failed.
- UI JSON:
  `E:\rasen-ecp6-ui-temp-20260802-140000-implementer3-serial\ui-suite.json`,
  SHA-256 `CA4483229E4FB97FB4638DE3B9F5F25B34A18275349A48097BCBD58829C7A804`,
  `success=true`, 59 files, 181/181 suites, 651/651 passed, 0 failed.
- The Management capture parses as `ecp6-vertical-management-capture/1`, contains six
  real success/failure views, and has SHA-256
  `1070DEF1720CFF6347F546D262A653F1A95EBDACAE96784FE198208ABACC3767`.

## Fresh verification results

- Strict Change validation: 1/1 valid, zero issues.
- Root TypeScript and UI typecheck: passed.
- `git diff --check`: passed.
- `auto-decompose` hash/diff: expected blob matched; no diff.
- Root high-signal group: 6 files, 98/98 passed (facade completion, CLI completion,
  shared-declaration profile, FanOut Gate/reconciler, Management Run detail/control).
- Operations group: 3 files, 24/24 passed.
- Full vertical product-boundary test: 1/1 passed in 346.97 seconds with 73 distinct
  built-CLI processes. Fresh success Run
  `run:9050cae7b63f46605db1d3360e675ff964bb9f4119a99fef4092b92d111f1aaf`
  and failure Run
  `run:f9d43e8c4ccf5c64244e9e7abe5ac254faf784f91ec17a4fe71f3e2d56378964`
  retained the expected source/capability/policy/plan/profile digests. No scoped Node
  process or fresh sandbox remained afterward.
- Test-history disclosure: the first fresh vertical invocation was cut off only by the
  verifier's 424-second outer command timeout and emitted no test failure. It left no
  scoped Node process. The identical command was rerun with a 720-second outer window
  and passed as recorded above.

## Final assessment

The implementation is not ready for review-clean closure while M1 is open. Fix the
workspace identity fail-open, add list/detail/control failure regressions, and rerun the
focused Management tests plus this independent verification. Tasks 9.8 and 9.9 remain
unchecked; task 9.10 remains parent-owned.

TEST EVIDENCE
- scope: strict Change validation; diff/hash; root and UI typechecks; six high-signal root files; three Operations files; full Canvas-to-Run product-boundary vertical journey
- rationale: covers the changed facade receipt boundary, shared declaration/profile and Gate seams, Management workspace identity/control, Operations projector consumption, and the real filesystem/fresh-process success and failure journeys without rerunning the retained 87-minute full root suite
- command: `node dist/cli/index.js validate ecp-v2-authoring-loop-vertical-proof --type change --strict --json`; `git -c core.safecrlf=false diff --check`; `git hash-object pipelines/auto-decompose/pipeline.yaml`; `pnpm exec tsc --noEmit`; `pnpm --dir packages/ui run typecheck`; `pnpm exec vitest run test/core/change-run/facade-settle-completeness.test.ts test/core/change-run/cli-complete.test.ts test/core/pipeline-registry/shared-declaration-profile.test.ts test/core/change-run/reconciler-ecp4.test.ts test/core/management-api/run-control.test.ts test/core/change-run/runs-api.test.ts --reporter=dot`; `pnpm --dir packages/ui exec vitest run test/components/canvas-v2-vertical-proof.test.tsx test/components/operations-section.test.tsx test/components/operations-controls.test.tsx --reporter=dot`; `pnpm exec vitest run test/core/change-run/canvas-v2-vertical-proof.test.ts --reporter=verbose`
- result: pass
- tree: 58489c46633a209d2c1761c2a4b684ad8b95cb48
