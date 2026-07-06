# Review Report — phase0d-absorb

**Reviewer:** reviewer-0d-absorb (isolated from both implementers)
**Repo/branch:** OpenSpec-code @ dev-harness, HEAD 3bd250a
**Scope reviewed:** `skills/gstack/{investigate,review,office-hours,codebase-design,domain-modeling}/**`, top-level `browse/SKILL.md`, `openspec/changes/phase0d-absorb/**`. Sibling changes (`add-context-handoff`, pipeline-registry, review-cycle workflow) in the mixed working tree were excluded.
**Mode:** read-only (no source edits, no git writes).

## Verdict

**DONE_WITH_CONCERNS** — one Major spec/acceptance-criteria mismatch (d7 browse "equivalent" scenario). All absorptions (d1/d2/d3), tool-scoping (d6), and the ethos-removal delivery itself are correct and faithful to the grill sources. Verification gates independently reproduced green.

## Findings by severity

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 1 |
| Minor    | 1 |
| Trivial  | 1 |

---

## Major

### M1 — d7: `browse/SKILL.md` does not satisfy the spec's "equivalent to clean browse" scenario
- **Spec:** `specs/browse-skill-ethos-cleanup/spec.md` — Requirement text "After the fix, `browse/SKILL.md` SHALL be equivalent to the already-clean `skills/gstack/browse/SKILL.md`" + Scenario "Equivalent to the clean gstack browse skill" ("their body content SHALL be equivalent"). `proposal.md` d7 echoes it ("after the fix it should match the already-clean `skills/gstack/browse/SKILL.md`").
- **Reality:** `diff` of the two files (CRLF-normalised) = **160 lines divergent**. `browse/SKILL.md` still carries gstack-branded preamble (`~/.claude/skills/gstack/…`), session tracking (`~/.gstack/sessions`), analytics writes (`~/.gstack/analytics/skill-usage.jsonl`), the telemetry prompt, Contributor Mode, and the gstack-upgrade flow — none of which exist in the generated clean copy.
- **Nature:** internal artifact contradiction. `design.md` D5 and `tasks.md` 5.2 (the "Deviation" note) correctly acknowledge full parity is **not** achievable and bracket the rebrand/de-vendor work out of scope — but the **spec requirement and proposal still assert full equivalence**. On `openspec archive`, this scenario syncs into main specs as an acceptance criterion the implementation knowingly fails.
- **Delivery is functionally correct:** the actual d7 goal (ethos removal) is done — the §6.3 grep gate for `Boil the Lake|Search Before Building|Completeness Principle|eureka.jsonl|ETHOS.md|garryslist` returns **zero**, and the dangling `LAKE_INTRO`/`_LAKE_SEEN`/`completeness-intro` references were cleaned with no leftovers.
- **Recommendation:** narrow the spec Scenario "Equivalent…" (and the proposal/requirement wording) from full body-parity to **ethos-equivalence** (zero ethos residue; body carries no ethos the generated copy lacks), consistent with design D5. This makes the delta honest without changing the delivered file.

---

## Minor

### m1 — d3: office-hours interview-discipline note partly duplicates existing per-phase rules
- The new "Interview discipline" section (`office-hours/SKILL.md.tmpl:80–90`, "One question at a time … STOP and wait") restates rules already present per-phase: `## Phase 2A/2B` "**STOP** after each question. Wait…" (lines 237, 278) and "Questions ONE AT A TIME" (line 621).
- **No conflict** — the three-element discipline (one-at-a-time / recommended answer / explore-first) is semantically complete and consistent; the recommended-answer and explore-first elements are genuinely new. This is reinforcement, not contradiction. Left as-is is acceptable; consolidation optional.

---

## Trivial

### t1 — design.md D6 undercounts attribution notes
- D6 enumerates 3 body attribution notes + the sidecar NOTICE ("same convention as 0c"). Actual attribution sites are **5**: investigate `SKILL.md.tmpl`, review `SKILL.md.tmpl` (two-axis block), review `checklist.md` (Fowler baseline), office-hours `SKILL.md.tmpl`, plus the `hitl-loop.template.sh` NOTICE. Over-attribution is correct (the review two-axis content is grill-derived and rightly carries its own note); only the design prose's count is slightly off. No action needed.

---

## Positive verification (per task checklist)

