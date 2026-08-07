# Planning context - ecp-frozen-action-session-executor

Seeded 2026-08-07, before any propose, by the planner who wrote the Step 1 obligation tasks on
the Linux provider, at the LEAD's direction. **Refreshed 2026-08-08** by the cutover planner at
the LEAD's direction, after locked decision 13 (all-platform best-effort convergence) and the
`ecp-hosted-best-effort-cutover` implementation landed - several 2026-08-07 statements were
stale. Layering convention (mirrors how Direction docs layer decisions): original statements
are preserved below, never deleted; anything no longer true carries an explicit dated
**SUPERSEDED** note naming the replacing authority.

Provenance discipline: every statement is tagged, now with dates. [VERIFIED 2026-08-07] /
[VERIFIED 2026-08-08] = checked in code in this worktree on that date; file:line anchors are as
of that date - re-verify before relying on them. [AUTHORED] = written by a seeding author into
change artifacts. [RELAYED: source] = taken from the named record or the LEAD, not
independently verified in code. [STALE-UNVERIFIED] = an original relayed statement the
2026-08-08 refresh did not re-verify; treat with extra suspicion.

## Propose gate (refreshed 2026-08-08)

[RELAYED: LEAD, 2026-08-08] The original DO NOT PROPOSE YET (preserved below) is dissolved. One
gate replaces its three moving pieces: **propose only after `ecp-hosted-best-effort-cutover` is
terminal (review-clean + shipped).**

Status at refresh time [VERIFIED 2026-08-08]: the cutover's implementation is complete - all 33
tasks ticked, through commit 6f35121e (real Linux kernel receipts) and the real-host win32
transport-loss fix 0346ba29 - but it is not yet review-clean or shipped, so the gate is NOT yet
open.

How each original moving piece settled:

