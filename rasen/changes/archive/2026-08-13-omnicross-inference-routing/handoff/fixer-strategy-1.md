# Fixer handoff: post-cap strategy attempt 1

## Status

HANDOFF. Tasks 7.1-7.8 remain unchecked. Do not report this strategy attempt as complete.

The low-level Record-owned execution assertion is substantially implemented, but the required trusted pre-admission driver boundary is not complete. The current hidden `--turn-input-file` bridge is only a partial transport seam: shipped orchestration templates do not render or populate it, and the existing reconciler flow admits/grants an Action before the LEAD composes the complete worker prompt. Consequently, normal production `pipeline start`, `resume-run`, `complete`, and `control` calls can reach agent admission without `resolveAgentTurnInput`, where `runtime-context.ts` now fails closed. This does prevent minting an unbound new agent Action, but it does not provide the required usable real-driver path.

## Work completed in this attempt

- Added optional closed `agent-turn-input/1` authority to canonical agent Actions for historical decoding compatibility.
- Added Action-builder-owned derivation over UTF-8 bytes using `agent-turn-input/1`, a zero byte separator, and the exact rendered bytes.
- Added a canonical 2 MiB admission bound and made `buildAgentAction` require rendered bytes.
- Added a mutation-context resolver seam and bounded private-ephemera manifest reader. The reader accepts prompt bytes only; it never accepts caller-authored digest or byte length.
- Added Record-owned execution validation after complete Action equality and before backend selection/lifecycle work.
- Added route-independent non-retryable results:
  - `execution_input_authority_missing`
  - `execution_input_mismatch`
  - `execution_input_too_large`
- Preserved historical unrouted caller-rendered behavior and made historical routed omission fail closed.
- Threaded the shared dispatch-time byte limit into hosted and in-tool production executor faces while retaining runner limits.
- Added/updated low-level Action, executor, production-executor, runtime-context, and Management API coverage. The latest Management API edits align the receipt-mutation test's bound bytes, change the oversized expectation to `execution_input_too_large`, and add changed-only Claude newline/equal-JS-length multibyte cases.
- Fixed the three revival compiler defects semantically:
  - `InputReaderError` codes are mapped to `input_too_large` or `invalid_run_request` rather than cast.
  - nullable `ephemeraDir` is normalized with `?? undefined`.
  - settle grant collection reads `context.deliveryMode`.
- Removed an accidental literal NUL from `src/commands/pipeline.ts` by using `JSON.stringify([nodeId, occurrence])` as the manifest key.

## Blocking architecture issue

The approved strategy requires the existing complete driver render before Action admission. Current source orchestration does the opposite:

1. `rasen pipeline start/resume-run/complete/control` reconciles and admits/grants the next Action.
2. The LEAD reads the granted Action.
3. The LEAD then composes the full worker brief from workflow instructions, Action-specific review/goal context, artifact paths, and handoff clauses.

The partial manifest implementation assumes that exact prompt already exists before step 1, but no shipped driver currently creates it. Candidate identity is also supplied as canonical `nodeId + occurrence`, while the current LEAD-facing workflow does not receive that candidate before admission.

A correct continuation needs an explicit pre-admission protocol rather than a late renderer. One viable direction is:

1. Add a driver-facing candidate preview/quiescent boundary that exposes the exact next candidate descriptor without admitting it.
2. Let the trusted workflow driver render the complete base prompt from that frozen descriptor and existing driver-owned context.
3. Resume admission with a private bounded prompt manifest keyed to that exact candidate.
4. Builder computes the binding and admits/grants atomically.
5. Ensure completion never auto-admits a successor before the driver has rendered it; it should settle to the same preview boundary and require a subsequent admission call.

This changes receipt timing and source workflow instructions, so it needs focused compatibility design and tests. Do not solve it by serializing `agent.input`, loading current Pipeline/skill text during retry, or persisting prompt bodies.

## Additional correctness concern

