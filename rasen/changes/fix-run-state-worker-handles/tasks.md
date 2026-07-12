## 1. Run-state validation helpers (`src/core/pipeline-registry/run-state.ts`)

- [x] 1.1 Add `detectDuplicateKeys(content: string): { path: string; key: string }[]` — a non-fatal raw-text scanner that reports JSON keys repeated at the same object level (tracks object scope; ignores tokens inside string literals). Returns `[]` for clean input. (Design D3; spec: "Duplicate JSON keys in run-state detected".)
- [x] 1.2 Add `stagesLackingDurableHandle(state): { stage: string; keys: string[] }[]` — for each stage whose normalized `worker` has none of `agentId`/`transcript`/`threadId`, return the stage id and the non-durable keys it carries (e.g. `["name"]`); bare-string/role-only workers report `keys: []` (or `["<bare-string>"]`). Reuse `normalizeWorker`; do NOT mutate `collectStageWorkers`/`stageWorkers` behavior.
- [x] 1.3 Update the `RunStateWorkerSchema` doc comment (~L27–43) to state that a spawn `name` is NOT a durable handle and must not be substituted for `agentId`/`transcript`; keep the existing agentId-is-a-live-handle / transcript-is-cross-session wording otherwise intact.
- [x] 1.4 Export the two new helpers from the module; keep `RunStateWorkerSchema` optional + `.passthrough()` (no schema strictness change).

## 2. Resume surfaces the warnings (`src/commands/pipeline.ts`)

- [x] 2.1 In `resume`, call `detectDuplicateKeys` on the raw run-state text read from disk and `stagesLackingDurableHandle(runState)`; compute both before building the result object. (Design D1; spec: "Run-state worker-handle validation surfaced on resume" + "Duplicate JSON keys in run-state detected".)
- [x] 2.2 Add `workerHandleWarnings` and a duplicate-key warnings field to the `--json` result ONLY when non-empty (so existing callers see no new keys on clean runs).
- [x] 2.3 Print human-readable warning lines for each (name the stage + non-durable keys; name the repeated key + path) only when non-empty; resume stays exit 0.
- [x] 2.4 Update the "dead SendMessage handles" comment (~L423–425) to add the in-session reality: a completed worker is not reliably name-addressable even within a session, so re-engagement is agentId-first with a transcript warm-seed fallback.

## 3. Playbook text corrections (`src/core/templates/workflows/_orchestration.ts`)

- [x] 3.1 Step B dispatch (~L44–64): add an explicit instruction that the LEAD captures `agentId` + `transcript` from the Agent/Task tool's spawn RESULT and writes them into the stage `worker` record; state that a fabricated `name` must NOT be substituted. (Defect #1 root; spec: "Durable worker handles captured in run-state on dispatch".)
- [x] 3.2 Step A tier description (~L24–30): bound the Tier-A claim — agent-teams enables `SendMessage` re-engagement by `agentId` in general; a completed worker may not be reachable even in-session; record `agentId`+`transcript`, re-engage agentId-first, fall back to transcript warm-seed. (Spec: "Tier A capability claims bounded to observed behavior".)
- [x] 3.3 Step F.1 (~L172–183): replace the within-session-revival-by-name claim with agentId-first re-engagement; rewrite the "two are the SAME mechanism" note (~L183) so it no longer asserts name-based revival of a completed worker; prescribe transcript warm-seed fallback when `agentId` is absent/does not resolve. (Defect #2; spec MODIFIED "SendMessage-resume scoping".)
- [x] 3.4 Step H.4a(b) infra-death revival (~L264) and Step H.4b unticked-`DONE` (~L267): change each to re-engage by `agentId` (not name), with transcript-warm-seed fallback when `agentId` is absent/does not resolve. (Spec MODIFIED "SendMessage-resume scoping".)

## 4. Comment alignment in `auto.ts` + `claude-settings.ts`

- [x] 4.1 `src/core/templates/workflows/auto.ts` Resume section (~L99): align the restatement of within-session revival so it does not claim a completed worker is name-addressable; point to agentId-first + Step F.1 fallback.
- [x] 4.2 `src/core/claude-settings.ts` header doc comment (~L1–9): stop asserting that enabling agent-teams guarantees a completed worker is re-addressable for warm re-review; characterize it as enabling agentId-based re-engagement in general with the completed-worker caveat. (Spec: "Tier A capability claims bounded to observed behavior".)

## 5. Tests

- [x] 5.1 `test/core/pipeline-registry/run-state.test.ts`: cover `detectDuplicateKeys` — duplicate top-level key reported; duplicate nested under `stages` reported; the same key at two different object levels is NOT a duplicate; clean input returns `[]`.
- [x] 5.2 `test/core/pipeline-registry/run-state.test.ts`: cover `stagesLackingDurableHandle` — name-only worker reported with `name` in keys; bare-string/role-only worker reported; structured worker with `agentId`/`transcript`/`threadId` NOT reported.
- [x] 5.3 `test/core/pipeline-registry/run-state.test.ts`: assert `stageWorkers`/`collectStageWorkers` behavior is unchanged for durable-handle workers (regression guard) and that a name-only record is still omitted from `stageWorkers` (the drop is now warned about in resume, not silently useful).
- [x] 5.4 `test/commands/pipeline.test.ts`: resume a change with a name-only worker → `--json` includes `workerHandleWarnings` naming the stage + `name`; human output prints the warning; exit 0.
- [x] 5.5 `test/commands/pipeline.test.ts`: resume a change with a durable-handle worker → no `workerHandleWarnings`; existing `workers` assertion still passes.
- [x] 5.6 `test/commands/pipeline.test.ts`: resume a change whose `auto-run.json` has a duplicate key → `--json` includes a duplicate-key warning; file still parses (last value wins); exit 0.

## 6. Parity hashes, lint, typecheck, tests

- [x] 6.1 Regenerate the SHA-256 hashes for the parity-pinned templates that embed the edited playbook (`rasen-auto`, `rasen-review-cycle`, `rasen-goal` at minimum) in `test/core/templates/skill-templates-parity.test.ts`; run the parity test to confirm no other rendered template drifted unexpectedly.
- [x] 6.2 `pnpm lint` clean, `tsc` clean (no new `any`/unused-export issues from the helpers), `pnpm test` green.
