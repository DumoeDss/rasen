# Review Cycle Report: `store-planning-foundation-v2`

Date: 2026-08-06  
Round: 1/3  
Stage: dispatched Codex-native ONE_SHOT fixer  
Canonical input: `evidence/review-report.md`  
Status: **ALL 3 MAJOR AND 2 MINOR FINDINGS FIXED; INDEPENDENT NON-AUTHOR RE-REVIEW PENDING**

This report records the fixer delta and its gate evidence. It does not declare the cycle CLEAN: under the author != verifier invariant, the parent must route the delta to a non-author reviewer before closing any canonical finding.

## Round summary

| Round | Findings (B/Ma/Mi/T) | Fixed by | Confirmation | Disposition |
| --- | --- | --- | --- | --- |
| 1 | 0/3/2/0 | `foundation_fixer_r1` | Focused tests, compatibility tests, typecheck, lint, build, strict Change validation; independent reviewer pending | 5/5 implemented; 5/5 await non-author confirmation |

## Finding dispositions

### MAJOR-1 — Durable identity relationships

Disposition: **FIXED; PENDING NON-AUTHOR CONFIRMATION**.

- Added separate relationship-verified subtypes, while keeping parser results explicitly shape-only: `VerifiedChangeInstanceId` and `VerifiedWorkspacePairId` in `src/core/store/planning-identity.ts:23-34`. Derive/verify functions now return those subtypes at `src/core/store/planning-identity.ts:207-229` and `src/core/store/planning-identity.ts:285-315`.
- Archive-entry layout inputs now require `VerifiedChangeInstanceId` at `src/core/store/planning-layout-v2.ts:47` and `src/core/store/planning-layout-v2.ts:70`; runtime shape validation remains at `src/core/store/planning-layout-v2.ts:212` to fail closed against unsafe casts or JavaScript callers.
- Change metadata now retains the verified subtype after relationship verification at `src/core/change-metadata/schema.ts:40` and `src/core/change-metadata/schema.ts:68`.
- Code-backed landed Archive records now re-verify `workspacePairId` against `changeInstanceId`, planning worktree, and execution worktree at `src/core/store/finalization-v2.ts:315-326`.
- Archive readers return the explicitly named `ArchiveV2Wire`, whose identities are only shape-valid where preimages are absent, at `src/core/store/finalization-v2.ts:387-411`. Durable serialization requires verified Change/pair inputs at `src/core/store/finalization-v2.ts:398-421`; no absent context is reported as relationship verification.
- Regressions: compile-time rejection of shape-only/raw layout and Archive-writer identities at `test/core/store/planning-foundation-consumer.test.ts:43-60`; correctly shaped pair-digest tamper rejection and the intentionally shape-only no-execution-preimage case at `test/core/store/finalization-v2.test.ts:176-195`; all identity verifier mismatch branches at `test/core/store/planning-identity-v2.test.ts:239-294`.

Residual risk: TypeScript brands are a static trust boundary and can be bypassed by explicit unsafe casts or untyped JavaScript. Runtime shape validation remains in place, and Archive cross-field verification is performed whenever the complete pair preimage exists. Callers must obtain durable-write values through derive/verify APIs.

### MAJOR-2 — Cross-platform portable path/ref components

Disposition: **FIXED; PENDING NON-AUTHOR CONFIRMATION**.

- Centralized the cross-platform component rule in `assertPortableSegment`, including Windows-invalid `: * ? " < > |`, normalized reserved-device aliases, controls, separators, and trailing dot/space at `src/core/store/planning-validation.ts:77-103`.
- Applied the same component rule to every full-ref component at `src/core/store/planning-validation.ts:167-194` and every portable-relative-path segment at `src/core/store/planning-validation.ts:230-248`.
- Regressions cover the platform-neutral Windows/POSIX policy and reserved aliases at `test/core/store/planning-validation-v2.test.ts:78-132`, catalog refs and knowledge bundles at `test/core/store/planning-layout-v2.test.ts:136-153` and `test/core/store/planning-layout-v2.test.ts:240-271`, and Archive evidence paths at `test/core/store/finalization-v2.test.ts:278-292`.

Residual risk: the ref grammar is intentionally conservative rather than a complete reimplementation of Git. Future locator/component forms must be explicitly added only if they remain materializable on both Windows and POSIX.

### MAJOR-3 — Portable project remote allowlist

Disposition: **FIXED; PENDING NON-AUTHOR CONFIRMATION**.

- Replaced negative-only path screening with an explicit URL-scheme allowlist (`https`, `ssh`, `git`, `git+ssh`) plus a conservative SCP-like grammar at `src/core/store/planning-catalogs.ts:94-98` and `src/core/store/planning-catalogs.ts:146-220`.
- The validator rejects relative, drive-relative, drive-absolute, UNC/device, slash-absolute, backslash-bearing, unsupported-scheme, credential-bearing, query, fragment, malformed-host, and pathless forms before catalog construction; integration is at `src/core/store/planning-catalogs.ts:271`.
- Valid HTTPS/SSH/Git/SCP and invalid relative/drive/UNC/device/credential/query/fragment fixtures are at `test/core/store/planning-layout-v2.test.ts:101-134`.

