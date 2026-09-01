# Review Report: system-assigned-issue-identity

**Date:** 2026-09-01
**Outcome:** Clean after three bounded review/fix rounds; no open Blocker or Major findings.

## Scope

The review covered system-assigned Issue UID/key creation, selector and lock semantics, V1/V2 compatibility, owned-resource identity, CLI/HTTP/UI recovery, public diagnostic redaction, and Store/UI integration.

## Findings and resolution

1. **Major — selector/create race:** all selector-based mutations now take the allocation/selector lock before the UID lock; a gated interleaving regression proves linearization.
2. **Major — committed creation reported as ordinary failure:** atomic exceptions are classified against the exact committed record. Exact bytes return success plus a path-free warning; unverifiable publication returns `issue_publication_indeterminate` with UID/key and `retrySafe: false`.
3. **Major — public storage-locator leakage:** centralized wire projection removes storage keys, fallback `issueId`/`itemId`, paths, and locator-bearing diagnostic text from malformed Issue and Execution Plan responses. Real flat and path-scoped damaged-record routes remain fail-closed with path-free bodies.
4. **Major — UI blind retry after indeterminate creation:** Unlinked Changes preserves the returned UID/key, permanently disables fresh creation for that dialog state, and recovers only through the canonical UID.
5. **Major — same-turn double submission:** a synchronous in-flight guard is set before the first `await`; a deferred-promise production-component regression proves two same-turn activations issue exactly one create request.
6. **Minor — path-bearing public warnings/errors:** raw filesystem and atomic causes remain core-only; public messages use stable path-free text.
7. **Minor — option-shaped compatibility aliases:** the path-scoped bridge places legacy aliases after the argv option terminator; real Commander regressions cover `-alias` and `--store`.
8. **Minor — incomplete unreadable-identity reverse lookup:** plan-bearing malformed records now fail closed with `complete: false`, no false match, and a named problem.
9. **Minor — divergent alias/key attention:** selector narrowing no longer misreports a known divergent Issue as unknown.
10. **Minor — weak concurrency coverage:** the suite now gates creation against a convenience-selector mutation rather than sampling lock state only at the final write.

All findings were fixed by a role-isolated fixer and re-reviewed by non-author reviewers. The final spec review and final adversarial review both returned `CLEAN`.

## Verification evidence

- `pnpm exec vitest run test/core/store/store-issue-identity-allocation.test.ts test/core/store/store-aggregate-query.test.ts test/core/management-api/issue-identity-errors.test.ts test/core/management-api/store-aggregate-wire-mirror.test.ts test/core/management-api/stores-api.test.ts --reporter=dot` — **5 files, 116 tests passed**.
- `pnpm --dir packages/ui exec vitest run test/api/client.test.ts test/components/link-change-dialog.test.tsx --reporter=dot` — **2 files, 43 tests passed**.
- `pnpm run build` — passed.
- `pnpm run lint` — passed.
- `pnpm --dir packages/ui run build` — passed.
- `node bin/rasen.js validate system-assigned-issue-identity --strict` — passed.
- Strict UTF-8 decoding, BOM/replacement-character scan, and `git diff --check` — passed after the final fix. The sole mojibake-pattern match is the existing intentional damaged-input fixture in `layout-migration-apply-recovery.test.ts`.

An external full-suite attempt was intentionally not treated as green evidence: under concurrent reviewer load, several process-heavy CLI tests timed out and Windows could not remove still-open temporary directories. Their assertions did not fail, and the affected boundaries passed in the focused suites above. The pull request CI remains the authoritative full-suite gate before merge.

## Known unrelated baseline

The standalone `packages/ui` typecheck still reports the pre-existing Canvas/consultation fixture errors documented before this change. The changed Issue UI files have no new type errors, their focused tests pass, and the production UI build succeeds.
