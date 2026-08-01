## Context

The four implementation children of `file-placement-hardening` now have clean review records:

- `file-placement-hardening-migration-safety` owns fail-closed migration planning, cleaning, and no-clobber behavior.
- `file-placement-hardening-archive-engine` owns the reusable archive transaction, recovery, publication, accounting, and consumer migration.
- `file-placement-hardening-root-routing` owns explicit Store-root routing and the one-plan session migration boundary.
- `file-placement-hardening-windows-lock-contention` owns the bounded Windows-only legacy registry-lock retry discovered by the closure P4 gate, while preserving the existing semantic winner/loser, timeout, and genuine-create-failure diagnostics.

Their final contracts are more precise than the current main specifications and `docs/zh/file-placement-and-planning-roots.md`. The original PR audit also remains open as a release record, the repository-wide test command has previously failed to emit a final summary, and native macOS/Linux archive recovery has not yet been observed in remote CI. Closure therefore needs a single evidence-oriented integration pass. It must not reopen the child implementations, rewrite historical child evidence, or confuse path-flavor helper tests with native-host results.

## Goals / Non-Goals

**Goals:**

- Reconcile the authoritative Chinese design and main `rasen/specs` with the final child contracts, applying every overlapping contract exactly once.
- Trace every saved PR audit finding to an owning child change, its clean review, a focused regression, and any remaining closure gate.
- Prove that generated workflow text, executable consumer adapters, CLI/help/completions/localization, schemas, and parity tests contain no stale pre-remediation contract.
- Integrate the focused archive, migration, root-routing, and session suites into one repeatable release record.
- Diagnose the repository-wide no-summary condition with direct bounded partitions, exact manifest reconciliation, summaries, and exits, then publish an honest local test-result gate without claiming process lineage that the local orchestrator cannot prove.
- Add a required native Windows/macOS/Linux archive fault/recovery CI step and defer its acceptance claim until actual remote runs exist.
- Record final diff scope and compatibility with the `0.1.6` package and Node.js floor.

**Non-Goals:**

- Changing archive, migration, root-routing, or session product behavior already owned by a child change.
- Rewriting completed child proposals, tasks, reviews, evidence, or handoffs to make their history look different.
- Committing, pushing, opening or updating a pull request, archiving any change, or claiming remote CI results during closure apply.
- Treating `path.win32`/`path.posix` helper coverage on one host as native filesystem evidence.

## Decisions

### 1. Reconcile contracts through a ledger and a fixed integration order

Create a reconciliation ledger whose rows identify the final contract, owning child delta, affected main specification, affected authoritative-design section, and closure verification. Apply child contracts in dependency order: migration safety, archive engine, root routing, then the independently scoped Windows legacy-lock correction discovered by the closure gate. This order mirrors the implementation dependency graph, makes later explicit-root constraints refine rather than erase earlier migration/archive guarantees, and integrates the lock correction without implying it depends on or changes those placement contracts.

Overlapping `MODIFIED` requirements will be merged semantically, not copied wholesale. In particular, `file-placement` and `work-migration` must preserve the union of all child guarantees while removing the stale direct-directory-move, pre-move-cleaning, external spec-sync, and post-hash self-reference models. Archive-only requirements remain in the archive capabilities, and root/session routing remains in `session-supervision` plus the relevant shared placement/migration requirements. After the main specs are coherent, update the Chinese design from that reconciled contract and check both directions for omissions or contradictions.

Alternatives considered:

- Applying every delta block mechanically would let later overlapping blocks discard earlier guarantees.
- Leaving the main specs stale and relying on child deltas would make post-archive behavior depend on historical planning artifacts instead of the normative capability set.

### 2. Preserve history while closing the audit through traceability

The saved PR audit is immutable input. Add a closure traceability matrix rather than editing the audit or completed child records. Every Blocker, Major, and Minor row must name its owning child, the clean review/evidence that closed the behavior, at least one focused regression or static check, and any closure-only dependency such as native CI or full-suite completion. A finding is closed only when its behavioral proof and all applicable closure gates are present.

Historical task checkboxes and intermediate review findings remain truthful records. The closure record may explain supersession, but it must not retroactively mark an earlier observation as if it never occurred.

### 3. Sweep every contract-bearing derived surface

Use a positive/negative contract-token catalog derived from the child deltas and authoritative design. Search and inspect:

- generated workflow and skill templates;
- executable archive consumer adapters and workflow sources;
- CLI command registry, help, completions, and localized strings;
- the spec-driven schema and archive instructions embedded in it;
- template parity, completion registry, and hash/golden tests.

The sweep records each surface as current, intentionally historical, or stale. Stale closure-owned documentation, generated/template, completion, schema, or parity surfaces may be corrected in this change and their narrow regressions updated. A newly discovered product-behavior defect is routed back to the owning child instead of silently expanding closure scope.

### 4. Run focused acceptance as explicit serial groups

The release evidence uses two explicit groups and records commands, elapsed time, file/test counts, skips, and exit status:

