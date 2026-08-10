# Pre-Landing Review: fix-store-finalization-admission

- Mode: dispatched, report-only
- Reviewer role: fresh non-author; no source, test, task, run-state, commit, or push mutation
- Branch: `fix/archive-transaction-recovery-follow-up`
- Child baseline: `f2a36576` (the uncommitted finalization child delta only)
- Integration base / PR: `dev/0.1.7`, draft PR #148
- Scope check: **CLEAN** — the production/test/fixture delta stays within the child design's touched set and consumes, rather than edits, the four review-clean dependency implementations
- Verdict: **FAIL — 1 Blocker / 1 Major / 1 Minor / 0 Trivial**

## Spec axis

### P1 — Blocker — Saved-preview refusal can still leave an unreachable transaction

**Evidence:** `src/core/management-api/finalize.ts:712-736`, `src/core/management-api/finalize.ts:527-559`, `src/core/archive.ts:78-88`, `src/core/archive.ts:1514-1523`.

The bridge admits the unsaved inspection, then runs the independently planning `--save-plan` subprocess. That subprocess persists before the bridge re-admits its returned preview. If mutable state changes between the two processes, the saved preview can be refused after persistence:

- the Change alias can now resolve to another committed `changeInstanceId`, so lines 527-536 return `change_identity_mismatch` after the new plan was saved; or
- an omitted/false request can inspect blocker-free, then the saved preview can acquire the sole merge gate. `canPersistStoreFinalizationPlan()` deliberately persists that shape, while lines 543-559 refuse it because the assertion is absent.

Both paths return no saved token and perform no owned abort/retirement, leaving the same unreachable machine transaction that CCR-4 required this child to eliminate. This contradicts the proposal's transaction-store-neutral refusal contract and the management spec's no-plan refusal scenarios. The existing four-case HTTP matrix holds state stable across inspect/save, so it cannot detect this TOCTOU form.

**Required correction (ASK / design-level):** make save itself conditionally atomic against the admitted inspection identity and blocker/plan fingerprint, so a changed saved preview is rejected by the CLI before `persistArchivePlan()`. Do not clean up an already-written plan from the server without archive-engine ownership. Add real loopback/child-process regressions that mutate the Change identity and merge-gate state between inspect and save and assert byte-identical transaction inventory.

## Standards axis

### S1 — Major — Sole-merge admission suppresses any numeric subprocess failure

**Evidence:** `src/core/management-api/finalize.ts:539-562`, `test/core/management-api/store-finalize-api.test.ts:668-707`.

`mergeBlockerAdmitted` is gated only by `run.exitCode !== null`; therefore exit 1, exit 2, or any other numeric failure is treated as the expected merge-gate exit. The following non-zero diagnostic branch is then skipped. A process that emits a parseable sole-merge preview but also exits for an independent operational/protocol failure can proceed to save/apply. The new phase tests cover non-zero output only when `archive` is null, so the dangerous combination is absent.

**Required correction (ASK):** define and validate the exact blocked-preview protocol (expected exit/status and absence of an additional diagnostic) rather than treating every numeric exit as merge admission. Add inspect and saved-preview fixture cases containing a valid sole merge blocker plus an independent CLI failure and require the failure to win with no later phase invoked.

Standards count: **0 Blocker / 1 Major / 0 Minor / 0 Trivial**. Worst issue: S1 Major.

Spec count: **1 Blocker / 0 Major / 0 Minor / 0 Trivial**. Worst issue: P1 Blocker.

## Coverage

### C1 — Minor — The production typed-reconciliation chain is not exercised end to end

**Evidence:** `test/core/store/finalization-spec-sync.test.ts:455-510`, `test/fixtures/management-api/finalization-cli.mjs:65-75`, `test/core/management-api/store-finalize-api.test.ts:590-611`, versus production `src/core/archive.ts:1178` and `src/core/archive.ts:1510`; child task `tasks.md:20` is marked complete.

The module test injects `reconciliationIssues` and matching generic blockers directly, while the HTTP test's bounded child synthesizes `specReconciliationIssue`. Neither starts with real malformed delta specs and crosses `SpecReconciliationError -> ArchiveCommand preparation -> ChangeFinalization.plan -> real CLI JSON -> loopback HTTP decoder`. A regression in the newly added production collection/threading seam could therefore pass both tests, despite task 3.3 claiming CLI JSON and HTTP proof.

**Required correction (AUTO-FIX test, routed to a non-author fixer):** add one real loopback/real-CLI refusal with two issues sharing source/capability but naming different requirements; deep-assert all typed fields and order plus byte-identical transaction/project trees.

```text
CODE PATH COVERAGE
==================
[+] management inspect -> save -> apply
    |-- [★★★ TESTED] stable identity refusal; omitted/false/sole-true/true+second blocker
    |-- [★★★ TESTED] inspect/save/apply timeout, unreadable, and ordinary non-zero phases
    |-- [★★★ TESTED] complete, recoverable, abort-required, and manual-only dispositions
    |-- [GAP] [->E2E] identity or merge-gate drift between inspect and save (P1)
    `-- [GAP] valid sole-merge JSON plus independent non-zero CLI failure (S1)

