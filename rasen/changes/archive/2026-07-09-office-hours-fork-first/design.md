## Context

`office-hours` (`src/core/templates/experts/office-hours.ts`, wrapped by `src/core/templates/workflows/office-hours.ts`) currently branches on three named paths chosen by a goal question plus an opening-message heuristic:

- **Startup mode** (Phase 2A) — six forcing questions, product-stage smart routing, escape hatch, then Phase 3 (Premise Challenge) → Phase 4 (Alternatives, mandatory) → design doc → Phase 4.5 (founder-signal synthesis) → Phase 6 (three-beat close).
- **Builder mode** (Phase 2B) — generative brainstorm questions, same escape hatch shape, same Phase 3 → Phase 4 → doc → Phase 4.5/6 pipeline.
- **Consultation posture** — a short-circuit triggered by "concrete design + feedback request" in the opening message, which skips the goal question, skips Phases 2–4 entirely, delivers stance prose directly, and closes with a plain summary (no Phase 4.5/6).

This design was fully worked through and adversarially reviewed (9/10) in `~/.rasen/projects/rasen/Sayo-main-design-20260710-011233.md`; this document translates that Recommended Approach into concrete section-level decisions for the two template files, without re-litigating anything already decided there.

## Goals / Non-Goals

**Goals:**
- Replace the three named paths with a single top-level routing axis: which product the user is buying (Diagnosis vs Design), discriminated by the object of the request, not the user's identity.
- Give the Design product one fork-first mechanism (fork-scan → weight-bearing forks first → stance → discussion → convergence → doc) that structurally guarantees "ask before stance" and "question only what's both branch-writable and unverified" — replacing Builder mode, Consultation posture, and the standalone Phase 3/Premise Challenge and Phase 4/Alternatives legislation.
- Collapse the two design-doc templates into one, with the evaluation-framework block rendered by goal.
- Preserve the Diagnosis product's six-question script, escape hatch, and closing beats byte-for-byte in intent (rename only, no behavior change).
- Sweep every cross-reference to the deleted named paths so no guard clause, precedence rule, or phase header still gates on "Startup," "Builder," or "Consultation."

**Non-Goals:**
- No change to `/rasen:explore` (zero diff).
- No change to the shared PREAMBLE / Dialogue Override.
- No referral detection between office-hours and explore.
- No version bump.
- Not resolving the design doc's two Open Questions (former-Builder Phase 6 closing beat; fork-scan admission-criteria calibration from live sessions) — both remain open, tracked below.

## Decisions

### D1: Diagnosis product also routes through the shared fork-scan mechanism after its six questions

The approved design doc lists what's unchanged for the Diagnosis product ("六个 forcing questions、按产品阶段的 smart routing、escape hatch、anti-sycophancy 规则、pushback patterns、Phase 4.5 founder-signal 统计、Phase 6 三拍闭幕——全部不动") and separately states Phase 3/Phase 4 "溶解为分叉机制的特例,删除独立立法" — deleted as *standalone* legislation, full stop, not scoped only to the Design product section. Since the six-question list above pointedly does not include Phase 3 or Phase 4, the coherent reading is: after the six questions, the Diagnosis product now also enters the shared fork-scan mechanism (for premise-checking and alternatives) before writing its design doc — it no longer has its own private Phase 3/4 pass, because there is no longer a private Phase 3/4 pass anywhere in the template.

**Alternative considered:** Keep a second, Diagnosis-product-local copy of Phase 3/Premise-Challenge and Phase 4/Alternatives, only removing them from the Design product. Rejected — this would leave two premise/alternative mechanisms in the same file (one named-legislation, one fork-scan), doubling the cross-reference sweep surface and directly contradicting "溶解为分叉机制的特例,删除独立立法" (dissolved into fork-scan, deleted as standalone legislation — deleted, not duplicated).

This is a filled-in mechanism-level gap, not a re-litigated decision — flagged here for implementer visibility since neither `planning-context.md` nor the design doc pins it down explicitly.

### D2: Phase renaming map (for implementer + spec cross-reference)

| Old | New |
|---|---|
| Phase 1 step "Consultation short-circuit" + goal-question mode mapping | Phase 1: Product Routing (discriminator = request object; ambiguous → goal question maps to Diagnosis/Design, not Startup/Builder) |
| Phase 2A: Startup Mode | Diagnosis Product — YC Product Diagnostic (six questions unchanged) |
| Phase 2B: Builder Mode | deleted as a named phase; generative-brainstorm content folds into the Design product's evaluation-framework rendering param |
| Consultation posture | deleted as a named posture; its behavior (skip questioning when premises are already verified, discuss peer-to-peer, doc-as-byproduct) becomes the Design product's default behavior *conditioned on the fork-scan finding no weight-bearing forks* — not unconditional the way Consultation was |
| Phase 3: Premise Challenge | deleted as standalone legislation; premise-shaped forks are one fork-scan classification outcome |
| Phase 4: Alternatives Generation | deleted as standalone legislation; method-space forks render as an AskUserQuestion approach menu only when a fork-scan classifies the method space as weight-bearing |
| Phase 2.75: Landscape Awareness | unchanged content; hook point moves to immediately before the fork-scan procedure (was: before Phase 3) so search results feed fork classification, not just stance analysis |
| Phase 4.5 / Phase 6 ("interview paths only") | rescoped to "Diagnosis product" (was "Startup/Builder") |
| Consultation terminal | becomes the Design product's terminal (plain summary + `/rasen:propose` pointer; skips Phase 4.5/6) |