- Archive group: `archive.test`, archive engine, consumer integration, fault matrix, path semantics, accounting, ephemera, archive-engine consumer template, and skill-template parity tests.
- Migration/root/session group: ephemera cleaner, work migration, work command, management/session APIs, session space, and command-registry completion tests.

Run groups serially where shared build output or temporary fixtures could race. The file list is evidence, not an implicit glob, so newly added relevant tests are either incorporated or explicitly justified.

### 5. Turn the full-suite hang into a bounded, auditable gate

Start with one externally bounded monolithic `pnpm test` baseline. A run that reaches the 480-second orchestration bound without a Vitest summary is recorded as an unresolved failure, never as a pass, and is not cleaned up by a bespoke or manual kill procedure.

If the baseline does not complete, enumerate the discovered test-file manifest and assign every file deterministically to a small fixed set of direct sequential partitions using `VITEST_FILE_PARTITION=i/N` and a single worker. Each partition is bounded by the outer orchestration shell at 480 seconds. Record its assigned manifest, command, elapsed time, Vitest summary, and exit status. Bisect any partition that fails to summarize until the responsible file or lifecycle seam is identified.

The repository-wide local gate is complete only when either:

1. the bounded monolithic run emits a successful final summary and exit status; or
2. the deterministic partition aggregate proves that its union exactly equals the discovered manifest, pairwise intersections are empty, every partition emits a successful summary and exit status, and aggregate file/test/pass/fail/skip counts reconcile.

The local gate proves test-result completion, not full process lineage. Read-only process observations may be recorded as diagnostics, but acquisition or parse failure does not change the summary/exit facts and leaves process cleanliness `NOT EVALUATED`. Any observed or suspected survivor remains release-blocking. Without spawn-time OS capability, closure SHALL NOT claim that a process is invocation-owned or that no descendants survive, and SHALL NOT perform bespoke/manual termination. Process isolation and cleanup belong to CI/orchestration infrastructure; the remote required jobs remain the delivery gate.

### 6. Make native archive recovery a separate required CI matrix

Add a dedicated CI job at the supported Node.js floor with `ubuntu-latest`, `macos-latest`, and `windows-latest` legs. It runs explicit archive engine, fault-matrix, accounting, ephemera, and cleaner files that exercise real temporary filesystems. Keep it separate from the broad test matrix so failures identify recovery behavior directly, and make the required aggregate test status depend on both matrices.

Local Windows results and deterministic path-semantics tests can validate configuration before delivery. Native acceptance is nevertheless pending until delivery pushes the workflow and the three remote legs complete successfully. The closure apply record names that deferred gate; it does not invent results.

### 7. Close on diff scope and `0.1.6` compatibility

Compare the final branch against its saved baseline and classify every changed path as a child implementation, closure documentation/spec reconciliation, derived-surface correction, test/harness work, or unrelated scope. Confirm that package version `0.1.6`, Node.js `>=20.19`, existing CLI forms, and compatibility aliases remain intact; new flags and JSON fields must be additive. Record build, lint, typecheck, Rasen validation, focused/full-suite gates, help/command checks, and absence of tracked `.rasen` ephemera as release evidence.

If the scope or compatibility audit finds a behavioral regression, route it to the owning child and keep closure blocked. Closure apply ends with evidence and validated artifacts only; delivery owns commit, push, remote CI observation, and eventual archive.

## Risks / Trade-offs

- **Overlapping deltas can erase guarantees.** The reconciliation ledger and dependency-ordered semantic merge make each final clause traceable before any child delta is retired.
- **A broad stale-token search can flag historical evidence.** Classify matches rather than rewriting immutable audit/review history.
- **Partitioned testing can mask order-dependent behavior.** Prefer the monolithic gate, preserve exact inventory/count evidence for the fallback, and keep any observed or suspected lifecycle leak blocking without turning an unverifiable local observation into an ownership claim.
- **A new CI matrix increases runtime.** The dedicated file list is intentionally narrow and runs at one supported Node version because its purpose is native recovery coverage, not a second full suite.
- **Remote proof cannot exist before push.** Keep the gate visibly pending and assign observation to delivery instead of lowering the evidence standard.

## Migration Plan

1. Build the reconciliation and audit-traceability ledgers from the four clean implementation-child records.
2. Reconcile main specs, then the authoritative Chinese design, and validate the resulting contract graph.
3. Run the contract-bearing derived-surface sweep and correct only stale closure-owned surfaces.
4. Run integrated focused suites and complete bounded full-suite diagnosis/evidence.
5. Add and locally validate the dedicated native recovery matrix and required aggregate dependency.
6. Finish the final diff, compatibility, validation, and release-evidence record.
7. During later delivery, push the workflow, observe all three native legs, and attach their actual URLs/results before declaring the remote gate complete.

Rollback is path-local: revert closure reconciliation, derived-surface, and CI/harness changes together. Do not roll back or rewrite the already-reviewed child implementations as part of closure rollback.

## Open Questions

None. Actual Windows/macOS/Linux CI results are a known delivery-time dependency, not a design ambiguity.