[+] Store finalization and dependency boundaries
    |-- [★★★ TESTED] missing/frozen association, normal pre-plan commits, post-plan Git drift
    |-- [★★★ TESTED] exact self-contained claim and journal-bound no-fallback
    |-- [★★★ TESTED] final-reservation-owned archive recovery, registry/config drift, abort order
    `-- [GAP] [->E2E] real reconciliation failure through CLI and HTTP (C1)

USER FLOW COVERAGE
==================
[+] HTTP finalization
    |-- [★★★ TESTED] refusal leaves bytes unchanged while the two previews are stable
    |-- [★★★ TESTED] exact saved token succeeds and incomplete apply structure survives
    `-- [GAP] [->E2E] concurrent state change during the two-process admission window

Coverage: 26 reviewed high-risk cases exercised; 3 material gaps identified.
```

Coverage count: **0 Blocker / 0 Major / 1 Minor / 0 Trivial**.

## Evidence accounting

### Reviewer-rerun evidence

- `pnpm run build` — passed; this compiled current TypeScript and rebuilt `dist/`.
- Selected real management HTTP/child-process matrix — **14 passed, 16 skipped** in one file. Covered stable identity, merge matrix, real association apply failure, bounded abort/manual disposition, and phase protocol/non-zero diagnostics.
- Selected archive/finalization/association/spec-sync/selection matrix — **12 passed, 123 skipped** across five files. Covered blocker-first rendering, immutable/live association separation, missing association, workspace authority modes, typed issue ordering at the module boundary, store-plan eligibility, owned-reservation recovery, and registry/config drift.
- Strict child validation — passed.
- `git diff --check` — passed (Git emitted only expected LF/CRLF checkout warnings).
- Strict UTF-8 decode of all 14 modified production/test/fixture files — passed.
- Greptile eligibility check for PR #148 — 0 current line-level and 0 top-level comments.

### Implementer/orchestrator recorded evidence (not reviewer rerun)

- Seven focused files / **171 tests passed**.
- Build, `tsc --noEmit`, focused ESLint, strict validation, UTF-8, diff, and scope gates recorded green.
- These results corroborate the stable paths but do not exercise P1, S1, or C1 as described above.

## Adversarial enhancement

The large-diff external Codex/Claude enhancement pass was **not run**. Dispatch explicitly prohibited new external adversarial processes because current Codex calls are hitting 429, and dispatched reviewers may not spawn subagents. This report is the reviewer's own Standards + Spec analysis and does not represent that enhancement as completed.

## Final disposition

**FAIL.** P1 reintroduces CCR-4 as a two-process race and must receive a design-level fix plus non-author delta re-review. S1 must prevent merge admission from swallowing an independent process failure. C1 is a ship-able coverage defect by itself, but task 3.3 should not remain claimed complete without the real production chain.

---

# Round 2 Delta Re-review — 2026-08-10

- Mode: dispatched, report-only; same non-author reviewer resumed with the Round 1 findings
- Review target: only the fixer delta for P1, S1, and C1, plus the minimal hidden CLI parser surface required by that delta
- Scope check: **CLEAN** — the three-line hidden option in `src/cli/index.ts` is the direct Commander adapter required by the compare-before-persist protocol; standalone/non-Store misuse is refused, production server callers do not populate the constructor-only test seam, and HTTP request fields cannot supply the option
- Verdict: **CLEAN — 0 Blocker / 0 Major / 0 Minor / 0 Trivial**

## Round 1 finding resolution

### P1 — RESOLVED — Save now compares the complete admitted plan before persistence

**Code evidence:** `src/core/archive.ts:108`, `src/core/archive.ts:1613-1637`, `src/core/management-api/finalize.ts:789-826`.

`storeFinalizationPreviewPrecondition()` hashes the complete finalization decision and underlying `ArchivePlan`, including source and stable paths, spec actions and target authority, sidecar, cleaner candidates/effective deletion/deletion authority, quality/evidence inputs, Git facts, association/finalization data, decisions, actions, and the ordered blocker set. It excludes only derived identifiers/hashes/tokens and normalizes the per-process transaction id, generated timestamps, and transaction-derived stage/journal instances. The save CLI recomputes and compares that value before `persistArchivePlan()`; the server then requires the saved preview to echo the exact admitted precondition and applies only its exact token.

The real child-process regressions mutate three materially different inputs after inspection and before save:

- committed Change identity and workspace pair — `test/core/management-api/store-finalize-api.test.ts:377`
- PR merge gate — `test/core/management-api/store-finalize-api.test.ts:455`
- archive cleaner/ephemera deletion decision — `test/core/management-api/store-finalize-api.test.ts:500`

All three return HTTP 409 `archive_finalization_preview_changed`, stop after `inspect -> save`, and leave the transaction inventory byte-identical. The cleaner-created file remains present, directly proving that no stale plan reached apply.

### S1 — RESOLVED — Sole-merge admission uses the production exit-1 protocol and cannot hide another diagnostic

**Code evidence:** `src/core/management-api/finalize.ts:473-484`, `src/core/management-api/finalize.ts:559-624`, `src/core/archive.ts:1766`.

The bridge now rejects any preview carrying a separate top-level `status` or `archive.finalization` diagnostic before identity/blocker admission. The sole merge blocker is admitted only when the request explicitly supplies `mergeConfirmed: true` **and** the subprocess exits exactly 1. Exit 0 is a protocol error; every other non-zero exit remains a CLI failure. Production `ArchiveCommand` sets exit 1 for a non-applicable finalization preview, and the real Windows child-process sole-merge success path passed.

`test/core/management-api/store-finalize-api.test.ts:1008` supplies valid sole-merge preview JSON plus an independent diagnostic in both inspect and save. Each case preserves that diagnostic, invokes no later phase, and leaves the transaction store unchanged.

### C1 — RESOLVED — Typed reconciliation is proven through the real production chain

**Code evidence:** `src/core/archive.ts:1270-1281`, `src/core/archive.ts:1602`, `src/core/store/finalization/module.ts:217-235`, `src/core/management-api/finalize.ts:330-361`.

`test/core/management-api/store-finalize-api.test.ts:671` creates malformed real delta specs whose two issues share the same source and capability but name different requirements. It crosses `SpecReconciliationError -> ArchiveCommand preparation -> ChangeFinalization.plan -> real CLI JSON -> real loopback HTTP`, then deep-asserts both issue objects, every typed field, occurrence order, and byte-identical transaction/project trees.

## Round 2 coverage

```text
CODE PATH COVERAGE
==================
[+] inspect -> precondition -> save compare -> exact-token apply
    |-- [★★★ TESTED] stable full-plan precondition across API/direct/bulk/in-ship
    |-- [★★★ TESTED] Change identity drift refuses before persistence
    |-- [★★★ TESTED] merge-gate drift refuses before persistence
    |-- [★★★ TESTED] cleaner/delete-authority drift refuses before persistence
    `-- [★★★ TESTED] standalone/non-Store hidden-option misuse is refused

[+] sole merge blocker protocol
    |-- [★★★ TESTED] real CLI blocked preview exits 1 and explicit true succeeds
    |-- [★★★ TESTED] independent inspect diagnostic wins; no save/apply
    `-- [★★★ TESTED] independent save diagnostic wins; no apply

