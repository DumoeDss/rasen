## Context

The synchronized `session-host-lifecycle` specification contains 26
requirements and 106 scenarios spanning the host, durable registry, public CLI,
and daemon scheduler. Those product surfaces have separate owners. This child
is the final DAG merge node and owns only their integrated acceptance tests,
fixtures, long-observation harness, architecture documentation, and evidence
records.

The cache asset is the live `claude -p --input-format stream-json` process, not
a session identifier. Prior physical probes observed a same-cwd live process as
a cache hit after 55 minutes and a miss after 65 minutes. The production
scheduler therefore targets an approximately 50-minute touch cadence and must
apply its deadline without turning the daemon into a correctness dependency.
Fake-clock tests can deterministically cover branches, but cannot establish the
real retention boundary.

All child-local changes are delivered locally. Repository-local fixes,
non-author review, task/spec state, child ship/archive, and parent-selected
repository mutations all finish before a controlled entrypoint freezes the
exact tracked delivery index/tree. The parent then owns the one portfolio-level
commit/push or PR. Native CI evidence must refer to that exact commit and
include `Test (linux-bash)`, `Test (linux-bash-node24)`,
`Test (windows-pwsh-shard-1)`, `Test (windows-pwsh-shard-2)`, and
`Test (windows-pwsh-shard-3)`. Writing those results back into the repository
would create a different commit and invalidate the claim, so repository
artifacts define the protocol while result-bearing delivery evidence lives in
the canonical external work directory or an immutable CI artifact keyed by the
tested SHA.

## Goals / Non-Goals

**Goals:**

- Prove one integrated create → wake × N → scheduled touch → retire lifecycle,
  plus contention, retired rejection, registry/transcript agreement, process
  loss recovery, and daemon-off correctness.
- Exercise the exact reconciler-supported built-in set:
  `bug-fix`, `small-feature`, `full-feature`, `goal-loop-measure`,
  `goal-loop-evaluate`, and `goal-loop-research`.
- Preserve `auto-decompose` as an expected fail-closed
  `execution_profile_unavailable` case.
- Produce real wall-clock evidence for the approximately 50-minute scheduler
  cadence, the 55-minute hit control, the 65-minute miss control, and the
  configured deadline action.
- Replace the architecture document's reserved session-execution-layer text
  with the delivered ownership and execution contract.
- Bind final native CI results to one exact parent-delivered SHA without
  changing the tested commit while recording those results.
- Keep every evidence record resumable, attributable, bounded, and safe to
  share.

**Non-Goals:**

- Repair host, registry, reusable-session API/CLI, or scheduler product code in
  this child.
- Change the already-synchronized runtime behavior merely to make an
  acceptance case pass.
- Claim that injected POSIX behavior, WSL, containers, or fake clocks are
  native Linux or real retention evidence.
- Push a child branch, open a PR, start remote CI, or infer parent delivery
  authorization.
- Make `auto-decompose` reconciler-supported.
- Modify ECP Direction files, `src/core/change-run/**`,
  `src/core/pipeline-registry/**`, or any package lock.

## Decisions

### D1. One explicit evidence manifest joins local, physical, and remote proof

The committed child artifacts define
`rasen-session-cache-acceptance/1`, an immutable-generation evidence protocol.
Each launch creates a never-reused content-addressed or UUID path:
`<workDir>/attempts/<attemptId>/`. Its candidate-bound intent is written once
by the launcher, each observer writes only its disjoint
`arms/<armId>/` subtree, and the launcher writes one complete attempt summary
after the three arms settle. Checkpoints and events use monotonically named
create-once files; results are create-once. No observer renames, deletes, or
overwrites an old attempt or writes either acceptance-run version.

Legacy `<workDir>/acceptance-run.json` remains immutable v1 history and is
never renamed, deleted, overwritten, or parsed as the v2 selected-attempt
record. `<workDir>/acceptance-run-v2.json` is the only canonical record for the
immutable-attempt protocol. The controlled E1 finalize operation is its sole
writer: it explicitly selects one complete `attemptId`, bounded-validates the
immutable summary plus all three declared arm results/checkpoints, and only
then creates v2. An exact existing v2 record may be validated idempotently; an
incompatible or different record fails. `seedAcceptanceRun` and every alternate
seed/preselection writer are removed. Final remote results remain in
`<workDir>/ci-evidence.json` and bind v2. An immutable CI artifact carrying the
same schema and candidate SHA may mirror the remote record but cannot replace
the canonical external record unless the protocol records that choice before
freeze.

