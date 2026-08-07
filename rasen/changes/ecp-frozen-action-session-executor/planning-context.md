# Planning context - ecp-frozen-action-session-executor

Seeded 2026-08-07, before any propose, by the planner who wrote the Step 1 obligation tasks on
the Linux provider, at the LEAD's direction. Purpose: this change's two core obligations were
created by Direction Step 1 with no task anywhere, and were first recorded in a sibling's
evidence file (`rasen/changes/ecp-linux-process-authority-provider/evidence/step1-obligation-tasks.md`).
This seed makes them impossible to miss without depending on that file.

Provenance discipline: every statement below is tagged. [VERIFIED] = checked in code in this
worktree on 2026-08-07 by the seeding author; file:line anchors are as of that date - re-verify
before relying on them. [AUTHORED] = written by the seeding author into proposed (not yet
implemented) change artifacts this same day. [RELAYED: source] = taken from the named record or
the LEAD, not independently verified in code.

## DO NOT PROPOSE YET

[RELAYED: LEAD, 2026-08-07] The LEAD's explicit decision at seed time: do not propose this
change yet. The moving pieces that must settle first:

- `RECURSIVE_PROCESS_SCOPE_SEMANTICS` (`src/core/session-host/process-authority/types.ts`) is
  mid-change - three entries are leaving or renaming, all in the single Change
  `process-authority-scope-semantics-wording`:
  - `workload-non-escape` is **renamed** to `forked-descendant-non-escape`, not merely
    reworded in prose. The token is emitted verbatim into `providers.json`, which is where it
    is actually read, so prose in `types.ts` would not travel [RELAYED: LEAD, from that
    Change's propose stage].
  - `replacement-recovery` is **removed** (criterion 4, retained on the upgrade path in git
    and stated normatively in the spec record, not kept as a runtime constant).
  - `publish-before-activate` is **removed**. This was the third entry, decided by the LEAD on
    2026-08-07 after the earlier records in this directory were written - which is why a
    sibling document may still describe it as out of scope. Retier row 2.5 splits it: the
    published phase belongs to the three-phase protocol and leaves, while **exactly-once
    activation stays** and is enforced separately at `process-scope-adapter.ts:181`, protected
    by its own standalone requirement [RELAYED: LEAD decision, row 2.5 verified by the LEAD].

  Do not read a removal as permission to delete the machinery underneath it. Removing a
  semantic and removing its implementation are different acts - on Linux every control verb is
  a fresh helper process, so opaque envelope plus reopen/revalidate is simultaneously
  criterion-4 reattach (which leaves) and per-operation destructive-target safety (which
  stays). Read the landed contract change before acting on any of this.
- `ecp-native-process-capsule-closure` and `ecp-durable-agent-session-host` are both
  `escalated` [RELAYED: lead-4 position table].
- This change's DAG prerequisites are unfinished: Linux provider 75/93 non-terminal, Windows
  provider 47/104 with a crate re-freeze in flight [RELAYED: lead-4 position table].

## The two Step 1 obligations this change owns

Recorded verbatim from the Linux evidence file (both [RELAYED: Direction locked decision 11 via
`evidence/step1-task-ledger-retier.md` and `handoff/lead-4.md`]):

1. **Typed `execution-lost` plus committed-frontier resume.** On daemon death the scope dies
   with the daemon; the in-flight action MUST be typed `execution-lost` - a distinct typed
   outcome, not generic uncertainty and not a workload failure; the Run resumes only from the
   last committed frontier; there is no reattach and no identity revalidation. Session-host
   cooperation is expected (re-tier record, Disagreements item 5: Run/Record outcome typing
   belongs to the executor with session-host cooperation, not to a provider ledger). ECP-8's
   Linux/Windows receipts include zero-orphan daemon-death teardown AND `execution-lost`
   typing (roadmap OS x backend matrix; closure re-grade rows 9.10/11.17).
2. **The `durable: daemon-lifetime` capability declaration.** Every provider's scope lifetime
   equals the owning daemon's lifetime; no provider may advertise a durable or reattachable
   scope in 0.2.0. Routed to the provider capability declaration surfaced through the
   executor's OS-by-backend capability matrix (Architecture Replans 4/5; lead-4 routing
   table). It is a declaration-surface change, not a native change; it does not break the
   crate freeze.

## What the executor owns - and what it no longer has to build

