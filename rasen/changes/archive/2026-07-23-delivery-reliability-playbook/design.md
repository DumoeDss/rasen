## Context

`ORCHESTRATION_PLAYBOOK` (`src/core/templates/workflows/_orchestration.ts`) is the single source of the shared LEAD orchestration text. It is imported and interpolated verbatim by `auto.ts`, `review-cycle.ts`, and `goal-command.ts` — confirmed by reading all three: each cites playbook step numbers in its own prose (e.g. review-cycle.ts: "Execute Step E ... of the playbook below") and embeds `${ORCHESTRATION_PLAYBOOK}` rather than restating any of Step B/H text locally. So every fix in this change is a single edit to `_orchestration.ts`; no other template file needs a parallel edit.

The four fixes come from four independent same-day incidents in one orchestration session:
1. A worker's `DONE` return, delivered only as its final plain-text turn output, was never observed by the LEAD (the harness's background-agent delivery model does not reliably surface a subagent's plain text to its parent — only an explicit tool call does). The LEAD reconstructed the result from the blackboard. Adding an ad hoc "return via SendMessage" instruction to later dispatches fixed it for the rest of that session.
2. A worker returned `HANDOFF`, then a `SendMessage` that had been sent BEFORE the handoff (but delivered after, a queuing race) woke it again; it resumed editing and reverted its own already-handed-off work, colliding with the successor the LEAD had already dispatched from the handoff document. A human had to interrupt manually.
3. An implementer with 254k tokens of context finished apply and was left un-parked (today's playbook has no rule directing it to park) while a review stage ran; it idled 8.8 minutes, its prompt cache expired (~5 minute idle window, per Step B.4's existing rationale), and when a fix was routed back to it, the resume cost a 226k-token cold cache rewrite.
4. The LEAD sent two separate `SendMessage`s to the same worker 20 seconds apart where one would have done; each delivery independently rebased the worker's conversation, so the second message paid a second full-conversation tax on top of the first.

Fix 3 sits directly on `worker-reuse-orchestration`'s "Keepalive reuse horizons" content (Step B.4 of the template already defines `ONE_SHOT`/`LOOP_BOUND`/`MILESTONE_BOUND`) — but that vocabulary was introduced by `rasen/changes/agent-wait-keepalive/`, which shipped in code (PR #36, commit `32a0c998`) but has **not yet been archived/spec-synced**: `rasen/specs/worker-reuse-orchestration/spec.md` (main specs, checked directly) does not yet contain "Keepalive reuse horizons" — only the pending change's own delta at `rasen/changes/agent-wait-keepalive/specs/worker-reuse-orchestration/spec.md` does. A `MODIFIED Requirements` block in THIS change's delta must copy an existing main-spec requirement verbatim, which "Keepalive reuse horizons" is not (yet). Writing one anyway would fail spec validation against current main specs and would create a real merge collision if agent-wait-keepalive archives afterward carrying its own (different) full text for the same header.

## Goals / Non-Goals

**Goals:**
- Bake all four fixes into the durable playbook text so every future run gets them by default, not by ad hoc mid-session correction.
- Keep each fix textually independent of the pending `agent-wait-keepalive` delta — extend its vocabulary by reference in prose, never by editing text that isn't in main specs yet.
- Touch only `_orchestration.ts` plus the golden-hash test; no runtime/logic code changes.

**Non-Goals:**
- Not re-deriving or renaming the `ONE_SHOT`/`LOOP_BOUND`/`MILESTONE_BOUND` vocabulary — this change treats it as already-real (it IS live in shipped code and in the current template text) while being honest in the spec layer that its formal spec-of-record is still pending elsewhere.
- Not touching `review-cycle.ts`, `auto.ts`, or `goal-command.ts` — confirmed none of them duplicate the playbook wording locally.
- Not adding a new `rasen agent wait` role restriction or CLI flag — `--role` is already a free-form key (confirmed against the shipped `cli-agent-wait` behavior: examples already show arbitrary keys like `impl-spaces`), so parking the apply implementer under a role key like `implementer` or `impl-<childId>` needs no CLI change.

## Decisions

**Fix 1 (SendMessage-delivery contract) and Fix 2 (stale-instruction immunity) both land as a MODIFIED `orchestration-handoff` / "Worker handoff contract" requirement.** That existing requirement already owns the DONE/HANDOFF structured-return contract end to end (spec text: "a structured return contract (`DONE` + summary, or `HANDOFF {...}`)") — the natural, single place both delivery-mechanism and post-return staleness rules belong, rather than splitting them into a new standalone requirement that would duplicate the DONE/HANDOFF framing. Full existing text plus two new scenarios (SendMessage delivery; stale pre-handoff instructions ignored) and one prose addition to the requirement body (LEAD SHALL NOT send further work to a retired worker) — the copy-forward keeps every existing scenario intact, per the "MODIFIED must not lose detail" rule.

