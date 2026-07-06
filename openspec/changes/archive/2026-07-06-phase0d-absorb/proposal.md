## Why

phase0c added four grill methodology skills as standalone experts. phase0d-absorb folds three grill disciplines into existing skills where they belong (rather than as new skills), fixes two residues that phase0/0c review surfaced, and tightens two over-broad tool grants. All edits follow `docs/skill-authoring.md` (the writing standard 0c added).

The absorptions are targeted, not rewrites:

- **investigate** has a four-phase root-cause discipline but no notion of a *reproduction loop*. grill `diagnosing-bugs` contributes its single strongest idea — "build a tight, red-capable feedback loop before you form any hypothesis" — plus minimisation and a HITL loop template. Merged in, investigate keeps its Iron Law and phase gates and gains the discipline that most often decides whether a hard bug gets solved.
- **review** is the P0 workhorse. grill `code-review` contributes the two-axis structure (Standards vs Spec, run as parallel workers, reported side-by-side without reranking) and the Fowler 12-smell baseline. Absorbed surgically, it augments review's existing checklist-driven pass rather than replacing it.
- **office-hours** already interviews one question at a time; grill `grilling` sharpens that into an explicit discipline (one question at a time, each with a recommended answer, explore the codebase before asking).

Plus two residues and two tool-scope fixes found during phase0/0c review:

- **office-hours/review absorptions** and **d7** clean up leftover pre-0b ethos in the standalone `./browse` package.
- **d6** narrows the `allowed-tools` of the two 0c advisory skills to what their bodies actually do.

This is absorption + cleanup only — no skill is added or removed, and no registration or count changes (all wiring stays stable).

## What Changes

### d1 — investigate absorbs diagnosing-bugs (feedback-loop-first)

Merge into the existing `skills/gstack/investigate/SKILL.md.tmpl` (no rename, no registration/count change). Add a new first working phase — **Build a red-capable feedback loop** — with `diagnosing-bugs`' hard completion gate ("you can name one command you have already run that drives the actual bug path and asserts the user's exact symptom; no red-capable command → no hypotheses"), the loop-tightening guidance (faster / sharper / more deterministic), the non-deterministic-bug reproduction-rate approach, and a **minimise** step. Keep investigate's Iron Law, scope-lock (freeze), and pattern-analysis. Where the two overlap (hypothesis testing, regression test), dedupe and **take the stricter form**: `diagnosing-bugs`' ranked-falsifiable hypotheses and its "no correct seam is itself the finding" regression nuance, kept alongside investigate's 3-strike stop. Carry `hitl-loop.template.sh` as a sidecar at `skills/gstack/investigate/scripts/hitl-loop.template.sh`. Genericize `diagnosing-bugs`' `/improve-codebase-architecture` handoff (that skill is not in this fork) to a neutral "flag the architectural finding".

### d2 — review absorbs the two-axis structure (surgical)

Augment `skills/gstack/review/SKILL.md.tmpl` Step 4 without restructuring. Add a **Standards axis / Spec axis** framing: the existing checklist-driven two-pass review is the Standards axis; add the **Fowler 12-smell baseline** (grill's paragraph, imported whole, as judgement-call heuristics where the repo's documented standards override) into the review's checklist content store (`skills/gstack/review/checklist.md`) so it is not duplicated in the tmpl; and add a **Spec axis** that checks the diff against the originating OpenSpec change (`proposal.md` / `tasks.md` in the change dir) for missing/partial requirements, scope creep, and wrong-looking implementations. Add the option to run the two axes as **parallel `Agent` workers** so they don't pollute each other, reported under side-by-side `## Standards` / `## Spec` headings, **not reranked or merged**. Genericize grill's Matt-Pocock spec-discovery (`/setup-matt-pocock-skills`, `docs/agents/issue-tracker.md`) to the OpenSpec change dir as the spec source.

### d3 — office-hours absorbs grilling discipline

In `skills/gstack/office-hours/SKILL.md.tmpl`, add an explicit interview-discipline note to the interview phases: ask one question at a time and wait; for each question give your recommended answer; if a question can be answered by exploring the codebase, explore instead of asking. Do not touch the neutralized (post-0a) encouragement prose.

### d6 — tighten 0c methodology skills' allowed-tools