`src/core/change-run/internal/runtime-context.ts` currently rejects every non-agent admission. The frozen plans and reconciler types still support `command` and `host`. Audit whether production prepared profiles can reach those kinds. If they can, restore `buildCommandAction`/`buildHostAction` construction rather than leaving this broad regression. This was not introduced intentionally by the approved strategy.

## Eliminated hypotheses

- `agent.input` can be serialized as the prompt: false; it is structured lifecycle metadata and omits the rich driver brief.
- Current Pipeline/skill artifacts can be re-rendered at execution or retry: false; mutable content would break exact retry authority.
- The capability digest alone reconstructs the prompt: false; it does not bind Action-specific task context or a retrieval/render contract.
- Complete Action equality already authenticates request `turnInput`: false; `turnInput` is a sibling request field.
- Routed-only enforcement is sufficient: false; it leaves hosted/in-tool unrouted execution with the same second authority channel.
- The hidden manifest by itself completes the trusted boundary: false; no shipped source driver currently creates it before admission.
- Admitting an unbound Action in `defer` mode and binding later is safe: false; it violates mandatory authority for every newly admitted agent Action and changes canonical identity after admission.

## Churn audit

The revival began with 81 tracked files and approximately +6745/-3871. `src/commands/pipeline.ts` alone showed approximately +3864/-3686 because the strategy turn had rewritten line endings and briefly inserted a literal NUL. A scoped diff with end-of-line whitespace ignored showed that the actual content changes were narrow.

Current audit after removing the NUL and normalizing that accidental churn:

- 81 tracked files changed.
- Aggregate tracked diff: +3100/-200.
- `src/commands/pipeline.ts`: +196/-12.

The remaining high-delta files are substantive pre-existing OmniCross and prior review-fix work, not wholesale strategy-turn rewrites, notably:

- `test/core/management-api/frozen-action-executor.test.ts`: real daemon/runtime vertical coverage plus strategy cases.
- `test/core/frozen-action-executor/production-executor.test.ts`: routed production executor and authority cases.
- `src/core/frozen-action-executor/production-executor.ts`: existing routed Claude/Codex lifecycle/process integration plus the shared input limit.
- `src/commands/agent.ts`, Claude/Codex runners, OmniCross modules, pipeline/config/docs/tests: legitimate feature implementation present before this strategy fix.

No broad restore, reset, or `git checkout --` was used.

## Verification state

Not verified after the latest edits:

- `pnpm exec tsc --noEmit` was requested but the terminal permission layer did not execute it. Do not claim the three compiler errors are cleared until rerun.
- Focused tests were not run after the latest Management API edits.
- Build was not run.
- Full tests were not run.
- Change validation was not run.
- Persistence/sentinel scans were not completed.

Verified command result:

- `git diff --check` completed without whitespace-error output (it emitted only Windows line-ending conversion warnings).
- Current `git diff --numstat`/`--shortstat` produced the churn numbers above.

## Test work still required

Complete and run AT-1 through AT-14, especially:

- Assert exact authenticated base bytes reach fake Claude/Codex runtimes, not merely successful result decoding.
- Prove zero SessionHost create/resume/dispatch, launcher settle/execute, process spawn, stdin, and lease activity on mismatch.
- Add real exact retry/resume with replacement Route Lease while preserving session/thread identity.
- Keep leaf/evaluate authority algorithm identical while preserving discriminating result contracts.
- Add mutation receipts that independently turn red when each guard or typed code is removed/relabelled.
- Scan canonical Records, run state, evidence, receipts, logs, and telemetry for prompt-body and route/admin secret sentinels.
- Prove legacy `rasen agent dispatch --prompt-file` is byte-for-byte behaviorally unchanged.

## Required closeout after implementation

1. Rerun typecheck and fix errors semantically.
2. Run focused change-run, frozen executor, Management API, SessionHost, Claude, and Codex suites.
3. Run build and full tests under the 270-second background rule.
4. Run change validation and `git diff --check`.
5. Append the exact heading `Post-cap strategy attempt 1 fix` to `evidence/review-cycle-report.md`, including this churn explanation and actual verification output.
6. Update architecture-index details for the final retained admission seam.
7. Mark tasks 7.1-7.8 only after all proof is complete.
