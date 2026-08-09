# Ship Log: fix-spec-reconciliation-integrity

**Date:** 2026-08-09T23:59:22.7815377+08:00
**Mode:** local
**Branch:** fix/archive-transaction-recovery-follow-up
**Commit:** e82149fe441742b17e88499db7af573d8a69e2a3
**Tree:** 444bf9f4ebd677e8bf4b01c56d1260530f905aa8
**Status:** Committed (delivery deferred to portfolio level)

The ship log is committed in a separate evidence-only follow-up commit. Its SHA is
reported by the shipper handoff rather than self-stamped into this file.

## Pre-Flight Results

- Verification: PASS / CLEAN at Tier A; final independent review reported 0 Blocker, 0 Major, 0 Minor, and 0 Trivial findings.
- Tasks: 11/12 complete.
- Pending task: 4.3, remote post-commit Windows CI evidence. The task remains unchecked and no remote CI pass is claimed.
- Scope: 13 committed paths, all within the child whitelist; no archive-engine, workspace, registry, Store-finalization, parent planning-context, or `.rasen/**` delta was included.

## Test Gate

- Required scope: canonical reconciliation, projected validation deduplication, validator issue metadata, and direct/bulk CLI rendering.
- Rationale: the delivered production change is localized to validator issue metadata, while the three focused files exercise every reconciliation and rendering contract credited to this child. Type checking, lint, and strict change validation cover the surrounding static and artifact contracts.
- Tests: `pnpm exec vitest run test/core/specs-apply.test.ts test/core/validation.test.ts test/commands/validate.test.ts --reporter=dot` — 3 files passed; 94 tests passed; 3 platform-inapplicable tests skipped; exit 0.
- Metadata delta check: `pnpm exec vitest run test/core/validation.test.ts -t "keeps stable metadata and order for" --reporter=dot` — 5 tests passed; exit 0.
- Type check: `pnpm exec tsc --noEmit` — exit 0.
- Lint: `pnpm lint` — exit 0.
- Strict artifact validation: `rasen validate fix-spec-reconciliation-integrity --type change --strict --json` — 1 item passed; 0 failed; exit 0.
- Tree: 444bf9f4ebd677e8bf4b01c56d1260530f905aa8

## Delivery

- No push, PR creation, merge, deployment, or archive was performed.
- Delivery is deferred to the single portfolio/parent-level ship after all decomposed children are complete.
- Remote Windows CI must run against the portfolio-delivered commit before task 4.3 can be completed.
