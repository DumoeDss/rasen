# Review Report — rasen-full-rebrand

**Reviewer:** independent verifier (did not author the code)
**Scope:** uncommitted working-tree diff (~230 tracked source/test files + 72 docs), verified against the 8 delta specs, design.md D1–D7, and tasks.md.
**Method:** brand constants + workspace-root rename audit, `node build.js` (compiles clean), targeted vitest suites (brand-guard, workspace-migration, store, init, update, command-generation — all green: 263+7 passed), live `rasen init --tools claude` smoke test in scratchpad, and manual coexistence/whitelist tracing.

**Verdict: findings-to-fix.** No Blocker. The structural rebrand is sound — constants are single-sourced, the copy-only migration contract is faithfully implemented and tested, coexistence guarantees hold (no live path deletes upstream `opsx`/`openspec-*` artifacts), and every whitelist token is correctly preserved. The findings are a cluster of **user-facing brand/path leaks that the brand-guard test does not catch** (it only checks `/opsx:`, `opsx-`, `commands/opsx/`, `openspec-`, `openspec:` — not `OPSX:` display names or bare `openspec/` paths), plus dead destructive code and one test gap.

Counts: **3 Major, 5 Minor, 2 Trivial.**

---

## What was verified clean

- **Brand constants (D1):** `config.ts` single-sources `WORKSPACE_DIR_NAME`/`COMMAND_PREFIX`/`SKILL_PREFIX` + `LEGACY_*`; `OPENSPEC_DIR_NAME` kept as back-compat alias. No dangling `openspec-root` imports; `workspace-root.ts` rename complete; build compiles.
- **Migration copy-only contract (workspace-migration spec):** `migrateWorkspace` copies `specs/changes(+archive)/config.yaml`, skips-existing (no overwrite), per-file-failure tolerant, idempotent, all `path.join`. Source zero-write asserted by test.
- **Coexistence (workspace-migration + cli-update specs):** `removeUnselectedCommandFiles` (update.ts:513) only deletes **rasen-namespace** paths — `getLegacyCommandFilePath` returns the `-command`-suffix rasen path, NOT an `opsx` path (verified command-file-id.ts:61-66). `pruneRetiredExpertSkillDirs` is scoped to the fork-only `openspec-gstack-` prefix (legacy-cleanup.ts:18,43) and cannot touch a live `openspec-*` skill. Marker-block removal is consent-gated (default no, interactive-only) inside the migrate flow only (cli/index.ts:249-271, init.ts:283-317); `update` never removes markers.
- **Root resolution (rasen-cli-identity):** `root-selection.ts` walks `WORKSPACE_DIR_NAME` only (lines 121-123); no silent `openspec/` fallback.
- **Store (store-registration spec):** `STORE_METADATA_DIR_NAME='.rasen-store'` + `LEGACY_STORE_METADATA_DIR_NAME='.openspec-store'` read-compat + copy-forward (foundation.ts:28,34,420); default checkout `~/rasen/<id>` (store.ts:246); registry absolute paths not rewritten.
- **Whitelist respected:** `format:'openspec'`/`'openspec-change'` (spec.ts, change-parser.ts), `.openspec.yaml` filename, `.openspec-store` legacy read, `openspec_root` store-doctor JSON field (store.ts:104,189), `.openspec-test-` probe (file-system.ts:289) — all correctly left as `openspec`.
- **Pipelines:** `pipelines/**/*.yaml` carry zero legacy `openspec-`/`openspec:`/`opsx` skill IDs.
- **README (project-readme spec):** "Coexistence with OpenSpec" section present (README.md:50-69); `npm uninstall @fission-ai/openspec` removed; `rasen migrate` copy-only documented.

---

## Findings

### MAJOR

**M1 — Init prints `Config: openspec/config.yaml` but the workspace is `rasen/`.**
`src/core/init.ts:820` and `:826` hardcode the literal `openspec/` in user-visible success output, while the existence check one line up (823-824) correctly uses `OPENSPEC_DIR_NAME` (=`rasen`). Confirmed live in the scratchpad smoke test: `Config: openspec/config.yaml (schema: spec-driven)` while `rasen/config.yaml` is what was created. Directly violates cli-init spec scenario "Success message references rasen commands" → "no hint references … an `openspec/` path". Not caught by any init.test.ts assertion.
*Fix:* `` console.log(`Config: ${WORKSPACE_DIR_NAME}/config.yaml (schema: ${DEFAULT_SCHEMA})`) `` and the same for line 826.

**M2 — `specs apply` prints `openspec/specs/<name>/spec.md` (wrong path).**
`src/core/specs-apply.ts:388` (fallback default), `:536`, `:543` print `openspec/specs/...` in user-facing output while writing to the real rasen target (`p.update.target`). Tells the user a path that no longer exists. Task 1.3 listed `specs-apply.ts` as a literal-collection site but these three output strings were missed.
*Fix:* build the display path from `WORKSPACE_SPECS_DIR` (e.g. `` `${WORKSPACE_SPECS_DIR}/${capability}/spec.md` ``).

