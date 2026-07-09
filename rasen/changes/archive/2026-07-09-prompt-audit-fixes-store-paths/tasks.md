## 1. WF-9 + WF-3 (T1) — archive resolves paths from status JSON

- [x] 1.1 In `src/core/templates/workflows/archive-change.ts`, BOTH getters (`getArchiveChangeSkillTemplate` + `getOpsxArchiveCommandTemplate`), step 3 (task-completion HARD GATE): change "Read the tasks file (typically `tasks.md`)" to read the tasks file from `artifactPaths.tasks.existingOutputPaths` (from the status JSON already fetched in step 2), matching `bulk-archive-change.ts`. Do NOT alter child #5's hard-gate wording — only the path source.
- [x] 1.2 In `archive-change.ts`, BOTH getters, step 4 (delta spec sync assessment): change "Compare each delta spec with its corresponding main spec at `rasen/specs/<capability>/spec.md`" to resolve the main spec under the `specs/` directory that is the sibling of `planningHome.changesDir` (i.e. resolved from the planning home in the status JSON), NOT the literal repo-relative path. Keep the rest of the sync-assessment logic unchanged.

## 2. WF-3 (T1) — sync-specs resolves the main-spec target from the planning home

- [x] 2.1 In `src/core/templates/workflows/sync-specs.ts`, BOTH getters, step 4b ("Read the main spec at `rasen/specs/<capability>/spec.md`") and step 4d ("Create `rasen/specs/<capability>/spec.md`"): resolve the main-spec directory from the planning home (the `specs/` sibling of `planningHome.changesDir`) instead of the literal `rasen/specs/`. Note the status JSON is already fetched in step 2 ("Resolve change context"); use `planningHome` from it. Delta inputs stay `artifactPaths.specs.existingOutputPaths` (already correct).

## 3. WF-3 (T4) — office-hours resolves its output paths from status JSON

- [x] 3.1 In `src/core/templates/workflows/office-hours.ts` (the WORKFLOW file), the Dual-Write step: change the active-change write path (currently `rasen/changes/<name>/office-hours-design.md`) to resolve under `changeRoot`, and the no-active-change write path (currently `rasen/office-hours/<topic-slug>.md`) to resolve under the `office-hours/` directory that is the sibling of `planningHome.changesDir`. Update the "Downstream Integration" note accordingly. This is the same location child #5's WF-2 propose-reader scans — keep the two descriptions consistent (producer/consumer agree). This file has both a skill getter and command getter sharing `OFFICE_HOURS_INSTRUCTIONS` — one edit covers both.

## 4. Regenerate + lock hashes + validate

- [x] 4.1 `pnpm build` (fall back to `node build.js` if the pnpm workspace file errors).
- [x] 4.2 `node dist/cli/index.js update` to regenerate skills/commands.
- [x] 4.3 `npx vitest run test/core/templates/` — expect the parity test to fail with moved hashes for exactly `rasen-archive-change`, `rasen-sync-specs`, and `rasen-office-hours-command` (skill function-hash + generated-content-hash) and their command function-hashes (`getOpsxArchiveCommandTemplate`, `getOpsxSyncCommandTemplate`, `getOpsxOfficeHoursCommandTemplate`). Hand-paste from the diff: function-map keys UNQUOTED, content-map keys single-quoted, values single-quoted.
- [x] 4.4 Confirm ONLY those three templates' hashes moved. No `_shared.ts`/`_orchestration.ts` edits here → NO PREAMBLE-embedding expert hashes and NO orchestration-embedder (auto/goal/review-cycle) hashes should move. If any unexpected hash moves, investigate before pasting.
- [x] 4.5 Re-run `npx vitest run test/core/templates/` → green.
- [x] 4.6 `node dist/cli/index.js validate prompt-audit-fixes-store-paths` → passes.

## 5. Scope guard verification (do NOT edit these)

- [x] 5.1 Confirm NO edits were made to `ship.ts`, `verify-enhanced.ts`, `verify-change.ts`, `retro.ts`, or any run-state path (T3 ephemera — owned by the live `externalize-artifacts-t3-workdir` child) and NO edits to any `src/core` runtime file (root-selection.ts, workspace-root.ts, project-home.ts, etc. — the externalize session's surface). `git status --porcelain -- src/core/templates/workflows/ src/core/` must show ONLY `archive-change.ts`, `sync-specs.ts`, `office-hours.ts`.
