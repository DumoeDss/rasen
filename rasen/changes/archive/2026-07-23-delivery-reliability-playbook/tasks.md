## 1. Fix 1 — worker-return delivery via SendMessage

- [x] 1.1 In `src/core/templates/workflows/_orchestration.ts` Step B's dispatch template quote (the `Task tool (subagent_type: ...)` example), amend the ending to require delivering the return via `SendMessage` to the LEAD, not solely as the final plain-text turn output
- [x] 1.2 In Step H.3 ("Worker self-handoff (the dispatch-prompt clause)"), amend both the "On trigger" (HANDOFF) and "On `DONE`" bullets to state the return MUST be delivered via `SendMessage`

## 2. Fix 2 — post-handoff stale-instruction immunity

- [x] 2.1 In Step H.3, add a clause: after returning `HANDOFF`/`DONE`, the worker treats any inbound instruction predating that return as expired — acknowledge and remain idle, do not resume work
- [x] 2.2 In Step H.4 ("LEAD accounting on a HANDOFF return"), add the LEAD-side mirror: once a `HANDOFF` is accepted, the LEAD does not send further work to that retired worker

## 3. Fix 3 — apply-implementer parking through the first review verdict

- [x] 3.1 In Step B.4's "Reuse horizons" bullet list, extend the `LOOP_BOUND` bullet (or add an adjacent clause in the same paragraph) to cover the apply implementer parking between finishing apply and the first review verdict, gated on the same context floor Step B.4 already defines (~100k tokens) for deciding a worker is not cheap to rebuild
- [x] 3.2 In Step E's triage step 2 ("route to the implementer worker that wrote the code"), add a note: if that implementer is parked per 3.1, route the fix via the Step B.4 signal-file protocol, not `SendMessage`
- [x] 3.3 Confirm the added text does not redefine or rename `ONE_SHOT`/`LOOP_BOUND`/`MILESTONE_BOUND` — it only adds a new case to when parking applies

## 4. Fix 4 — LEAD message-batching discipline

- [x] 4.1 In Step B, near the existing "Use `SendMessage` only to continue a conversation with a worker you already spawned" sentence, add the batching rule: consecutive instructions to the same live worker are combined into one `SendMessage` when no intermediate result is needed

## 5. Golden-hash parity

- [x] 5.1 Run `test/core/templates/skill-templates-parity.test.ts` and capture the new hashes for `getAutoCommandSkillTemplate`, `getReviewCycleSkillTemplate`, and `getGoalCommandSkillTemplate`
- [x] 5.2 Update `EXPECTED_FUNCTION_HASHES` in the test file with the captured values
- [x] 5.3 Confirm no OTHER function's hash changed (would indicate an unintended edit bled into a different template)

## 6. Validation

- [x] 6.1 Run `rasen validate delivery-reliability-playbook --strict` and confirm the delta specs apply cleanly against current main specs
- [x] 6.2 Read the full rendered playbook text once (e.g. via `getAutoCommandSkillTemplate()`'s output) to confirm all four fixes read coherently in context, not just as isolated diffs
- [x] 6.3 Run the full test suite; confirm no regression beyond the expected hash-parity update
