## 1. Investigation confirmation

- [x] 1.1 Confirm the 4 root-stub scenarios in `rasen/specs/cli-update/spec.md` (lines 10-13, 18-21, 26-31, 36-39) are the complete set — re-grep `AGENTS.md\|CLAUDE.md\|stub\|marker` against the file before editing, since line numbers drift.
- [x] 1.2 Confirm zero implementation: `src/core/legacy-cleanup.ts` only detects and (consent-gated, `rasen migrate` only) removes root marker blocks; `src/core/update.ts:507-511` states update never rewrites/refreshes shared config files; `src/core/config.ts:14-16` states `OPENSPEC_MARKERS` is recognize-only, never written into new content.
- [x] 1.3 Confirm the historical trace via `CHANGELOG.md`: feature added upstream at v0.6.0/v0.7.0 (lines ~600, 606), removed upstream at v1.0.0 (lines ~219-227, "Config files removed ... no longer generated"), fork baseline aligns with upstream v1.5.0 (line 22) — the fork never had this feature.
- [x] 1.4 Confirm no sibling spec repeats this exact claim: `grep -rl "root-level stub\|root stub\|managed marker block" rasen/specs/` returns only `cli-update/spec.md`.

## 2. Spec correction

- [x] 2.1 Edit `rasen/specs/cli-update/spec.md` requirement "Update Behavior" / scenario "Running update command" (lines 10-13): remove the root-stub `AND` clause, keep the `rasen/AGENTS.md` replacement `THEN` clause.
- [x] 2.2 Edit requirement "File Handling" / scenario "Updating files" (lines 18-21): remove the root-stub `AND` clause, keep the `rasen/AGENTS.md` replacement `THEN` clause.
- [x] 2.3 Edit requirement "Tool-Agnostic Updates" / scenario "Updating files" (lines 26-31): remove the "create or refresh the root-level AGENTS.md stub ... even if previously absent" `AND` clause, keep the `rasen/AGENTS.md` replacement `THEN` clause and the other two true `AND` clauses (command/skill regeneration, avoid creating new native-tool config files).
- [x] 2.4 Edit requirement "Core Files Always Updated" / scenario "Successful update" (lines 36-39): remove the root-stub `AND` clause, keep the `rasen/AGENTS.md` replacement `THEN` clause.
- [x] 2.5 Verify `rasen/changes/cli-update-stub-adjudication/specs/cli-update/spec.md` (delta, MODIFIED Requirements) contains full corrected block copies for all 4 requirements, matching this repo's delta convention (see `rasen/changes/archive/2026-07-10-fix-brand-residuals/specs/cli-update/spec.md` for the prior pattern).

## 3. Validation

- [x] 3.1 Run `node dist/cli/index.js validate cli-update-stub-adjudication --strict` from the worktree root; fix any reported issues. (Result: "Change 'cli-update-stub-adjudication' is valid")
- [x] 3.2 Run `node dist/cli/index.js validate --specs --strict` from the worktree root; confirm the expected 119/0 pass count and no new failures introduced by the `cli-update` edits. (Result: "Totals: 119 passed, 0 failed (119 items)")
- [x] 3.3 Brand-grep discipline: confirm no `OpenSpec`/`openspec` brand tokens were wrongly introduced or removed in the edited scenarios (K1-K7 keep-classes per `rasen-cli-identity/spec.md` conventions) — verified: the 4 removed clauses contain zero `OpenSpec`/`openspec` occurrences.

## 4. Round-2 fix (Blocker resolution)

- [x] 4.1 Round-1 verify returned BLOCKED: the kept "replace `rasen/AGENTS.md` with the latest template" clause in all 4 scenarios was also false (never independently checked; `update.ts`/`init.ts` have zero `AGENTS` references). See `design.md` D1a/D1b.
- [x] 4.2 Re-adjudicated all 4 scenarios' surviving clauses against `update.ts` (read in full) and empirical `dist/cli/index.js` runs; rewrote each to assert only verified-true behavior (skill files always regenerated; command files regenerated when delivery includes commands; update never onboards a new tool). See `design.md` D1b table.
- [x] 4.3 Found a second false clause during re-adjudication (`Tool-Agnostic Updates`' "avoid creating new native-tool configuration files ... unless they already exist" — contradicted by empirically-reproduced profile-drift healing). Did not assert the opposite either, since that collides with the already-accepted `Slash Command Updates` scenarios; dropped/replaced with an undisputed true clause instead. Ledgered as a new follow-up in `design.md` Open Questions. See `design.md` D1c.
- [x] 4.4 Re-ran `node dist/cli/index.js validate cli-update-stub-adjudication --strict` (pass) and `validate --specs --strict` (119/0) after the round-2 edit.
- [x] 4.5 Confirmed delta spec (`specs/cli-update/spec.md`) and main spec (`rasen/specs/cli-update/spec.md`) are byte-consistent for the 4 corrected blocks after the round-2 edit.
