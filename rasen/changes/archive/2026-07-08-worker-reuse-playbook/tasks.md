## 1. Planner reuse gating (src/core/templates/workflows/_orchestration.ts, Step B.1 ~lines 66-74)

- [x] 1.1 Preface Step B.1 so the persistent-planner rule applies under resolved `reuse.planner: auto` (default, current behavior); under `never`, spawn a fresh planner per propose seeded from `planning-context.md` + sibling proposals (promote B.1 item-2's Tier-B seeding path to the general `never` path). Note the resolved value comes from `resolvePipelineReuseConfig` via `openspec pipeline show <name> --json`.
- [x] 1.2 In B.1 item 5, clarify that the cross-change retire decision uses the resolved *reuse* threshold (not the handoff threshold); keep the transcript-probe mechanism unchanged.

## 2. Cross-child implementer reuse section (_orchestration.ts, new Step G sub-point near G.4 review-clean gate ~line 158)

- [x] 2.1 Add relatedness = DAG adjacency; probe point = prerequisite review-clean (same gate as G.4); probe via `openspec agent context --transcript <path>`.
- [x] 2.2 Add the decision: `pct ≤ resolved implementer reuse threshold` → warm reuse (`SendMessage`) with the contamination guard (child-A conventions hold only where child-B artifacts are silent; read B's proposal/design first); `>` → retire-between-children (handoff doc, reason `retired-between-children`, transferable-knowledge focus, empty `remaining`) + dual-source seed a fresh implementer from doc + LEAD child-B brief.
- [x] 2.3 Add the merge-node rule (reuse requires a unique warm predecessor; >1 prerequisite → fresh worker, multi-source seeded from each prerequisite's durable findings).
- [x] 2.4 Add lineage recording: `reusedFrom: <prerequisite-child-id>` on child-B's implementer worker record (LEAD-written, single-writer invariant).
- [x] 2.5 Add scope guards: `reuse.implementer: never` → always fresh; design-fixer excluded; Tier B / Codex degrade via existing warm-seed / threadId-resume ladders.

## 3. Handoff contract + relay quiesce (_orchestration.ts)

- [x] 3.1 H.3 (~lines 178-181): extend the DONE return contract with a durable-findings clause (1-3 lines that stay true for future planning, not chatter; LEAD relays verbatim into the next planner dispatch). Must match the MODIFIED orchestration-handoff "Worker handoff contract" delta.
- [x] 3.2 H.7 "Quiesce first" bullet (~line 190): before a session relay, any held warm reuse candidate must first write its knowledge digest document (else its cross-change knowledge dies with the agentId). Must match the MODIFIED session-relay "Relay only at stage boundaries" delta.

## 4. Retired-between-children handoff guidance (src/core/templates/workflows/handoff.ts)

- [x] 4.1 In HANDOFF_INSTRUCTIONS near "Worker-level use" (~line 60), add a note: a between-children retirement document shifts content focus to cross-change-transferable knowledge (conventions/gotchas/dead ends/working set) with empty `remaining`, reusing the existing template unchanged.

## 5. auto.ts check

- [x] 5.1 Confirm `auto.ts` needs no reuse-specific text (the policy lives in the shared `ORCHESTRATION_PLAYBOOK` it embeds). Only touch it if a reuse reference genuinely belongs in auto's own sections; otherwise leave unchanged. — Confirmed: auto.ts embeds `${ORCHESTRATION_PLAYBOOK}` (auto.ts:65); no auto-specific reuse text needed. Left unchanged.

## 6. Template tests

- [x] 6.1 `test/commands/auto.test.ts`: assert the rendered skill text contains the new anchor phrases — `reuse.planner`, the `never`/fresh-planner behavior, the cross-child implementer-reuse decision (threshold + `retired-between-children` + contamination guard), the merge-node unique-predecessor rule, `reusedFrom` lineage, and the H.3 durable-findings clause + H.7 warm-candidate-digest clause. Mirror the existing substring-assertion style (skillText.toContain).
- [x] 6.2 `test/commands/handoff.test.ts`: assert the retired-between-children note is present in the handoff instruction body.

## 7. Docs + changeset

- [x] 7.1 Extend `docs/opsx-workflow-guide.md` (worker-staffing / handoff area) with a reuse subsection; mirror to `docs/zh/opsx-workflow-guide.md` (repo requires the zh mirror to stay in sync).
- [x] 7.2 Add a minor `.changeset/*` entry describing the reuse policy.

## 8. Validate

- [x] 8.1 Run the touched template tests (`test/commands/auto.test.ts`, `handoff.test.ts`, and `review-cycle.test.ts` if it asserts playbook text). No build-before-CLI-test dependency here — these are unit tests over rendered strings, not runCLI e2e.
- [x] 8.2 `openspec validate worker-reuse-playbook` passes.
