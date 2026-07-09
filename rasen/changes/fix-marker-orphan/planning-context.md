# Planning Context — fix-marker-orphan

Seeded by the LEAD, 2026-07-10. Pipeline: bug-fix. Worktree run (branch fix-marker-orphan @ 8907201).

## User intent

Fix the accepted-known from fix-brand-residuals (verifier2's Minor finding): when a shell profile contains BOTH a current `# RASEN:START/END` block AND a stray legacy `# OPENSPEC:START/END` block, reconfigure and uninstall act only on the RASEN block (current-family-first short-circuit) and leave the legacy block orphaned forever.

## Known facts (from fix-brand-residuals, verified 2026-07-10 — re-verify lines, tree may have drifted)

- Two INDEPENDENT implementations share the same short-circuit pattern and BOTH need the symmetric fix:
  1. `src/utils/file-system.ts` `updateFileWithMarkers()` — used by bash-installer.ts and zsh-installer.ts; gained an optional `legacyMarkers` param in fix-brand-residuals (backward-compatible default). Its search finds the current family first and stops.
  2. `src/core/completions/installers/powershell-installer.ts` `findManagedBlockRange()` — inline helper shared by configureProfile()/removeProfileConfig().
- Desired behavior (design decision for the planner, LEAD-endorsed): on reconfigure — replace the FIRST recognized block in place and REMOVE any additional recognized blocks of EITHER family (dedupe); on uninstall — remove ALL recognized blocks of both families. Exact strategy is the planner's call if evidence suggests better, but the invariant is: after any reconfigure/uninstall, at most one managed block remains (exactly one after reconfigure, zero after uninstall), no orphans of either family.
- Spec home: `rasen-cli-identity` has 3 scenarios (added by fix-brand-residuals) covering fresh-install/upgrade/uninstall — none claims both-present behavior. This change ADDS one scenario (or extends via MODIFIED — planner adjudicates per ADDED-vs-MODIFY convention: prefer ADDED requirement/scenario, avoid fragile MODIFY) declaring the dedupe/orphan-free invariant.
- Existing tests: test/core/completions/installers/{bash,zsh,powershell}-installer.test.ts already have write-new/upgrade/uninstall regression tests from fix-brand-residuals — extend in-style with both-families fixtures (reconfigure dedupes, uninstall clears both).

## Constraints

- bug-fix pipeline (propose → apply → adaptive verify → ship → archive; no review-loop stage — verify escalates if findings).
- pnpm is HEALED (outer pnpm-workspace.yaml deleted 2026-07-10) — `pnpm build`/`pnpm vitest` fine; `node build.js` still works too.
- Behavior guard: fresh-install/single-block-upgrade/single-block-uninstall behavior must NOT change (existing tests stay green unmodified except where fixtures legitimately extend).
- CLI in worktree: `node dist/cli/index.js` after building the worktree.
- Shared tree: main is active with another session; ship = local commit in worktree; LEAD merges (reverse-merge + ff) at the end.
- Runtime: ALL workers sonnet (user directive).
- Keep it minimal: no refactor to unify the two implementations unless it is genuinely smaller than fixing both in place (planner may consider extracting the search into file-system.ts and having powershell use it — adjudicate by diff size and blast radius; the two files are in different layers, crossing them may not be worth it).

## Planning findings (2026-07-10, planner pass — all 4 artifacts done, validate + validate --specs both green)

- **Bug surface is 4 sites, not 2** (re-verification against current tree superseded the brief's count): `file-system.ts` `updateFileWithMarkers()` (bash/zsh reconfigure), `bash-installer.ts` `resolvePresentMarkers()`/`removeBashrcConfig()` (bash uninstall — separate code path, doesn't call `updateFileWithMarkers` or `removeMarkerBlock`), `zsh-installer.ts`'s byte-identical duplicate (zsh uninstall), `powershell-installer.ts` `findManagedBlockRange()` (both PS paths). All four do "find first matching family, stop" instead of finding every recognized block.
- **Fix-shape decision: extract, don't fix-in-place-4x.** New exported pure helper `findAllMarkerBlocks(content, markerFamilies)` in `file-system.ts`, consumed by the two character-offset-based sites (`updateFileWithMarkers`, `powershell-installer.ts`). The two line-based uninstall sites (bash/zsh) keep their own private per-file "resolve all present families" helper (generalized from singular to plural) and loop existing line-splice removal — deliberately NOT sharing that piece, mirroring `fix-brand-residuals`'s Non-Goal against consolidating the marker-literal duplication. Rationale: 4 independent implementations of "scan N families, collect every block, handle malformed state" is the exact failure mode that shipped this bug; the shared piece is a pure function (no I/O/BOM/encoding concerns) so extraction is the smaller diff, not a layer-crossing risk.
- Reconfigure algorithm: single left-to-right cursor pass over content — substitute first match's span with fresh RASEN content, drop every subsequent match's span, collapse `(\r?\n){3,}` → `\n\n`. Naive per-block substring splicing on original indices is wrong once the first replacement changes length.
- Delta spec: new ADDED requirement "Shell-completion marker dedupe on dual-family presence" under `rasen-cli-identity` (not a MODIFY of "Brand namespace identifiers" — avoids reproducing 3 unrelated existing scenarios verbatim).
- Artifacts: proposal.md, design.md, specs/rasen-cli-identity/spec.md, tasks.md all written and validated (`validate fix-marker-orphan --strict` and `validate --specs --strict` both pass). Ready for `/rasen:apply`.
