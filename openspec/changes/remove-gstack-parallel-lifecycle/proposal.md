## Why

gstack shipped its own parallel lifecycle (plan-review pipeline, deploy family, and standalone ship/retro) that duplicates the OPSX workflow OpenSpec already owns. The product's main axis is the OpenSpec workflow, so these parallel entry points are redundant surface: they compete with `/opsx:*` for the same jobs and force users to hold two overlapping mental models. This change collapses gstack down to a pure expert layer consumed by OPSX and removes the ten skills that run a lifecycle parallel to it (including the release doc-sync skill `document-release`) — first absorbing the two (ship, retro) that OPSX still delegates to, so nothing OPSX relies on is lost.

This is step one of a two-step plan. Step two (`fuse-methodology-into-opsx`, proposed later) audits the remaining experts for logic worth fusing into the OPSX workflow. This change only removes the parallel lifecycle; it does not fuse the methodology experts.

## What Changes

- **Absorb `/ship` into `/opsx:ship`**: the ship workflow template becomes self-contained. Today `src/core/templates/workflows/ship.ts` delegates the ship phase with "Invoke the `/ship` expert skill" and a fallback. The workflow template SHALL carry the execution contract itself (merge base branch before tests, run detected test command and stop on failure, review the diff, a fresh-verification gate before pushing, `git push -u`, `gh pr create`) so no delegation to a gstack expert remains.
- **Absorb `/retro` into `/opsx:retro`**: the retro workflow template becomes self-contained for its general and global scopes. Today it delegates both to the `/retro` expert. The workflow template SHALL carry the git-data-gathering and metric-computation contract itself (commit/author/LOC gathering, metrics, per-author leaderboard, streaks), writing to OPSX's own output paths.
- **Remove 10 parallel-lifecycle experts** and all their wiring and source: `autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review` (parallel planning pipeline); `land-and-deploy`, `setup-deploy`, `canary` (parallel deploy lifecycle); `ship`, `retro` (absorbed above, then removed as experts); and `document-release` (release doc-sync — the gate ruled it out with the rest, and its doc-sync step is folded inline into `/opsx:ship`). Each removal deletes its expert `.ts`, its three registration references, its `skills/gstack/<name>/` source directory, and its catalog/navigator entries.
- **Update counts, curated lists, and docs**: the 4 expert-count assertions in `test/core/shared/skill-generation.test.ts` drop from 30 experts to 20; `scripts/skill-check.ts` `SKILL_FILES` loses its 9 removed entries; `skills/gstack/docs/AGENTS.md` loses its removed rows; the navigator map loses its Deploy family, Plan family, standalone `/retro`, and `/document-release` sections.
- **Clean up the install side**: after regeneration, the orphaned installed skill directories for the 10 removed experts SHALL be removed (`openspec update --force` does not prune them — see design).
- **BREAKING**: the `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/ship`, `/retro`, and `/document-release` expert skills are removed. Their capabilities are either superseded by the OPSX workflow, absorbed into `/opsx:ship` and `/opsx:retro` (ship/retro), or folded inline as a release doc-sync step in `/opsx:ship` (document-release).

## Capabilities

### New Capabilities
- `remove-parallel-lifecycle-skills`: removal of the ten gstack parallel-lifecycle experts — their expert `.ts` files, registration chain, `skills/gstack/<name>/` sources, curated `skill-check` entries, AGENTS.md rows, expert-count assertions, install-side orphan directories, and the guarantee that no live surface retains a dangling reference to any of the ten.

### Modified Capabilities
- `opsx-ship-command`: ship execution changes from delegating to the gstack `/ship` expert to a self-contained absorbed contract (no expert dependency); the post-ship documentation-sync step is folded inline rather than pointing at the removed `/document-release` skill.
- `opsx-retro-command`: the general and global retro scopes change from delegating to the gstack `/retro` expert to self-contained git-analysis contracts.
- `navigator-router-skill`: the navigator map removes the Deploy family, Plan family, standalone `/retro`, and `/document-release` routing sections and must not reference any of the ten removed skills.
- `opsx-auto-command`: the full-feature pipeline's planning/review requirements are rewritten to drop the mandated `/autoplan` invocation — planning comes from the propose stage and the pipeline registry's expert-review stages (review + cso/benchmark/qa/design-review), not a standalone planning skill. (The auto workflow template in `src/` already routes via the pipeline registry and hardcodes no `/autoplan`; only the spec text was stale.)

## Impact

- **Source removed**: `src/core/templates/experts/{autoplan,plan-ceo-review,plan-eng-review,plan-design-review,land-and-deploy,setup-deploy,canary,ship,retro,document-release}.ts` and `skills/gstack/{same ten}/`.
- **Wiring edited**: `src/core/templates/experts/index.ts`, `src/core/templates/skill-templates.ts`, `src/core/shared/skill-generation.ts` (import block + `getSkillTemplates()` roster).
- **Workflow templates edited**: `src/core/templates/workflows/ship.ts` (absorb + inline doc-sync replacing the `/document-release` pointer), `src/core/templates/workflows/retro.ts` (absorb).
- **Curated lists / docs edited**: `scripts/skill-check.ts`, `skills/gstack/docs/AGENTS.md`, `skills/gstack/navigator/SKILL.md.tmpl` (re-rendered).
- **Tests edited**: `test/core/shared/skill-generation.test.ts` (4 count assertions + inline comments, 30→20 experts). No other test references the ten by name; `test/core/profiles.test.ts` and `test/core/templates/skill-templates-parity.test.ts` are unaffected (see design).
- **Main spec drift fixed (delta-only, no manual main-spec edit)**: `openspec/specs/opsx-auto-command/spec.md` carries live requirements mandating the removed `/autoplan`; a MODIFIED delta rewrites them. The archive stage syncs the delta into the main spec — no source or hand edit of the main spec is required.
- **Build/verification gates**: `pnpm build` (tsc catches any missed wiring), `pnpm test`, `bun run gen:skill-docs` + `bun run skill:check`, `openspec update --force` + orphan cleanup, whole-repo dangling-reference grep, and `openspec config list` pollution check.