The manifest uses explicit named lists rather than glob inference:

- `SUPPORTED_PIPELINES` contains the six built-ins above;
- `EXPECTED_FAIL_CLOSED_PIPELINES` contains only `auto-decompose`;
- `REQUIRED_CI_JOBS` contains the five exact `Test (...)` names above;
- each observation arm has a stable ID, exact run/session/cwd identity, start
  and end wall timestamps, elapsed monotonic duration, raw-result path,
  classification, and disposition.

There is no acceptance-layer shared mutation lock, mutation guard,
stale-reclaim algorithm, or release algorithm. Concurrency safety comes from
writer ownership and immutable paths:

- one launcher owns its attempt intent and final summary;
- one observer owns each named arm subtree;
- checkpoint/event filenames are unique and monotonically ordered;
- result and summary paths use create-once semantics;
- concurrent launchers necessarily choose different attempt IDs.

Immediately before product dispatch, each launcher performs fresh capacity and
product-owned admission. A loser records an immutable pre-dispatch
inconclusive result and makes no Claude call. The product admission boundary,
not an acceptance filesystem lock, arbitrates simultaneous work.

The concurrency proof is multiprocess and crosses the real integration seam:
two actual launch/observe clients use the real CLI/HTTP path into an actual
management server/router, reusable-session service, durable registry, and
coordinator. A deterministic barrier may hold the admitted winner inside the
real product admission/dispatch boundary. The existing fake Claude executable
is allowed only where the production host would invoke the agent binary; it
cannot replace capacity, routing, registry, lease, reservation, coordinator, or
dispatch-fence behavior. The proof requires one actual create/dispatch, one
typed busy/inconclusive loser before dispatch, no second supervisor/Claude
create, and matching real registry session plus wake-ledger facts. A
test-private slot file or dispatch log is not evidence.

Result files are written atomically before best-effort logs. Final acceptance
does not trust an arm's manifest status: it resolves the exact declared result
path under the explicitly selected immutable attempt/arm root, rejects links/reparse redirection
and non-regular files, enforces a named byte limit, strict-decodes the complete
result, and cross-checks candidate, binary, identity, elapsed time,
classification, and usage. It additionally requires the exact named-arm policy
shape: each control is `mode: never`, `maxTouches: 0`, with a null deadline,
while the scheduler is `mode: auto`, `maxTouches: 1`, with the exact configured
non-null deadline. The result start is persisted before bootstrap, original
transcript-baseline capture, eligibility capture, and checkpoint creation, and
resume restores that exact start. The scheduler must satisfy
`startedAt <= eligibilityAt <= touchAt <= touchSettledAt <=
configuredDeadlineAt <= deadlineAppliedAt <= endedAt`. Positive real-time
`cadenceToleranceMs` and `deadlineApplicationToleranceMs` are derived directly
from immutable `OBSERVATION_ARMS` definitions—5 minutes and 10 minutes,
respectively—and persisted in intent, checkpoints, result, and summary. A
jointly altered checkpoint/result pair still fails when compared with the
constants. A completed-arm resume performs bounded validation of the immutable
result and returns it with no process, CLI, ledger, or file side effect.

A new attempt may reuse only a completed control arm after bounded no-follow
validation of immutable bytes, full candidate identity, arm policy/constants,
and provenance. Reuse creates a new immutable copy/reference under the target
attempt; the source never changes. Scheduler-arm reuse is explicitly rejected
with a stable typed code before any result/reference write. Every scheduler
result eligible for finalization is native to its target attempt and has that
attempt's bounded-valid immutable checkpoint chain; result-without-checkpoint,
wrong-attempt, or tampered checkpoint evidence fails. Pre-strategy mutable
ledgers, failed/incomplete checkpoints/results, and the historical
`7af1e71b...` attempt remain bounded-catalogued legacy history, excluded from
automatic selection.