Per body-action audit: `codebase-design` is advisory (its body only reads code and reasons about interfaces; DESIGN-IT-TWICE spawns sub-agents, no file writes, no bash) → narrow `allowed-tools` to `Read, Grep, Glob, AskUserQuestion` (drop Write, Edit, Bash). `domain-modeling` writes CONTEXT.md/ADRs and cross-references code (no bash in body) → narrow to `Read, Write, Edit, Grep, Glob, AskUserQuestion` (drop Bash). Edit the tmpl frontmatter; re-render.

### d7 — clean stale ethos from the standalone ./browse package

Top-level `browse/SKILL.md` is a vendored artifact outside the main generation loop (`gen-skill-docs` only scans `skills/gstack/`), so it never picked up 0b's preamble cleanup and still carries `LAKE_INTRO` / "Boil the Lake" / Completeness-Principle blocks, the "Search Before Building" section (including the `~/.gstack/analytics/eureka.jsonl` write and the `~/.claude/skills/gstack/ETHOS.md` reference and `garryslist.org` links), and a dangling "(see Completeness Principle)" cross-ref. Its `.tmpl` is already clean (identical to `skills/gstack/browse/SKILL.md.tmpl` mod line endings). Strip those ethos blocks (and any now-dangling reference to them) from `browse/SKILL.md` so it becomes **ethos-equivalent** to the already-clean `skills/gstack/browse/SKILL.md` — carrying no ethos the generated copy lacks. This is ethos removal only, not full body-parity: the standalone copy also predates the gstack→openspec rename and still carries gstack-branded preamble, session/analytics tracking, telemetry, Contributor Mode, and upgrade-flow prose, whose removal is browse-productization de-vendor work (out of scope here — see design D5).

### MIT attribution

Grill content absorbed into `investigate`, `review` (checklist), and `office-hours` carries an `adapted from mattpocock/skills (MIT, Copyright Matt Pocock)` note near the changed sections, and the `hitl-loop.template.sh` sidecar keeps its header NOTICE (same convention as 0c).

### Out of scope

- No new/removed skills; no registration or count changes (this sub-change touches no counts — verified).
- `review`'s structure is preserved (surgical only); investigate's is reshaped but keeps name/wiring.
- Sidecar install-portability (the fact that `hitl-loop.template.sh` and `review/*.md` don't reach the install target) is **phase0d-sidecar-install**, not here.
- The router skill is **phase0d-router**.

## Capabilities

### New Capabilities

- `investigate-diagnosing-absorption`: The feedback-loop-first discipline, minimise step, and HITL sidecar merged into investigate.
- `review-two-axis-absorption`: The Standards/Spec two-axis structure, Fowler baseline, and parallel-worker orchestration in review.
- `office-hours-grilling-absorption`: The one-question-at-a-time / recommended-answer / explore-first interview discipline in office-hours.
- `methodology-skill-tool-scoping`: Narrowed `allowed-tools` for codebase-design and domain-modeling.
- `browse-skill-ethos-cleanup`: Removal of stale pre-0b ethos from the standalone `./browse/SKILL.md`.

## Impact

Edited (source of truth):
- `skills/gstack/investigate/SKILL.md.tmpl` — feedback-loop phase, minimise, merged hypothesis/regression, MIT note
- `skills/gstack/investigate/scripts/hitl-loop.template.sh` — new sidecar (adapted from grill)
- `skills/gstack/review/SKILL.md.tmpl` — Step 4 two-axis + parallel-worker orchestration, Spec axis vs OpenSpec change
- `skills/gstack/review/checklist.md` — Fowler 12-smell baseline section, MIT note
- `skills/gstack/office-hours/SKILL.md.tmpl` — interview-discipline note, MIT note
- `skills/gstack/codebase-design/SKILL.md.tmpl` — narrowed allowed-tools
- `skills/gstack/domain-modeling/SKILL.md.tmpl` — narrowed allowed-tools
- `browse/SKILL.md` — stripped stale ethos (top-level standalone package)

Re-rendered: `skills/gstack/{investigate,review,office-hours,codebase-design,domain-modeling}/SKILL.md`

Verification: `bun run gen:skill-docs`, `bun run skill:check` FRESH, `test/core/shared/skill-generation.test.ts` + `test/core/templates/skill-templates-parity.test.ts` (both unaffected — no count/registration change), `openspec validate --strict`. No `.ts` changes, so no build gate needed.
