## Context

gstack was vendored into this fork as an expert layer, but it carried its own lifecycle skills that run parallel to the OPSX workflow: a plan-review pipeline (`autoplan` + `plan-ceo-review`/`plan-eng-review`/`plan-design-review`), a deploy lifecycle (`land-and-deploy`/`setup-deploy`/`canary`), standalone `ship`/`retro`, and the release doc-sync skill `document-release`. The user's directive is that the OpenSpec workflow is the single axis, so these parallel entry points must go. Two of the ten — `ship` and `retro` — are still consumed by OPSX: `src/core/templates/workflows/ship.ts:54` invokes the `/ship` expert and `retro.ts:62`/`:66` delegate the general and global scopes to the `/retro` expert; a third, `document-release`, is pointed at by the opsx:ship template (`ship.ts:126`). Ship and retro must be absorbed before removal so OPSX stays whole; the document-release doc-sync step is folded inline into opsx:ship.

The removal mechanics are the mature phase0b chain (verified this session): each expert has exactly four wiring points — the expert `.ts` under `src/core/templates/experts/`, an export in `experts/index.ts`, a re-export in `skill-templates.ts`, and an import + `getSkillTemplates()` roster entry in `skill-generation.ts` — plus a `skills/gstack/<name>/` source directory and catalog/navigator entries. Deleting an expert `.ts` without its three references is a `tsc` failure, so `pnpm build` is a hard gate.

