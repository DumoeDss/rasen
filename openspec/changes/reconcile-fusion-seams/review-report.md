# Review Report: reconcile-fusion-seams

**Reviewer:** non-author verifier (LEAD authored the change). **Date:** 2026-07-07. **Branch:** dev-harness.
**Scope:** uncommitted working-tree diff (5 modified files + 1 new file) against the change artifacts.

## Verdict (round 1)

**APPROVE** — ship-ready. No Blockers, no Majors. One Minor (cosmetic spec typo) and one Trivial. All gates green. The core cross-body neutralization (the point the prior review cycle missed) is genuinely effective.

Finding counts (round 1): **Blocker 0 · Major 0 · Minor 1 · Trivial 1.** (Minor-1 backslash typo fixed before round 2.)

> **Round-2 verdict is at the bottom of this report** — the change pivoted from *patching* domain-modeling to *removing* it. See "Round 2".

---

## Findings

### Minor-1 — Delta spec uses `\opsx:explore` (backslash) instead of `/opsx:explore`
`openspec/changes/reconcile-fusion-seams/specs/methodology-expert-fusion/spec.md:7, :11, :17`

The MODIFIED requirement body and two scenario WHEN clauses reference the command as `` `\opsx:explore` `` (literal backslash) whereas the main spec (`openspec/specs/methodology-expert-fusion/spec.md:26-32`) and the rest of the codebase use `` `/opsx:explore` `` (forward slash). This is a plain markdown file, not a template string, so the backslash is literal — not an escape artifact. On archive/sync the MODIFIED block replaces the main requirement, so the canonical spec would inherit the malformed reference in 3 spots.

Suggested fix: replace `\opsx:explore` → `/opsx:explore` on lines 7, 11, 17.

Impact: cosmetic; does not affect validation (passes `--strict`) or any code path. Fix before archive so the synced main spec stays clean.

### Trivial-1 — prototype body's non-file capture alternatives aren't re-scoped by the note
`skills/gstack/prototype/SKILL.md:136` vs `src/core/templates/workflows/change-context.ts:7`

The prototype "When done" section lists capture in "commit message, ADR, **or a NOTES.md next to the prototype**." The appended `CHANGE_CONTEXT_CAPTURE_GUIDANCE` explicitly forbids the two file-layout artifacts that would strand output (`docs/adr/` and `NOTES.md beside prototype code`) and redirects to the change directory — which fully neutralizes the seam-1 concern (the proposal specifically called out "NOTES.md next to the prototype"). The residual "commit message" / "issue" options are not stranded-repo-root artifacts and need no re-scoping. No action required; noted only for completeness.

---

## Scrutiny-point results (per LEAD brief)

1. **schema.yaml enhance removal** — CLEAN. Diff removes exactly one line (`enhance: codebase-design`); design artifact's `requires: proposal` remains correctly indented (schema.yaml:110-111). `grep enhance schemas/spec-driven/schema.yaml` → zero hits: schema now ships with no enhance hooks. No other artifact touched. YAML valid (build loads it; `validate --strict` passes).

2. **explore.ts guardrail carve-out** — CORRECT and narrow. Both variants (skill L290, command L472) get identical wording: "The single exception is a throwaway `/prototype` probe (see "Prototype to Settle a Stuck Question") — and its code MUST be deleted once the answer is captured." Coheres with the pre-existing "Prototype to Settle a Stuck Question" sections (L282-284 skill; matching command section), which already say "Capture the *answer* in the change directory … then delete the prototype code." The carve-out stays scoped to throwaway-probe + mandatory-deletion and preserves explore's "capture, don't implement" identity (the section itself reaffirms "the artifact is the decision, not the code").

3. **change-context.ts note + cross-body neutralization** — EFFECTIVE (the load-bearing check). Read both full generated bodies:
   - `domain-modeling` teaches CONTEXT.md glossary + `docs/adr/` (SKILL.md File-structure + "Update CONTEXT.md inline"). The note names `CONTEXT.md` and `docs/adr/` explicitly, redirects change-context output to the change directory, and scopes "the file layouts described earlier in this skill" to standalone use. The note is appended after the entire body, so "earlier in this skill" resolves unambiguously. Neutralizes the seam for change-context without breaking standalone use.
   - `prototype` teaches capturing the verdict in "commit message, ADR, or a NOTES.md next to the prototype" (SKILL.md:136). The (shared) note names `NOTES.md beside prototype code` and `docs/adr/` as forbidden in change-context. Primary seam (NOTES.md-beside-prototype) neutralized; ADR covered via docs/adr. See Trivial-1.
   - Placement confirmed: getter appends `${body}\n\n${CHANGE_CONTEXT_CAPTURE_GUIDANCE}\n\n${STORE_SELECTION_GUIDANCE}` in both `domain-modeling.ts:24-29` and `prototype.ts:24-29` — between body and store guidance, as specified.