**M3 — 19 generated command display names still read `OPSX:`.**
Every workflow template sets `name: 'OPSX: <Title>'` (apply-change.ts:172, archive-change.ts:128, auto.ts:149, bulk-archive-change.ts:259, continue-change.ts:132, explore.ts:306, ff-change.ts:115, goal-command.ts:111, handoff.ts:120, new-change.ts:87, office-hours.ts:130, onboard.ts:569, propose.ts:126, retro.ts:182, review-cycle.ts:99, ship.ts:210, sync-specs.ts:158, verify-change.ts:182, verify-enhanced.ts:135). This flows verbatim into generated command frontmatter — confirmed in smoke test: `.claude/commands/rasen/archive.md` line 2 is `name: "OPSX: Archive"`. Violates rasen-cli-identity "own a complete rasen namespace across **every user-visible identifier**". The brand-guard misses it because its FORBIDDEN list has no `OPSX:` (uppercase, no slash) token.
*Fix:* replace `OPSX:` with `Rasen:` (or the chosen display brand) across the 19 `name:` fields, and add an `OPSX:` / `OPSX ` token to the brand-guard so it can't regress.

### MINOR

**m4 — brand-guard has blind spots (root cause of M1–M3).** `test/core/brand-guard.test.ts:26-32` checks only `/opsx:`, `opsx-`, `commands/opsx/`, `openspec-`, `openspec:`. It does not detect `OPSX:` display names, bare `openspec/` workspace paths in generated bodies, or `~/openspec` hints. design.md D1 sells the guard as an insurance-equivalent backstop ("与插值等强的防回归保证"); these gaps are why the leaks shipped. *Fix:* add `OPSX` (case-insensitive) and a bare-`openspec/`-path check (excluding the `.openspec.yaml`/`.openspec-store` whitelist) to the FORBIDDEN set.

**m5 — store setup example hint uses `~/openspec/`.** `src/commands/store.ts:446` prints `rasen store setup team-context --path ~/openspec/team-context` — inconsistent with the new `~/rasen/<id>` default (line 246 uses `WORKSPACE_DIR_NAME`). *Fix:* `` `--path ~/${WORKSPACE_DIR_NAME}/team-context` ``.

**m6 — `navigator` skill prose says "OPSX".** `src/core/templates/experts/navigator.ts:12` ("the OPSX **main flow**") and `:66` ("this repo's skills and OPSX workflows") ship in generated navigator skill content. User-visible. *Fix:* reword to "Rasen" / "the Rasen workflow".

**m7 — dead destructive cleanup code (D4 footgun).** `cleanupLegacyArtifacts` (legacy-cleanup.ts:407 — deletes `openspec/` command dirs and `openspec-*.md` files via `LEGACY_SLASH_COMMAND_PATHS`), plus `formatDetectionSummary`, `formatCleanupSummary`, `buildRemovalsList`, `buildUpdatesList` have **zero live callers** (only doc-comment references). They contradict the D4 coexistence rule and are a re-wiring hazard for a future maintainer. *Fix:* delete them (detection + `cleanupMarkerBlocks` + `formatLegacyCoexistenceNotice` are the live surface), or at minimum add a guard test asserting no init/update path invokes them.

**m8 — migration partial-failure scenario untested.** workspace-migration spec scenario "Partial failure does not abort" and tasks.md 2.5 ("单文件失败不中断") are implemented (workspace-migration.ts:112-121 collects `failed`) but `test/core/workspace-migration.test.ts` has no case exercising a per-file copy failure + summary reporting. *Fix:* add a test that makes one destination unwritable (or stubs `copyFileSync` to throw once) and asserts the run completes with the file listed in `summary.failed`.

### TRIVIAL

**t9 — stale `openspec/` doc-comments in root-selection.** `src/core/root-selection.ts:9,268,270,275,277` reference `openspec/` and `~/openspec/<id>` in comments (code is correct — uses `WORKSPACE_DIR_NAME`). Cosmetic; update for readability.

**t10 — `// OPSX fusion workflow commands` code comments** in init.ts:87, profiles.ts:31, profile-sync-drift.ts:31, skill-generation.ts:33/171/235, tool-detection.ts:45, skill-templates.ts:22. Not user-visible; rename for consistency if touching those files.

---

## Notes (accepted / out of scope per kickoff — not findings)
- Telemetry endpoint still `openspec-telemetry.workers.dev` (parked, other session).
- `docs/opsx*.md` filenames unchanged (link stability).
- Prose "OpenSpec" brand mentions in lineage/upstream-analysis docs.
- Untracked `openspec/handoff/*` files at repo root belong to concurrent sessions, not this change.

---

## Round-2 Re-review (fix-delta verification)

