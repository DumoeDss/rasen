# Independent review remediation evidence

Date: 2026-08-02

## Outcome

All five Major findings from `review-report.md` are resolved locally and covered by focused regression tests. The implementation remains inside the ECP 0.2.0 boundary: the six Change-level built-ins are authored v2, while `auto-decompose` remains the byte-identical authored-v1 Issue/Dispatch compatibility fixture for 0.3.0.

## Finding closure

1. **Gate node single authority**
   - `AtomicStage.execution.gate` is retired and rejected as an unknown authored field.
   - A Gate now targets one AtomicStage and owns its outcome list plus the complete `proceed | fail | escalate` disposition map.
   - Validation rejects dangling targets, non-Atomic targets, duplicate Gates for one target, and inconsistent disposition keys.
   - Profile projection, prepared execution view, lowering, and reconciliation derive gate behavior from the targeted Gate only.
   - Mutation tests prove changing Gate id/outcomes/dispositions changes the runtime plan exactly; removing the Gate removes the runtime gate.

2. **Management API host-aware parity**
   - Management inventory and detail detect one host per request, or accept an injected host for deterministic tests.
   - That same host is used for v1 and v2 runtime projection.
   - Codex-host and Claude-host tests compare Management output with the shared CLI/prepared projection, including effective runtime, dispatch mode, and bridge.

3. **Native-v2 route and bridge preflight**
   - Native-v2 launch now projects the prepared execution view before selection or Run creation.
   - Unsupported routes fail with `pipeline_runtime_route_unsupported`.
   - Every required bridge is probed once and unavailable bridges fail with `pipeline_runtime_unavailable`.
   - Cross-host Codex-to-Claude and Claude-to-Codex fixtures prove rejection occurs before selection/Run creation.

4. **ReviewCycle fix authority**
   - Added the internal `rasen-review-fix` workflow as the sole write-capable fix-phase capability.
   - `rasen-review` remains read-only for review, triage, and independent re-review.
   - Capability descriptors advertise closed phase contracts; lowering fails closed when a phase uses an incompatible capability, role, or workspace access.
   - Exact pin: `skill:rasen-review-fix@sha256:737e61418515fb67d0bdf46626f80b0e0c418a38d7b931b9bf69d320a520cad0`.

5. **GoalLoop judge authority**
   - Added the internal read-only `rasen-goal-judge` workflow for measure/evaluate/research judge results.
   - Goal work remains write-capable under `rasen-goal-iterate`; judge declarations require reviewer/read authority and preserve author != verifier.
   - Exact pin: `skill:rasen-goal-judge@sha256:944c21e977d795c1ee2c67f5a0ad0534e8b40a8c1f746ecd83ae89a4e51de40c`.

## Install closure

- `review-cycle` strongly requires `review-fix` and the `review` expert.
- `goal-command` strongly requires `goal-judge` in addition to the capabilities reached through its three native-v2 pipelines.
- Selection, dependency-graph, init, update, and review-cycle installation tests prove these internal workflows are installed transitively and remain non-selectable.

## Validation

- Strict Change validation: passed, zero issues.
- Final focused ECP-6 remediation matrix: 20 files, 295 tests passed, zero failed.
- Install-closure matrix (`selection`, `dependency-graph`, `review-cycle`, `init`, `update`): 5 files passed, exit 0.
- Root build: passed.
- Root TypeScript `--noEmit`: passed.
- Root lint: exit 0; one pre-existing unused-disable warning remains at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- UI typecheck: passed.
- Full UI suite: 57 files, 611 tests passed; existing non-failing jsdom `scrollTo`/navigation messages remained on stderr.
- Post-remediation root full-suite attempts reached 120 seconds and 304 seconds respectively and timed out without a final summary; no assertion failure appeared before timeout. The pre-remediation child-2 clean-root evidence was 432 files and 6788 passed / 34 pending / 0 failed, but it is not represented as post-remediation proof.
- `git diff --check`: passed.
- `node bin/rasen.js validate ecp-v2-default-authoring-and-builtins --strict`: passed.
- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`: clean.

## Remaining external gate

Task 9.5 remains open for the parent portfolio PR: required Windows CI and normal Linux/macOS lanes must be green. No local finding from the five-item review remains open.

