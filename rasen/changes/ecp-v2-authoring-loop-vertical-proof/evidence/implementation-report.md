# ECP-6 v2 authoring-loop vertical proof implementation report

Recorded on 2026-08-02 from `wip/ecp-shared-bounded-loop-lifecycle-resume` at the migrated implementation worktree. This report covers implementation tasks through 9.7. Independent review, parent delivery, remote CI, merge, and archive remain open in 9.8-9.10.

## Outcome and authority boundary

One Canvas-authored Definition v2 now drives both a successful and a required-member-failure Run through public product boundaries. The proof saves and reads the Definition through Management, launches and resumes through fresh built-CLI processes, commits real host evidence and effect observations through `pipeline complete`, and consumes the canonical `ChangeRunView` through CLI, Management, and Operations.

The vertical driver is an explicitly trusted test host. It does not start an agent runtime, create a Session executor, observe effects automatically, reuse or hand off workers, account Session usage, mutate a private reducer/store, or introduce a second product projector. Those execution responsibilities remain ECP-7. Issue Execution Plans, Dispatch, Acceptance, portfolios, and migration of `auto-decompose` remain 0.3.0.

## Sole fixture and frozen digests

- Fixture: `packages/ui/test/fixtures/canvas-v2-authoring.ts`
- Export: `CANVAS_V2_AUTHORING_DEFINITION`
- Source digest: `sha256:7c637546b22b91d2a242f01205165c3893aaef9ed2e33130198e9a10a865302d`
- Capability digest: `sha256:36d43bb2dabb64819c987ab5af5dc703cd2183ba789bae4de427ea6227dc26f8`
- Policy digest: `sha256:a11cd0e1eff98562ad73707155a8fc12ab145b338973195a0ad938f1e4d3b53c`
- Plan digest: `sha256:727b593cbc1993ba8ca33bb6d3e8bd6aee441ab9aa816762aac4326aa6e61cd6`
- Profile digest: `sha256:51773a842e60b9e80e066061a326a20e13b14bd4be76ba75449a5a49120220d8`

The saved Definition, prepared artifact, frozen plan, and both Runs assert these five digests exactly. No second Definition or hand-built `RuntimePlanInput` is used.

## Canonical identities

- Successful Run: `run:27947346eb59881f355f6530d3432d5b552ce52552c952d48d6baa533adc9a9f`
- Required-member-failure Run: `run:60f26fed06adc13066f717e8226050c4d658d938392fff14b4eb6a848a2decdb`
- Representative successful Action: `action:62032b3048e1a1693ad11729c2a99c83d71ae7fd2ecf1b3b4790cf5937aee9c2`
- Representative successful Effect: `effect:2a083d5ba8a2a11199a5519e5db773d30e64fecb3551bcde3996e47aa3afe295`
- Successful Gate Wait: `wait:2e199071ba2f374fb492fa5f2afc2fa972558aafa18937bfb52c2247159de91d`
- Representative failure Action: `action:38ab44d03923cde28739fb2f8fa6fd55d2c2ddaa4cb811e07a74179b70b674c4`
- Representative failure Effect: `effect:60f6da881e07da632ad26cdfe8522820a468dd5b12a4f6427f529a27a0cc2621`
- Failure Gate Wait: `wait:668d73c2d65f45c3d154dc56de9c5061e30d8266a10b0a6df29ddc9c094fae06`

The two Runs have distinct deterministic Run/launch identities and identical source, capability, policy, plan, and profile digests.

## Transition and projection ledger

The final expanded E2E crosses 73 real built-CLI process boundaries. Every mutation is followed by a fresh status read; repeated same-head reads are deep-equal and non-mutating. The checked-in capture is `evidence/management-view-capture.json`, produced by the real Management endpoint from the root vertical driver and consumed losslessly by the Operations acceptance test.

