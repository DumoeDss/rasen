## Why

The same-day session that produced this portfolio also produced four independent, evidence-backed dispatch-protocol failures in the shared LEAD orchestration playbook (`src/core/templates/workflows/_orchestration.ts`, embedded into `auto`, `review-cycle`, and the goal-loop command): a worker's completed result silently dropped because it returned only as plain text instead of via `SendMessage`; a worker that had already handed off getting re-woken by a stale, pre-handoff message and colliding with its already-dispatched successor; an apply implementer left idle (undispatched keepalive) through an 8.8-minute review window until its cache expired, forcing a 226k-token cold rewrite when fixes routed back to it; and a LEAD that sent two separate `SendMessage`s 20 seconds apart to the same worker, each one independently rebasing (and re-taxing) its conversation. Each was fixed ad hoc in that session by adding a one-off instruction; none of the fixes are yet in the durable playbook text that every future run reads.

## What Changes

- **Worker-return delivery contract:** every dispatch prompt's return contract (Step B's dispatch template, Step H.3) states that the worker's `DONE`/`HANDOFF` return MUST be delivered via `SendMessage` to the LEAD, not solely as the worker's final plain-text turn output — plain text alone is not reliably observed by the LEAD under the harness's background-agent delivery path.
- **Post-handoff stale-instruction immunity:** once a worker has returned `HANDOFF` or `DONE`, it treats any inbound instruction that predates that return as expired — it acknowledges and stays idle rather than resuming work; the LEAD-side mirror: after accepting a worker's `HANDOFF`, the LEAD does not send further work to that (retired) worker.
- **Apply-implementer parking through the first review verdict:** when a review/verify stage immediately follows apply and the implementer's context is high enough that a cold rebuild would be expensive, the LEAD dispatches it to park (`rasen agent wait`) between finishing apply and receiving the first review verdict, instead of leaving it un-parked to idle out and pay a full cache rewrite if fixes route back to it.
- **LEAD-side message-batching discipline:** consecutive instructions to the same live (non-parked) worker are combined into a single `SendMessage` whenever no intermediate result is needed, rather than sent as separate messages that each independently rebase the worker's conversation.

## Capabilities

### Modified Capabilities
- `orchestration-handoff`: the "Worker handoff contract" requirement gains the SendMessage-delivery mandate and the post-handoff stale-instruction-immunity behavior (both LEAD-side and worker-side).
- `opsx-orchestration`: gains an explicit message-batching discipline for the LEAD's `SendMessage` usage toward a live worker.
- `worker-reuse-orchestration`: gains a parking rule for the apply implementer's window between finishing apply and its first review verdict, extending the same keepalive mechanism the playbook already uses for review-loop reviewer/fixer parking.

## Impact

- `src/core/templates/workflows/_orchestration.ts`: the sole source of the shared playbook text — embedded into `auto.ts`, `review-cycle.ts`, and `goal-command.ts` via the exported `ORCHESTRATION_PLAYBOOK` constant. Editing it here is sufficient; none of the three consuming templates duplicate this wording locally (verified by reading each file — they cite playbook step numbers and interpolate the constant, not restate it).
- `test/core/templates/skill-templates-parity.test.ts`: the golden-hash test covering `getAutoCommandSkillTemplate`, `getReviewCycleSkillTemplate`, and `getGoalCommandSkillTemplate` (the three functions whose generated output embeds `ORCHESTRATION_PLAYBOOK`) needs its expected hashes regenerated after the text change.
- No code-logic changes — this is a prompt/instruction-text change to what the LEAD tells itself and its workers to do; no runtime behavior outside agent-authored text is altered.
- Coordination note: `rasen/changes/agent-wait-keepalive/` (shipped in code via PR #36, not yet archived/spec-synced) carries a pending delta on `worker-reuse-orchestration` introducing the `ONE_SHOT`/`LOOP_BOUND`/`MILESTONE_BOUND` reuse-horizon vocabulary that Step B.4 of the CURRENT template already uses. This change's `worker-reuse-orchestration` delta is written as an ADDED requirement (not a MODIFIED one) against today's main specs — which do not yet contain that vocabulary — and is worded to extend it by reference rather than duplicate it; see design.md for the sync-order note.
