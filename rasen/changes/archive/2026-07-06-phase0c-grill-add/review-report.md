# Review Report — phase0c-grill-add

**Reviewer:** reviewer-0c (isolated from implementer)
**Repo:** OpenSpec-code @ `dev-harness` (HEAD `c41716f`, changes uncommitted in working tree)
**Date:** 2026-07-06
**Verdict:** ✅ **APPROVE** — no Blocker/Major. Change is faithful, complete, and all §7 gates reproduce green.

---

## Summary by severity

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 0 |
| Minor    | 3 |
| Trivial  | 2 |

The core contract (逐字忠实度) is fully satisfied. All four skill bodies are **byte-identical** to the grill sources; all eight sidecars are verbatim plus a single NOTICE header; every registration mirror point is wired correctly; `tsc --noEmit`, the four bumped assertions (29-test suite), `skill:check`, and `openspec validate --strict` all pass under independent re-run.

---

## Verification reproduced (independent re-run)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **exit 0** (four new imports resolve) |
| `npx vitest run test/core/shared/skill-generation.test.ts` | **29 passed** (assertions 46 / 33 / 29 / 30 with matching comments) |
| `bun run skill:check` | **exit 0**, all SKILL.md FRESH incl. 4 new |
| `openspec validate phase0c-grill-add --strict` | **valid** |

---

## Axis 1 — Verbatim fidelity (core contract) ✅

- **Bodies:** `diff` of grill `SKILL.md` body (after frontmatter) vs tmpl body (after `{{PREAMBLE}}`) for all four skills → **exit 0, zero differences**. Bodies preserved verbatim as required.
- **Sidecars (8/8):** each sidecar differs from its grill source by exactly the 2-line NOTICE header (`<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->` + blank). No body edits, no dropped sidecar references. `[DEEPENING.md]`, `[DESIGN-IT-TWICE.md]`, `[LOGIC.md]`, `[UI.md]`, `[ADR-FORMAT.md]`, `[CONTEXT-FORMAT.md]` relative links intact in the bodies.
- **Leading words survive** in generated content: `deep module` (codebase-design), `seam` (codebase-design + tdd), `tracer bullet` (tdd), `throwaway` (prototype), `ubiquitous language` (domain-modeling). All present in the rendered `SKILL.md`, not just the tmpl.

## Axis 2 — Registration mirror completeness ✅

- **experts/*.ts ×4** each mirror `investigate.ts` exactly — only the function name, skill path segment, not-found string, and `name: 'gstack:<name>'` are substituted. `description: '|'` sentinel and `metadata: { author: 'openspec', version: '1.0' }` preserved (correctly not "fixed").
- **Four wiring points** all present: `experts/index.ts` (4 exports), `skill-templates.ts` (4 re-exports), `skill-generation.ts` (4 imports + 4 `getSkillTemplates()` entries with `dirName: 'openspec-gstack-<name>'`, `workflowId: '<name>'`), `AGENTS.md` (+4 rows, clean diff — nothing else touched).
- Generated dirNames confirmed: `openspec-gstack-{domain-modeling,codebase-design,tdd,prototype}`.

## Axis 3 — Frontmatter adaptation ✅ (with Minor scope notes)

- Fork convention adopted per skill: `name` / `version: 1.0.0` / block `description` with "Use when …" + "Proactively suggest when …" / `allowed-tools`; `{{PREAMBLE}}` after frontmatter. No `hooks` block (correct — not freeze-scoped). Matches design D1.
- `prototype` places `Bash` first in `allowed-tools` (design intent — "centred on Bash, it runs code"). Correct.

## Axis 4 — MIT attribution ✅

- All 4 tmpls carry the NOTICE **after** the closing frontmatter `---` and before `{{PREAMBLE}}`. Verified in the rendered `SKILL.md` the NOTICE lands at line 26 (after the frontmatter close at line 22, before the expanded preamble at line 28) — so it survives the `.ts` frontmatter strip and installs with the instructions. Each generated `SKILL.md` contains both `mattpocock/skills` and `MIT` (grep count 1/1).
- All 8 sidecars + `docs/skill-authoring.md` carry the same NOTICE at head.

## Axis 5 — Counts & sentinels ✅

- Four assertions bumped exactly: `toHaveLength(42→46)` / `(29→33)` / `(25→29)` / `(26→30)`, comment strings updated to "… 29 expert". Suite green (29 tests).
- `scripts/skill-check.ts` **untouched** per contract — the four methodology skills issue no `$B` browse commands, correctly absent from `SKILL_FILES`; freshness covered by the dry-run over all `.tmpl` (skill:check exit 0). Asymmetry with phase0b is expected and documented (D4).

## Axis 6 — docs/skill-authoring.md ✅

Faithful, well-localized rewrite of grill `writing-great-skills` (SKILL.md + GLOSSARY.md). All core concepts preserved: predictability as root virtue, invocation (model/user-invoked + router skill), description-writing, information hierarchy / completion criteria / progressive disclosure / context pointer / co-location, when-to-split (invocation/sequence), leading words, pruning (SSOT/relevance/no-op), and the **full five-病 failure-mode clinic** (premature completion, duplication, sediment, sprawl, no-op). Repo-localization ("gstack expert skills", "OpenSpec workflow skills") is accurate; leading-word example set enriched with `seam`/`deep module`/`ubiquitous language` to tie into the four new skills — an enrichment, not a distortion. Opens with the MIT NOTICE.

---

## Findings

### Minor

- **[Minor] M1 — `codebase-design` grants Write/Edit/Bash to an advisory skill.** The skill body is pure vocabulary + principles + design-for-testability guidance; it does not itself write files or run commands (the writing happens downstream in `implement`/`tdd`). `allowed-tools` includes Write/Edit/Bash. This is **design-blessed** (D1 explicitly scoped domain-modeling/codebase-design/tdd to Read/Grep/Glob/Edit/Write/Bash/AskUserQuestion) and harmless, but is broader than the skill's own actions. Not a blocker — flag only if you want tightest-possible least-privilege.
- **[Minor] M2 — `domain-modeling` grants `Bash` but the body never runs commands.** It reads/greps/cross-references code and writes CONTEXT.md/ADRs (Read/Grep/Glob/Write/Edit all justified). `Bash` is unused by the skill's described actions. Design-blessed under D1; low concern.
- **[Minor] M3 — Two working-tree files sit outside the phase0c impact list.** `docs/upstream-v1.5-stores-and-resolution.md` (untracked) is an **unrelated** upstream-v1.5 research doc — it should NOT be swept into a phase0c commit. `openspec/changes/phase0-grill-integration/planning-context.md` (modified) is a legitimate 0c-planner research-notes *append* to the prior phase's context (paper trail), but is likewise not in phase0c's stated Impact. Recommend committing phase0c with an explicit pathspec so the unrelated upstream doc is not included.

### Trivial

- **[Trivial] T1 — `prototype` description says "several radically different variations … switchable via a URL param"** — verbatim from grill; fine. No action.
- **[Trivial] T2 — LF→CRLF warning on `AGENTS.md`** from git on this Windows checkout. Cosmetic; matches repo's existing line-ending handling. No action.

---

## Notes on scope discipline (informational)

The change is strictly additions — no existing skill, generator, or workflow body modified (only the AGENTS table +4 rows and the four test count constants, both required by the wiring). The two documented scope-notes in the proposal (skill-check.ts asymmetry; sidecar install-portability deferred to phase0d) are correct and consciously flagged, not oversights.
