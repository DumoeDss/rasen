# Design — phase0d-absorb

## Context

Five independent edits, all content-level (only d-none touch `.ts`), all following `docs/skill-authoring.md`. Line numbers below are from HEAD `3bd250a`; confirm before editing. No registration or count changes — the two vitest count suites must stay green untouched, which is a useful guard that nothing structural slipped.

## Key decisions

### D1. investigate: reshape allowed, name/wiring frozen

The LEAD permits a real merge for d1 (unlike d2). `diagnosing-bugs`' contribution is a *phase ordering* change: the feedback loop comes **first**, and hypotheses are gated behind it. The merged skeleton:
1. **Iron Law** (kept from investigate) — no fix without root cause.
2. **Phase 1: Build a red-capable feedback loop** (new, from diagnosing-bugs) — the ten construction ladder (failing test → curl → CLI → headless → replay → harness → fuzz → bisect → differential → HITL), tighten-the-loop, non-deterministic reproduction-rate, and the hard gate: *a named command, already run, that drives the bug path and asserts the user's exact symptom; no such command → no Phase 2.*
3. **Reproduce + minimise** (new) — shrink to the smallest still-red repro.
4. **Scope lock** (kept from investigate — freeze integration).
5. **Pattern analysis** (kept from investigate — the pattern table).
6. **Hypothesise** (merged) — diagnosing-bugs' 3–5 ranked *falsifiable* hypotheses (stricter) + investigate's 3-strike stop.
7. **Instrument** (new from diagnosing-bugs) — one variable at a time, tagged `[DEBUG-xxxx]` logs, perf branch.
8. **Fix + regression test** (merged) — write the test first *only if a correct seam exists*; "no correct seam is itself the finding" (stricter, from diagnosing-bugs).
9. **Verify + post-mortem** (kept from investigate's report + diagnosing-bugs' "what would have prevented this").

Conflict rule applied: where both cover the same ground, keep the stricter statement and drop the weaker duplicate, so the merged skill is not longer-but-vaguer. The `/improve-codebase-architecture` handoff is genericized (skill absent in fork). `hitl-loop.template.sh` lands at `investigate/scripts/` and is referenced by relative path (matches diagnosing-bugs' own `scripts/hitl-loop.template.sh` reference).

### D2. review: surgical, and the Spec axis maps to the OpenSpec change

review must not be restructured (P0 workhorse). The insight that makes the two-axis absorption *fit* this fork: grill's "Spec axis" compares the diff to an originating issue/PRD; in OpenSpec the originating spec **is the change's `proposal.md` / `tasks.md`**. So the Spec axis becomes "does the diff faithfully implement the change's proposal/tasks — missing/partial requirements, scope creep, wrong implementations?" — native, no external issue tracker. This lets us delete grill's Matt-Pocock issue-tracker plumbing (`/setup-matt-pocock-skills`, `docs/agents/issue-tracker.md`) rather than genericize it awkwardly.

Placement split to avoid duplication:
- **Fowler 12-smell baseline** → appended to `review/checklist.md` (the Standards content store that Step 2 already reads), as an explicit judgement-call section with the "documented repo standard overrides the baseline; skip what tooling enforces" rules. Not in the tmpl (would duplicate the checklist).
- **Two-axis orchestration** (spawn Standards + Spec as parallel `Agent` workers, side-by-side `## Standards` / `## Spec` report, no rerank/merge) → tmpl Step 4 augmentation. The existing inline checklist two-pass is the Standards axis' content; the parallel-worker form is offered as the mechanism when a change has an associated OpenSpec proposal.

### D3. office-hours: a discipline note, not new phases

office-hours Phase 2A/2B already "STOP after each question. Wait." The grilling delta is two explicit rules it lacks: *each question carries your recommended answer*, and *if the codebase can answer it, explore instead of asking*. Added as a short "Interview discipline" note at the head of the interview phases. The post-0a neutralized encouragement prose is untouched.

### D4. d6 tool-scoping is body-evidenced

`codebase-design` body: advisory vocabulary + testability examples; DESIGN-IT-TWICE spawns sub-agents; **no** `Write`/`Edit`/`git`/bash actions → `Read, Grep, Glob, AskUserQuestion`. `domain-modeling` body: creates/updates `CONTEXT.md` and `docs/adr/*` (Write/Edit), cross-references code (Read/Grep/Glob), challenges terms (AskUserQuestion), **no** bash → drop `Bash`. Sub-agent spawning (DESIGN-IT-TWICE) is not gated by `allowed-tools`, so its removal from the list is safe.

### D5. d7: top-level browse is stale-vendored, not hand-authored-ethos

Verified mechanism: `gen-skill-docs` scans only `SKILLS_DIR = skills/gstack`, so `skills/gstack/browse/SKILL.md` is regenerated (and is **clean** — 0 ethos matches) while top-level `browse/SKILL.md` sits outside the loop and is a stale copy from before 0b removed `generateCompletenessSection` + `generateSearchBeforeBuildingSection`. The two `.tmpl` files are byte-identical mod line endings, both clean. Fix: remove the stale ethos blocks from `browse/SKILL.md` directly (LAKE_INTRO intro, "Completeness Principle — Boil the Lake", "Search Before Building" incl. the `eureka.jsonl` jq write, the `~/.claude/skills/gstack/ETHOS.md` reference and `garryslist.org` links, and the "(see Completeness Principle)" cross-ref). Cross-check: the result should equal `skills/gstack/browse/SKILL.md`. Flag: top-level browse is not wired into the freshness loop (that is why it went stale undetected); re-wiring or de-vendoring it is a browse-productization concern, not this cleanup.

### D6. MIT attribution

Absorbed grill content carries `adapted from mattpocock/skills (MIT, Copyright Matt Pocock)` as an HTML comment near the changed section. Five attribution sites in total: the investigate feedback-loop block (`investigate/SKILL.md.tmpl`), the review two-axis block (`review/SKILL.md.tmpl`), the review Fowler baseline (`review/checklist.md`), the office-hours interview-discipline note (`office-hours/SKILL.md.tmpl`), and the `hitl-loop.template.sh` sidecar (shebang + a NOTICE comment line).

## Verification strategy

1. `bun run gen:skill-docs` — re-render investigate/review/office-hours/codebase-design/domain-modeling.
2. `bun run skill:check` — FRESH; also confirms review still validates (it is in `SKILL_FILES`).
3. Content spot-checks: investigate contains the red-capable-loop gate and references `scripts/hitl-loop.template.sh`; review Step 4 names both axes and `checklist.md` carries the Fowler baseline; office-hours carries the interview-discipline note; codebase-design/domain-modeling frontmatter tools narrowed; `browse/SKILL.md` has zero matches for `Boil the Lake|Search Before Building|eureka.jsonl|ETHOS.md|garryslist`.
4. `npm run test` for `test/core/shared/skill-generation.test.ts` + `test/core/templates/skill-templates-parity.test.ts` — must stay green unchanged (no count/registration touched); a failure means something structural leaked.
5. `openspec validate phase0d-absorb --strict`.
