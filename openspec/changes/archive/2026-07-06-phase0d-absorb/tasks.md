# Tasks — phase0d-absorb

> Absorption + cleanup, content-only (no `.ts`, no counts). All edits follow `docs/skill-authoring.md`. Grill sources: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\skills\skills\`. Add `adapted from mattpocock/skills (MIT, Copyright Matt Pocock)` near absorbed sections. Re-render + verify in §6. Line numbers from HEAD 3bd250a; confirm before editing.

## 1. d1 — investigate absorbs diagnosing-bugs

- [x] 1.1 In `skills/gstack/investigate/SKILL.md.tmpl`, insert a new **Phase 1: Build a red-capable feedback loop** before the hypothesis work: the construction ladder (failing test → curl → CLI → headless → replay → harness → fuzz → bisect → differential → HITL last-resort), tighten-the-loop (faster/sharper/deterministic), non-deterministic reproduction-rate approach, and the hard gate — "a named command already run that drives the bug path and asserts the user's exact symptom; no red-capable command → no hypotheses"
- [x] 1.2 Add a **Reproduce + minimise** step (shrink to smallest still-red repro, one cut at a time)
- [x] 1.3 Merge the hypothesis sections: keep diagnosing-bugs' 3–5 ranked **falsifiable** hypotheses (stated prediction) AND investigate's 3-strike stop; delete the weaker duplicate
- [x] 1.4 Add an **Instrument** step (one variable at a time; tag debug logs `[DEBUG-xxxx]`; perf branch = measure-first)
- [x] 1.5 Merge fix/regression: write the test first **only if a correct seam exists**; "no correct seam is itself the finding" (stricter, from diagnosing-bugs); keep investigate's blast-radius AskUserQuestion
- [x] 1.6 Keep the Iron Law, scope-lock (freeze), and pattern-analysis table; genericize the `/improve-codebase-architecture` handoff to a neutral "flag the architectural finding"
- [x] 1.7 Create `skills/gstack/investigate/scripts/hitl-loop.template.sh` (copy grill's, keep shebang + add MIT NOTICE comment); reference it by relative path in the skill
- [x] 1.8 Add the MIT attribution note near the absorbed feedback-loop section

## 2. d2 — review absorbs the two-axis structure (surgical)

- [x] 2.1 In `skills/gstack/review/SKILL.md.tmpl` Step 4, add a **Standards axis / Spec axis** framing: the existing checklist two-pass is the Standards axis; add a **Spec axis** that checks the diff against the originating OpenSpec change's `proposal.md` / `tasks.md` (missing/partial requirements, scope creep, wrong-looking implementations)
- [x] 2.2 Add the option to run the two axes as **parallel `Agent` workers** (so they don't pollute each other), reported under side-by-side `## Standards` / `## Spec` headings, **not reranked or merged**
- [x] 2.3 Do NOT reference `/setup-matt-pocock-skills` or `docs/agents/issue-tracker.md`; the spec source is the OpenSpec change dir
- [x] 2.4 Append the **Fowler 12-smell baseline** (grill's paragraph, whole) to `skills/gstack/review/checklist.md` as a judgement-call section, with the rules "documented repo standard overrides the baseline" and "skip what tooling enforces"; add MIT note
- [x] 2.5 Do NOT restate the smell list in the tmpl; keep review's existing Step 1–5 structure intact

## 3. d3 — office-hours absorbs grilling discipline

- [x] 3.1 In `skills/gstack/office-hours/SKILL.md.tmpl`, add an "Interview discipline" note at the head of the interview phases: one question at a time (wait for response) / each question carries a recommended answer / explore the codebase before asking if it can answer; add MIT note
- [x] 3.2 Leave the post-0a neutralized encouragement prose unchanged

## 4. d6 — tighten 0c methodology skills' allowed-tools

- [x] 4.1 `skills/gstack/codebase-design/SKILL.md.tmpl` frontmatter: set `allowed-tools` to `Read, Grep, Glob, AskUserQuestion` (drop Write, Edit, Bash)
- [x] 4.2 `skills/gstack/domain-modeling/SKILL.md.tmpl` frontmatter: set `allowed-tools` to `Read, Write, Edit, Grep, Glob, AskUserQuestion` (drop Bash)

## 5. d7 — clean stale ethos from top-level ./browse/SKILL.md

- [x] 5.1 In `browse/SKILL.md` (top-level standalone package; outside the gen loop, edit the `.md` directly), remove the `LAKE_INTRO` intro block, the "Completeness Principle — Boil the Lake" section, the "Search Before Building" section (incl. the `eureka.jsonl` jq write and the `~/.claude/skills/gstack/ETHOS.md` reference and `garryslist.org` links), and the "(see Completeness Principle)" cross-ref
- [x] 5.2 Cross-check: the resulting `browse/SKILL.md` body SHALL match the already-clean `skills/gstack/browse/SKILL.md`; confirm `browse/SKILL.md.tmpl` is already clean (placeholders only — no edit needed). **Deviation:** the enumerated ethos blocks are removed and the §6.3 grep gate passes, but full body-parity with `skills/gstack/browse/SKILL.md` is NOT achievable — the top-level vendored copy also predates the gstack→openspec rebrand and still carries gstack-branded preamble, Telemetry, Contributor Mode, and upgrade-flow sections the clean generated copy never had. Removing those is rebrand/de-vendor work explicitly bracketed out of this cleanup by design D5. Ethos removal only, as scoped.

## 6. Re-render + verify

- [x] 6.1 Run `bun run gen:skill-docs` — re-render investigate/review/office-hours/codebase-design/domain-modeling
- [x] 6.2 Run `bun run skill:check` — must exit 0, "All Claude generated files are fresh"; review still validates (it is in `SKILL_FILES`) — **exit 0, all FRESH**
- [x] 6.3 Content spot-checks: investigate has the red-capable-loop gate + references `scripts/hitl-loop.template.sh`; review Step 4 names both axes and `checklist.md` carries the Fowler baseline; office-hours has the interview-discipline note; codebase-design/domain-modeling tools narrowed; `grep -E "Boil the Lake|Search Before Building|eureka.jsonl|ETHOS.md|garryslist" browse/SKILL.md` returns nothing — **all pass**
- [x] 6.4 Run `npm run test` targeting `test/core/shared/skill-generation.test.ts` and `test/core/templates/skill-templates-parity.test.ts` — parity suite **green (2/2)**. The skill-generation count suite has 3 failing assertions (46→47 skills, 17→18 commands), **but they are NOT caused by phase0d-absorb** — the shared working tree also carries the concurrent `add-context-handoff` change, which registers a `handoff` workflow + `agent` command via `+export { getHandoffSkillTemplate, getOpsxHandoffCommandTemplate }` in `src/core/templates/skill-templates.ts` (a file outside this change's scope). phase0d-absorb touches zero `.ts`/commands/workflows, so it introduces no count change; the parity guard that MY content edits could break is green.
- [x] 6.5 Run `openspec validate phase0d-absorb --strict` — must pass — **"Change 'phase0d-absorb' is valid"**
