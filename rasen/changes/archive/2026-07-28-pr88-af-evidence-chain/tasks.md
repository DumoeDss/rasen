## 1. M5 — Evidence reconciliation artifact

- [x] 1.1 Create `docs/audits/pr88-round2-evidence-reconciliation.md` with a table listing each round-2 child (1-8): finding IDs, artifact paths, review-report path (reference, don't author), and test verdict (leave as TBD until implementation completes)
- [x] 1.2 Add explicit statement that old `pr88-rf-*` ledgers are NOT re-audited (per review §6 M5: "不要事后伪造历史勾选")
- [x] 1.3 Correct dead links and over-claims in the roadmap (`rasen/explorations/pr88-test-cases-and-roadmap.md`): head `728688ba` not `c4e54285`; Node `>=20.19.0` not "5.9.3 toolchain"; TypeScript 5.9.3; pnpm 9.15.9

## 2. Minor 1 — Scenario title rename

- [x] 2.1 In `rasen/specs/session-runtime-context/spec.md:219`, rename the scenario from "A project the Store records only by its own declaration is a valid choice" to "A project the Store records only by its own declaration is rejected". The body already describes rejection semantics — no body change needed

## 3. Minor 2 — Config reader distinct diagnostics

- [x] 3.1 In `src/core/project-config.ts`, add `readProjectConfigWithDiagnostics(root, options)` returning `{ status: 'absent' } | { status: 'ok', config } | { status: 'unreadable', path, error }`. Keep `readProjectConfig` as a thin wrapper returning `config ?? null`
- [x] 3.2 Migrate bootstrap's config read (the specific caller the review names) to the new function so it can distinguish "unreadable" from "missing identity"

## 4. Minor 4 — Portability gate coverage

- [x] 4.1 In `src/core/project-config.ts` `assertPortableHintValue` (line 2041), replace the fragmented path checks with: `path.win32.isAbsolute(value)` (catches Windows absolute forms on any platform) + `value.startsWith('\\')` (single-backslash root-relative + UNC + `\\?\`) + `value.startsWith('/??/')` or `value.startsWith('\\??\\')` for NT-namespace
- [x] 4.2 Add test cases: `\Users\team\repo` (root-relative), `\??\C:\Users\team\repo` (NT-namespace), `\\?\C:\Users\team\repo` (device namespace) — all rejected on both POSIX and Windows

## 5. Minor 5 — EOF blank line

- [x] 5.1 Fix the `git diff --check` blank line at `rasen/changes/archive/2026-07-27-pr88-review-fixes/planning-context.md:202` (remove trailing blank line at EOF)
- [x] 5.2 Update any clean-evidence claims in PR body/roadmap that reference the old (broken) state

## 6. Verification

- [x] 6.1 Run `git diff --check` — must be clean
- [x] 6.2 Run portability gate tests in isolation — confirm new path forms are rejected
- [x] 6.3 Run config-reader tests — confirm absent vs unreadable distinction
- [x] 6.4 Run `pnpm exec tsc --noEmit` — confirm no type errors
- [x] 6.5 Run `pnpm lint` on changed files — confirm clean
