# Review Cycle Report: archive-and-validate-defects

- Branch: `fix/archive-transaction-recovery-followup`
- Integration base: `dev/0.1.7`
- Review tier: A (independent multi-agent review)
- Rounds completed: 1 of 3
- Status: ESCALATED
- Scope: the live 58-path change diff against `dev/0.1.7`
- Outcome: 21 accepted findings; 0 independently confirmed as resolved

The requested review completed its first independent pass. The automatic fix/re-review loop was stopped at the user's request before any finding could be accepted as fixed. Interrupted fixer work left partial, unverified edits in the live working tree; this report therefore treats every finding as open.

## Round Summary

| Round | Findings (Blocker/Major/Minor) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|---|---:|---|---|---|---:|
| 1 | 6/9/6 | 21 accepted | None accepted; fix attempt interrupted | None | 0/21 |

No final clean-round gate was run. There is therefore no test command, result, or content-tree fingerprint that can support a `CLEAN` disposition.

## Open Blockers

### VSR-1 — Fenced example headings satisfy scenario preservation

- Evidence: `src/core/specs-apply.ts:849-898`
- A `#### Scenario:` heading inside a fenced Markdown example is counted by reconciliation even though the Markdown parser masks it. A replacement can therefore delete a real canonical scenario while strict validation reports success.
- Required correction: mask fenced regions before extracting scenario headings from both canonical and incoming requirement blocks; cover strict validation and apply behavior.

### VSR-2 — Duplicate canonical requirement headers can be collapsed and deleted

- Evidence: `src/core/specs-apply.ts:525-530,666-704`
- Canonical requirements are placed in a name-keyed map before duplicate headers are rejected. Removing one collapsed key can classify the capability as empty and delete its directory.
- Required correction: reject duplicate normalized canonical headers before map construction and before empty-target classification; prove apply performs no deletion.

### CCR-4 — Management identity mismatch persists an unreachable transaction plan

- Evidence: `src/core/management-api/finalize.ts:212-233,532-591`
- The loopback route invokes `archive --dry-run --save-plan --json` before checking `changeInstanceId`. A rejected identity can leave an unreachable plan in the machine transaction store even though project files appear unchanged.
- Required correction: use an unsaved inspection for admission, then persist and apply the exact plan only after identity and blocker checks; assert transaction-store immutability on refusal.

### RSR-1 — Canonical alias collapse can arbitrarily orphan a live project home

- Evidence: `src/core/project-registry.ts:591-596`
- Canonicalized duplicate registry claims retain whichever raw key sorts first and merely combine liveness. A missing alias can replace a live alias's fixed metadata, leaving the live machine home unreferenced and pruneable.
- Required correction: prefer the direct entry, otherwise a unique live alias, and refuse mutation when live aliases disagree on fixed metadata.

### FAR-1 — Mutable cached heads make ordinary finalization fail after publication

- Evidence: `src/core/store/finalization/association.ts:568-569`
- Association agreement compares live frozen HEAD/ref values with stale workspace-index cache fields. Normal commits after binding can trigger `planning_execution_binding_mismatch` only after specs/accounting/publication have run.
- Required correction: compare immutable pair identity fields only in index agreement while retaining live Git validation against the frozen plan.

### FAR-2 — Missing association document yields an applicable but unrecoverable plan

- Evidence: `src/core/store/finalization/association.ts:65-74` and `src/core/store/finalization/module.ts`
- Planning can emit an applicable plan without `executionAssociationPath`. Apply then fails after publication with an incomplete frozen binding, and the immutable token cannot be repaired.
- Required correction: freeze the derived path unconditionally and return a pre-mutation blocker when the association document is absent.

## Open Majors

### VSR-3 — Duplicate MODIFIED blocks suppress missing-scenario diagnostics

- Evidence: `src/core/specs-apply.ts:594-639`
- Duplicate detection skips every ambiguous `MODIFIED` block before each is compared with immutable canonical scenarios. The report omits independently required missing-scenario errors.
- Required correction: analyze every block for diagnostics and suppress only simulated mutation.

### VSR-4 — Any shape error suppresses independent projected-spec errors

- Evidence: `src/core/validation/validator.ts:457-475`
- A source-wide suppression set drops all projected validation failures for a capability once any shape error is present, hiding unrelated invalid requirements.
- Required correction: deduplicate corresponding issues individually, not by source.

### CCR-2 — No test proves abort refusal after canonical publication before phase advance

- Evidence: `test/core/archive-engine.test.ts:1856-1861`
- Existing coverage retries immediately after a torn canonical publication. It does not prove the pre-`specs-applied` progress guard prevents abort from retiring the only recovery state.
- Required correction: attempt stored-plan abort before retry, require `archive_abort_phase_unsafe`, and assert all canonical/source/stage/journal/token state is unchanged.