Baselines verified this session (dev-harness snapshot): expert roster = 30 (`skill-generation.ts:184-215`); the four count assertions live in `test/core/shared/skill-generation.test.ts` at the 48 / 34 / 30 / 31 assertions (comments say "30 expert"); `scripts/skill-check.ts` `SKILL_FILES` (lines 19-37) contains 9 of the 10 removal candidates (all except `autoplan` — including `document-release/SKILL.md` at line 31); `skills/gstack/docs/AGENTS.md` lists 6 of them (`plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `ship`, `retro`, `document-release` — not the deploy family or autoplan); the navigator tmpl (`skills/gstack/navigator/SKILL.md.tmpl:57-71`) has a `/document-release` bullet, a standalone `/retro`, a Deploy family, and a Plan family block. No built-in pipeline in `src/core/pipeline-registry/` references any of the ten (grep-confirmed empty). `test/core/profiles.test.ts` counts workflows only (unaffected).

## Goals / Non-Goals

**Goals:**
- Remove the ten parallel-lifecycle experts completely: wiring, source, curated lists, catalog, navigator, counts, and install-side orphans.
- Make `/opsx:ship` and `/opsx:retro` self-contained before removing their expert counterparts — distilling the execution contract, not copying the 800-line templates.
- Leave the OPSX workflow, the consumed experts (review/cso/qa/qa-only/benchmark/design-review), the on-ramp experts (investigate/careful/office-hours), and the step-two fusion candidates (domain-modeling/codebase-design/tdd/prototype) untouched.

**Non-Goals:**
- Fusing methodology experts into OPSX — that is step two (`fuse-methodology-into-opsx`).
- Reworking gstack's brand/MIT cleanup — phase0a already did that; absorbed content is already clean.
- Changing the OPSX workflow count (18) or any workflow template other than ship/retro.

## Decisions

### D1 — Absorb-then-remove for ship and retro; distill the contract, don't copy the template

The absorb replaces the delegation blocks with the expert's load-bearing *execution contract* expressed in the OPSX template's own voice, not a verbatim paste. The principle: keep the gates and artifacts OpenSpec's lifecycle actually needs; drop gstack shop-ceremony that is project-specific and already optional.

**opsx:ship** — replace the "Invoke the `/ship` expert skill" block (`ship.ts:52-58`) and its fallback (`:72-76`) with concrete steps: (1) merge base branch before tests, stop on unresolvable conflicts; (2) run the detected test command, stop on in-branch failure; (3) review the diff for obvious structural issues; (4) a fresh-verification gate — if code changed since the test run, re-run before pushing; (5) `git push -u origin <branch>`; (6) `gh pr create` (the existing PR-body-from-proposal block already covers title/body). Update the header comment (`ship.ts:4-5`) that names gstack `/ship` and `/land-and-deploy`. **Also reword the post-ship documentation-sync step** (`ship.ts:126` currently suggests running `/document-release`, now deleted): replace the pointer with a minimal inline instruction — "update project documentation (README/architecture/changelog) to match what shipped" — so opsx:ship stays self-contained and references no removed skill. **Excluded as gstack shop-ceremony**: the 4-digit VERSION bump, CHANGELOG auto-generation, TODOS.md reconciliation, Greptile triage, and eval-tier machinery — these are project-specific, not part of OpenSpec's ship contract, and keeping them would defeat the "distilled, not copied" principle. The existing ship-log and optional land-and-deploy sections stay.

**opsx:retro** — replace the general-scope "Invoke the `/retro` expert skill" (`retro.ts:62`) and global-scope delegation (`:66`) with a self-contained git-analysis contract: gather commit/author/LOC/hotspot/streak data, compute the metrics table and a per-author leaderboard, and write to OPSX's own output paths (general → `openspec/retro-latest.md`, global → `openspec/retro-global-latest.md`). Reuse the report structures already in the template. **Excluded**: gstack's `.context/retros/*.json` snapshot/history-compare persistence — that is gstack-specific state, out of the OPSX contract.

*Alternative considered*: keep ship/retro experts and just stop OPSX delegating. Rejected — that leaves the parallel `/ship` and `/retro` entry points the user asked to remove.

### D2 — The other eight delete directly

`autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review` are a planning pipeline that duplicates OPSX propose + review-cycle; `land-and-deploy`, `setup-deploy`, `canary` are a deploy lifecycle with no OPSX consumer (the opsx:ship land-and-deploy section already inlines the deploy concept). `document-release` is a release doc-sync skill whose only OPSX touchpoint is the opsx:ship post-ship pointer (`ship.ts:126`), which D1 rewords to an inline instruction — so once that pointer is folded inline, document-release is a clean deletion too. None of the eight is delegated to by any OPSX template or pipeline in a way that survives this change (grep-confirmed), so each is a clean four-point + source-dir deletion.

### D3 — Parity tests are unaffected (corrects the seed assumption)

`test/core/templates/skill-templates-parity.test.ts` hashes a **fixed allowlist** of the 11 base workflow templates + their opsx command templates + feedback (`EXPECTED_FUNCTION_HASHES`, lines 37-61; `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`, 63-75). It does **not** hash `getShipCommandSkillTemplate`, `getRetroCommandSkillTemplate`, any OPSX-fusion workflow, or any expert. Therefore editing ship.ts/retro.ts and removing the ten experts do **not** change any expected hash. This corrects the planning-seed note (§"移除链机制" point 2) that expected the ship/retro parity hashes to change — there is no parity-hash recompute step. The **only** test-count edit is the four assertions in `skill-generation.test.ts`.

*Verification*: run the parity file after the change; it should stay green with no hash edits. If it somehow goes red, that is a signal the wrong template set was touched.

### D4 — Count and curated-list strategy

Reduce the four `skill-generation.test.ts` assertions by ten (30→20 experts): full roster 48→38, four-filter 34→24, no-match 30→20, single-filter 31→21, and update the inline "30 expert" comments. Remove the 9 present `SKILL_FILES` entries from `skill-check.ts` (autoplan is not in the list; `document-release` is). Remove the 6 present AGENTS.md rows. Purge the navigator Deploy family, Plan family, standalone `/retro`, and `/document-release` sections (keep the main-flow `/opsx:retro`), then re-render with `bun run gen:skill-docs` and gate on `bun run skill:check`.

### D5 — Install-side orphan cleanup is manual

`openspec update --force` regenerates only the current roster; it does **not** prune installed directories for skills that left the registry. Verified in `src/core/init.ts`: the write loop (`:582-604`) only writes current templates, and `removeSkillDirs` (`:830-849`) iterates `ALL_WORKFLOWS` via `WORKFLOW_TO_SKILL_DIR` — experts are not workflows, so expert directories are never pruned. The ten `openspec-gstack-*` directories (including `openspec-gstack-document-release`) currently exist under `.claude/skills/` (confirmed). Tasks therefore include an explicit removal of the orphaned installed directories across every configured tool's skills directory, after the update. This mirrors phase0b's half-deleted-state finding.

## Risks / Trade-offs

- **[Absorbed opsx:ship/retro loses a capability users relied on]** → Distill from the expert source deliberately; the excluded machinery (VERSION/CHANGELOG/TODOS/Greptile/evals for ship; JSON history for retro) is gstack shop-ceremony, not OpenSpec contract. Reviewer confirms the absorbed contract covers test → verify → push → PR (ship) and gather → metrics → report (retro).
- **[Missed wiring reference]** → `pnpm build` (tsc) fails on any unresolved import/export; it is a required gate. The whole-repo dangling-reference grep is the backstop for prose references.
- **[Stale generated SKILL.md left behind]** → `bun run skill:check` freshness gate (`gen-skill-docs --dry-run`) catches any un-rendered template drift.
- **[Global-config pollution during tests]** → known env flake; run `openspec config list` after tests to confirm the real global config was not mutated, and isolate-rerun any spec.test.ts / artifact-workflow EBUSY flake.

## Migration Plan

1. Absorb ship, then retro (workflow templates) — self-contained, no expert delegation.
2. Remove the ten experts (four wiring points each) + delete `skills/gstack/<name>/` sources.
3. Navigator / AGENTS / skill-check cleanup; re-render docs.
4. Update the four count assertions + comments.
5. `pnpm build` + `pnpm test` + `bun run gen:skill-docs` + `bun run skill:check`; `openspec update --force` then remove orphaned install dirs; `openspec config list` pollution check; whole-repo dangling-reference grep; `openspec validate --strict`.

Rollback: the change is a coherent removal on a feature branch; revert the branch if the build or absorbed-contract review fails.

## Open Questions

### document-release — RESOLVED at gate: delete now (user overruled keep, 2026-07-07)

The planner recommended keeping `document-release` for the step-two fusion audit (it is a doc-sync utility, not a lifecycle parallel to OPSX). **At the propose gate the user overruled that and ruled it out with the rest.** So `document-release` is deleted in this change: the removal set is ten experts, expert count 30→20. Its only OPSX touchpoint — the opsx:ship post-ship pointer at `ship.ts:126` — is reworded to a minimal inline "update docs to match the release" instruction (D1), so opsx:ship stays self-contained and no reference to the deleted skill survives. No open questions remain; proceed to apply.