1. **The semantics contract landed, ten entries -> eight** (commit e31d297d; residue reconciled
   in 753edc7d). [VERIFIED 2026-08-08] `RECURSIVE_PROCESS_SCOPE_SEMANTICS`
   (`src/core/session-host/process-authority/types.ts:25-34`) now lists exactly eight:
   `forked-descendant-non-escape` (the landed rename of `workload-non-escape`),
   `root-exit-distinct`, `natural-exact-empty`, `recursive-terminate`, `recursive-abort`,
   `bounded-controls`, `identity-drift-detection`, `event-completeness`.
   `publish-before-activate` and `replacement-recovery` are gone from the constant, exactly as
   the original seed forecast. The original warning still binds: removal of a semantic is not
   permission to delete the machinery underneath it - exactly-once activation stayed and is
   enforced at `src/core/session-host/process-authority/process-scope-adapter.ts:181`
   [VERIFIED 2026-08-08; the original seed's path lacked the `process-authority/` segment].
2. **Closure and host were re-graded with concrete residuals.** [VERIFIED 2026-08-08 that both
   files exist: `ecp-native-process-capsule-closure/evidence/decision13-regrade.md` and
   `ecp-durable-agent-session-host/evidence/decision13-regrade.md`; contents RELAYED, read them
   at propose time.]
3. **The DAG prerequisites were re-tiered by locked decision 13 / portfolio replan 5.** The
   Linux and Windows kernel-enforced providers are PARKED to the upgrade path (not completed);
   the chain into this change is now cutover -> closure -> host -> executor. [RELAYED: Target
   State locked decision 13; slice plan.md Architecture Replan 6.]

### Original DO NOT PROPOSE YET (2026-08-07) - SUPERSEDED 2026-08-08, preserved verbatim in substance

[RELAYED: LEAD, 2026-08-07] The LEAD's explicit decision at seed time: do not propose this
change yet. The moving pieces that must settle first:

- `RECURSIVE_PROCESS_SCOPE_SEMANTICS` (`src/core/session-host/process-authority/types.ts`) is
  mid-change - three entries are leaving or renaming, all in the single Change
  `process-authority-scope-semantics-wording`:
  - `workload-non-escape` is **renamed** to `forked-descendant-non-escape`, not merely
    reworded in prose. The token is emitted verbatim into `providers.json`, which is where it
    is actually read, so prose in `types.ts` would not travel [RELAYED: LEAD, from that
    Change's propose stage]. *(2026-08-08: landed as forecast; see Propose gate item 1.)*
  - `replacement-recovery` is **removed** (criterion 4, retained on the upgrade path in git
    and stated normatively in the spec record, not kept as a runtime constant). *(Landed.)*
  - `publish-before-activate` is **removed**. This was the third entry, decided by the LEAD on
    2026-08-07 after the earlier records in this directory were written - which is why a
    sibling document may still describe it as out of scope. Retier row 2.5 splits it: the
    published phase belongs to the three-phase protocol and leaves, while **exactly-once
    activation stays** and is enforced separately at `process-scope-adapter.ts:181`, protected
    by its own standalone requirement [RELAYED: LEAD decision, row 2.5 verified by the LEAD].
    *(Landed; corrected path in Propose gate item 1.)*

  Do not read a removal as permission to delete the machinery underneath it. Removing a
  semantic and removing its implementation are different acts - on Linux every control verb is
  a fresh helper process, so opaque envelope plus reopen/revalidate is simultaneously
  criterion-4 reattach (which leaves) and per-operation destructive-target safety (which
  stays). Read the landed contract change before acting on any of this. *(Still binding.)*
- `ecp-native-process-capsule-closure` and `ecp-durable-agent-session-host` are both
  `escalated` [RELAYED: lead-4 position table]. *(2026-08-08: still escalated, but now
  re-graded with decision13-regrade.md residuals; closure's dependsOn was rewired to the
  cutover change alone.)*
- This change's DAG prerequisites are unfinished: Linux provider 75/93 non-terminal, Windows
  provider 47/104 with a crate re-freeze in flight [RELAYED: lead-4 position table].
  *(SUPERSEDED 2026-08-08: both providers were PARKED whole to the upgrade path by locked
  decision 13 - they left the DAG, they were not finished. Their task counts are historical.)*

## The two Step 1 obligations this change owns - still stand

Recorded verbatim from the Linux evidence file (both [RELAYED: Direction locked decision 11 via
`evidence/step1-task-ledger-retier.md` and `handoff/lead-4.md`]):

1. **Typed `execution-lost` plus committed-frontier resume.** On daemon death the scope dies
   with the daemon; the in-flight action MUST be typed `execution-lost` - a distinct typed
   outcome, not generic uncertainty and not a workload failure; the Run resumes only from the
   last committed frontier; there is no reattach and no identity revalidation. Session-host
   cooperation is expected (re-tier record, Disagreements item 5: Run/Record outcome typing
   belongs to the executor with session-host cooperation, not to a provider ledger).
   *(2026-08-08: this obligation stands verbatim - locked decision 11 is unchanged by
   decision 13.)* The original tail "ECP-8's Linux/Windows receipts include zero-orphan
   daemon-death teardown AND `execution-lost` typing" is **SUPERSEDED in its receipt shape**
   by locked decision 13 [RELAYED: roadmap ECP-8 matrix as revised 2026-08-07]: zero-orphan
   is now a Windows-only kernel guarantee (Job `KILL_ON_JOB_CLOSE`, receipted by the cutover);
   on Linux/macOS the daemon-death orphan risk is a **declared known limitation**, and the
   receipts must prove `execution-lost` typing plus "uncommitted frontier stays uncommitted" -
   NOT zero orphans.
2. **The `durable: daemon-lifetime` capability declaration.** Every provider's scope lifetime
   equals the owning daemon's lifetime; no provider may advertise a durable or reattachable
   scope in 0.2.0. Routed to the provider capability declaration surfaced through the
   executor's OS-by-backend capability matrix (Architecture Replans 4/5; lead-4 routing
   table). It is a declaration-surface change, not a native change; it does not break the
   crate freeze. *(2026-08-08: the scope-seam half now EXISTS - pre-start tier declarations
   are implemented and persisted by the cutover, see Verified code facts. The executor's
   remaining duty is the matrix surface, not the declaration plumbing.)*

## What the executor owns (refreshed 2026-08-08): TWO backend tiers in 0.2.0

[RELAYED: Target State locked decision 13; slice plan.md Architecture Replan 6] The executor
owns TWO declared backends in 0.2.0:

- `in-tool` (host-native Tier A, which never enters ProcessScope), and
- `hosted` **best-effort on all three OSes** - POSIX process groups on Linux/macOS, Job object
  on Windows, every declaration `exactCancel: false` / `scopeEmptyProof: false`, visible
  before start.

Plus the OS-by-backend capability matrix and the never-silently-reroute rule
(`authority-unavailable` never selects a weaker provider; `in-tool` only by explicit request
or a pre-start-visible explicit default). `durable: daemon-lifetime` keeps its exact meaning:
survives launcher exit, does NOT survive daemon restart; daemon death types `execution-lost`
per locked decision 11 (obligation 1 above, unchanged).

### Original "What the executor owns" (2026-08-07) - SUPERSEDED 2026-08-08, preserved

[RELAYED: LEAD, consistent with the Step 1 re-tier records] The executor now owns THREE
declared tiers - in-tool (host-native Tier A, which never enters ProcessScope), hosted
kernel-enforced (Linux user+PID namespace, Windows Job), and hosted best-effort (macOS process
group) - plus the OS-by-backend capability matrix and the never-silently-reroute rule
(`authority-unavailable` never selects a weaker provider). It no longer has to implement
reattach, identity revalidation, or the prepared -> published -> activate three-phase protocol:
all criterion-4 machinery moved to the upgrade path under locked decision 11, and that removal
is where Step 1's largest practical gain for this change lands.

*(SUPERSEDED 2026-08-08 by locked decision 13: the "hosted kernel-enforced" tier is PARKED
whole to the upgrade path - its definition survives in Direction history only, and 0.2.0 ships
no kernel-enforced backend. The criterion-4 relief in the last sentence still stands.)*

## The best-effort tier the capability matrix must surface honestly (now all three OSes)

Originally [AUTHORED] from the then-proposed macOS artifacts; as of 2026-08-08 this is
implemented, production-wired code on every hosted platform [VERIFIED 2026-08-08 - anchors in
the next section]. The hosted tier declares, visibly in the hosted-session record at prepare
time and before activation: `exactCancel: false` and `scopeEmptyProof: false`. Its cancel
terminal is `cancelled / emptiness-unproven` - never "cleanly cancelled" - even when the
process group (or Windows Job accounting) observes empty, because containment-primitive
emptiness does not prove scope emptiness. POSIX cancel escalation is keyed off whole-group
emptiness, never leader exit; `setsid()` escape is a declared limitation, not a defect. The
capability matrix must surface these limits as declared facts, not translate them into either
a clean-cancel claim or a generic uncertainty.

## Verified code facts the executor will consume

All [VERIFIED 2026-08-08] in this worktree at commit 0f7eda09 unless noted:

- **Selection point (single).** `createHostedProcessScope`
  (`src/core/session-host/process-capsule/hosted-process-scope.ts:22-31`): darwin and linux
  select `createPosixBestEffortProcessScope()`; win32 selects
  `createWin32BestEffortProcessScope(...)` (which keeps the legacy capsule's Job kill
  mechanics under the honest declaration); every other platform keeps the legacy exact-tier
  capsule; host-native Tier A never enters ProcessScope. Consumers: `router.ts:639`
  (construction; `createSessionHost` invoked at `router.ts:642`) plus the internal defaults
  `host.ts:306` and `claude-backend.ts:423`. There is no per-site platform logic to cover -
  the original three-sites framing collapsed into this one selection point.
- **Declarations are frozen literals.** `POSIX_BEST_EFFORT_DECLARATION`
  (`posix-best-effort-scope.ts:40-45`) and `WIN32_BEST_EFFORT_DECLARATION`
  (`win32-best-effort-scope.ts:75-80`, attached to every prepared scope at `:277`), both
  `exactCancel: false` / `scopeEmptyProof: false`. Win32 semantics vocabulary at
  `process-scope.ts:83` (`WIN32_BEST_EFFORT_SCOPE_SEMANTICS`, including
  `kill-on-job-close-teardown`).
- **Transport loss NEVER mints a terminal (win32).** `win32-best-effort-scope.ts` latches
  `transportLost` (state field `:95`, set at `:295`) and answers every later control with
  `LOST_CONTROL_OBSERVATION` (`:327`) / `LOST_CONTROL_RECEIPT` (`:363`) - typed uncertainty,
  authority retained. Hardened by the real-host fix commit 0346ba29. Executor outcome typing
  must treat this as retention/uncertainty, never as completion, cancellation, or
  `execution-lost`.
- **The host projection cannot express a proof claim.** `toHostedProcessTerminal`
  (`host.ts:652-658`) hardcodes `emptiness: 'unproven'` for every projected terminal.
  Consequence for the executor: honesty about emptiness must be read from the scope's own
  `DeclaredUnprovenReceipt`, not inferred from the projection - the projection is honest by
  construction and therefore carries no distinguishing information about proof.
- **Declaration-gated release - five declaration-conditioned sites, two release paths.** The
  rule itself is `receiptAuthorizesRelease` (`process-scope.ts:222-228`): `closed` always
  releases; `declared-unproven` releases only when the pre-start declaration is present;
  everything else is refused. Call sites: `host.ts:490`, `:573`, `:1446` (prepared-abort
  gates) and `:717` (the `closeDurableProcess` receipt path); the fifth declaration gate is
  terminal persistence at `host.ts:766-767` (only a declared scope's record may receive a
  declared-unproven terminal). `closeDurableProcess` (`host.ts:696-730`) has TWO release
  paths that must both be exercised by any executor-side test: the observation path
  (`:711-714`, inspect returns a declared-unproven observation) and the receipt path
  (`:715-721`, terminate returns the receipt). The original seed's "release wedge" (a tier
  that never returns `closed` wedges its sessions) is SOLVED by this rule - the executor's
  outcome typing must compose with it, not bypass it.