[RELAYED: LEAD, consistent with the Step 1 re-tier records] The executor now owns THREE
declared tiers - in-tool (host-native Tier A, which never enters ProcessScope), hosted
kernel-enforced (Linux user+PID namespace, Windows Job), and hosted best-effort (macOS process
group) - plus the OS-by-backend capability matrix and the never-silently-reroute rule
(`authority-unavailable` never selects a weaker provider). It no longer has to implement
reattach, identity revalidation, or the prepared -> published -> activate three-phase protocol:
all criterion-4 machinery moved to the upgrade path under locked decision 11, and that removal
is where Step 1's largest practical gain for this change lands.

## The macOS best-effort tier the capability matrix must surface honestly

[AUTHORED: proposed macOS change artifacts, 2026-08-07 -
`rasen/changes/ecp-macos-process-authority-provider/` proposal/design/specs; proposed, not yet
implemented] The macOS hosted tier declares, visibly in the hosted-session record at prepare
time and before activation: `exactCancel: false` and `scopeEmptyProof: false`. Its cancel
terminal is `cancelled / emptiness-unproven` - never "cleanly cancelled" - even when the
process group observes empty, because group emptiness does not prove scope emptiness. Cancel
escalation is keyed off whole-group emptiness, never leader exit. The capability matrix must
surface these limits as declared facts, not translate them into either a clean-cancel claim or
a generic uncertainty.

## Verified code facts every tier with an honest-unproven terminal will hit

All [VERIFIED] on 2026-08-07 in this worktree:

- **The release wedge.** `closeDurableProcess`
  (`src/core/session-host/host.ts:614-638`) releases durable session authority only from a
  termination receipt whose state is `closed`; any other receipt leaves the session
  live-or-uncertain. A tier whose terminate honestly never returns `closed` therefore wedges
  its sessions unless release is extended. The proposed macOS design resolves this with a
  declaration-gated release rule: a distinct declared-unproven terminal receipt (not `closed`,
  not `uncertain`) that authorizes release only when the record carries the pre-start
  declaration; undeclared scopes keep byte-identical existing behavior. The executor's outcome
  typing must compose with that rule, not bypass it.
- **Subset providers cannot register in the frozen recursive capability.**
  `src/core/session-host/process-authority/registry.ts:105-112` rejects any descriptor whose
  capability id differs from `rasen-recursive-process-scope/1` or whose semantics list is not
  the complete frozen list index-for-index; `manifest.ts:61-62` and `:119` enforce the same
  index-exact match at manifest validation. A declared-limit tier therefore lives at the
  ProcessScope seam (`src/core/session-host/process-scope.ts`), not inside the recursive
  capability - and the accepted `process-authority-provider` spec makes subset rejection a
  requirement, so this is contract, not implementation accident.
- **ProcessScope seam vocabulary** (`src/core/session-host/process-scope.ts`):
  `TerminationReceipt.state` is `closed | retained | uncertain`; `LiveProcessScope.closed`
  resolves a proven scope-empty receipt; `ProcessRef` values carry the
  `rasen-process-scope/1:` prefix for every scope. The honest-unproven terminal is an additive
  extension to this vocabulary, proposed in the macOS change.
- **Construction sites for hosted dispatch.** `createSessionHost` is invoked in `src/` only at
  `src/core/management-api/router.ts:642`; `createNativeProcessScope` is constructed at
  `router.ts:639` plus two internal default fallbacks (`src/core/session-host/host.ts:299`,
  `src/core/session-host/claude-backend.ts:395`). Platform selection work must cover all
  three sites.
- **The frozen semantics constant currently lists ten entries** (`types.ts:25-36`):
  `workload-non-escape`, `publish-before-activate`, `root-exit-distinct`,
  `natural-exact-empty`, `recursive-terminate`, `recursive-abort`, `replacement-recovery`,
  `bounded-controls`, `identity-drift-detection`, `event-completeness`. This is the
  pre-contract-change state; see DO NOT PROPOSE YET.

## Where the sibling records live

- Step 1 obligations and their routing: the Linux change's
  `evidence/step1-obligation-tasks.md`, `evidence/step1-task-ledger-retier.md`, and
  `handoff/lead-4.md`.
- The Linux ledger's Section 12 (pipe-EOF daemon-death teardown wave, freeze-cost framing,
  ship-gating decision dated 2026-08-07) is the provider-side counterpart of obligation 1: the
  kernel teardown receipt is the provider's, the `execution-lost` typing is this change's.
- The closure re-grading (`ecp-native-process-capsule-closure/evidence/step1-scope-reconciliation.md`)
  carries the OS x backend receipt expectations this change inherits (rows 9.10, 11.16, 11.17).
