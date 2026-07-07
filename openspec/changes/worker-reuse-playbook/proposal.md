## Why

Child-1 (`worker-reuse-config`, now archived) gave pipelines a `reuse` config block and a `reusedFrom` run-state marker, but nothing in the orchestration playbook reads them yet. Today the LEAD spawns a fresh implementer for every child change even when a dependent child directly consumes its predecessor's code — the warm worker that just wrote that code, and holds the relevant context, is discarded. This change teaches the LEAD *when and how* to reuse a planner or implementer across child changes (and when to retire one), turning the frozen config surface into actual behavior.

## What Changes

- **Configurable planner reuse.** The playbook's persistent-planner rule (Step B.1) becomes governed by `reuse.planner`: `auto` keeps today's single-planner-per-run behavior; `never` spawns a fresh planner for each propose, seeded from `planning-context.md`.
- **Cross-child implementer reuse (new).** Between a prerequisite child and its dependent, the LEAD probes the prerequisite's implementer *after that child is review-clean*. Relatedness is DAG adjacency (a dependency edge). If the worker's context usage is at or below the resolved reuse threshold, the LEAD warm-reuses it for the dependent child (with a contamination guard: the predecessor's conventions hold only where the dependent's own artifacts are silent). Above the threshold, the worker is retired: it writes a handoff document (reason `retired-between-children`, focused on cross-change-transferable knowledge, empty `remaining`), and a fresh implementer is dual-source seeded from that document plus the LEAD's dispatch brief.
- **Merge-node safety.** Reuse requires a *unique* warm predecessor. A child that depends on multiple prerequisites always gets a fresh worker, multi-source seeded from each prerequisite's durable findings.
- **Lineage recording.** A reused worker's run-state record carries `reusedFrom: <prerequisite-child-id>`.
- **Info-reflow via durable findings.** The worker `DONE` return contract gains a durable-findings clause — 1–3 lines that stay true for future planning — which the LEAD relays verbatim into the next planner's dispatch, so implementation discoveries feed the next proposal.
- **Warm-candidate digest before session relay.** A warm reuse candidate being *held* across a session boundary must first write its knowledge digest; otherwise its cross-change knowledge dies with its (session-scoped) agent handle.
- **Scope guards.** The design-level fixer is explicitly excluded from reuse (fresh eyes are its value). Tier B / Codex degrade through existing seeding/thread-resume ladders. Explicit non-goal: reuse across a user's manually-run sequence of unrelated small features (no reliable relatedness signal).
- Documentation (`docs/opsx-workflow-guide.md` + `docs/zh` mirror) and a `.changeset` (minor).

This change is playbook/policy text and its supporting handoff-document guidance only. It adds no new CLI surface — it consumes the config and run-state fields child-1 froze.

## Capabilities

### New Capabilities
- `worker-reuse-orchestration`: the reuse policy the LEAD executes — configurable planner reuse, cross-child implementer warm-reuse-vs-retire (DAG-adjacency relatedness, review-clean probe point, resolved-threshold decision, contamination guard, dual-source seeding), the unique-warm-predecessor / merge-node fresh-worker rule, `reusedFrom` lineage recording, the design-fixer exclusion, Tier B/Codex degradation, and the explicit manual-sequence non-goal.

### Modified Capabilities
- `orchestration-handoff`: the worker handoff contract's `DONE` return gains a durable-findings clause (the info-reflow channel the LEAD relays into the next planner dispatch).
- `session-relay`: the "relay only at stage boundaries" quiesce rule gains a clause requiring any held warm reuse candidate to write its knowledge digest before the relay.

## Impact

- `src/core/templates/workflows/_orchestration.ts` — Step B.1 (reuse.planner-configurable), a new cross-child implementer-reuse section, H.3 (durable-findings DONE clause), H.7 (warm-candidate digest quiesce clause).
- `src/core/templates/workflows/handoff.ts` — `retired-between-children` document-authoring guidance (content-focus shift).
- `src/core/templates/workflows/auto.ts` — checked; the reuse policy lives in the shared `ORCHESTRATION_PLAYBOOK` that `auto` embeds, so no auto-specific text change is expected.
- Template tests: `test/commands/auto.test.ts` (playbook text, asserted via auto's embedded skill text) and `test/commands/handoff.test.ts` (retired-between-children note).
- `docs/opsx-workflow-guide.md` + `docs/zh/opsx-workflow-guide.md` mirror; `.changeset/*` (minor).
- Depends on `worker-reuse-config` (archived): `ReuseConfigSchema`, `DEFAULT_REUSE_CONFIG` (`{auto, auto, 0.25}`), `resolvePipelineReuseConfig`, `RunStateWorkerSchema.reusedFrom` — all frozen and referenced, not changed.
- No breaking changes: `reuse.planner: auto` (the default) preserves current planner behavior; implementer reuse only activates on DAG-adjacent serial children.