### D3: Consultation's "skip generative questioning unconditionally" behavior is deleted, not renamed

This is the substantive behavior change the whole redesign is for (Success Criterion 1 vs 2 in the design doc). Old Consultation always skipped straight to stance on a "concrete design + feedback request" opening. The Design product only skips straight to stance when the fork-scan finds zero weight-bearing forks (all premises already verified) — a concrete-but-premise-shaky design now gets asked its load-bearing fork *before* any stance, which is the defect this change exists to fix. Because this is an inversion of old behavior rather than a rename, the corresponding `office-hours-dialogue` requirement is REMOVED (not MODIFIED) with a migration pointer to the new `office-hours-fork-first` fork-scan requirement.

### D4: Skip-signal handling is split across two capabilities without duplication

`office-hours-dialogue` keeps owning the general rule "only an explicit skip signal counts; a discussion request is never a skip signal; a non-skip signal routes to Dialogue Override" — this is a general dialogue-routing principle, unchanged in substance, just rescoped from "Startup/Builder" to "Diagnosis product / Design product." `office-hours-fork-first` owns the Design-product-specific *effect* of a skip signal (downgrade every open weight-bearing fork to a declared, headline assumption; deliver immediately; assumptions are individually reopenable later) — this is new mechanism, not present in either old Builder's escape hatch (which fast-tracked to Phase 4) or old Consultation (which had no skip concept, since it never asked in the first place).

### D5: Single design-doc template, evaluation block only

The template collapse only touches the evaluation-framework section (Demand Evidence + The Assignment vs. What Makes This Cool + Next Steps), rendered by the user's stated goal. The shared skeleton (Problem/Premises/Approaches/Recommended/Open Questions/Success Criteria/Supersedes lineage) is unchanged from the existing two templates' common structure. The Diagnosis product keeps using the current Startup template unchanged (per Goals) — the collapsed template applies to the Design product only.

## Risks / Trade-offs

- **Dangling cross-references** (proposal's stated #1 regression risk) → Mitigation: `tasks.md` includes a dedicated cross-reference sweep task enumerating every known guard clause (see Dependencies in the approved design doc: "interview paths only," "Consultation replaces Phases 2–4," escape-hatch carve-outs, Phase 4.5/6 path qualifiers) plus a verification task that greps both template files post-edit for the literal strings "Startup mode," "Builder mode," and "Consultation" and confirms zero matches outside of historical/attribution prose (none expected).
- **D1 is an inference, not a pinned decision** → Mitigation: called out explicitly above and in `planning-context.md`'s durable findings so a reviewer can object before implementation, rather than discovering it silently during apply.
- **Parity hash staleness** → Mitigation: task group dedicated to `pnpm build` → `update` → `pnpm vitest run test/core/templates/skill-templates-parity.test.ts` → paste actual hashes, mirroring the exact sequence used in the `office-hours-dialogue-override` change.
- **Behavioral regression in the Diagnosis product** (since D1 routes it through a mechanism it didn't use before) → Mitigation: the six-question script, escape hatch, anti-sycophancy rules, and closing beats are explicitly unchanged; only what happens *after* the six questions (premise-checking/alternatives) changes source (from a private Phase 3/4 copy to the shared fork-scan), which should be behaviorally equivalent or stricter (fork-scan's branch-writability test is a superset of what Phase 3/4 checked) — flagged as a point to watch in manual review, not something automated tests can fully cover for a prompt template.

## Migration Plan

No runtime migration — this is a prompt-template rewrite with no data model or stored state. Rollout is: edit the two template source files → `pnpm build` → `node dist/cli/index.js update` to regenerate installed `.claude/skills/*` → update parity hashes → run tests → validate the change. No feature flag; the new behavior is live for every session as soon as the template regenerates. Rollback is a plain revert of the two source files plus the parity-hash test file.

## Open Questions

(Carried verbatim from the approved design doc — not resolved here.)

1. **Former-Builder users' Phase 6 closing beat.** Under the new architecture, builder-flavored sessions run through the Design product and end with a plain summary, losing the old golden-age close. Default lean: don't preserve it — the peak-intensity closing tone stays reserved for the Diagnosis product. Could be revisited later, gated on founder-signal count, if wanted.
2. **Fork-scan admission-criteria calibration.** After shipping, watch real sessions for the two drift failure modes (questionnaire relapse: asking too much; sycophancy relapse: asking too little) and calibrate the branch-writability/weight-bearing wording from evidence.
