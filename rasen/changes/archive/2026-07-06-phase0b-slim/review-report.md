# Review Report — phase0b-slim

**Reviewer role:** isolated pre-landing reviewer (did not author the change).
**Repo / branch:** OpenSpec-code @ `dev-harness`, HEAD `0deed40`. Diff reviewed = working tree vs HEAD (uncommitted, includes deletions).
**Scope:** faithful-implementation review against `proposal.md` / `design.md` / `specs/` / `tasks.md`. Read-only (no source edits, no git writes).

## Verdict

**APPROVE — CLEAN.** No Blocker, no Major. The change is a faithful, deletion-only implementation of the four capabilities. Every executable gate passes; every declared deletion and reference edit is present; nothing out of scope was gutted. The remaining findings are all Minor/Trivial and are either explicitly out of the change's declared scope or pre-existing.

### Findings by severity

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 0 |
| Minor    | 2 |
| Trivial  | 3 |

## Gate results (all green, re-run by reviewer)

| Gate | Command | Result |
|------|---------|--------|
| Freshness + expected-list | `bun run scripts/gen-skill-docs.ts --dry-run` | exit 0 — 26/26 `FRESH`; `setup-browser-cookies` + `gstack-upgrade` absent from render list |
| Compile (de-registration complete) | `npx tsc --noEmit` | exit 0 — no dangling import of `getSetupBrowserCookiesSkillTemplate` |
| Core vitest | `vitest run test/core/shared/skill-generation.test.ts` | 29/29 pass |
| Parity (tasks 5.5) | `vitest run test/core/templates/skill-templates-parity.test.ts` | 2/2 pass |
| Spec validation (tasks 5.6) | `openspec validate phase0b-slim --strict` | `is valid` |
| Deleted artifacts absent | `ls` | `setup-browser-cookies/`, `gstack-upgrade/`, `docs/ETHOS.md`, `conductor.json` all gone |

Blast radius: `git diff --stat` = 42 files, 67 insertions / 1874 deletions. Deletion-only as intended; no stray tracked-file changes outside `skills/gstack`, `src/core`, `scripts/`, `test/core`.

## Face-by-face verification

### 1. Deletion completeness — PASS
- **setup-browser-cookies (4 wiring points + skill-check):** all removed and confirmed by clean `tsc`:
  - `src/core/templates/experts/setup-browser-cookies.ts` — deleted.
  - `src/core/templates/experts/index.ts:29` export — removed.
  - `src/core/templates/skill-templates.ts:54` re-export — removed.
  - `src/core/shared/skill-generation.ts` import (~66) **and** `getSkillTemplates()` registry entry (`dirName: 'openspec-gstack-setup-browser-cookies'`) — both removed.
  - `scripts/skill-check.ts` `setup-browser-cookies/SKILL.md` entry — removed.
  - `gen-skill-docs.ts:783` design-review auth prose — softened to a generic "provide a logged-in browser session" note (no `/setup-browser-cookies`).
  - `docs/AGENTS.md` `/setup-browser-cookies` row — removed.
- **gstack-upgrade half-delete收尾:** `skill-check.ts` entry removed; `docs/AGENTS.md` `/gstack-upgrade` row removed; `docs/ARCHITECTURE.md` `gstack-update-check` bullet removed. No `experts/gstack-upgrade.ts` / export / registration remains (verified absent).
- **conductor.json:** deleted; zero source/generated references.

### 2. Deletion not excessive — PASS
- `{{PREAMBLE}}` mechanism retained. All four functional sub-generators are **defined and still called** by `generatePreamble` (gen-skill-docs.ts:339–342): `generatePreambleBash`, `generateAskUserFormat`, `generateRepoModeSection`, `generateCompletionStatus`. Only the two genuine ethos generators (`generateCompletenessSection`, `generateSearchBeforeBuildingSection`) were dropped and deleted.
- Deploy trio (`land-and-deploy`, `setup-deploy`, `canary`) and plan quad (`autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`) all present, `.tmpl` intact.
- `skills/gstack/browse/` untouched: `bin/` + `test/gstack-update-check.test.ts` present (its `SKILL.md` was only re-rendered via the shared preamble, and is clean of ethos).