The manifest never stores bearer tokens, prompts, raw message IDs, owner
secrets, or unrestricted transcript contents. A missing, partial, mismatched,
schema-invalid, or stale record keeps acceptance incomplete.

Alternative considered: commit a final evidence Markdown file after CI. That
would prove a predecessor SHA while making the repository point at a successor
SHA, recreating the evidence loop this change must eliminate.

### D2. Local deterministic suites and the real harness have different claims

Fast Vitest integration/E2E/durability suites own deterministic lifecycle,
race, restart, policy, exact-identity, and presentation checks. They may inject
clocks and process/service seams to make every failure branch repeatable on a
developer machine.

An opt-in Node harness owns physical-time and real-process observations. It
uses production CLI/service entry points, real wall time, and durable
checkpoints; it never presents an advanced fake clock as a final retention
sample. It runs only after the repository-local implementation is independently
reviewed clean and every planned repository mutation is complete. The scheduler
result interval begins and is checkpointed before bootstrap, bounded transcript
baseline capture, or eligibility capture. Its immutable checkpoint sequence
persists that exact `startedAt`, the original bounded transcript
identity/range/hash, eligibility `capturedAt`, and constant-derived tolerances
in create-once monotonically named files. Resume bounded-validates and reuses
the latest valid checkpoint; it never overwrites a checkpoint or takes a fresh
start/snapshot that can shorten the apparent cadence or snapshot away the
admitted touch append. The harness can resume completed named
arms by validating their result files rather than depending on a background
completion notification. It refuses to merge samples from a different final
tracked tree, binary build, daemon/Claude identity, exact run/session identity,
policy/tolerances, result start, or original scheduler baseline.

Alternative considered: put a 65-minute test into the ordinary CI matrix.
That exceeds current job budgets and would make routine CI fragile; the long
observation is instead a pre-delivery acceptance gate whose immutable result is
bound into the external manifest.

### D3. The integrated lifecycle is proven once deeply and across every supported pipeline

One representative Run performs the full live path:

1. create with an exact admitted action and durable bootstrap fence;
2. wake sequentially with multiple stable message IDs;
3. reject a truly overlapping distinct wake without a second dispatch;
4. admit a later wake after the active turn settles;
5. accept one scheduler touch through the same durable lease;
6. retire and prove every later wake is rejected without spawn or delivery.

The harness snapshots safe CLI/API output, supervisor identity, registry
revision, digest-only wake/touch ledger, and the exact production no-follow
regular transcript identity at each boundary. The host-loss test uses that
actual transcript file, not a parallel static fact. A controlled process loss
between turns then proves recovery keeps the stable logical host/session
binding and canonical cwd while changing only the owned process binding.

Each of the six supported built-ins separately produces at least one real
reconciler-admitted action that the session executor accepts with its exact
Run/action/workspace binding. `auto-decompose` must traverse the production
registry, profile preparation, and reconciler-support path and return
`execution_profile_unavailable` before any host call; an injected `null`
profile is not evidence. This distinguishes execution-layer acceptance from
merely parsing pipeline definitions.

Alternative considered: run the deepest lifecycle independently for all six
pipelines. That multiplies expensive live model work without increasing
coverage of the shared lifecycle; the design instead combines one deep chain
with six exact-binding integration cases.

### D4. Daemon-off is a correctness arm, not a cache-efficiency failure

The daemon-off case uses the production daemon state/socket/PID owner-selection
seam to positively establish refusal plus a dead/stale recorded owner, then
executes the same exact-run operation through the permitted foreground owner.
Negative cases prove timeout, ambiguity, and a live recorded owner never select
foreground. The accepted case verifies the shared durable fence, recovery,
result, and owner-shutdown semantics and accepts that the live cache process is
reaped.

Alternative considered: skip daemon-off because it cannot retain the cache.
That would confuse the optimization with correctness and leave a central
portfolio promise unproved.

### D5. Real retention uses independent controls and one scheduler/deadline arm

The long harness uses isolated exact run/session identities and records raw
cache-usage counters before classification:

- `control-hit-55m`: no automatic touch; a real wake after at least 55 minutes
  must classify as a cache hit.
