# Ship Log — phase0d-sidecar-install

**Date:** 2026-07-06
**Repo:** OpenSpec-code @ `dev-harness`

## Final verification (all green)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | exit 0, no output |
| `bun run skill:check` (gen-skill-docs --dry-run) | FRESH — all 30 skill docs, no drift |
| `npx vitest run test/core/shared/skill-generation.test.ts test/core/shared/skill-sidecar-install.test.ts test/specs/source-specs-normalization.test.ts` | 3 files, **39 passed**, 0 failed |
| `openspec validate phase0d-sidecar-install --strict` | valid |

Archived via `openspec archive phase0d-sidecar-install -y` → spec created at `openspec/specs/skill-sidecar-install/spec.md` (+3 requirements, 0 modified, 0 removed).

## Review verdict (carried from `review-report.md`)

**SHIP-READY** for the change itself — 0 Blocker / 1 Major / 2 Minor / 1 Nit. All four in-scope self-run gates were green in review; no Blocker or Major in the sidecar diff proper.

- **M1 (Major — portfolio debt, `add-grill-expert-skills` spec Purpose placeholder):** flagged as pre-existing debt from the phase0c archive (`b041df0`), outside the sidecar diff's scope (sidecar never touches `openspec/specs/`). **Fixed independently in this ship** — see commit B below, which fills the placeholder Purpose for `add-grill-expert-skills` along with 17 other specs carrying the same "TBD - created by archiving" text (phase0 portfolio archives + phase0d + add-context-handoff sibling). Re-ran `source-specs-normalization.test.ts` after the fix: green.
- **m1 (Minor, doc):** `proposal.md`/`design.md` characterize the `browse` whole-dir skip as "belt-and-suspenders"; it is actually load-bearing (`browse/scripts/build-node-server.sh` would otherwise be copied). Left as-is — doc wording only, not fixed in this ship.
- **m2 (Minor, coverage):** no explicit test asserts sidecar removal via `removeUnselectedSkillDirs`/`removeSkillDirs` (inherent since the whole dir is deleted; task 2.3 was verify-only). Left as-is.
- **n1 (Nit):** `copySidecarTree` calls `mkdirSync(..., { recursive: true })` per file instead of once per dir — cosmetic, left as-is.
- **config/profile ×4 pre-existing failures** (`test/commands/config.test.ts` ×1 + `test/commands/config-profile.test.ts` ×3): attributed to `686ba8e` ("include auto-command in CORE_WORKFLOWS"), which **predates the entire phase0 portfolio** (`git merge-base --is-ancestor 686ba8e 0deed40` = true), compounded by the add-context-handoff **sibling** change's `handoff` workflow addition. **Not fixed in this ship** — flagged as pre-existing/sibling drift, left for the user to decide whether/when to update the config/config-profile fixtures to the current core workflow set.

## Commits produced

1. **Commit A** — sidecar implementation: `copySkillSidecars` helper, `init.ts`/`update.ts` wiring (both loops), tests, and the merged `skill-sidecar-install` spec + archive artifacts.
2. **Commit B** — fills placeholder `## Purpose` sections in 18 specs (including `add-grill-expert-skills`, closing M1) left over from recent archives (phase0 portfolio, phase0d, add-context-handoff).

See git log on `dev-harness` for exact hashes/stats (commits are local-only, not pushed).
