# Ship Log: fix-archive-recovery-ownership

**Date:** 2026-08-10T01:13:35+08:00
**Mode:** local
**Branch:** fix/archive-transaction-recovery-follow-up
**Commit:** c09a1dcbe2553a3831ab117f41e0a3326d2c9cec
**Tree:** 01aac43a04d3925484b6866f25339a8718aea8d2
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results

- Verification: pass — independent Tier A Round 2 review CLEAN, 0 Blocker / 0 Major / 0 Minor / 0 Trivial
- Tasks: 15/15 complete
- Scope: `src/core/archive-engine.ts`, the two focused archive recovery test files, and this child change's artifacts

## Test Gate

- Required scope: focused archive-engine authority/abort recovery and cleaner retry/source-removal selections, build, focused ESLint, strict child validation, staged diff, and UTF-8 checks
- Rationale: the delivered change is isolated to archive cleaner authority and stored-abort recovery boundaries; the selected native-Windows cases exercise mixed-case order, exact signed timestamps, legacy authority refusal, publication-window retry, plan-derived abort operands, restored retry, and source-removal recovery without escalating to the unrelated repository-wide suite
- Tests: `pnpm run build` — pass
- Tests: `pnpm exec vitest run test/core/archive-engine.test.ts -t 'mixed-case cleaner authority|unchanged cleaner candidate with exact stat identity|signed exact timestamps|cleaner content changes before exact authority|changed cleaner candidate|same-byte cleaner candidate|inode-reuse-style|same-byte private claim|legacy delete plan|legacy no-delete|crash between hard-link publication|native Windows stored-abort path identity|torn guarded abort' --reporter=dot` — 28 passed, 65 skipped
- Tests: `pnpm exec vitest run test/core/archive-fault-matrix.test.ts -t 'promotes a restored cleaner retry|active-source removal failure|cleaner partial failure|recovers a cleaner deletion' --reporter=dot` — 4 passed, 52 skipped
- Tests: `pnpm exec eslint src/core/archive-engine.ts test/core/archive-engine.test.ts test/core/archive-fault-matrix.test.ts` — pass
- Validation: `rasen validate fix-archive-recovery-ownership --strict` — valid
- Structural checks: scoped staged paths only, `git diff --cached --check`, debug/TODO/secret scan, and strict UTF-8 decoding of 12 files — pass; no BOM found
- Tree: 01aac43a04d3925484b6866f25339a8718aea8d2

## Delivery

- No push, PR, merge, deployment, or archive action was performed.
- Portfolio-level delivery owns the eventual branch push/PR update and integration CI.

## Archive
**Date:** 2026-08-10T05:54:39.536Z
**Ship commit:** c09a1dcbe2553a3831ab117f41e0a3326d2c9cec
**Outcome:** archived at E:\wt\rasen-archive-follow-up\rasen\changes\archive\2026-08-10-fix-archive-recovery-ownership
**Transaction:** 8467f492-11d2-4576-8569-1223131f8e00
