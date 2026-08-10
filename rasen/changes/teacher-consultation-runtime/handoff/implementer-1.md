# Handoff: teacher-consultation-runtime — implementer #1

## Original intent

新增一个 Teacher workflow。它参考 Anthropic Advisor 的建议模式，但不作为由模型主动调用的工具 API；它必须成为 ECP/Canvas 可编排的 workflow，使 implementer 在执行过程中遇到问题时可以直接向只读 Teacher 请求解决建议，并在原会话中继续执行，不经过 LEAD 中转。

## Position

Pipeline: small-feature. Completed stages: propose. Current stage: apply（核心 consultation runtime 已实现大部分契约与状态机，尚需补齐 executor/SessionHost、Facade、daemon 及端到端验证）。

## Done / Remaining

Done: consultation question/invocation/advice/resume/unavailable contracts and deterministic identities; `consultable-leaf` worker contract; optional frozen consultation profile binding and legacy digest compatibility; canonical consultation lifecycle, Record/reducer states, direct Teacher reconciliation, continuation grants, projection, sponsored reads, and executor continuability declarations; focused contract/profile/lifecycle/reservation/capability tests; TypeScript no-emit check.

Remaining: production executor and SessionHost continuation/replay tests; Facade attestation and end-to-end consultation journey tests; daemon execution-face wiring; BoundedLoop non-interference and restart-boundary tests; focused regression suites and full TypeScript/build/Rasen validation; mark task checkboxes only when their corresponding verification is complete.

## Key decisions (and why)

- Consultation is a direct runtime edge from a paused source implementer Action to a separate read-only Teacher Action; no LEAD Action is introduced, avoiding the extra model turn and cost the user called out.
- Existing `leaf` behavior remains byte-for-byte compatible; `CONSULT` is accepted only through the separate `consultable-leaf` contract.
- Consultation identity, advice correlation, budget accounting, continuation identity, and replay are canonical Record state so restart/reconciliation cannot rely on transient process memory.
- Teacher authority is frozen in the execution profile and must be read-only, effect-free, and unable to override runtime-owned invocation or continuation input.
- Consultation counters and transitions remain independent of BoundedLoop progress, blocker, iteration, and strategy state.

## Dead ends & gotchas

- An initially over-strict UUID validator caused two focused-suite failures; it was corrected and the consultation lifecycle tests passed afterward. Re-run the broader focused suite to confirm the correction everywhere.
- The predecessor checkpoint completed before this document was persisted; this file was reconstructed from the structured compaction handoff. Do not assume an old worker handle remains resumable.
- The branch intentionally has no task checkboxes marked yet because implementation pieces still require the matching verification evidence.

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)

none — this is an implementer handoff, not a fixer/debugger investigation.

## Working set

Primary implementation: `src/core/change-run/consultation-contracts.ts`, `src/core/change-run/internal/consultation-lifecycle.ts`, canonical Record/reducer/reconciler/facade/projector/reservation modules, frozen-action executor modules, pipeline profile validation, worker contracts, Claude/Codex invocation contracts, and daemon agent command seams. Focused tests are under `test/core/change-run/`, `test/core/frozen-action-executor/`, `test/core/pipeline-registry/`, and `test/core/worker-contracts.test.ts`.

Known green commands: `pnpm exec tsc --noEmit`; initial focused suite 29 tests; `consultation-lifecycle.test.ts` 2 tests. The broader suite must be rerun after the UUID correction.

## Next action

Run `rasen instructions apply --change teacher-consultation-runtime --json`, read every returned context file plus this handoff, inspect the current executor/SessionHost tests, then finish the production continuation/replay path and its focused tests before moving to Facade/daemon/end-to-end coverage.
