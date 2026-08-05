# Round-1 Independent Re-Review: `store-planning-foundation-v2`

Date: 2026-08-06
Mode: dispatched, report-only, non-author re-reviewer
Review-loop round: 1
Child baseline: `origin/dev/0.1.7` / `HEAD` at `588afca1029b7319143b23ed7885403404792183` (remote-confirmed)
Branch: `feat/store-project-partitions-planning-worktrees`

## Verdict

**CLEAN**

Open findings: **0 BLOCKER, 0 MAJOR, 0 MINOR**.

All five findings from the original canonical review are **CONFIRMED FIXED**. The current full child implementation diff, including the round-1 fixer delta, introduces no new BLOCKER, MAJOR, or MINOR regression. The foundation remains side-effect free and preserves its legacy compatibility surfaces.

## Scope check

**Scope Check: CLEAN**

- Intent: provide pure Store layout/catalog, portable identity, Change-metadata, finalization-outcome, and Archive v2 contracts without activating command routing, filesystem mutation, migration, Git worktree, Archive apply, API, or UI behavior.
- Delivered child inventory: six tracked compatibility/export edits; seven new production contract modules; five focused test files; and the child proposal/design/tasks/spec/evidence artifacts.
- The shared worktree contains sibling portfolio Changes and unrelated branch history. They were excluded from the child inventory using the child artifacts, imports/exports, focused tests, and the original review inventory.
- No dependency, command, mutation, Git-operation, management API, or UI change was attributed to this child. No root documentation becomes stale because these contracts remain additive and unactivated.

## Prior finding dispositions

### MAJOR-1 — Durable archive boundaries parse identity shape but do not verify identity relationships

**Disposition: CONFIRMED FIXED.**

- `src/core/store/planning-identity.ts:21-34` separates format-valid wire identities from `VerifiedChangeInstanceId` and `VerifiedWorkspacePairId`; derivation/verification returns the verified subtypes at `:208-229` and `:286-315`.
- Change metadata preserves a relationship-verified Change instance after recomputing its scope and seed relationship at `src/core/change-metadata/schema.ts:40` and `:68-71`.
- Archive-entry layout inputs require `VerifiedChangeInstanceId` at `src/core/store/planning-layout-v2.ts:47` and `:70`, while runtime shape validation remains fail-closed at `:208` for untyped/unsafe callers.
- Code-backed landed Archive records re-verify the workspace pair from the Change, planning worktree, and execution worktree at `src/core/store/finalization-v2.ts:315-326`.
- Archive readers intentionally return the shape-only `ArchiveV2Wire`, while durable serialization requires both verified identity subtypes at `src/core/store/finalization-v2.ts:387-421`; it no longer reports unavailable preimage relationships as verified.
- Regression coverage: public type-boundary rejection at `test/core/store/planning-foundation-consumer.test.ts:43-60`, relationship-verifier mismatch cases at `test/core/store/planning-identity-v2.test.ts:239-294`, and correctly shaped workspace-pair tamper rejection at `test/core/store/finalization-v2.test.ts:176-195`.
- Reviewed residual: TypeScript brands can be bypassed only by an explicit unsafe cast or untyped caller. Runtime shape checks remain, and the complete code-backed pair preimage is re-verified. This is the documented static trust boundary, not an open child finding.

### MAJOR-2 — Portable relative paths and full refs admit Windows-unrepresentable names

**Disposition: CONFIRMED FIXED.**

- `assertPortableSegment` now rejects Windows-invalid `: * ? " < > |`, controls, separators, trailing dot/space, and normalized reserved-device aliases at `src/core/store/planning-validation.ts:77-103`.
- The shared rule is applied to every full-ref component at `src/core/store/planning-validation.ts:167-194` and every portable-relative-path segment at `:230-248`.
- Regression matrices cover both path flavors, every added invalid character, reserved aliases, catalog refs/knowledge bundles, and Archive evidence paths in `test/core/store/planning-validation-v2.test.ts:78-132`, `test/core/store/planning-layout-v2.test.ts:136-153`, and `test/core/store/finalization-v2.test.ts:278-292`.

### MAJOR-3 — Project catalogs accept machine-relative clone locations

**Disposition: CONFIRMED FIXED.**

- V2 project remotes now use an explicit URL-scheme allowlist (`https`, `ssh`, `git`, `git+ssh`) or conservative SCP-like syntax at `src/core/store/planning-catalogs.ts:94-98` and `:146-220`.
- Local relative, drive-relative/absolute, UNC/device, slash-absolute, backslash-bearing, unsupported-scheme, credential-bearing, query, fragment, malformed-host, and pathless forms fail before catalog construction; integration is at `src/core/store/planning-catalogs.ts:271`.
- `test/core/store/planning-layout-v2.test.ts:101-134` proves valid HTTPS/SSH/Git/SCP locators and rejects `relative/repo.git`, `C:repo.git`, absolute/device forms, unsupported schemes, and credential/query/fragment variants.
- The stricter grammar is scoped to the new v2 catalog. The legacy Store remote compatibility suite remains green.

### MINOR-1 — Planning-identity input failures escape under the layout error family

**Disposition: CONFIRMED FIXED.**

- `src/core/store/planning-identity.ts:47-67` reclassifies nested portable-id validation as `invalid_planning_identity`, retaining the original field and error as `cause`; `derivePlanningScopeId` uses it at `:179-182`.
- `test/core/store/planning-identity-v2.test.ts:206-223` asserts the outer code/field and inner layout-family cause for invalid project and target-line inputs.