**Verdict: all 10 findings RESOLVED. One NEW commit-hygiene issue surfaced (R2-1, not a code defect) — the "parity-hash = name-field-only drift" claim does not hold.** Build compiles; brand-guard (3) + workspace-migration (5, incl. new partial-failure) green; init/update flaked once on the known Windows EACCES CLI-spawn issue then passed clean on isolated re-run (94/94).

| # | Status | Verification |
|---|--------|-------------|
| M1 | ✅ Resolved | init.ts:821/827 now `${WORKSPACE_DIR_NAME}/config.yaml` (and `/${configName}`). |
| M2 | ✅ Resolved | specs-apply.ts:389/537/544 now `${WORKSPACE_SPECS_DIR}/…`; constant imported at line 2; build clean. |
| M3 | ✅ Resolved | Zero `name: 'OPSX:'` and zero `OPSX` remaining anywhere under `src/core/templates/`. |
| m4 | ✅ Resolved (scope note) | brand-guard predicates inspected: `/opsx/i` fires on `OPSX:` display names; `/openspec[\\/]/` fires on bare workspace paths and provably does NOT match `.openspec.yaml`/`.openspec-store` (`.`/`-`, not a slash). **Scope caveat:** the guard only scans *generated skill/command artifacts*, so it backstops M3 but does **not** cover M1/M2 — those are `console.log` strings in source the guard never reads. |
| m5 | ✅ Resolved | store.ts:446 now `~/${WORKSPACE_DIR_NAME}/team-context`. |
| m6 | ✅ Resolved | navigator.ts: zero `OPSX`. |
| m7 | ✅ Resolved | `cleanupLegacyArtifacts`, `formatCleanupSummary`, `buildRemovalsList`, `buildUpdatesList`, `formatDetectionSummary`, `CleanupResult` deleted — grep confirms **zero live callers** (the `CleanupResult` hits are the unrelated `StoreCleanupResult`). Kept: detection fns, `cleanupMarkerBlocks`, `formatLegacyCoexistenceNotice`, `formatProjectMdMigrationHint`, `getToolsFromLegacyArtifacts`. 26 legacy-detection literals intact. |
| m8 | ✅ Resolved | workspace-migration.test.ts:133 mocks `node:fs` `copyFileSync` to fail exactly one file; asserts no-throw, `summary.failed` lists it with error, other files still copied, and `formatMigrationSummary` surfaces `failed: 1` + the path. On-spec. |
| t9/t10 | ✅ Resolved | Covered by the OPSX→Rasen template/comment sweep; no residual `OPSX` in templates. |
| Whitelist (checklist #5) | ✅ Intact | `format:'openspec'` (spec.ts ×2), `.openspec.yaml` (archive.ts ×2), `.openspec-store` (foundation.ts), `openspec_root` (store.ts ×5), `.openspec-test-` (file-system.ts) all present and unchanged. |

### R2-1 — NEW [Major · commit-hygiene, not a runtime defect]: parity-hash baseline is contaminated by a concurrent change

`test/core/templates/skill-templates-parity.test.ts` regenerated ~24 hashes. Only **navigator + office-hours** (m6/M3 prose) and the **11 `getOpsx*CommandTemplate` name fields** (M3) are rebrand-attributable. The remaining ~13 — `getBenchmark/Cso/Qa/QaOnly/Review/Tdd/CodebaseDesign/DesignConsultation/DesignReview/Investigate/Prototype` and their `rasen-*` generated-content hashes — changed **solely because they embed `_shared.ts`/`_orchestration.ts`**, whose diffs are **100% the concurrent change `prompt-audit-fixes-expert-dispatch`** (`specs/canonical-severity-vocabulary/`, `specs/expert-dispatch-contract/`). Verified: `_shared.ts`'s diff contains **zero** rebrand OPSX→Rasen tokens — it is entirely the concurrent "Canonical severity vocabulary" / "Dispatched vs standalone mode" content.

Consequences:
- The "11 parity regenerations are name-field-only drift" claim is **inaccurate** — the majority of the regenerated hashes are driven by another in-flight change, not by name-field drift.
- `_shared.ts`, `_orchestration.ts`, and `skill-templates-parity.test.ts` now carry **co-mingled edits from two changes** and cannot be cleanly separated by file-level pathspec (the rebrand *also* legitimately edits `_orchestration.ts` for OPSX→Rasen LEAD text).
- Test is green (hashes match the current *combined* working-tree output), so **no runtime break** — but a broad `git add` when committing rasen-full-rebrand will absorb the concurrent change's template edits and bake its content into the rebrand's parity baseline (the shared-index hazard).

*Fix/recommendation:* commit rasen-full-rebrand with **explicit pathspec** and reconcile the parity-hash file with the `prompt-audit-fixes-expert-dispatch` owner — only the navigator/office-hours + `getOpsx*CommandTemplate` hash rows belong to this change; the expert-skill hash rows belong to the concurrent change. Do **not** `git add -A`.

**Round-2 verdict: findings-to-fix — all 10 resolved cleanly; ship-gated on commit hygiene for 3 shared files (R2-1). The fixes themselves introduced no code defect.**