- `control-miss-65m`: no automatic touch; a real wake after at least 65 minutes
  must classify as a cache miss/rewrite.
- `scheduler-cadence-deadline`: auto policy remains eligible through the
  production approximately 50-minute cadence, admits exactly one real touch
  within the declared tolerance, and then reaches its configured `stop` or
  `retire-silent` deadline before another touch. The registry and transcript
  must agree on that one touch and the terminal policy action.

Before each arm starts, the harness freshly queries the live production
supervisor/daemon state and recomputes ordinary plus reusable live processes
and available slots. An editable cached capacity document is diagnostic only.
The three arms may run concurrently to keep wall time near 65 minutes only when
that live probe proves capacity and their run/session/cwd identities are
isolated.

The scheduler arm snapshots the exact transcript before eligibility, retains
the admitted touch timestamp, and proves a bounded append containing the exact
touch causal chain. The original no-follow regular-file identity and exact
pre-append offset bound the range. From that range the harness derives and
persists only the digest of the exact scheduler-touch user text, followed by
regular assistant/result lines with the same Claude/session identity and
ordered timestamps. That transcript-derived digest and line chain are compared
directly with the durable wake's message digest, kind, ordinal, attempt,
dispatch/settled times, result digest, and policy time. A summary fingerprint
is allowed only after those direct comparisons; concatenating independent
claims cannot create causality.

The scheduler timestamps must satisfy the complete ordering
`started <= eligibility <= touch <= settled <= configuredDeadline <=
deadlineApplied <= ended`. The touch lies inside the positive declared real
cadence tolerance, and application lies no earlier than the configured
deadline and no later than its frozen application tolerance. The registry
ordinal and `touchesUsed` agree. The durable terminal transition names the
exact scheduler deadline reason, action, and timestamp and equals the configured
policy/deadline. Copying the action from configuration, substituting wall-clock
`now`, an early manual retirement, an unrelated `lost` state, another completed
wake append, or `mode: never` is never terminal evidence.

Immediately before any arm result is committed, the harness recomputes the
frozen tracked tree/index identity, declared binary set, daemon identity, and
selected Claude binary/version/hash. Each control must still expose the exact
same live admission-time owner/host/child-process binding, including
process-creation identity; absence, replacement, ambiguity, PID reuse, or
recovery makes that control inconclusive. The terminal scheduler arm uses a
different production-valid rule: it proves the same durable logical Run/session
and Claude session, retains the exact preterminal owner history through touch
settlement, and then requires the owner to be absent with the causally bound
configured deadline reason/action/time. It never requires a live owner after
retirement and never accepts terminal absence without the preterminal binding
and exact terminal cause. A capacity, transport, clock, owner, or identity
ambiguity is inconclusive, never a hit/miss result. Wall time and monotonic
elapsed time are both recorded; backward or suspended-clock ambiguity is
reported rather than normalized away.

Superseding never mutates an old attempt. A repository change or failed product
admission creates a new candidate-bound attempt ID and leaves every prior
intent, checkpoint, event, result, summary, workspace reference, PID record,
and launch log in place. Live hosts still use the independently confirmed
production retire/absence probe, but filesystem evidence is not cleared,
archived by rename, or reseeded. The controlled finalizer selects one complete
new attempt and resets current CI consistently; all other attempts remain
failed, inconclusive, complete-but-unselected, or diagnostic history.

Alternative considered: infer the 55/65 boundary from the historical probe.
That probe establishes the design premise, but final acceptance must observe
the integrated implementation and its current binary/content fingerprint.

### D6. Architecture documentation replaces, rather than duplicates, the reservation

`docs/architecture/executable-composite-pipelines.md` keeps the kernel boundary:
the reconciler grants frozen actions and does not itself run agents. Its
reserved session text is updated in place to name the delivered session
execution layer, exact admitted-action boundary, stable reusable owner,
durable recovery/single-flight semantics, daemon optimization role, and the
authoritative source of reuse policy. It explicitly explains that historical
placeholder `handoffTokenLimit`/`reuseRoundLimit` values are not retroactive
operator choices.

Alternative considered: append a disconnected new chapter while leaving the
reserved claims unchanged. That would leave contradictory architecture
statements in the same document.

### D7. Every implementation gap routes back to one owner