### MINOR-2 — Required negative contract paths lack direct tests

**Disposition: CONFIRMED FIXED.**

- Non-canonical local identity inputs are covered at `test/core/store/planning-identity-v2.test.ts:225-237`.
- Correctly shaped mismatch cases for planning scope, Change, worktree, and workspace-pair verifiers are covered at `test/core/store/planning-identity-v2.test.ts:239-294`.
- Target-line filename mismatch is covered at `test/core/store/planning-layout-v2.test.ts:223-234`.
- Invalid real calendar dates with stable code/field assertions are covered at `test/core/store/planning-layout-v2.test.ts:433-457`.

## Regression audit

- **No new findings.** The fixer delta remains within the five reported correction areas.
- Canonical JSON extraction/re-export is compatible: both workflow-package codec suites pass.
- Store metadata remains byte-stable without `layoutVersion`, and both metadata schema versions retain the explicit layout declaration behavior covered by the focused and legacy suites.
- Centralizing the Windows device-name list preserves the legacy project-record export and behavior; the project-record compatibility suite passes.
- The stricter v2 remote grammar does not alter legacy Store remote parsing/writes; the Store remote command suite passes.
- Public core exports and branded writer/layout boundaries typecheck through the consumer fixture and `tsc --noEmit`.

## Standards axis

- Result: **PASS** — 0 BLOCKER, 0 MAJOR, 0 MINOR.
- The current child modules perform no filesystem, registry, cwd, environment, command, or Git-process access. No SQL, concurrency, LLM, frontend, dependency, or bundle concern applies.
- No new Fowler-baseline smell rises to a reportable severity; the fixes centralize policy rather than duplicate it.

## Spec axis

- Result: **PASS** — 0 BLOCKER, 0 MAJOR, 0 MINOR.
- The five previously identified contract/coverage gaps now match the Store layout, planning identity, and Archive v2 requirements.
- No requested behavior is missing or partial, and no implementation behavior exceeds this foundation slice's non-goals.

## Coverage map

```text
CODE PATH COVERAGE
==================
[+] Verified identity boundaries
    |-- [★★★ TESTED] metadata Change verification + verifier mismatch matrix
    |-- [★★★ TESTED] layout compile-time verified-id requirement
    `-- [★★★ TESTED] code-backed Archive workspace-pair tamper rejection

[+] Portable paths, refs, and project remotes
    |-- [★★★ TESTED] Windows-invalid characters + device aliases
    |-- [★★★ TESTED] evidence and knowledge-bundle propagation
    `-- [★★★ TESTED] remote allowlist positive/negative matrix

[+] Stable errors and negative branches
    |-- [★★★ TESTED] identity-family reclassification with preserved cause
    |-- [★★★ TESTED] local identity and all relationship mismatches
    `-- [★★★ TESTED] filename mismatch and invalid calendar dates

DOWNSTREAM FLOW COVERAGE
========================
[+] [★★★ TESTED] public core consumer composes only verified writer/layout values
[+] [★★★ TESTED] Archive serialize/parse/verify remains deterministic
[+] [★★★ TESTED] legacy Store/project/Change/archive/canonical-package consumers pass

PRIOR-FINDING COVERAGE: 5/5 dispositions directly tested; 0 open gaps.
No E2E/browser flow is appropriate: command selection, I/O mutation, Git integration,
API, and UI are explicit later-slice responsibilities.
```

## Checks performed

- Read completely: child `proposal.md`, `design.md`, `tasks.md`, all three delta specs, original canonical review, fixer cycle report, supplied global rules, `test/AGENTS.md`, the review checklist, and Greptile triage instructions.
- Reviewed the complete child implementation inventory: all six tracked diffs and the full contents of all seven new production modules and five focused tests.
- Confirmed `origin/dev/0.1.7` remotely at `588afca1029b7319143b23ed7885403404792183`; no PR exists for the worktree branch.
- `pnpm exec vitest run test/core/store/planning-validation-v2.test.ts test/core/store/planning-layout-v2.test.ts test/core/store/planning-identity-v2.test.ts test/core/store/finalization-v2.test.ts test/core/store/planning-foundation-consumer.test.ts` — **PASS**, 5 files / 159 tests.
- `pnpm exec vitest run test/core/store/foundation.test.ts test/core/store/project-records.test.ts test/core/store/legacy-metadata.test.ts test/utils/change-metadata.test.ts test/core/archive-accounting.test.ts test/commands/store-remote.test.ts test/core/workflow-package/codec.test.ts test/core/workflow-package/pipeline-package.test.ts` — **PASS**, 8 files / 146 passed / 1 pre-existing platform skip.
- `pnpm exec tsc --noEmit` — **PASS**.
- `pnpm run lint` — **PASS**.
- `rasen validate 'store-planning-foundation-v2' --type change --strict` — **PASS**.
- `git diff --check HEAD -- <six tracked child files>` — **PASS**; only Git's existing LF/CRLF conversion warnings were emitted.
- `pnpm run build` was not rerun because this report-only re-review owns no generated-file writes. The fixer recorded a passing build for the same final source/test content; this re-review independently exercised runtime imports, public types, lint, and both focused/compatibility suites.

## Final gate

- BLOCKER: none.
- MAJOR: none; MAJOR-1, MAJOR-2, and MAJOR-3 are confirmed fixed.
- MINOR: none; MINOR-1 and MINOR-2 are confirmed fixed.
- Round-1 independent re-review verdict: **CLEAN**.