Residual risk: the allowlist deliberately rejects uncommon clone transports until portability and credential semantics are specified. This is a fail-closed compatibility choice for the new v2 catalog only; legacy Store remote parsing is unchanged.

### MINOR-1 — Identity error-family reclassification

Disposition: **FIXED; PENDING NON-AUTHOR CONFIRMATION**.

- Nested project/target-line validation failures are rethrown as `invalid_planning_identity`, preserving the original field and error as `cause`, at `src/core/store/planning-identity.ts:47-67` and `src/core/store/planning-identity.ts:179-182`.
- Code/field/cause assertions are at `test/core/store/planning-identity-v2.test.ts:206-223`.

Residual risk: none identified within the pure identity boundary.

### MINOR-2 — Missing negative contract tests

Disposition: **FIXED; PENDING NON-AUTHOR CONFIRMATION**.

- Non-canonical local identity inputs: `test/core/store/planning-identity-v2.test.ts:225-237`.
- Correctly shaped mismatch cases for planning scope, Change, worktree, and workspace-pair verifiers: `test/core/store/planning-identity-v2.test.ts:239-294`.
- Target-line filename mismatch: `test/core/store/planning-layout-v2.test.ts:223-234`.
- Invalid real calendar dates with stable code/field: `test/core/store/planning-layout-v2.test.ts:433-457`.

Residual risk: none identified for the listed negative branches.

## Verification evidence

Required scope: all five child-focused foundation suites, affected legacy Store/project/Change/archive and workflow-canonicalization compatibility suites, TypeScript public-boundary checking, lint, build, strict Change validation, UTF-8 validation, and diff hygiene. This covers the changed parsers, types, schemas, deterministic serialization path, shared validator consumers, and the compatibility surfaces named by the canonical review.

Exact gates:

- `pnpm exec vitest run test/core/store/planning-validation-v2.test.ts test/core/store/planning-layout-v2.test.ts test/core/store/planning-identity-v2.test.ts test/core/store/finalization-v2.test.ts test/core/store/planning-foundation-consumer.test.ts` — **PASS**, 5 files / 159 tests against the final source/test content.
- `pnpm exec vitest run test/core/store/planning-layout-v2.test.ts` — **PASS**, 1 file / 48 tests (the targeted iteration gate before the final combined run).
- `pnpm exec vitest run test/core/store/foundation.test.ts test/core/store/project-records.test.ts test/core/store/legacy-metadata.test.ts test/utils/change-metadata.test.ts test/core/archive-accounting.test.ts test/commands/store-remote.test.ts test/core/workflow-package/codec.test.ts test/core/workflow-package/pipeline-package.test.ts` — **PASS**, 8 files / 146 passed / 1 pre-existing platform skip.
- `pnpm exec tsc --noEmit` — **PASS** after the final test edit.
- `pnpm run lint` — **PASS**; final changed-file ESLint rerun also passed.
- `pnpm run build` — **PASS**.
- `rasen validate 'store-planning-foundation-v2' --type change --strict` — **PASS**.
- Strict UTF-8 decode + no-BOM/mojibake scan over all 11 changed source/test files — **PASS**.
- `git diff --check -- src/core/change-metadata/schema.ts` — **PASS**. The other child implementation/test files are untracked in the shared worktree, so Git has no tracked baseline for `diff --check`; their UTF-8, lint, typecheck, and test gates passed.

Git state identity used by the gates:

- HEAD: `588afca1029b7319143b23ed7885403404792183`
- `git rev-parse HEAD^{tree}`: `37b9a3cfdf8753a31d7542944692e85d86d27863`
- Uncommitted fixer source/test content manifest SHA-256: `5bb6b4e749a8d8af7f7681da5085524bf72328bd2c4cdab98e03af17adfca1f0`

## Changed files owned by this fixer

- `src/core/change-metadata/schema.ts`
- `src/core/store/finalization-v2.ts`
- `src/core/store/planning-catalogs.ts`
- `src/core/store/planning-identity.ts`
- `src/core/store/planning-layout-v2.ts`
- `src/core/store/planning-validation.ts`
- `test/core/store/finalization-v2.test.ts`
- `test/core/store/planning-foundation-consumer.test.ts`
- `test/core/store/planning-identity-v2.test.ts`
- `test/core/store/planning-layout-v2.test.ts`
- `test/core/store/planning-validation-v2.test.ts`
- `rasen/changes/store-planning-foundation-v2/evidence/review-cycle-report.md`

No sibling Change, parent design document, `.rasen/**/auto-run.json`, `portfolio-run.json`, command/mutation/Git integration, commit, push, archive, or PR operation was touched.

## Open findings

No implementation finding remains open in the fixer delta. Canonically, MAJOR-1, MAJOR-2, MAJOR-3, MINOR-1, and MINOR-2 remain **pending independent non-author re-review** and must not be reported CLEAN until that confirmation is recorded.
