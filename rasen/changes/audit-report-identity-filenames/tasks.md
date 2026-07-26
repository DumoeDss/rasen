## 1. Deterministic Default Filename

- [x] 1.1 Add a named basename byte limit and a pure helper in `src/core/token-audit/audit.ts` that uses the full readable runtime/session id for normal lowercase portable ids and a full SHA-256 canonical-identity fallback for unsafe, case-sensitive, empty, or overlong ids.
- [x] 1.2 Refactor default path resolution to consume `AuditResult.session.runtime` and `AuditResult.session.id` directly, while preserving the explicit `outPath` bypass and existing report write behavior.

## 2. Focused Regression Coverage

- [x] 2.1 Add pure filename-helper tests covering two Codex UUIDv7 ids with the same first eight characters, repeat-call stability, equal ids across different runtimes, and deterministic bounded fallback names for Windows-invalid and overlong ids.
- [x] 2.2 Update the default-path integration assertion for the new runtime/full-id filename and retain the explicit `--out` regression assertion, using `path.join` for cross-platform expectations.
- [x] 2.3 Run only the focused token-audit audit test file(s) on the Windows worktree with Vitest and record the green result; do not run the repository-wide test suite.

## 3. Change Verification

- [x] 3.1 Run `rasen validate audit-report-identity-filenames --json` and confirm the implementation satisfies the modified `cli-agent-audit` output-location scenarios without migrating existing analytics files.