4. **CHANGE_CONTEXT wording audit** — CORRECT. `openspec status --change <name> --json` genuinely emits a top-level `changeRoot` field: `ChangeStatus.changeRoot` (instruction-loader.ts:154) is populated by `formatChangeStatus` (`changeRoot: context.changeDir`, :492) and serialized in the JSON branch of `statusCommand` (`{ ...status, root }`, status.ts:112-113). No contradiction with the following `STORE_SELECTION_GUIDANCE` — the store guidance lists `status` among `--store`-accepting commands, so the two compose (add `--store <id>` to the `openspec status --change` call in a store-scoped run). Complementary, not conflicting.

5. **Parity test hashes** — EXACTLY 3 updated, all legitimate: `getExploreSkillTemplate` (function), `getOpsxExploreCommandTemplate` (function), `openspec-explore` (content). Verified the expert getters (`getDomainModelingSkillTemplate`, `getPrototypeSkillTemplate`) are NOT in the parity factories/hash maps (test lines 37-91, 115-130) — only workflow/command templates are parity-locked — so appending the note to the two experts correctly requires no hash change. No other expected value in the diff. Parity suite recomputed green (6/6).

6. **Delta spec correctness** — MODIFIED header "Explore references the prototype discipline" matches the main spec header exactly (both files). MODIFIED replaces the whole requirement (both scenarios preserved: "Explore template names prototype" retained + "Explore guardrail carve-out…" added), and each ADDED/MODIFIED scenario matches the code (verified against explore.ts L284/L290 and change-context.ts:7). `schema-enhance-field/spec.md` remains TRUE — every requirement/scenario there is about the *mechanism* (hypothetical `enhance: "review"`); deleting `design.enhance` leaves the field, parsing, `<enhance>` rendering, resolution, and JSON output intact, and now exercises the "field-absent" scenarios more. `methodology-expert-fusion`'s "enhance hooks reference only existing skills" is now vacuously satisfied (zero hooks); "Instructions never point at a removed skill" holds (no `<enhance>` section emitted — task 2.5). Only cosmetic issue is Minor-1.

## Gate results

| Gate | Result |
|------|--------|
| `pnpm build` | PASS (TypeScript 5.9.3, gen:skill-docs ran, no working-tree drift in generated SKILL.md) |
| `pnpm vitest run skill-templates-parity + skill-generation + profiles` | PASS — 3 files, 53 tests |
| `openspec validate reconcile-fusion-seams --strict --json` | PASS — 1/1 valid, 0 issues |

Post-build `git status` shows only the intended 5 modified + 1 new file (plus untracked change dir / handoff / .gitattributes) — the build regenerated no tracked SKILL.md, confirming the getter-append approach left generated sources untouched as designed (D1).

## Notes
- Did not run the full suite; the diff's blast radius is confined to explore/expert templates + one schema line, and the targeted suites plus parity/generation cover it. LEAD gates full suite at ship.
- Fixed nothing (findings-only per brief).

---

# Round 2 (domain-modeling removal pivot)

**Reviewer:** non-author verifier. **Date:** 2026-07-07. **Scope:** the round-2 delta — the pivot from patching `domain-modeling` with an adaptation note to **removing the skill entirely** (roster 20 → 19). Working tree now: 14 modified + 4 deleted + 1 new file.

## Verdict (round 2)

**APPROVE with Minors** — ship-ready. No Blockers, no Majors. The removal chain is complete and correct at the code and requirement level, all gates green. Two Minor findings are spec/archive-hygiene items to fix **before archive** (they do not affect code, tests, or the live skills); two Trivial.

Finding counts (round 2): **Blocker 0 · Major 0 · Minor 2 · Trivial 2.**

## Findings

### Minor-2 — navigator MODIFIED requirement silently drops a pre-existing scenario
`openspec/changes/reconcile-fusion-seams/specs/navigator-router-skill/spec.md` vs main `openspec/specs/navigator-router-skill/spec.md:36-39`

The main requirement "Navigator maps OPSX and the experts…" has **four** scenarios; the fourth is "No removed parallel-lifecycle skills referenced" (enumerates `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/document-release`, standalone `/retro` — **and the positive guarantee** "the `/opsx:ship` and `/opsx:retro` entries in the main flow SHALL remain"). The delta's MODIFIED version carries forward only the first three scenarios and swaps in a new "No removed methodology skill referenced." Because a MODIFIED requirement replaces the whole requirement block on sync, the parallel-lifecycle scenario — including the ship/retro-remain positive assertion, which is **not** covered by the body's negative prohibition — is dropped from the main spec.