### CCR-3 — Destructive abort containment is not exercised through Windows path spellings

- Evidence: `src/core/archive-engine.ts:4836-4839` and related journal/tombstone comparisons
- Standalone path tests do not cover persisted ownership checks that authorize deletion. Drive-case, separator, alias, sibling, and traversal spellings remain unverified through actual abort dispatch.
- Required correction: inject path flavor into abort ownership logic and prove equivalent owned Win32 spellings are accepted while outside paths survive and are refused.

### RSR-3 — Project-home probes can choose a legacy worktree home

- Evidence: canonical registry lookup versus `resolveProjectHome(..., { ensure: false })`
- The read-only project-home path still checks the linked-worktree entry first, while planning and owner resolution prefer the canonical main entry. Different commands can therefore use different machine homes.
- Required correction: route the probe through the same canonical main-entry lookup.

### RSR-4 — Normalized project selection can silently adopt drifted config identity

- Evidence: `src/core/store-planning/internal/resolver.ts:409-412`
- Normalized selector matching chooses a registry root, then replaces the requested identity with the root's current config identity without checking for genuine drift.
- Required correction: compare normalized registry and config identities and raise the established planning-selection conflict before adopting config evidence.

### RSR-5 — Interrupted coordination writes cannot resume retained self-owned claims

- Evidence: `src/core/store/workspace/dependencies.ts:998-1003`
- Unjournaled coordination writes use a claimed carrier whose retained-claim recovery requires authority they never provide. A crash after claim creation can permanently wedge a plan/index path.
- Required correction: use a suitable rename primitive or make the self-contained claim safely verifiable and adoptable without weakening no-clobber guarantees.

### RSR-6 — Unsupported directory fsync can wedge all workspace coordination writes

- Evidence: `src/core/store/workspace/dependencies.ts:294-300`
- Directory open/sync errors such as `EISDIR`, `EINVAL`, `EPERM`, or `ENOTSUP` propagate after durable intent/claim creation. On affected filesystems, every write can fail and leave an unrecoverable claim.
- Required correction: ignore only known unsupported directory-sync errors and continue surfacing genuine I/O failures.

### FAR-3 — Landed previews replace reconciliation blockers with a generic skip refusal

- Evidence: `src/core/store/finalization/module.ts:269-274`
- When preparation already returns multiple reconciliation blockers and no actions, an early skip gate emits one generic conflict instead of preserving the full blocker set in a non-applicable plan.
- Required correction: reserve the generic conflict for intentional skip/decline; retain all preparation blockers otherwise.

## Open Minors

### VSR-5 — Unreadable delta diagnostics omit capability identity

- Evidence: `src/core/validation/validator.ts:168-188`
- `spec_delta_read_failed` includes path/source but not the root-relative capability, and reconciliation cannot restore it because the unreadable snapshot is absent.

### CCR-1 — Bulk validation does not defend all-error rendering

- Evidence: `test/commands/validate.test.ts:183-190`
- The command-level test asserts only one reconciliation error, so truncation to first-error feedback would still pass. Coverage must assert at least two deterministic human and JSON errors, preferably across capabilities.

### CCR-5 — Merge confirmation is not tested through loopback HTTP finalization

- Evidence: `test/core/management-api/store-finalize-api.test.ts:96-105`
- Direct helper tests cannot detect a route that drops or misapplies `mergeConfirmed`. HTTP coverage is required for omitted, false, sole-blocker true, and true-with-second-blocker cases, including transaction-store effects.

### CCR-6 — Nested recovery dispositions are not tested through HTTP apply failures

- Evidence: `test/core/management-api/store-finalize-api.test.ts:166-176`
- Synthetic decoder tests do not prove the child-process/HTTP path preserves nested status, all blockers, and exact recovery/abort/manual-action fields.

### RSR-2 — Read-only self-heal recreates a missing machine home

- Evidence: `src/core/project-registry.ts:466-475`
- Alias-only canonical repair routes through placement that creates the home even when `allowCreate === false`, violating read-only probe semantics.

### SCR-1 — Store abort output prints association state before blockers

- Evidence: `src/core/archive.ts`
- Human abort rendering emits association-pending state before actionable blocker lines. The required order is blockers first, then association/disposition guidance.

## Disposition

`ESCALATED`: all 6 Blockers and 9 Majors remain open and unverified. The implementation must not be shipped or archived as complete on this evidence. The automatic fix/re-review loop was deliberately stopped; no partial fixer edit is credited until it receives focused verification and independent non-author confirmation.
