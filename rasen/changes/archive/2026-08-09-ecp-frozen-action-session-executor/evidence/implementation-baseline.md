# Implementation baseline - ecp-frozen-action-session-executor

Recorded at implementation start by the implementer. All anchors re-verified in
this worktree on 2026-08-08.

## HEAD and propose anchor

- Implementation-start HEAD: `4a167bfa1c3085585a9c063d72aa1e69d3eff766`
  (`fix(ecp7): keep the server-reader scenario name, add lifecycle-registry
  scenario (host archive prep)`).
- This change's propose commit: `08ed23c6`
  (`docs(ecp7): propose ecp-frozen-action-session-executor`).
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume` (SHARED worktree). The
  host change `ecp-durable-agent-session-host` is being archived in parallel in
  the working tree (its dir is deleted, specs synced to
  `rasen/specs/durable-agent-session-host/`). That archive work is not this
  change's; host code/contract is consumed as the stable seam per the brief.

## Task 1.1 - Seam anchors re-verified at HEAD 4a167bfa

| Seam | File:line | Verified |
| --- | --- | --- |
| Facade surface (`start\|resume\|complete\|inspect\|control`) | `src/core/change-run/facade.ts:27-45` | yes |
| `RuntimeMutationContext.deliveryMode` | `src/core/change-run/facade.ts:14` | yes |
| `record_version_conflict` code | `src/core/change-run/facade.ts:57` | yes |
| `receipt_conflict` code | `src/core/change-run/facade.ts:59` | yes |
| `workspace-scope-mismatch` code | `src/core/change-run/facade.ts:60` | yes |
| `RecordVersion` brand | `src/core/change-run/contracts.ts:16` | yes |
| `expectedRecordVersion` (control request) | `src/core/change-run/contracts.ts:436` | yes |
| `deliveryState` enum | `src/core/change-run/contracts.ts:601` | yes |
| grant path / `collectSettleStimuli` | `src/core/change-run/internal/facade-runtime.ts:211-421` | yes |
| `complete` re-reads evidence before mutation | `src/core/change-run/internal/facade-runtime.ts:509-533` (calls `verifyCompletionAuthority` -> `verifyAttestedCompletion(... evidenceStore.read)`) | yes |
| `verifyCompletionAuthority` re-read via store | `src/core/change-run/internal/facade-runtime.ts:119-133` | yes |
| `verifyAttestedCompletion` (re-verify binding/content/claim) | `src/core/change-run/internal/attestation.ts:347-433` | yes |
| EvidenceStore interface / bounded store | `src/core/change-run/internal/evidence.ts:165-280` | yes |
| `HostEvidenceWriter` complete-set verify-before-publish | `src/core/change-run/internal/host-evidence-writer.ts:53-131` | yes |
| `createSessionHost` | `src/core/session-host/host.ts:300` | yes |
| `closeDurableProcess` | `src/core/session-host/host.ts:696` | yes |
| `receiptAuthorizesRelease` gates | `host.ts:490`, `:573`, `:717` (rule at `process-scope.ts:222`) | yes |
| terminal-persistence declaration gate | `src/core/session-host/host.ts:766-767` | yes |
| `toHostedProcessTerminal` hardcodes `emptiness: 'unproven'` | `src/core/session-host/host.ts:652-658` | yes |
| `receiptAuthorizesRelease` rule | `src/core/session-host/process-scope.ts:222` | yes |
| `TerminationReceipt.state` = `closed\|retained\|uncertain\|declared-unproven` | `src/core/session-host/process-scope.ts:142-143` | yes |
| `DeclaredUnprovenReceipt` | `src/core/session-host/process-scope.ts:116` | yes |
| single selection point `createHostedProcessScope` | `src/core/session-host/process-capsule/hosted-process-scope.ts:22-29` | yes |
| `POSIX_BEST_EFFORT_DECLARATION` (`exactCancel:false`/`scopeEmptyProof:false`) | `src/core/session-host/process-capsule/posix-best-effort-scope.ts:41-45` | yes |
| `WIN32_BEST_EFFORT_DECLARATION` (`exactCancel:false`/`scopeEmptyProof:false`) | `src/core/session-host/process-capsule/win32-best-effort-scope.ts:76-80` | yes |
| exactly-once activation | `src/core/session-host/process-authority/process-scope-adapter.ts:179-183` | yes |
| production construction | `src/core/management-api/router.ts:639` (`createHostedProcessScope`), `:642` (`createSessionHost`) | yes |
| host failure vocabulary incl. `turn-outcome-unknown` | `src/core/session-host/contracts.ts:5-23` | yes |
| host `interrupted`/`failed` states | `src/core/session-host/contracts.ts:27-36` | yes |

No design-affecting drift. The design's phrasing "`complete`/`control` request
carries `expectedRecordVersion` (`contracts.ts:436`, `:792`)" is slightly
imprecise: only `ChangeRunControlRequest` carries `expectedRecordVersion`
(`:436`); `CompleteRunAction` does not, and its atomicity comes from the
RunStore head+1 commit plus the re-read/re-verify in `verifyCompletionAuthority`
(facade-runtime.ts:119-133) - which is exactly the transactional mechanism D5
describes. This is a documentation wording imprecision, not a seam drift; the
transactional-integrity work composes the existing re-read/re-verify, it does
not need to add `expectedRecordVersion` to the complete request.

## Task 1.2 - No-touch surfaces

This change does not modify:

- `native/linux-process-authority/**`, `native/windows-process-authority/**`
  (frozen authority crates - parked to the upgrade path by decision 13).
- The legacy ProcessCapsule (`src/core/session-host/process-capsule/native-process-scope.ts`).
- The durable session-host registry record shape (`rasen-session-host-registry/2`):
  the registry stays a host-lifecycle reader; the executor writes completion
  only through the Facade into the canonical Record.
- The host outcome vocabulary (`session-host/contracts.ts:5-23`): the executor
  composes it into `execution-lost`, it does not redefine it.

`git diff --stat` for this change will touch none of those.

## Obligations and scope

Recorded verbatim from `planning-context.md`, Target State locked decisions
11/12/13, and the slice spec `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/spec.md`.

### Step 1 obligations owned verbatim (locked decision 11)

1. **Typed `execution-lost` plus committed-frontier resume.** On daemon death
   (hosted) or launcher disappearance (in-tool), the in-flight Action is typed
   `execution-lost` - a distinct typed outcome, not generic uncertainty and not
   a workload failure; the Run resumes only from the last committed Record
   frontier via the Facade; no reattach, no identity revalidation, no resend of
   an input whose commitment is unknown.
2. **`durable: daemon-lifetime` surfaced through the capability matrix.**
   `hosted` best-effort owns a daemon-lifetime subprocess (POSIX group on
   linux/darwin, Job on win32); survives launcher exit, does NOT survive daemon
   restart. Declared as a matrix fact visible before start.

### Locked decision 12 scope (threat model = our own mistakes)

Completion integrity is **transactional**, not cryptographic:
complete-set verify-before-publish + Facade re-read/re-verify (integrity,
completeness, binding Action/invocation/workspace-revision/actor) before atomic
Record mutation. **No producer signing, no private-key custody, no
byte-repro-as-provenance, no TOCTOU hardening** as new acceptance. ECP-6's
archived Ed25519 is not rolled back, only not extended into the producer.

### Locked decision 13 scope (all-platform best-effort convergence)

`hosted` = shipped declared best-effort tier on **all three OSes** (POSIX group
linux/darwin, Job win32), `exactCancel: false` / `scopeEmptyProof: false`,
cancel terminal `cancelled / emptiness-unproven`. The kernel-enforced authority
tier is NOT a 0.2.0 backend. Windows zero-orphan daemon-death teardown via the
cutover's `KILL_ON_JOB_CLOSE` chain; linux/macOS daemon-death orphan risk is a
declared known limitation (receipt proves `execution-lost` typing + uncommitted
frontier stays uncommitted, NOT zero orphans).

### Slice acceptance owned by this change

Acceptance 1 (frozen-Action consumption), 2 (real Session + complete fact set +
two-backend matrix), 3 (transactional completion integrity), 5 (reuse/handoff
policy), 6 (driver-face same-Run parity), and the execution-lost /
committed-frontier HALF of acceptance 4. Acceptance 4's full
cancel/restart/ack-loss fault matrix is `ecp-session-policy-and-control-parity`'s;
acceptance 7 (self-hosting toy-Change proof) is operator-owned
`ecp-session-self-hosting-vertical-proof`. This change leaves both seams.

### Highest-value mutation targets (LEAD-named)

Both MUST have demonstrated RED counterparts:

1. The transactional half-set guard (complete-set verify-before-publish +
   re-read/re-verify).
2. The never-reroute guard (`authority-unavailable` never silently becomes
   in-tool).
