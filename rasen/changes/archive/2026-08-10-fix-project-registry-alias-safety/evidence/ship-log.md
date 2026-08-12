# Ship Log: fix-project-registry-alias-safety

**Date:** 2026-08-09T23:50:56+08:00
**Mode:** local
**Branch:** fix/archive-transaction-recovery-follow-up
**Commit:** 43c7e88fb2cacb584754bfbee7bdedf28114131d
**Tree:** 9fa422c1c5139b893d7f226c9aa5d158a87f6d69
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results

- Verification: passed — Tier A review cycle CLEAN, final findings 0 Blocker / 0 Major / 0 Minor / 0 Trivial; fresh focused gate passed.
- Tasks: 17/17 complete.
- Scope: 21 path-scoped code, test, specification, and review-evidence files; no sibling child or `.rasen/**` run-state path was staged.

## Test Gate

- Required scope: final canonical-alias mutation-admission regression, adjacent healthy registry behaviors, focused lint for the complete child delta, and strict change validation.
- Rationale: the last review fix moved the conflict guard ahead of identity filtering in `project-registry.ts`; the focused regression covers that fail-closed branch and its closest admitted behaviors, while ESLint and strict validation cover the complete child surface without escalating to the unrelated full repository suite.
- Tests: `pnpm exec vitest run test/core/project-registry.test.ts -t "refuses a third identity|refuses conflicting live aliases|collapses canonical aliases|rebinds a moved repo|finds an existing uppercase-UUID entry"` — 5 passed, 45 skipped; `dist/` matched current sources.
- Lint: `pnpm exec eslint src/core/project-registry.ts src/core/project-home.ts src/core/learned-skills/context.ts src/core/store-planning/internal/dependencies.ts src/core/store-planning/internal/resolver.ts test/core/project-registry.test.ts test/core/project-home.test.ts test/core/learned-skills/context.test.ts test/core/root-selection.test.ts test/core/store-planning/store-planning.test.ts test/core/store-planning/finalize-scope.test.ts` — passed.
- Validation: `node bin/rasen.js validate fix-project-registry-alias-safety --type change --strict --no-interactive` — valid.
- Tree: 9fa422c1c5139b893d7f226c9aa5d158a87f6d69

## Delivery

- Local child commit only; no push, PR, merge, deployment, or archive action was performed.
- Delivery is deferred to the portfolio/parent level after all decomposed children complete.

## Archive
**Date:** 2026-08-10T06:00:03.625Z
**Ship commit:** 43c7e88fb2cacb584754bfbee7bdedf28114131d
**Outcome:** archived at E:\wt\rasen-archive-follow-up\rasen\changes\archive\2026-08-10-fix-project-registry-alias-safety
**Transaction:** 92e38fce-3552-4334-9564-66413c43686a
