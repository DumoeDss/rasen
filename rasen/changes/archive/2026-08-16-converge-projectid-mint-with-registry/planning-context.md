# Planning Context — converge-projectid-mint-with-registry

Seeded by the LEAD (2026-08-16) from a real-world diagnosis made earlier today. Read this
FIRST; it contains verified file:line facts so you can research only what is missing.

## User intent (verbatim)

"修复 mint-vs-sticky 不收敛 这个问题" — fix the mint-vs-sticky non-convergence problem.

## The defect (verified today, real repro)

A project whose path is ALREADY registered in the machine project registry (with projectId A)
gets `rasen init` (or any flow that lazily mints a project id) after its planning root is
absent/recreated. The mint path and the registry-update path move in opposite directions and
NEVER converge:

1. **Mint side**: `src/core/project-config.ts` `ensureProjectIdInConfig` (~line 2057) mints a
   fresh `crypto.randomUUID()` when `rasen/config.yaml` has no `projectId`, and appends it to
   the config. It does NOT consult the machine project registry for an existing entry at this
   canonical path → mints NEW id B ≠ A.
2. **Sticky side**: `src/core/project-registry.ts` `registerProject` (~lines 440–556), the
   `existingAtPath` branch, KEEPS the existing registry entry (projectId A) when the path is
   already registered — a same-path claimant carrying a different id does not overwrite it.
3. **Consumers assume convergence** and now fail:
   - `src/core/learned-skills/context.ts` (~558–573): `knowledge_owner_stale` when
     `readProjectConfig(root)?.projectId` ≠ `registered.entry.projectId`.
   - `src/core/config-api/project-addressing.ts` `projectPlanningSpace` (~160–171):
     `planning_selection_conflict` when registry projectId ≠ planning-scope projectId.
4. **The repair hint is wrong**: the `knowledge_owner_stale` message says
   "Run `rasen init` to repair it." — but init is exactly what minted the divergent id B
   (fresh-init `createConfig` writes config.yaml WITHOUT projectId; `src/core/init.ts`
   ~1113–1160; the id is minted lazily elsewhere during init's machine-home binding). Re-running
   init does NOT converge; the divergence is permanent until a human hand-edits config.yaml.

Real repro (today): project registered 2026-08-01 by a 0.1.7-era build (no `rasen/` planning
root existed then); 0.2.0 `rasen init` created `rasen/` + config.yaml; lazy mint produced a new
id; registry kept the old one; learned-skills sync failed `knowledge_owner_stale`; space
resolution (`project:<uuid>`) failed 409 `space_unavailable` → `project_scope_required` chain.
Manual fix = hand-writing config.yaml's `projectId` back to the registry id (the field is
documented as hand-mintable).

## Design direction (LEAD's finding — planner decides, may overturn with evidence)

- When `ensureProjectIdInConfig` is about to mint and a machine-registry entry EXISTS for the
  canonical path, ADOPT the registry entry's projectId instead of minting fresh. Only mint a
  fresh UUID when no registry entry exists. Rationale: the registry entry is described elsewhere
  in the codebase as the project's PERMANENT identity (knowledge-bundle code: "permanent project
  identity"), and space addressing (`project:<uid>`) keys on it.
- Consider whether the stale-divergence case also needs a repair path: config.yaml EXISTS with
  wrong id B while registry has A. `ensureProjectIdInConfig`'s fast path returns B unchanged —
  mint-adoption alone does not fix that arm. Evaluate: should init (extend or fresh mode) detect
  registry≠config and reconcile toward the registry id for a registered path? What about
  `authority: 'ensure'` + `fixedMetadataConflict` alias guards in registerProject — does an
  adoption write trip them?
- Fix the misleading hint text or make init genuinely repair (with the reconciliation, the
  existing hint becomes true — verify).
- Investigate whether an explicit un-register/re-identity command exists (e.g. store/project
  lifecycle commands) for the "user deliberately wants a NEW identity" escape hatch; if none,
  note it as a non-goal.

## Verified mechanics you can rely on

- Minting runs under `withProjectRegistryLock` already (project-config.ts ~2074) — the registry
  read for adoption is right there under the same lock.
- `resolveProjectSelector` (project-addressing.ts ~282) matches registry by projectId, canonical
  root path, or worktree fallback (worktree claimants matter: `cachedResolveRegistrationRoot`,
  git worktree sibling logic in project-registry.ts ~504).
- `findProjectRegistryEntry` / `readProjectRegistryState` are the read APIs; registry state
  shape: `{ version, projects: { [canonicalPath]: { projectId, name, mode, home, lastSeen } } }`.

## Constraints (project rules — also in rasen/config.yaml)

- Cross-platform (Windows/macOS/Linux): path.join everywhere, no hardcoded slashes, tests must
  use path.join for expected path values.
- Specs in user-facing product behavior language; avoid implementation-negative SHALL statements.
- Prefer explicit lookups over pattern matching; reuse existing constants/lists.
- CLI commands in this repo are run as `node bin/rasen.js ...` from the repo root (the global
  `rasen` on PATH is a DIFFERENT, older line — never invoke bare `rasen`).

## Scope guard

The working tree has unrelated dirty files (docs/, rasen/changes/* of other changes, artifacts/).
This change touches ONLY the identity convergence behavior + its tests + this change's own
artifacts. Do not plan around unrelated files.
