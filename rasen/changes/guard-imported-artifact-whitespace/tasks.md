## 1. Pre-commit guard

- [x] 1.1 Add `.githooks/pre-commit` running `git diff --cached --check` and ESLint over staged in-scope JavaScript/TypeScript, with an actionable failure message that names both Markdown hard-break fixes.
- [x] 1.2 Add the hook installer that points `core.hooksPath` at `.githooks/`, and make it a silent no-op outside a git work tree, under `CI`, under `RASEN_SKIP_GIT_HOOKS`, and when a different hooks path is already configured.
- [x] 1.3 Wire the installer into `prepare` so a normal install arms the hook without breaking dependency installs that have no git work tree.
- [x] 1.4 Add tests for the installer's decision table (install, skip-no-git, skip-ci, skip-opt-out, skip-foreign-hooks-path).

## 2. Archive whitespace preflight

- [x] 2.1 Add the whitespace scanner: trailing whitespace, blank line at end of file, space-before-tab; skip binary content; return every offending `file:line`.
- [x] 2.2 Run the scanner over the change's text artifacts during archive planning, before any staging, copy, or hash, and block with the full list.
- [x] 2.3 Add the `--no-whitespace-check` opt-out and record in the archive output that the guard was disabled.
- [x] 2.4 Add tests: dirty evidence blocks before staging, all offending lines reported, binary skipped, clean change unaffected, opt-out recorded.

## 3. Verification

- [x] 3.1 Prove the guard catches the real regression: the imported `verification-report.md` shape (Markdown hard breaks) is rejected by both the hook and the preflight.
- [x] 3.2 Run `git diff --cached --check`, ESLint, `tsc --noEmit`, and the focused test files; confirm the change's own artifacts pass the guard it adds.
- [x] 3.3 Document the hook, its opt-out, and the archive flag.