The acceptance child may edit only newly declared acceptance tests, fixtures,
harness/protocol files, the reserved architecture section, and its own change
artifacts/work directory. The ownership audit derives the complete changed set
from the frozen baseline, the actual worktree/index diff, and the candidate
delivery manifest. Those three sets must be exactly equal before allow/forbid
classification; a caller-supplied partial path list cannot pass. The explicit
manifest includes all child artifacts such as `.openspec.yaml`,
`planning-context.md`, proposal, design, delta spec, and tasks.

Findings are classified and routed as follows:

- live process lifecycle/capacity/recovery mechanics → `host-lifecycle`;
- durable registry, transcript, lock, fence, and reconciliation →
  `registry-recovery`;
- public commands, foreground/resident protocol, output, and shutdown →
  `cli-surface`;
- cadence, deadline, cold-gap, backoff, and daemon scheduler lifecycle →
  `touch-scheduler`;
- harness, fixture, assertion, documentation, or evidence-schema defects →
  this acceptance child.

A product gap blocks the affected acceptance case. The owner fixes it, its own
non-author review closes it, and acceptance reruns only the invalidated
evidence. The acceptance implementer does not silently patch another child's
file.

CLI execution is bounded in success and failure. On every nonzero exit the
harness strict-decodes only the bounded public command envelope and retains its
safe stable code, never raw stdout/stderr. Malformed, oversized, missing, or
otherwise unclassified envelopes receive a stable harness code that still maps
to the CLI/protocol owner and records `productGap` through the full observer
path. No `cli_failed_<exit>` or exit/signal fallback may end an arm ownerless.

### D8. Repository freeze precedes the only remote delivery and all result recording

Finding checkboxes are implementer-completion markers, not review
dispositions. The implementer may mark one only after its implementation and
local evidence exist, labels it `FIXED_PENDING_REVIEW`, and resets it when a
non-author review reopens the finding. Only the canonical independent report
and the dedicated non-author review task may say confirmed or CLEAN. Physical
and remote gates never edit repository checkboxes.

The sequence is deliberately split:

1. implement local tests/docs/harness/protocol and run deterministic local
   gates;
2. complete non-author review, route/fix every finding, and obtain a clean
   delta re-review over the repository implementation;
3. run the final serial local gates, derive truthful typed `localEvidence`
   flags from those gate records, and retain the five complete output files,
   their exit files, byte counts, and SHA-256 values under one canonical logs
   root; final acceptance reopens and rehashes all five outputs/exits;
4. finish every repository mutation, including repo task state, delta-spec
   sync, child local ship/archive, and any remaining parent-selected repository
   operation;
5. through one controlled parent entrypoint, persist the normalized repository
   root, original frozen baseline SHA, delivery-manifest fingerprint,
   tree/content/binary fingerprints, and exact delivery set derived from that
   baseline and the actual index; reject forbidden/unmanifested paths, exclude
   the pre-existing untracked
   `packages/ui/package-lock.json`, write the candidate tree object, and seed a
   candidate-freeze record without fabricating an attempt, arm state, or
   physical outcome;
6. create fresh immutable attempt generations and run real 50/55/65-minute
   arms against that final tree; observers write only disjoint arm paths. When
   one attempt is complete, the same controlled entrypoint's finalize operation
   bounded-validates its launcher summary and three arm results/checkpoints,
   selects exactly that attempt, and creates `acceptance-run-v2.json` as the
   sole canonical writer (or exact-idempotently validates the same existing v2
   record). Legacy `acceptance-run.json` remains untouched. A product gap
   leaves every attempt immutable and returns to step 1 with a new candidate;
7. only after physical acceptance and explicit parent authorization, compare
   the full persisted candidate identity, create the one portfolio commit and
   push/open the one PR from the same frozen index, and make delivery recording
   derive from the persisted baseline rather than a moving `HEAD`; recompute
   the tree and require `git show <deliverySha>^{tree}` to equal the frozen tree
   before recording delivery externally;