The requirement body still says "…nor any of the removed parallel-lifecycle skills, nor the removed `/domain-modeling`…", so the general prohibition survives; only the enumerated scenario and the ship/retro-remain guarantee are lost. Likely unintentional (the standard MODIFIED foot-gun: reproduce every scenario you intend to keep).

Suggested fix: re-add the "No removed parallel-lifecycle skills referenced" scenario to the MODIFIED requirement so the delta preserves all four scenarios plus the new one.

Impact: spec-fidelity regression only; validate `--strict` still passes. No code/test effect.

### Minor-3 — proposal archive NOTE about stale Purpose lines is incomplete
`openspec/changes/reconcile-fusion-seams/proposal.md:34`

The NOTE flags only `methodology-expert-fusion`'s Purpose line ("still says 'four methodology experts'"). Two other main-spec Purpose lines are equally stale after this change and are unflagged:
- `openspec/specs/add-grill-expert-skills/spec.md:4` — "Establishes **four** grill methodology expert skills — `domain-modeling`, …" and "Covers … expert registration, **count assertions**, and MIT attribution" (count-assertions requirement is REMOVED here).
- `openspec/specs/methodology-skill-tool-scoping/spec.md:4` — "…and `domain-modeling` (writes CONTEXT.md and ADRs) keeps its write tools…" (the domain-modeling scoping requirement is REMOVED here).

Since tooling does not carry Purpose in deltas (as the NOTE itself states), all three must be hand-edited at archive; the NOTE names one of three. Suggested fix: expand the NOTE to list all three Purpose lines (and the add-grill "count assertions" clause).

Impact: archive-hygiene; if archived per the NOTE as written, two main specs retain contradictory Purpose prose. No code/validation effect.

### Trivial-4 — change-context.ts doc-comment says "experts" (plural); only prototype consumes it now
`src/core/templates/workflows/change-context.ts:2-5`

The header comment reads "appended to methodology expert **skills**" / "reconciling the **experts'** standalone file layouts." After the pivot, `prototype` is the sole importer (verified: only `experts/prototype.ts` imports `CHANGE_CONTEXT_CAPTURE_GUIDANCE`). Cosmetic; consider singularizing.

### Trivial-5 — add-grill MODIFIED headers still read "Four …" while bodies describe three
`openspec/changes/reconcile-fusion-seams/specs/add-grill-expert-skills/spec.md:11,36`

"Four grill expert skills exist…" / "Four skills registered…" keep the word "Four" (the header is the OpenSpec match-key, so it cannot change without becoming REMOVED+ADDED). The bodies correctly describe three surviving skills and assert domain-modeling's absence. This is the inverse choice from the propose requirement, which *was* handled as REMOVED+ADDED to rename. Both are valid; the "Four" headers are slightly awkward but harmless. No action required.

## Round-2 scrutiny-point results (per LEAD brief)

1. **Removal chain complete** — VERIFIED. `experts/domain-modeling.ts` deleted; export dropped from `experts/index.ts`, re-export from `skill-templates.ts`, and import + `getSkillTemplates()` entry from `skill-generation.ts`; `skills/gstack/domain-modeling/` deleted incl. `SKILL.md`, `SKILL.md.tmpl`, `ADR-FORMAT.md`, `CONTEXT-FORMAT.md`; AGENTS.md `/domain-modeling` row removed; navigator vocabulary reduced to `/codebase-design` in **both** `SKILL.md` and `SKILL.md.tmpl` (re-render matches tmpl — no post-build drift). Installed orphan confirmed gone (`.claude/skills/*domain-modeling*` → none; installed navigator clean). Repo-wide grep for live `domain-modeling` references outside archive/change-dir returns only the four main-spec files (superseded by deltas) and one historical handoff doc (exempt like archive).

2. **propose.ts** — CLEAN. Both variants now read "**Methodology consult (optional)**… consult `/codebase-design`…"; no dangling `/domain-modeling` wording, no "domain-heavy"/"glossary" residue, block reads coherently. (Pre-existing nit, not introduced here: the block resolves changeRoot via `openspec status --json` without `--change`; the new change-context note correctly uses `openspec status --change <name> --json`. Out of round-2 scope — untouched by this diff.)

3. **change-context.ts reword** — CORRECT. Now names "an ADR or a `NOTES.md` beside the prototype code" as standalone-only, matching prototype's body capture teaching (SKILL.md:136 "commit message, ADR, issue, or a NOTES.md next to the prototype"); CONTEXT.md / docs-adr references removed (they'd be meaningless — prototype never taught them). Still resolves via `openspec status --change <name> --json` → `changeRoot` (verified correct in round 1). Neutralizes prototype's capture teaching for change-context without breaking standalone use.

4. **skill-generation.test.ts counts 20→19** — VERIFIED against the actual roster. Four length assertions updated with matching comments/`it` descriptions: total 38→37, filtered 24→23, 20→19, 21→20. Suite green (37 tests), so `getSkillTemplates()` genuinely returns 37 (18 workflow + 19 expert).