### 3. Dangling references — PASS (in-scope); see Minor 1/2 for parallel copies
- Whole-tree residue grep for `ETHOS`, `Boil the Lake`, `Search Before Building`, `Completeness Principle`, `setup-browser-cookies`, `SetupBrowserCookies`, `gstack-upgrade`, `gstack-update-check` is **zero across all in-scope source + generated output** (`skills/gstack/**`, `src/**`, `scripts/**`), except `skills/gstack/browse/test/gstack-update-check.test.ts` which is the explicitly out-of-scope browse update-check module (proposal §"Explicitly out of scope").
- **Implementer self-repairs are semantically complete:**
  - `autoplan` skip-list correctly drops the two now-nonexistent section names ("Completeness Principle — Boil the Lake", "Search Before Building").
  - `plan-eng-review` inlined the Layer definitions (`[Layer 1]` tried-and-true / `[Layer 2]` new-and-popular / `[Layer 3]` first-principles / `[EUREKA]`) in place of the deleted "(see preamble's Search Before Building section)" pointer. The decision tree is now **self-contained** — no dangling reference, reasoning intact.
  - `office-hours` / `plan-ceo-review` "Read ETHOS.md…" pointers removed; surrounding prose stands alone.

### 4. Test-change legitimacy — PASS
`test/core/shared/skill-generation.test.ts` changes exactly four count assertions, each a consistent −1 expert (removal of one expert skill, `setup-browser-cookies`): 43→42 (17w+26→25e), 30→29 (4w+…), 26→25 (0w+…), 27→26 (1w+…). No over- or under-adjustment. Vitest confirms green. (`gstack-upgrade`'s expert was already de-registered by a prior change, so it does not affect these counts here — correct.)

### 5. Generated-output consistency — PASS
26 `SKILL.md` render `FRESH` against slimmed sources; the two deleted skills' `SKILL.md` are absent from the tree and from the render manifest.

## Minor findings

**M1 — Git-tracked top-level `./browse/SKILL.md` still hand-bakes ethos content (out of declared scope).**
`browse/SKILL.md:112` ("## Completeness Principle — Boil the Lake"), `:149` ("## Search Before Building"), `:151` (`Read ~/.claude/skills/gstack/ETHOS.md for the full philosophy`). This is a **separate, tracked productization-era `browse/` package** (49 tracked files, its own generator), distinct from `skills/gstack/browse/`, and was not modified by phase0b. The ETHOS reference points at an install path (`~/.claude/…/ETHOS.md`), not the deleted source `skills/gstack/docs/ETHOS.md`, so phase0b does not materially worsen it — the pointer was already install-relative. The whole-repo "residue zero" goal is therefore not *literally* met, but the residue lives entirely in a package the proposal scoped out. **Recommendation:** confirm `./browse/` is intentionally excluded (it appears to be), and file a follow-up to slim its hand-authored SKILL.md if elfspec will vendor it. Not blocking.

**M2 — Local install copy `.claude/skills/openspec-*` is stale.**
`.claude/skills/openspec-*/SKILL.md` (incl. `openspec-setup-browser-cookies/`) still carry ethos strings and the deleted skill. This directory is **gitignored** (`.gitignore:145 .claude/`, 0 tracked files) and is a downstream install artifact not produced by `gen:skill-docs` (which writes only to `skills/gstack/`). Genuinely out of scope for this change; refreshed by a separate re-install step. Noted only so land isn't surprised by the grep hits.

## Trivial findings

**T1 — `skills/gstack/docs/ARCHITECTURE.md` preamble description remains partially inaccurate.**
The rewritten "handles three things" list (Session tracking / Contributor mode / AskUserQuestion format) still names "Contributor mode" (removed from the generator earlier — `// generateContributorMode — REMOVED`) and omits the actually-emitted "Repo Ownership Mode" and "Completion Status Protocol" sections. This inaccuracy is **pre-existing** and D6 explicitly declares ARCHITECTURE.md cleaned opportunistically, not reworked. Acceptable, but the doc still misrepresents the live preamble composition.

**T2 — `autoplan` skip-list still lists non-emitted sections.** After the two deletions it retains "Contributor Mode" and "Telemetry (run last)", neither of which the current `generatePreamble` emits. Pre-existing staleness, not introduced here; harmless.

**T3 — Mixed worktree.** The uncommitted tree also contains unrelated changes (`docs/upstream-v1.5-stores-and-resolution.md` new, `openspec/changes/phase0c-grill-add/` new, `openspec/changes/phase0-grill-integration/planning-context.md` modified). Not part of phase0b-slim; land should stage the phase0b files selectively.