[+] typed reconciliation propagation
    `-- [★★★ TESTED] two same-source/capability issues survive real CLI + HTTP in order

USER FLOW COVERAGE
==================
[+] HTTP Store finalization
    |-- [★★★ TESTED] concurrent semantic drift returns 409 with zero transaction writes
    |-- [★★★ TESTED] verified sole merge applies the exact saved token
    `-- [★★★ TESTED] malformed deltas preserve complete typed refusal details

Round 2 material paths: all covered; no remaining coverage finding.
```

## Evidence accounting

### Reviewer-rerun evidence

- `pnpm run build` — passed.
- Selected management HTTP/real-child-process Round 2 matrix — **7 passed, 29 skipped** in one file: three P1 drift cases, real sole-merge success, C1 production-chain reconciliation, and S1 independent inspect/save failures.
- Hidden-option misuse plus four-surface parity — **2 passed, 65 skipped** across two files.
- `pnpm exec tsc --noEmit --pretty false` — passed.
- Focused ESLint over all 15 modified production/test/fixture files — passed.
- `node bin/rasen.js validate fix-store-finalization-admission --type change --strict --no-interactive` — passed.
- `git diff --check` — passed; Git emitted only the existing LF/CRLF checkout warnings.
- Strict UTF-8 decode of the 15 modified production/test/fixture files — **0 failures, 0 BOM, 0 mojibake markers**.

### Implementer/orchestrator recorded evidence (not reviewer rerun)

- Seven focused files / **177 tests passed** after the final P1 cleaner-fingerprint correction.
- Cleaner drift was recorded red before the full-plan fingerprint and green after it.
- Focused build, TypeScript, ESLint, strict validation, UTF-8, diff, and forbidden-scope gates were recorded green.

## Durable context

- Selected tests still emit Node `DEP0190` for `shell: true` in out-of-scope test infrastructure; no production finalization subprocess uses `shell: true`.
- The large-diff external Codex/Claude enhancement remains intentionally unrun under the dispatched constraint and recorded 429 condition; it is not represented as reviewer evidence.
- Tasks 6.5 and 7.1-7.4 remain untouched by this report-only reviewer.

## Round 2 final disposition

**CLEAN.** P1, S1, and C1 are independently confirmed resolved. No open Blocker, Major, Minor, or Trivial finding remains in the reviewed delta.
