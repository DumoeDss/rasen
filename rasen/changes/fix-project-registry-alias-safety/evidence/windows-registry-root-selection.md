## Windows registry and root-selection verification

- Date: 2026-08-09
- Platform: native Windows / PowerShell
- CI-equivalent worker setting: `VITEST_MAX_WORKERS=2`
- Command: `pnpm exec vitest run test/core/project-registry.test.ts test/core/project-home.test.ts test/core/root-selection.test.ts`
- Result: 3 files passed; 124 tests passed.
- Full focused command: `pnpm exec vitest run test/core/project-registry.test.ts test/core/project-home.test.ts test/core/root-selection.test.ts test/core/store-planning/store-planning.test.ts`
- Full focused result: 4 files passed; 159 tests passed, including all registry/config identity-drift refusal cases.

The passing cases include canonical alias ownership and conflict refusal,
read-only missing-home no-create behavior, canonical main-first project-home
selection with direct worktree fallback, and root-selection use of the canonical
main home under native Windows case, separator, and dot-segment semantics.