5. **Parity hashes** — exactly the propose triple drifted: `getOpsxProposeSkillTemplate`, `getOpsxProposeCommandTemplate` (function ×2) + `openspec-propose` (content ×1). The explore triple (`getExploreSkillTemplate`, `getOpsxExploreCommandTemplate`, `openspec-explore`) carries the identical round-1 values — unchanged. No other expected value touched. Parity suite green (6 tests) confirms every other template's payload is byte-identical to its pinned hash (a stray change would fail its unchanged expectation).

6. **Delta specs (4 files)** — every MODIFIED/REMOVED header matches its main-spec header **exactly** (cross-checked all 12):
   - methodology-expert-fusion: REMOVED "Propose references the design and domain methodology experts" (main:6) ✓; MODIFIED "Explore references the prototype discipline" (main:26) ✓; MODIFIED "Fused experts remain standalone-invokable" (main:61) ✓; plus ADDED "Propose references the design methodology expert" and "Prototype adapts its capture path…" (new, correctly reflect code — propose codebase-design-only + prototype note).
   - add-grill-expert-skills: REMOVED "Expert count assertions updated" (main:44) ✓; MODIFIED "Four grill expert skills exist as source templates" (main:7) ✓; "Four skills registered as expert templates" (main:29) ✓; "MIT attribution on adapted content" (main:53) ✓ — bodies/scenarios match code (three .tmpl survive, domain-modeling dir/wiring/AGENTS-row absent).
   - methodology-skill-tool-scoping: REMOVED "domain-modeling allowed-tools scoped to its write actions" (main:15) ✓ — the sibling codebase-design scoping requirement (main:7) is untouched and stays true.
   - navigator-router-skill: MODIFIED "Navigator maps OPSX and the experts, reflecting the post-absorb state" (main:19) ✓ — vocabulary reduced to `/codebase-design`, matches code; see Minor-2 re the dropped scenario.
   - Archive NOTE accuracy: see Minor-3.

## Round-2 gate results

| Gate | Result |
|------|--------|
| `pnpm build` | PASS (TS 5.9.3; gen:skill-docs ran; no post-build drift — file set exactly as intended, navigator re-render in sync with tmpl) |
| `pnpm vitest run skill-templates-parity + skill-generation + profiles` | PASS — 3 files, 53 tests |
| `openspec validate reconcile-fusion-seams --strict --json` | PASS — 1/1 valid, 0 issues (exit 0 when run directly; a PowerShell native-exe quirk reported 255, not a real failure) |

## Round-2 notes
- Full suite deferred to ship gate per LEAD decision; round-2 blast radius (expert removal + propose/explore templates + 4 delta specs) is covered by the targeted suites plus the repo-wide reference grep.
- Fixed nothing (findings-only per brief).

---

## Round-2 re-verification (fixes landed)

Re-ran after the fixer addressed the round-2 findings. All four are resolved:

- **Minor-2 — RESOLVED.** `specs/navigator-router-skill/spec.md` now carries all pre-existing scenarios plus the new one: the MODIFIED requirement retains "No removed parallel-lifecycle skills referenced" (incl. the positive "`/opsx:ship` and `/opsx:retro` entries … SHALL remain" guarantee) at lines 26-30 and adds "No removed methodology skill referenced" at lines 32-35. No scenario dropped. Header still matches main exactly.
- **Minor-3 — RESOLVED.** `proposal.md:34` NOTE now enumerates all three stale main-spec Purpose lines to hand-edit at archive: `methodology-expert-fusion`, `add-grill-expert-skills` (incl. the count-assertions mention), and `methodology-skill-tool-scoping`.
- **Trivial-4 — RESOLVED.** `change-context.ts:2-5` comment is now singular ("appended to the prototype expert skill" / "the skill's standalone capture locations"). The exported constant string is unchanged, so no hash/parity impact.
- **Trivial-5 — no action (as noted); acceptable.**

Header-exactness re-checked programmatically (`comm` of delta vs main requirement headers): every MODIFIED/REMOVED header in all four delta specs matches a main-spec header exactly; the only unmatched delta headers are the two intentional ADDED requirements.

Re-run gate results (current tree):

| Gate | Result |
|------|--------|
| `pnpm build` | PASS (TS 5.9.3) |
| `pnpm vitest run skill-templates-parity + skill-generation + profiles` | PASS — 3 files, 53 tests |
| `openspec validate reconcile-fusion-seams --strict --json` | PASS — exit 0, valid, 1/1 passed, 0 issues |

**Round-2 final verdict: APPROVE — ship-ready.** All round-2 findings resolved; open finding count now **0**. Fixed nothing myself (findings-only).
