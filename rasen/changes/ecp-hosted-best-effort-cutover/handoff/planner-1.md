# Planner handoff 1 - ecp-hosted-best-effort-cutover (propose stage)

Author role: PLANNER. Artifacts authored, no product code touched, no tasks ticked, vitest never invoked.

## What exists now

- `proposal.md`, `design.md`, `tasks.md` (33 tasks), `specs/hosted-best-effort-process-scope/spec.md` (6 requirements, 17 scenarios), `.openspec.yaml`.
- Baseline HEAD at planning time: 753edc7ddf723b314d890ac6380929a4e0e8f3df.

## Code claims verified (and charter drift found)

- The charter's construction-site lines had drifted: actual sites are `router.ts:639`, `host.ts:306` (charter said 299), `claude-backend.ts:423` (charter said 395). More importantly, all three call `createHostedProcessScope()` - platform selection is already centralised in `hosted-process-scope.ts:17-23` (darwin -> best-effort, else -> legacy capsule). The cutover is one selection edit plus three consumer verifications, not three edits.
- Job-object claims verified in `native/process-capsule/src/main.rs`: `CreateJobObjectW` (:672), `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (:677), `TerminateJobObject` code 137 (:592).
- Pin lists verified: `linux-process-authority-boundary-guards.test.ts:14-29` pins seven files; `windows-process-authority-package-ci.test.ts:36-47` pins five (subset). `hosted-process-scope.ts`, `process-scope.ts`, and `darwin-best-effort-scope.ts` are NOT pinned.
- Host machinery is already tier-agnostic: declaration persisted at prepare (host.ts:449-464, keys tier/exactCancel/scopeEmptyProof only), activation gate (host.ts:471-479), `closeDurableProcess` with TWO release paths - observation (host.ts:711-714) and receipt (host.ts:716-720) - plus prepared-abort gates at host.ts:490/573/1446. Design D1 concludes no host/router/backend/registry edits are needed; task 1.3 makes the implementer re-verify and stop on drift.
- SEC-001 text read in the closure change: "transport loss can become a clean host detach" (architecture-replan.md:19); closure contract is 12.2 (retained uncertainty or independently proven termination, never clean detach). All artifacts phrase the closure as structure shipped, verdict owed to the closure re-grade.
- Source-scan guards found at `darwin-best-effort-scope.test.ts:392-404` and `:484-491` - they read the module source file directly. This drove the no-shim decision (D2): a re-export shim would make both guards pass vacuously.
- The platform-selection guard at `darwin-best-effort-scope.test.ts:497+` currently asserts linux AND win32 route to the exact tier; task 2.5 inverts it deliberately.

## Decisions taken (and why)

- **win32 design (owned decision): thin new `win32-best-effort-scope.ts` wrapping the UNMODIFIED legacy capsule** (design D3). Modifying `native-process-scope.ts`/`main.rs` in place would trip both byte-pin lists and force a rebaseline of assets decision 13 just froze; a from-scratch Job scope discards the measured-working kill path and reopens the refused native-assembly bridge. The wrapper keeps Job kill mechanics bit-for-bit and translates only the seam vocabulary; declared-unproven terminals are mintable only from actual capsule protocol outcomes, transport loss maps to retained uncertainty (the SEC-001 shape).
- **POSIX generalisation is a module move, no shim** (D2), because of the source-scan guard vacuity problem. Test filenames kept; imports and guards repointed.
- **No guard rebaseline planned.** Section 5 receipts byte-identical digests against the COMMIT (per the shared-dirty-worktree hazard); any needed pinned-file edit is a STOP-and-escalate, not a task.
- **Platform coverage exactly darwin+linux (POSIX) and win32** (D7); other POSIX platforms stay on the legacy route to avoid an undeclared support claim.
- **Additive `WIN32_BEST_EFFORT_SCOPE_SEMANTICS`** in unpinned `process-scope.ts` (D5); persisted record keys unchanged (registry has a strict key allowlist).
- **Foreign/stale win32 refs**: probe `closed` translates to declared-unproven (D4) so daemon-restart reconciliation does not wedge sessions, while the Record keeps unproven language.

## Dead ends (do not re-walk)

- In-place capsule modification for win32 honesty: blocked by both pin lists and by pinned capsule tests asserting the exact vocabulary the capsule legitimately keeps internally.
- Compatibility re-export shim for the darwin module: defangs two source-scan guards (verification-theater risk).
- Registering the best-effort tier in the recursive capability registry: rejected index-exact by design; the seam is ProcessScope.

## Open decisions for LEAD/review

1. D4's probe-`closed` -> declared-unproven `completed` outcome for stale scopes whose true history is unknown: recommended in design with rationale (anti-wedge + honest language), flagged in design.md Open Questions for the reviewer to accept or tighten.
2. Whether the win32 KILL_ON_JOB_CLOSE chain (daemon death -> controller stdin EOF -> supervisor exit -> handle close -> kernel teardown) holds end-to-end is deliberately left to the 7.2 receipt; if a link fails it is a finding, not a declaration widening.
3. No crate change is planned or needed under this design; nothing to flag under the "crate change requires stopping" rule.

## Validation record

- `rasen validate ecp-hosted-best-effort-cutover --strict` (worktree root, 2026-08-07): output `Change 'ecp-hosted-best-effort-cutover' is valid`, exit 0.
- Bare `rasen validate --strict` in this non-interactive shell prints its target-selection usage ("Nothing to validate. Try ... rasen validate <item-name>"); the change-scoped strict run above is the authoritative result for this change.
- Whitespace gate verified on bytes for all six authored files: LF-only, zero trailing-whitespace lines, final newline present, no trailing blank line.