- **Subset providers cannot register in the frozen recursive capability.**
  `process-authority/registry.ts:105-116` rejects any descriptor whose capability id differs
  from `rasen-recursive-process-scope/1` (`:105-107`) or whose semantics list is not the
  frozen list index-for-index (`:108-116`); `manifest.ts` enforces the same index-exact match
  (`:62`, `:160`). The declared-limit tier therefore lives at the ProcessScope seam - contract,
  not implementation accident. (Original anchors `registry.ts:105-112` / `manifest.ts:61-62,
  :119` drifted slightly; substance unchanged.)
- **ProcessScope seam vocabulary.** `TerminationReceipt.state` is now
  `closed | retained | uncertain | declared-unproven` with the `unproven` receipt attached
  exactly when declared-unproven; `LiveProcessScope.closed` resolves
  `ScopeEmptyReceipt | DeclaredUnprovenReceipt`. The original "closed | retained | uncertain"
  tri-state description is SUPERSEDED - the honest terminal is landed vocabulary, no longer a
  proposal.

## Where the sibling records live (updated 2026-08-08)

- Step 1 obligations and their routing: the Linux change's
  `evidence/step1-obligation-tasks.md`, `evidence/step1-task-ledger-retier.md`, and
  `handoff/lead-4.md`. [STALE-UNVERIFIED: relayed 2026-08-07; the refresh confirmed the files
  exist but did not re-read the re-tier rows.]
- The Linux ledger's Section 12 (pipe-EOF daemon-death teardown wave) as the provider-side
  counterpart of obligation 1: [STALE-UNVERIFIED and now parked context - the provider left
  0.2.0; the surviving Windows-side teardown receipt is the cutover's KILL_ON_JOB_CLOSE
  receipt.]
- The closure re-grading rows the original cited
  (`ecp-native-process-capsule-closure/evidence/step1-scope-reconciliation.md`, rows
  9.10/11.16/11.17): [STALE-UNVERIFIED as receipt expectations - re-read them together with
  the newer `decision13-regrade.md` in the same directory, which post-dates them.]
- NEW: the cutover change `rasen/changes/ecp-hosted-best-effort-cutover/` - proposal/design
  (the D3 transport-loss invariant the executor composes with), tasks, and evidence
  (implementation-baseline, mutation receipts, legacy-freeze integrity, real Linux kernel
  receipts). Its design.md D8 phrases the SEC-001 structural closure the closure re-grade will
  verify.
- NEW: `decision13-regrade.md` in both the closure and host change directories - the concrete
  residuals this change's DAG predecessors carry into their resumes.