| Captured phase | Record version | Canonical status | Authoritative facts |
| --- | ---: | --- | --- |
| success-running | 1 | running | loop iteration 1; limits 3/12/12; first workspace effect admitted; required member still waiting |
| success-waiting | 7 | waiting | loop exited `done`; required member ready; Join waiting; exact Gate WaitId and controls visible |
| success-parallel | 7 | waiting | same Record head and same canonical view; no inspection mutation or client recomputation |
| success-terminal | 10 | completed | required member succeeded; Join proceeding; Finish outcome `done`; no actions, waits, or controls |
| failure-running | 1 | running | distinct Run; same frozen digests; first workspace effect admitted |
| failure-terminal | 10 | escalated (`failed`) | required `root:atomic-stage` failed; Join failed; exact blocker retained; success Finish unreachable; no actions, waits, or controls |

For each selected phase, the test compares built `pipeline status --json` exactly with real `GET /api/v1/runs/<change>/<run>`. The view includes `root-dag/1`, `bounded-loop-lifecycle/1`, `composite/1`, `parallel/1`, and `choice/1` sections from the same immutable plan and Record. `GET /api/v1/runs` also returns the two real Run summaries.

## Negative and recovery proof

`test/core/change-run/canvas-v2-vertical-proof.test.ts` proves all failures through public commands and asserts exact pre/post status equality:

- a malformed completion body fails decoding before facade/store mutation;
- validly shaped receipts with a wrong action, invocation, effect, actor-attestation binding, evidence binding, or receipt digest fail without advancing the Record;
- domain success before the required workspace effect fails closed, after which the same Action remains recoverable through the correct observation and domain result;
- a successful FanOut result that omits the frozen required member, or marks it inactive, is rejected without mutation or optionalization;
- the separate failure Run records the real required-member effect before submitting its failed domain result;
- the authored Join escalates failure, never reaches the successful Finish, and grants no post-terminal action.

Operations uses the captured Management view as server truth. On a `409 record_version_conflict`, it refetches and renders the returned terminal view; it does not merge the stale waiting view or retain stale controls.

## Product gaps found and closed with TDD

1. CLI status classified the launched Run as `workspace.scope=current`, while Management classified the same Run as another workspace and hid its controls. The root cause was different workspace identity derivation. `deriveRunWorkspaceIds()` now mirrors both supported CLI identity paths read-only: the exact selected-root legacy candidate plus the registered active/archived Change physical-identity candidate. Runs list, detail, and control admission share this helper.
2. Operations omitted Action effect identifiers even though Management projected them. `OperationsSection` now renders every server-projected effect slot, full EffectId, and state. It does not derive or reduce effect state locally.

Focused RED discriminators were the real CLI-versus-Management view deep equality and the Operations DOM assertion expecting two projected EffectIds. Both are GREEN after the minimal product changes.

## Requirement and task traceability

- Saved Definition, semantic digests, preparation/lowering, and stable identities: fixture/Canvas/Management matrices plus the fresh-process vertical E2E (requirements 1 and 3; tasks 1-6).
- Trusted observation, wrong-binding immutability, effect-before-domain ordering, replay/conflict, and infrastructure distinction: facade/CLI focused suites and the vertical negative matrix (requirement 2; tasks 3 and 7.1-7.3).
- Successful cross-plane explanation and deterministic recovery: vertical E2E plus the six Management capture phases (requirement 4 success/process-path scenarios; tasks 4-6 and 8.1-8.2).
- Required-member suppression and failure closure: separate failure Run in the vertical E2E (requirement 4 failure scenarios; tasks 7.4-7.7).
- Operations server-truth rendering and conflict refetch: `packages/ui/test/components/canvas-v2-vertical-proof.test.tsx` (tasks 8.3-8.5).

Every added requirement and scenario in `specs/ecp-change-run-runtime/spec.md` therefore has a direct focused assertion plus coverage in the full root or UI gate.

## Exact focused commands and results

