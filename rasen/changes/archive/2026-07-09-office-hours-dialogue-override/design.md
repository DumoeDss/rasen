## Context

The expert skills are authored as inline TypeScript template strings under `src/core/templates/experts/`. A shared `PREAMBLE` constant in `_shared.ts` is interpolated (via `${PREAMBLE}`) into 15 expert templates; 14 of those are pinned by the golden-master parity test `test/core/templates/skill-templates-parity.test.ts` (chrome-use embeds PREAMBLE but is not in the parity maps). Installed `.claude/skills/*` are generated artifacts produced from these templates by `node dist/cli/index.js update` (which calls `getSkillTemplates` → `generateSkillContent`).

`office-hours.ts` composes the office-hours skill body: it embeds the PREAMBLE, an "Interview discipline" block (three rules, lines ~61-69), Phase 2A (Startup) with an escape hatch (~220-225), Phase 2B (Builder) with an escape hatch (~261), a Phase 3 premise gate, a Phase 4 alternatives gate that says "Do NOT proceed without user approval" (~371), and Phase 5 design-doc writing (~396).

Diagnosed failure (see `planning-context.md`): office-hours is a one-way question state machine with no "user asks back" state, whose only pressure valve (escape hatch) means "fast-forward," the opposite of "discuss more." A user's request to be answered first was misread as impatience and fast-forwarded to writing the doc.

The workspace is mid-migration from `openspec/` to `rasen/`; the live spec dir (`rasen/specs/`) is empty, so both spec capabilities in this change are introduced fresh. The `openspec/` tree is an upstream mirror and is not read by the rasen CLI.

## Goals / Non-Goals

**Goals:**
- Give the shared PREAMBLE a Dialogue Override that turns "user asked a question / wants discussion" into a first-class state: pause the AskUserQuestion machine, answer in prose, resume without skipping. This benefits all PREAMBLE-embedding experts.
- Make office-hours' escape hatch fire only on explicit skip signals, add an answer-first interview rule, hard-gate design-doc writing on explicit Phase 4 approval, and add a Consultation posture for concrete-design arrivals.
- Keep the golden-master parity test green by recomputing the affected hashes.

**Non-Goals:**
- No redesign of other skills' conversational flows (they inherit the PREAMBLE benefit passively).
- No changes to `design-consultation` or to the workflow-command layer (`workflows/office-hours.ts`) six-question flow.
- No new escape-hatch/consultation logic for skills other than office-hours.

## Decisions

**D1 — Put the cross-cutting rule in the shared PREAMBLE, not per-skill.** The root cause (AskUserQuestion consuming a user's question as an answer) is generic to every AskUserQuestion caller. Placing Dialogue Override in `_shared.ts` PREAMBLE fixes it once for all 19 expert skills. Alternative (duplicate the rule into office-hours only) was rejected: it leaves the same trap in qa, review, cso, etc., and the scope guidance explicitly wants the shared-preamble path.

**D2 — Two capabilities, split by blast radius.** `expert-dialogue-override` captures the shared/cross-cutting behavior (PREAMBLE Dialogue Override + Completeness scoping + parity preservation); `office-hours-dialogue` captures the office-hours-specific behaviors. This keeps the cross-cutting contract separable from office-hours specifics at archive time. Alternative (one capability named after the change) was rejected because it conflates a rule affecting all experts with office-hours-only prose.

**D3 — Escape hatch narrowed by allow-list, not by sentiment.** The bug was sentiment-matching ("sounds impatient" → skip). The fix restricts the escape hatch to an explicit skip-phrase allow-list ("just do it" / "skip" / "stop asking, just write it") and routes everything else (questions, "explain first") to Dialogue Override. This removes the misclassification path entirely rather than trying to tune it.

**D4 — Phase 5 gets a hard precondition.** Rather than relying on Phase 4's soft "Do NOT proceed without approval," add an explicit gate at Phase 5 that names the only valid precondition (explicit Phase 4 approval) and enumerates non-approvals (complaint, silence, question). Belt-and-suspenders with Phase 4 because the observed failure bypassed the Phase 4 gate.

**D5 — Consultation is a posture, not a third mode.** Adding a full third mode (alongside Startup/Builder) would balloon scope and the mode-mapping table. Instead, Consultation is a posture the skill adopts when the opening message is a concrete design + feedback request: skip generative questioning, deliver analysis prose, offer the doc only after convergence. This keeps the small-feature footprint.

**D6 — Regeneration + parity are implementation steps, not runtime.** After editing the TS source, run `node dist/cli/index.js update` to regenerate installed skills, and recompute the 14 affected function hashes + 14 generated-content hashes in the parity test. There is no auto-updater; the parity test failure output prints the actual hashes to paste into the two constant maps.

## Risks / Trade-offs

- **[Large parity blast radius — 28 hash entries change]** → Expected and mechanical. Run the parity test, read the actual hashes from the assertion diff, replace the entries for the 14 affected templates in both maps. Only the 14 PREAMBLE-embedding, parity-pinned templates change; careful/freeze/guard/unfreeze do not embed PREAMBLE and must stay unchanged (a diff on those signals an error).
- **[Prose-only change to a prompt could be under-followed by the model at runtime]** → Mitigate with strong, explicit imperatives (SHALL-style, "never," "the only precondition is…") and by placing Dialogue Override early in the PREAMBLE where it governs later phases.
- **[Dialogue Override could over-trigger and refuse to ever ask questions]** → Bound it: it pauses only when the previous message is a question / discussion request / non-clean-selection, and explicitly resumes the original phase once the user signals to proceed.
- **[Migration state: rasen/specs empty]** → Both capabilities are ADDED (new), so there is no MODIFIED-vs-existing reconciliation risk in this change.

## Migration Plan

Not a data or API migration. Deployment = edit TS source → `node dist/cli/index.js update` regenerates installed skills → recompute parity hashes → run affected tests. Rollback = revert the two source edits and restore the prior parity hashes (git revert of this change's commit).

## Open Questions

- None blocking. Exact escape-hatch phrase list and Consultation trigger wording are finalized during implementation against the current prose; the specs pin the required semantics, not verbatim strings.
