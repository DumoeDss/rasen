## Context

Child-1 froze the config surface: `ReuseConfigSchema` (`{ planner|implementer: auto|never, threshold (0,1], roles strictly planner/implementer }`), `DEFAULT_REUSE_CONFIG = { planner: 'auto', implementer: 'auto', threshold: 0.25 }`, `resolvePipelineReuseConfig(pipeline) → ResolvedReuseConfig { planner, implementer, threshold, roles: { planner, implementer } }`, and `RunStateWorkerSchema.reusedFrom`. This change is the *policy* that reads them. It is entirely template/documentation text — no schema or command code. The playbook lives in one shared string, `ORCHESTRATION_PLAYBOOK`, in `src/core/templates/workflows/_orchestration.ts`, embedded verbatim by both `auto.ts` and `review-cycle.ts`; its text is asserted in `test/commands/auto.test.ts` (and `review-cycle.test.ts`) via each workflow's rendered skill text.

The existing playbook already carries the load-bearing scaffolding this change extends:
- **Step B.1 — Persistent planner** (_orchestration.ts:66–74): the single-planner-per-run rule; item 5 already retires a bloated planner via the Step H.2 warm-continue guard using `openspec agent context --transcript`.
- **Step G — Portfolio orchestration** (_orchestration.ts:144–166): decompose fan-out, the dependency DAG, and the strict-serial rule "a dependent MUST NOT begin until every prerequisite is implemented and review-clean" — the exact point where cross-child implementer reuse plugs in.
- **Step H.2 warm-continue guard**, **H.3 worker self-handoff / DONE contract**, **H.7 session relay quiesce** (_orchestration.ts:176, 178–181, 189–192).
- The handoff-document template + worker-level guidance in `handoff.ts` (its `HANDOFF_INSTRUCTIONS` string powers both the skill and the `/opsx:handoff` command).

## Goals / Non-Goals

**Goals:**
- Make Step B.1 planner reuse read `reuse.planner`.
- Add a cross-child implementer-reuse policy anchored at Step G's "prerequisite review-clean" gate, using the resolved reuse threshold and `resolvePipelineReuseConfig`.
- Extend the H.3 DONE contract with durable findings; extend H.7 quiesce with the warm-candidate digest; add `retired-between-children` guidance to `handoff.ts`.
- Keep the two MODIFIED spec deltas (orchestration-handoff, session-relay) exactly matched by the template edits, and cover the new text with template-string assertions.

**Non-Goals:**
- No config/schema/CLI change (child-1 owns those; frozen). No reuse *decision engine* in code — the LEAD executes the policy from the prose, exactly as it executes handoff/escalation today. No reuse for reviewer/shipper, and design-fixer explicitly excluded. No `auto.ts`-specific text (policy is in the shared playbook).

## Decisions