- `pnpm --dir packages/ui exec vitest run test/canvas --reporter=dot`: 7 files, 149/149 passed (Canvas authored-v1/all-eight/handles/lifecycle matrix; recorded by implementer 2).
- `pnpm exec vitest run test/core/pipeline-registry/shared-declaration-profile.test.ts test/core/change-run/reconciler-ecp4.test.ts --reporter=dot`: 2 files, 21/21 passed.
- `pnpm exec vitest run test/core/change-run/canvas-v2-vertical-proof.test.ts --reporter=verbose`: 1/1 passed after expansion, 260.603 seconds, 73 real CLI processes.
- `pnpm exec vitest run test/core/management-api/run-control.test.ts test/core/change-run/runs-api.test.ts --reporter=dot`: 2 files, 48/48 passed for Management identity/control parity; the final helper refinement is additionally covered by the full root gate and clean archive-recreate rerun.
- `pnpm --dir packages/ui exec vitest run test/components/canvas-v2-vertical-proof.test.tsx test/components/operations-section.test.tsx test/components/operations-controls.test.tsx --reporter=dot`: 3 files, 24/24 passed.
- `pnpm --dir packages/ui exec vitest run test/canvas/draft.test.ts test/canvas/pipeline-canvas-page.test.tsx test/canvas/v2-authoring-model.test.ts --reporter=dot`: 3 files, 133/133 passed for the final authored-v1 audit. jsdom emitted its existing `window.scrollTo` not-implemented diagnostic; no test failed.

## Complete gates

- Full root, isolated serial command: `pnpm exec vitest run --reporter=json --outputFile=E:\rasen-ecp6-root-temp-20260802-final-serial\root-suite.json` with `TEMP`/`TMP=E:\rasen-ecp6-root-temp-20260802-final-serial` and `VITEST_MAX_WORKERS=1`.
  - Exit 0 in 5203.3 seconds.
  - 435 test files; 1793/1793 suites passed.
  - 6855 tests: 6821 passed, 34 pending, 0 failed, 0 todo; `success=true`.
  - Retained JSON: `E:\rasen-ecp6-root-temp-20260802-final-serial\root-suite.json` (2,433,683 bytes).
- Full UI serial: `pnpm --dir packages/ui exec vitest run --maxWorkers=1 --reporter=json --outputFile=E:\rasen-ecp6-ui-temp-20260802-140000-implementer3-serial\ui-suite.json`.
  - 59 files; 181 suites; 651 passed, 0 failed, 0 pending.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm --dir packages/ui run typecheck`: passed.
- `pnpm run build`: production build passed.
- `pnpm run lint`: exit 0, 0 errors, no new warnings. The one pre-existing warning is exactly `test/core/change-run/facade-settle-completeness.test.ts:141:1  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-explicit-any')`.
- `node dist/cli/index.js validate ecp-v2-authoring-loop-vertical-proof --type change --strict --json`: 1/1 valid, zero issues.
- `git diff --check`: exit 0; Git printed only LF-to-CRLF worktree conversion notices.
- `git hash-object pipelines/auto-decompose/pipeline.yaml`: `6f306544010a8950508f1223acfca5d62de407f5`, exactly the pre-change baseline; `git diff -- pipelines/auto-decompose/pipeline.yaml` is empty.

## Test-history disclosure

The first full root run used four workers and produced 6814 passed, 34 pending, and 7 failed tests. Six failures were Windows parallel file-lock/cleanup/exit-timing flakes; the seventh exposed the initial registered-workspace identity helper's pre-registration/archive transition gap. After the identity fix, the five affected files reran serially with 146 passed, 1 pending, and 0 failed. The definitive full serial gate above then passed all 435 files with zero failures. The first full UI run had one catalog used-key ordering flake; its focused rerun passed 11/11, and the definitive full serial UI gate passed 651/651.

No Node process scoped to this worktree remained after the final root gate.

## Review round 2 remediation addendum

The second review round found that observation authority was still caller-shaped,
the evidence bytes were command-local, the `planning:` selector was inconsistent
across list/detail/control, archive-candidate races lacked a deterministic seam,
and the real-process vertical exceeded its outer timeout twice. Those findings
were remediated with TDD and are recorded in
`evidence/review-remediation-round-2.md`.

The fresh round-2 vertical passed 1/1 in 455.28 seconds total with 73 process
boundaries and 73 transitions. Focused runtime/Management tests passed 140/140,
the Operations/UI matrix passed 24/24, build and both typechecks passed, lint had
zero errors, strict Change validation remained clean, and `auto-decompose`
remained byte-identical. The round-2 implementer did not mark tasks 9.8-9.10;
a fresh non-author review is still required.
