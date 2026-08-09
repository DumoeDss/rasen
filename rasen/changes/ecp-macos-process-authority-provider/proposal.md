## Why

Architecture Replan 4 removed macOS durable process authority from 0.2.0 and registered it as 0.3.0 research; Step 1 (locked decision 11) then reopened this child with a narrowed scope: macOS hosted sessions in 0.2.0 need a cancellable, honestly recorded workload scope now, without pretending to the exact recursive authority that remains unproven on macOS. The invariant this change protects is "the Record must not lie", not "processes must never leak": an honest `cancelled / emptiness-unproven` terminal keeps that invariant; a false "cleanly cancelled" would break it.

## What Changes

- Add a macOS best-effort hosted process scope: the workload starts as the leader of its own POSIX session and process group; cancel delivers a group SIGTERM, waits a bounded grace period, then delivers a group SIGKILL, then takes one bounded final observation. Escalation is keyed off whole-group emptiness, never off leader exit: a leader that exits instantly while a descendant survives still gets the full grace-then-SIGKILL treatment for the group.
- Declare the tier's limits visibly before any scope starts: `exactCancel: false` and `scopeEmptyProof: false` are recorded in the hosted-session record at prepare time, before activation. This is acceptance, not decoration.
- Make the cancel terminal state `cancelled / emptiness-unproven` - always, even when the process group observes empty, because group emptiness does not prove scope emptiness (a descendant can leave the group with `setsid()`/`setpgid()`). The provider never reports "cleanly cancelled". Natural completion records the exact root exit code or signal plus the same unproven-emptiness honesty.
- Extend the hosted-session close path so durable authority may be released from the declared unproven terminal - but only for scopes that declared the best-effort tier before start. Exact-tier scopes (Linux, Windows) keep the existing rule: only a proven scope-empty receipt authorizes release.
- Leave the frozen common provider contract untouched. This provider does not register under `rasen-recursive-process-scope/1`: that capability is one indivisible semantic set, subset registration is rejected by design, and this tier honestly cannot provide it. No edit to the frozen types, registry, or manifest validation.
- Explicitly out of scope (unapproved, 0.3.0 research or upgrade path): Endpoint Security clients, a VM-based approach, a minimum macOS version requirement, Apple entitlements and code signing, replacement recovery or reattach after daemon death, identity revalidation, and any durable-authority claim. Daemon death on this tier means the detached workload group may keep running; the record on the next daemon must reflect loss honestly rather than reattach.
- Plan real macOS run evidence with mutation receipts (demonstrated failing counterparts, not only green suites). No macOS host is available in the environment this change is being planned and implemented in; the task ledger marks exactly which tasks require a real macOS machine.

## Capabilities

### New Capabilities

- `macos-process-authority-provider`: macOS best-effort hosted process authority - declared-limit tier, group-signal cancel with whole-group-emptiness-keyed escalation, honest unproven terminals, hosted-session record honesty, and real-macOS verification.

### Modified Capabilities

None. The accepted `process-authority-provider` common contract is consumed read-only and remains unchanged; the best-effort tier is expressed at the ProcessScope seam and in the new capability, not by widening the indivisible recursive-scope capability.

## Impact

- Affects: a new Darwin best-effort scope module (Node-only; no native helper binary, no new build infrastructure), an additive tier declaration and honest terminal vocabulary at the ProcessScope seam, the session-host close/release path, and the hosted-session record surface. Exact-tier providers and the in-tool (host-native Tier A) dispatch path, which never enters ProcessScope, are untouched.
- DAG: `ecp-native-process-capsule-closure` keeps `dependsOn: [ecp-linux-process-authority-provider, ecp-windows-process-authority-provider]`. This change adds no edge into closure; the macOS-to-closure edge was deliberately cut by Replan 4 and must not be re-added.
- Governing decisions: locked decision 11 (daemon lifetime - no reattach, no identity revalidation, criterion-4 machinery stays on the upgrade path) and locked decision 12 (threat model is our own mistakes, not a local attacker; process authority is a janitor, not a sandbox).
- Contract dependency: `RECURSIVE_PROCESS_SCOPE_SEMANTICS` has two pending edits (a `workload-non-escape` wording narrow and the `replacement-recovery` re-tier). This provider's capability declaration is written to survive both: it declares neither semantic under either the current or the pending wording (see design.md).
- Evidence: real macOS receipts are required for acceptance, including a production-path hosted-session receipt (not a fixture or `...ForTesting` twin) and mutation receipts proving each guard test discriminates.
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/`.
