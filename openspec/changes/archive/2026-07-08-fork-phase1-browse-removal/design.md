## Context

Final A-chain step. A1 vendored chrome-use; A2 re-pointed all browser-driving experts to it and froze `browse.ts` to be fully self-contained (byte-identical output, no `_shared.ts` browse imports). Removal is now a clean excision. This change deletes every browse entity and its wiring, and retires the `browse-integration` capability.

Verified touchpoints (fresh grep):
- **Files/dirs to delete**: `browse/` (top-level bun tool: `bin/remote-slug`, `scripts/build-node-server.sh`, `src/`, `test/`), `skills/experts/browse/` (mirror), `src/core/templates/experts/browse.ts`.
- **Registration (src/)**: `experts/index.ts:8` re-export; `skill-templates.ts:38` re-export; `skill-generation.ts:56` import, `:195` `expertSkills` entry, `:151` `if (workflowId === 'browse') return;` (dead after browse skill gone), plus the browse-referencing doc comment on `copySkillSidecars` (~:135-137).
- **package.json**: `:31` bin `"browse"`; `:60` `build:browse` script (compiled `browse` + the unregistered `find-browse` — there is NO `find-browse` bin); `:88` `playwright` optionalDependency. Plus `pnpm-lock.yaml` regen.
- **Tests**: `skill-generation.test.ts` — count comment/assertions at `:15` (22 workflow + 20 expert = 40 total-ish), `:78` `toHaveLength(24)`, `:97` `toHaveLength(20)`, `:103` `toHaveLength(21)`, and the `:283` `copySkillSidecars('browse')` skip test. `skill-sidecar-install.test.ts` — `browseSrc()` and `openspec-browse` assertions (`:37,61,67-76`). `skill-templates-parity.test.ts` — import `:31`, `EXPECTED_FUNCTION_HASHES` `getBrowseSkillTemplate` `:83`, `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` `openspec-browse` `:117`, `GENERATED_SKILL_FACTORIES` `:152`, `functionFactories` `:219`.
- **Docs**: `docs/grill-gstack-absorption.md` (browse-tool lines ~87/117/120/190) + `docs/zh/grill-gstack-absorption.md` mirror. No `.github/` or `.gitignore` browse references exist.

## Goals / Non-Goals

**Goals:**
- Delete all browse entities and wiring; build and tests green afterward.
- Retire `browse-integration` via a REMOVED delta.
- Update architecture docs describing browse as live tooling.

**Non-Goals:**
- Any `_shared.ts` edit (A2 already removed all browse content there).
- INSTALL / fork-declaration README (batch C).
- Touching English-verb "browse" text in `README.md` / `docs/cli.md`.
- Reworking chrome-use (A1/A2 own it).

## Decisions

**D1 — Deletion order: code/tests first, package.json last (gated).** Delete `browse.ts` + the registration hops + tests + the `browse/` and `skills/experts/browse/` trees, rebuild, and get the suite green using the CLI package alone. Do the `package.json` + `pnpm-lock.yaml` edits only after — and only once sibling B2 (telemetry-client) has SHIPPED its package.json change (portfolio applyGate). Rationale: A3 and B2 both edit `package.json`; B2's change must land first so A3 does not clobber an uncommitted overlap.

**D2 — package.json edit guard.** Before editing `package.json`, the implementer verifies `git status` shows `package.json` clean (B2's edit committed, no pending overlap). Remove the three browse entries, run `pnpm install` to regenerate `pnpm-lock.yaml` (playwright was optional → minimal node_modules churn), and confirm `pnpm build` still works without `build:browse`.

**D3 — Test updates are deletions/decrements, not new coverage.** Count assertions decrement by one expert: `toHaveLength(24)→23`, `toHaveLength(20)→19`, `toHaveLength(21)→20`, and the total/comment at `:15` (20 expert → 19). Remove browse from the three parity anchors and the `functionFactories`. The two browse-specific sidecar tests lose their subject: delete the `copySkillSidecars('browse')` skip test outright (the skip logic is gone), and rewrite `skill-sidecar-install.test.ts` to drop the `openspec-browse` / `browseSrc` assertions — if that test needs a subject skill to prove sidecar install + idempotency, retarget it to a surviving skill that ships sidecars (e.g. chrome-use, which ships `scripts/*.mjs` + `references/cdp-api.md`).

**D4 — Docs: bounded, truthful, history-aware.** `grill-gstack-absorption.md` is a gstack-absorption narrative. Update only the lines presenting browse as a current vendored tool / current expert (the §5 tool description and the expert-layer mapping) to note browse was replaced by chrome-use in the fork; mirror the same edits in `docs/zh`. Do not rewrite the historical narrative wholesale. Leave English-verb "browse" occurrences elsewhere untouched.

**D5 — Capability retirement mechanism.** A REMOVED-Requirements delta under `specs/browse-integration/spec.md` naming all four requirements with Reason + Migration. At archive time this empties the capability; chrome-use's capabilities (from A1/A2) carry the browser contract forward.

## Risks / Trade-offs

- **package.json overlap with B2** → D1/D2 gate + `git status` guard. If B2 has not shipped, the implementer stops before package.json (LEAD gates dispatch, but the task text is the backstop).
- **Missed browse reference breaks build/tests** → post-deletion `grep -rniE 'getBrowseSkillTemplate|openspec-browse|browse/dist' src test package.json` must be empty; `pnpm build` + full affected suite green.
- **Retargeting `skill-sidecar-install.test.ts` changes its subject** → acceptable; the test's purpose (sidecars install, `.ts` trees excluded, idempotent) is preserved against a surviving skill. Alternatively delete the now-moot browse-specific assertions and keep the generic ones.
- **Lockfile churn** → `pnpm install` may adjust more than playwright if transitive; review the diff to confirm only playwright and its deps drop.
- **Docs staleness vs. rewrite** → D4 keeps edits minimal to avoid churn while removing the misleading "browse is a current tool" claims.

## Migration Plan

1. Delete `browse.ts`; remove the 4-hop registration + dead skip + doc comment.
2. Delete `browse/` and `skills/experts/browse/` trees.
3. Update the three test files (decrements + parity removals + sidecar-test rewrite).
4. `pnpm build` + affected suites green (CLI package only, package.json untouched).
5. **Gate:** confirm B2 shipped and `package.json` is clean → remove the three browse entries, `pnpm install`, rebuild.
6. Update the two grill-gstack docs.
7. Rollback: `git checkout` the deleted trees + reverted files (single logical change); chrome-use is unaffected.

## Open Questions

- Whether `skill-sidecar-install.test.ts` should be retargeted to chrome-use or simply have its browse assertions removed — implementer's call; both satisfy the intent. Retargeting to chrome-use gives stronger ongoing coverage of the `.mjs` sidecar path A1 added.