**d1 — investigate absorbs diagnosing-bugs:** Merge is faithful and complete against grill `engineering/diagnosing-bugs/SKILL.md`. Preserved: Iron Law, scope-lock/freeze, pattern table, 3-strike stop, >5-file blast-radius gate. Absorbed with semantic parity: 10-rung construction ladder, tighten-the-loop, non-deterministic reproduction-rate, "cannot build a loop → stop", and the hard gate (named already-run command that is red-capable/deterministic/fast/agent-runnable) → "No red-capable command → no Phase 4 hypotheses" (grill's "no Phase 2" correctly renumbered). Overlaps took the **stricter** form: ranked-falsifiable hypotheses kept **alongside** 3-strike; "no correct seam is itself the finding" regression nuance kept. `/improve-codebase-architecture` genericized to "flag the architectural finding". Sidecar `investigate/scripts/hitl-loop.template.sh` vs grill original = **only the NOTICE line added** (line 2), otherwise byte-identical; tmpl references it by correct relative path `scripts/hitl-loop.template.sh`.

**d2 — review two-axis (surgical):** Existing Step 1–5 (and 1.5/2.5/4.5/4.75/5.x) headers intact — two-axis added as a `### Two axes` subsection inside Step 4 only; no restructure. Standards/Spec presented side-by-side under `## Standards`/`## Spec`, "do not merge or rerank across axes" explicit, Spec axis points to the OpenSpec change's `proposal.md`/`tasks.md` with **no** `/setup-matt-pocock-skills` or `docs/agents/issue-tracker.md` reference. Parallel `general-purpose` Agent-worker orchestration self-consistent (Standards worker gets the pasted baseline). Fowler baseline lives in `checklist.md` (not duplicated in tmpl); **all 12 smells present** and word-for-word from grill `engineering/code-review/SKILL.md` (Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest), with the "repo overrides / skip tooling-enforced" rules. HEAD checklist had **zero** pre-existing Fowler content → no duplicate/conflict.

**d3 — office-hours discipline:** All three elements present (one-at-a-time+wait / recommended answer / explore-first); post-0a neutralized prose untouched; no conflict with existing STOP rules (see m1).

**d6 — tool-scoping body-evidenced:** `codebase-design` body has **zero** write/edit/bash/run actions (grep-confirmed) → narrowing to `Read, Grep, Glob, AskUserQuestion` is correct, not over-tight. `domain-modeling` body writes `CONTEXT.md`/`docs/adr/*` (justifies Write/Edit) and has no bash → dropping only `Bash` is correct. No skill description changed in the delta → skill-authoring leading-words convention preserved.

**d7 — browse cleanup:** grep gate zero; no dangling LAKE refs; `browse/SKILL.md.tmpl` untouched (only `browse/SKILL.md` in diff). (Equivalence caveat = M1.)

**Attribution / skill-authoring:** MIT notes present at all 5 absorbed sites (above). No frontmatter `description:` edits → no leading-words/no-op-filler concern.

**Verification gates (independently re-run):**
- `bun run skill:check` → **exit 0, all FRESH** (generated SKILL.md in sync with tmpls; re-render confirmed).
- `openspec validate phase0d-absorb --strict` → **"Change 'phase0d-absorb' is valid"**.
- `skill-templates-parity.test.ts` → **2/2 green**.
- `skill-generation.test.ts` → **3 assertions fail** (46→47 skills, 17→18 commands ×2). **Attribution independently confirmed:** sole cause is the sibling `add-context-handoff` line `+export { getHandoffSkillTemplate, getOpsxHandoffCommandTemplate } from './workflows/handoff.js';` in `src/core/templates/skill-templates.ts` — registers +1 skill (handoff) and +1 command, exactly matching the deltas. phase0d-absorb touches **zero** `.ts` in its scope and adds no skill/command/workflow, so it contributes no count change; the parity guard its content edits could actually break is green. **Not caused by this change.**

---

## Fix Round 1

**Fixer:** implementer-0d-absorb-2 · **LEAD ruling:** fix M1; record m1/t1 as accepted-known (T1 fixed opportunistically alongside M1).

### M1 — fixed (spec + proposal wording narrowed to ethos-equivalence)
The spec Requirement and its "Equivalent…" Scenario asserted full body-parity between `browse/SKILL.md` and the generated `skills/gstack/browse/SKILL.md`, which the scoped ethos-only delivery knowingly cannot meet (160-line pre-rename divergence). Rewritten to **ethos-equivalence**, matching design D5 and tasks 5.2. No delivered file changed — only the acceptance criteria now describe what was actually (and correctly) shipped.

- `specs/browse-skill-ethos-cleanup/spec.md`:
  - Requirement text: dropped "SHALL be equivalent to the already-clean `skills/gstack/browse/SKILL.md`"; replaced with "SHALL be **ethos-equivalent**… carries none of the five ethos token classes and no dangling reference to a removed ethos block, and its `.tmpl` is left untouched," plus an explicit out-of-scope clause naming the pre-rename gstack-branding/session-analytics/telemetry/Contributor-Mode/upgrade-flow prose as browse-productization de-vendor work.
  - Scenario "Equivalent to the clean gstack browse skill" → renamed **"Ethos-equivalent to the clean gstack browse skill"**; THEN now asserts "no ethos content that the generated copy lacks" **AND** that pre-rename branding/telemetry/Contributor-Mode/upgrade-flow divergence "SHALL NOT count as a violation."
  - Added Scenario **"No dangling reference to a removed ethos block"** (zero matches for `LAKE_INTRO` / `_LAKE_SEEN` / `completeness-intro`), formalizing the dangling-ref cleanup the fixer already did.
- `proposal.md` d7 paragraph: "after the fix it should match the already-clean `skills/gstack/browse/SKILL.md`" → "becomes **ethos-equivalent**… This is ethos removal only, not full body-parity," with the same de-vendor out-of-scope note pointing at design D5.

### T1 — fixed (design D6 attribution count)
`design.md` D6 enumerated 3 body notes + sidecar (implying 4); rewritten to enumerate **all 5** attribution sites explicitly: investigate `SKILL.md.tmpl`, review `SKILL.md.tmpl` (two-axis block), review `checklist.md` (Fowler baseline), office-hours `SKILL.md.tmpl`, and the `hitl-loop.template.sh` NOTICE.

### Accepted-known (not fixed, per LEAD)
- **m1** — office-hours interview-discipline note partly restates existing per-phase STOP rules; reinforcement, no conflict.
- **count sentinel red** — sibling `add-context-handoff` contamination in the shared tree; shipper must exclude `src/core/**` from this change's commit.

### Precise delta (this round)
Change-artifact files only — **no source, no generated SKILL.md, no delivered `browse/SKILL.md` change**:
- `openspec/changes/phase0d-absorb/specs/browse-skill-ethos-cleanup/spec.md` (M1: requirement + scenario rewrite; +1 scenario)
- `openspec/changes/phase0d-absorb/proposal.md` (M1: d7 wording)
- `openspec/changes/phase0d-absorb/design.md` (T1: D6 count 4→5)
- `openspec/changes/phase0d-absorb/review-report.md` (this section)

Re-verified: `openspec validate phase0d-absorb --strict` → **"Change 'phase0d-absorb' is valid"**.

---

## Re-review Round 1 (reviewer-0d-absorb)

**Independent re-verdict on the Fix Round 1 delta (4 change-artifact files; no source / no generated SKILL.md / no `browse/SKILL.md` change — confirmed via `git diff HEAD --name-only`).**

| Check | Verdict |
|-------|---------|
| M1 — spec/proposal self-consistent with design D5 + tasks 5.2 | RESOLVED |
| M1 — rewritten scenarios pass a literal verifier (empirically re-run) | RESOLVED |
| M1 — no new unreachable assertion introduced | RESOLVED |
| T1 — design D6 five-site enumeration matches actual notes 1:1 | RESOLVED |

**Overall: RESOLVED.** No new findings. Change is coherent for archive (barring the known sibling `src/core/**` contamination the shipper must exclude).

### Evidence
1. **Self-consistency (M1).** `spec.md` requirement now reads "SHALL be **ethos-equivalent**" with an explicit out-of-scope clause naming pre-rename gstack-branding / session-analytics / telemetry / Contributor-Mode / upgrade-flow prose as de-vendor work. `proposal.md` d7 matches ("ethos removal only, not full body-parity", references design D5). Both now align with design D5 and tasks 5.2 — the internal contradiction that drove M1 is gone.
2. **Literal verifiability (M1), re-run against the current working tree:**
   - Scenario "No ethos residue": `grep -cE "Boil the Lake|Search Before Building|Completeness Principle|eureka.jsonl|ETHOS.md|garryslist.org" browse/SKILL.md` → **0**. PASS.
   - Scenario "No dangling reference": `grep -cE "LAKE_INTRO|_LAKE_SEEN|completeness-intro" browse/SKILL.md` → **0**. PASS.
   - Scenario "Ethos-equivalent": binding assertion is "no ethos content the generated copy lacks" (grep-zero above) with the remaining 160-line divergence explicitly carved out as non-violating. PASS.
   - Scenario "browse tmpl already clean": `browse/SKILL.md.tmpl` not in the diff (untouched); contains exactly the four placeholders `{{PREAMBLE}}` `{{BROWSE_SETUP}}` `{{SNAPSHOT_FLAGS}}` `{{COMMAND_REFERENCE}}` and no ethos prose. PASS.
3. **No new unreachable assertion (M1).** The added "No dangling reference" scenario is empirically satisfied (0 matches). The "Ethos-equivalent" carve-out bullet is a scoping clause, not an assertion, and its binding first bullet is grep-verified. No scenario in the rewritten spec fails a literal check.
4. **T1 enumeration (design D6).** D6 now names five sites: investigate `SKILL.md.tmpl`, review `SKILL.md.tmpl` (two-axis), review `checklist.md` (Fowler), office-hours `SKILL.md.tmpl`, and `hitl-loop.template.sh`. Each was independently confirmed to carry the note and to be a phase0d **addition** (present in this change's diff). Repo-wide the token appears at 17 sites, but the other 12 are pre-existing phase0c attributions (codebase-design / domain-modeling / prototype / tdd auxiliary files) outside this change's scope; D6 is correctly scoped to "absorbed grill content" of phase0d. 1:1 correspondence holds.

**Re-run gate:** `openspec validate phase0d-absorb --strict` → "Change 'phase0d-absorb' is valid".