**Fix 1's placement in the template itself:** the dispatch template quote in Step B (the `Task tool (subagent_type: ...)` example ending "Return <what the LEAD needs back>") and Step H.3's "On `DONE`"/"On trigger" bullets both get the explicit "deliver this via `SendMessage` to the LEAD, not only as your final turn's plain-text output" instruction — Step B is where the worker first learns the contract, Step H.3 is the authoritative return-contract definition; both need it since a worker may only read one closely.

**Fix 2's LEAD-side mirror lands in Step H.4 ("LEAD accounting on a HANDOFF return"), not just the worker-side H.3 clause.** The incident's actual second half was the LEAD's own inbox — a stale message the LEAD itself had queued before the handoff. Stating "the LEAD does not send further work to the retired predecessor once its HANDOFF is accepted" in H.4 closes the loop on the LEAD's side of the same failure, not only the worker's.

**Fix 3 lands as an ADDED (not MODIFIED) `worker-reuse-orchestration` requirement**, per the Context section's reasoning — cannot MODIFY text that isn't in main specs yet. Named distinctly ("Apply implementer parks pending its first review verdict") so it reads as a standalone rule today; when `agent-wait-keepalive` eventually archives (before or after this change), whichever archives second is the natural point for a human/LEAD editor to fold this requirement's text into "Keepalive reuse horizons" as a fourth bullet — flagged here as an explicit open question rather than silently hoping the eventual sync handles it.

**Fix 3's template placement:** extend Step B.4's "Reuse horizons" bullet list — the LOOP_BOUND bullet currently reads "(review-loop reviewer/fixer): parks between rounds; stands down when the loop exits (clean or cap)". Add the apply implementer as a second parking case in the same bullet (rather than inventing a new horizon name): dispatch it as parking, not `ONE_SHOT`, for the window between finishing apply and the FIRST review verdict, when its context is at/above the SAME context floor Step B.4 already defines for standing down immediately (~100k tokens) — below that floor, park is pointless (cheap to rebuild anyway) so it stays `ONE_SHOT`. Also touch Step E's triage step 2 ("route to the implementer worker that wrote the code") to note: if that implementer is parked per this rule, route the fix via the B.4 signal-file protocol, not `SendMessage`.

**Fix 4 (message batching) lands as an ADDED `opsx-orchestration` requirement**, not a modification to "LEAD Is the Sole Orchestrator" (that requirement is about hierarchy flatness, a different concern than message cadence) or to `orchestration-handoff` (batching applies to ANY live-worker `SendMessage`, not only handoff-related ones). Template placement: a new short paragraph in Step B, near the existing "Use `SendMessage` only to continue a conversation with a worker you already spawned" sentence — the natural home for general `SendMessage`-usage discipline.

## Risks / Trade-offs

- [Risk] Fix 3's ADDED requirement and `agent-wait-keepalive`'s pending ADDED requirement both live in the same capability folder path (`specs/worker-reuse-orchestration/spec.md`) across two different, currently-unarchived changes — a human could archive both without noticing the intended follow-up fold. → Mitigation: named the new requirement distinctly (no header collision), and flagged the fold explicitly in this design's Open Questions and in the requirement's own scenario text so it survives even if this document is not re-read at archive time.
- [Risk] The playbook text is large and prescriptive; a wording change in one place (e.g. Step B's dispatch template) could drift from a parallel description elsewhere (e.g. Step H.3) if only one is updated. → Mitigation: Decisions above explicitly call out BOTH Step B and Step H.3 for fix 1, and BOTH H.3 (worker-side) and H.4 (LEAD-side) for fix 2 — each fix's task list touches every place its behavior is described.
- [Risk] The golden-hash parity test will fail immediately after the template edit until hashes are regenerated. → Mitigation: tasks.md includes running the test to capture the new hashes as an explicit step, not an afterthought.

## Migration Plan

No data migration — this changes instructional text embedded in generated skill files. Existing installed projects pick up the new wording the next time they run `rasen update` (or `rasen init`), consistent with how every other playbook wording change has always propagated.

## Open Questions

- When `agent-wait-keepalive` eventually archives (order relative to this change is not controlled by either planner), should someone fold this change's "Apply implementer parks pending its first review verdict" requirement into "Keepalive reuse horizons" as a fourth reuse-horizon bullet, to avoid two separate requirements describing adjacent parking behavior long-term? Flagged for whoever holds either change at archive time — not blocking for this proposal.