**1. Step B.1 becomes `reuse.planner`-gated (edit _orchestration.ts:66–74).** Preface B.1 with: the persistent-planner rule applies when the resolved `reuse.planner` is `auto` (the default — today's behavior); when `never`, spawn a fresh planner per propose seeded from `planning-context.md` + sibling proposals on disk (this is the existing Tier-B seeding path from B.1 item 2, promoted to the general `never` path). The resolved value comes from `resolvePipelineReuseConfig(pipeline).planner` via `openspec pipeline show <name> --json` (the playbook already resolves handoff config the same way in Step H). Keep item 5's transcript-probe retirement unchanged; note the reuse threshold (not the handoff threshold) governs the *cross-change* retire decision.

*Alternative considered:* a separate B.2 for the `never` path — rejected; folding the mode into B.1 keeps one planner-staffing section and avoids duplicating the seed-from-planning-context prose.

**2. New cross-child implementer-reuse section, anchored in Step G's serial rule.** Add it as a Step G sub-point (near G.4's "dependent MUST NOT begin until every prerequisite is implemented and review-clean") or an adjacent `Step G.1`. Content, in this order:
- **Relatedness = DAG adjacency.** Only a direct dependency edge makes reuse meaningful; independent/parallel children share nothing to reuse.
- **Probe point = prerequisite review-clean.** Reuse is decided at the same gate that already unblocks the dependent (G.4), so no new synchronization point. Probe the prerequisite implementer's recorded transcript with `openspec agent context --transcript <path>` (the Step F worker pointer).
- **Decision.** `pct ≤ resolved reuse threshold for implementer` → warm reuse: Tier A `SendMessage` the same worker with a dispatch that includes the **contamination guard** ("child-A conventions hold only where child-B's proposal/design are silent — read B's artifacts first"). `>` → **retire-between-children**: final task is "write handoff document, reason `retired-between-children`, focus on cross-change-transferable knowledge (conventions/gotchas/dead ends/working set), `remaining` empty"; then **dual-source seed** a fresh implementer from that document + the LEAD's child-B dispatch brief.
- **Merge-node rule.** Reuse requires a *unique* warm predecessor; a child depending on >1 prerequisite always gets a fresh worker, multi-source seeded from each prerequisite's durable findings.
- **Lineage.** Record `reusedFrom: <prerequisite-child-id>` on child-B's implementer worker record (child-1's frozen field; run-state is LEAD-written per the single-writer invariant).
- **Scope guards.** `reuse.implementer: never` → always fresh. Design-fixer excluded. Tier B / Codex degrade via the existing warm-seed / `threadId`-resume ladders (Step F.1 / A.1).

**3. H.3 DONE contract gains durable findings (edit _orchestration.ts:178–181).** Add to the return contract: `DONE` carries a durable-findings clause (1–3 lines that stay true for future planning, not per-task chatter); the LEAD relays it verbatim into the next planner dispatch. This matches the MODIFIED `orchestration-handoff` "Worker handoff contract" delta. Because the dispatch-prompt clause text is what workers receive, the edit is in the H.3 prose that every dispatch prompt appends.

**4. H.7 quiesce gains the warm-candidate digest (edit _orchestration.ts:190, the "Quiesce first" bullet).** Add: before a session relay, any held warm reuse candidate (a `DONE`-returned worker retained for a dependent child rather than dismissed) must first write its knowledge digest document — otherwise its cross-change knowledge dies with its session-scoped agentId, and F.1's document-first channel has nothing to read. This matches the MODIFIED `session-relay` "Relay only at stage boundaries" delta.

**5. `handoff.ts` gains `retired-between-children` guidance (edit HANDOFF_INSTRUCTIONS, near the "Worker-level use" section ~handoff.ts:60).** A short note: when a worker is retired between child changes, its handoff document's content focus shifts from "resume this task" to "transfer cross-change knowledge" (conventions, gotchas, dead ends, working set), and `remaining` is empty. This reuses the existing document template unchanged — only the content-focus note is new — so `workflow-handoff-command`'s spec is NOT modified (the retirement *semantics* are specced in `worker-reuse-orchestration`; this is the authoring HOW).

**6. Docs + changeset.** Extend `docs/opsx-workflow-guide.md` (the worker-staffing / handoff area) with a reuse subsection and mirror to `docs/zh/opsx-workflow-guide.md`. Add a minor `.changeset`.

## Risks / Trade-offs

- [Playbook text asserted by exact substrings — new prose must be matched by tests or drift/parity tests may lag] → add `auto.test.ts` assertions on the new anchor phrases (e.g. `reuse.planner`, `retired-between-children`, `reusedFrom`, the contamination-guard phrase, the merge-node rule) and a `handoff.test.ts` assertion on the retired-between-children note; mirror any zh doc so `docs/zh` stays in sync (repo convention).
- [Two MODIFIED deltas must stay verbatim-consistent with the edited template prose] → keep the spec wording and the playbook wording aligned on the same phrases (durable findings; held warm reuse candidate writes its digest before relay).
- [Over-broadening reuse beyond DAG adjacency] → the spec pins relatedness to a dependency edge and requires a unique warm predecessor; parallel/independent and merge-node children are explicitly fresh.
- [No runtime behavior to build → verification is text/parity + `openspec validate`] → no build-before-CLI-test dependency here (unlike child-1); the template tests are unit-level over the rendered strings.