8. select the existing GitHub workflow only when its target repository,
   GitHub origin, exact URL path segments, run ID, run attempt, run URL, and
   `head_sha` match the delivered record; consume actual workflow/jobs REST
   shapes without a fabricated job repository field, deriving repository
   identity from `run_url`, and require every job's `run_id`, `run_attempt`,
   `run_url`, `head_sha`, job URL, name, and conclusion to bind to that same
   run and attempt;
9. record run URLs and required job conclusions externally, without any
   repository write.

The child pipeline's `ship` means local delivery; the parent portfolio delivery
and the physical/CI outcomes are separate external gates. Repository checkboxes
describe only protocol/preflight/local-delivery work that can finish before
freeze; they are never edited to record physical or remote outcomes. If CI
fails or any tracked/index byte changes, the candidate is superseded, current
CI success is invalidated, `run.ciState` and the CI document both become
matching failed/pending state, the failure routes to its owner, and a new
tree/SHA and new attempt generation must repeat physical and exact-SHA gates.
Final acceptance checks both state sources. Results from every superseded or
unselected attempt remain immutable history but cannot close acceptance.

Alternative considered: push once for CI, commit the evidence, and push again.
That tests a different SHA and violates the single portfolio delivery rule.

## Risks / Trade-offs

- **[Real-time evidence is expensive or interrupted]** → Use create-once
  checkpoint sequences inside one immutable attempt, bounded-validate resume,
  reuse only completed controls through validated immutable copy/reference, and
  always run a fresh scheduler arm with a target-native checkpoint chain.
- **[Provider-side cache behavior is probabilistic]** → Preserve raw usage
  counters and exact timestamps; classify only the established hit/miss
  signatures and report ambiguity instead of forcing a pass.
- **[Parallel launchers influence capacity]** → Verify fresh capacity and
  product-owned admission immediately before dispatch, isolate attempt/run/
  session/cwd identities, and settle losing launchers inconclusive before any
  Claude dispatch.
- **[Multiple attempts complete]** → UUID or content-addressed generations
  never share paths; controlled finalization selects and cross-validates exactly
  one summary while all others remain immutable unselected history.
- **[Legacy mutable evidence remains on disk]** → Bounded-catalogue it as
  legacy history, exclude it from automatic selection, and permit reuse only
  through the validate-and-copy/reference contract.
- **[A review/archive write occurs after the candidate is named]** → Treat any
  repository mutation as invalidating the candidate and do not request parent
  delivery until all repo-local mutation is finished.
- **[GitHub job labels drift]** → Resolve the explicit required list against
  the committed workflow before freeze; missing or renamed required jobs fail
  the evidence protocol rather than being guessed by pattern.
- **[External evidence is lost]** → Use the canonical work directory's atomic
  record and optionally mirror it as an immutable CI artifact keyed by SHA.
- **[Acceptance discovers product defects]** → Keep the case blocked and route
  the minimal reproducer to the declared owner; no cross-child opportunistic
  fix is authorized.

## Migration Plan

1. Remove acceptance-layer shared ledger locks, mutation guards, reclaim, and
   release paths; install immutable attempt/arm writer ownership and create-once
   checkpoint/result/summary schemas without changing product behavior.
2. Bounded-catalogue all legacy mutable, failed, and incomplete external state
   in place. Never rename/delete it; preserve legacy `acceptance-run.json` and
   move v2 readers/writers to `acceptance-run-v2.json`; gate completed-control
   reuse through a new immutable copy/reference and reject scheduler reuse.
3. Add constant-bound timeline, concurrent-launch admission, exact-attempt
   finalization, transcript causality, and terminal-owner tests; run focused
   local verification and obtain independent non-author CLEAN review.
4. Complete repo tasks/spec sync/local ship/archive and all parent-selected
   mutations, then freeze the exact audited tree to a candidate-freeze record.
5. Run fresh immutable attempt generations, use controlled finalization as the
   sole creator/exact-idempotent validator of `acceptance-run-v2.json`, then
   follow explicit parent delivery authorization and exact-SHA CI.

Rollback before delivery removes only acceptance-owned test/harness/docs
changes. After delivery, a failed gate does not rewrite evidence as passing; it
routes the defect, creates a new candidate SHA after repair, and supersedes the
failed candidate explicitly.

## Open Questions

None. Remote authorization and CI availability are future gates, not planning
ambiguities, and remain absent by default.
