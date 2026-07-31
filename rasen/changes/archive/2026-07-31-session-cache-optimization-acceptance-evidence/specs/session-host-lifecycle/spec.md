## ADDED Requirements

### Requirement: Integrated reusable-session acceptance follows the complete lifecycle
The portfolio SHALL retain durable acceptance evidence for one exact canonical Run that creates a reusable session from an admitted action, wakes it repeatedly, admits an automatic touch through the same coordinator, and retires it. The evidence SHALL relate observable command outcomes, supervisor identity, durable registry transitions, and production no-follow exact-transcript facts without persisting caller content or secrets.

#### Scenario: Full create wake touch retire chain succeeds
- **WHEN** an exact admitted action creates a reusable session, multiple stable message identities wake it sequentially, the eligible scheduler touches it, and the user retires it
- **THEN** every accepted turn settles once under the same exact Run and logical session, the touch uses the shared durable admission path, retirement becomes terminal, and the bounded evidence record relates each transition

#### Scenario: Concurrent wake is rejected without delivery
- **WHEN** a distinct wake overlaps an already admitted turn for the same logical session
- **THEN** exactly one turn is dispatched, the overlapping caller receives contention without a Claude charge, and a later non-overlapping wake remains admissible

#### Scenario: Retired session rejects execution
- **WHEN** a new message targets the session after terminal retirement
- **THEN** execution is rejected without process recovery, spawn, stdin delivery, or durable wake admission

#### Scenario: Registry transcript agreement survives host loss
- **WHEN** the owned process is lost between accepted turns and the next wake reconciles the session through the production transcript probe
- **THEN** the exact canonical cwd, Claude session identity, digest-only ledger, and actual regular no-follow transcript agree before recovery, the stable logical host binding is retained, and only the owned process binding changes

#### Scenario: Daemon-off execution remains correct
- **WHEN** the production owner selector proves loopback refusal and a dead or stale recorded owner before admission
- **THEN** a permitted foreground owner applies the same exact-run, durable fence, recovery, result, and shutdown rules, while timeout, ambiguity, or a live recorded owner remains fail closed and only true absence reduces cache residency

### Requirement: Acceptance matches the reconciler support boundary
The session execution acceptance suite SHALL exercise real reconciler-admitted actions from `bug-fix`, `small-feature`, `full-feature`, `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research`. It SHALL retain `auto-decompose` as an expected fail-closed pipeline whose production execution-profile preparation prevents session dispatch.

#### Scenario: Every supported built-in reaches the session executor
- **WHEN** each of the six named supported pipelines produces an admitted action
- **THEN** the executor accepts that action only with its exact Run, action, session, workspace, and execution binding and records a successful supported-pipeline case

#### Scenario: Auto-decompose remains fail closed through production preparation
- **WHEN** `auto-decompose` traverses the production registry, profile preparation, and reconciler-support path
- **THEN** it returns `execution_profile_unavailable` before a reusable session is created or messaged, without relying on an injected null profile, and the result is recorded as expected behavior rather than a regression

### Requirement: Real cadence and retention evidence uses physical elapsed time
Final cache-retention acceptance SHALL run only after repository-local implementation, non-author clean review, task/spec/local-delivery/archive state, and every parent-selected repository mutation are complete. It SHALL use the production scheduler and real elapsed time against the frozen exact tracked delivery tree. It SHALL include an approximately 50-minute eligible touch, an independent no-touch cache-hit control at 55 minutes, an independent no-touch cache-miss control at 65 minutes, and a real configured deadline action. Fake-clock evidence MAY support deterministic local coverage but SHALL NOT by itself close this requirement.

#### Scenario: Production cadence admits one real touch
- **WHEN** an eligible auto-policy session remains idle through the production approximately 50-minute cadence
- **THEN** the result start and original transcript baseline were persisted before bootstrap and eligibility, exactly one touch is admitted through the shared coordinator inside the 5-minute cadence tolerance derived directly from `OBSERVATION_ARMS`, and the bounded append's exact scheduler-touch user-text digest plus subsequent regular assistant/result lines directly match the durable wake's session identity, message digest, kind, ordinal, attempt, dispatch/settled times, result digest, and policy time; any unrelated append or chain without one shared causal value remains incomplete

#### Scenario: Fifty-five-minute control retains the cache
- **WHEN** an isolated live session receives no automatic touch and is woken after at least 55 minutes of real elapsed idle time
- **THEN** the preserved raw usage counters classify the wake as a cache hit and bind that observation to the exact final candidate and session

#### Scenario: Sixty-five-minute control crosses the cache boundary
- **WHEN** an isolated live session receives no automatic touch and is woken after at least 65 minutes of real elapsed idle time
- **THEN** the preserved raw usage counters classify the wake as a cache miss or rewrite and bind that observation to the exact final candidate and session

#### Scenario: Real deadline performs the configured action
- **WHEN** the scheduler arm reaches its configured `stop` or `retire-silent` deadline after the first real touch and before another cadence
- **THEN** the arm satisfies `startedAt <= eligibilityAt <= touchAt <= touchSettledAt <= configuredDeadlineAt <= deadlineAppliedAt <= endedAt`, deadline application is no later than the 10-minute tolerance derived directly from `OBSERVATION_ARMS`, and the durable transition records the exact reason/action/time before any second touch; jointly altered checkpoint/result tolerances, copied configuration, wall-clock `now`, early manual retirement, unrelated process loss, another completed wake append, or generic `mode: never` cannot substitute for the constants and durable fact

#### Scenario: Fake-clock-only evidence remains incomplete
- **WHEN** deterministic scheduler tests pass but no valid real-time cadence, 55-minute, or 65-minute observation exists for the final candidate
- **THEN** local branch coverage may be reported but final retention acceptance remains incomplete

#### Scenario: Final gate validates each bounded result file
- **WHEN** an arm manifest claims completion
- **THEN** controlled finalization bounded no-follow reads each exact regular result path declared by one explicitly selected immutable attempt summary, strict-decodes it, and cross-checks attempt/candidate/binary/identity/minimum elapsed/classification/usage; each control has `mode: never`, `maxTouches: 0`, and a null deadline, while the scheduler has `mode: auto`, `maxTouches: 1`, its exact non-null deadline, the complete ordered timeline, and tolerance values equal to the immutable `OBSERVATION_ARMS` constants

#### Scenario: Result commit revalidates the running candidate
- **WHEN** an arm is ready to persist a physical result after its long wait
- **THEN** the harness first rehashes the frozen tracked tree/index, declared binary set, daemon identity, and selected Claude binary/version/hash; each control additionally requires the same live admission-time owner/host/child-process binding, while a terminal scheduler result requires the same durable logical and Claude session, exact preterminal owner history through touch settlement, production-valid `owner: undefined`, and the causally bound configured terminal reason/action/time

#### Scenario: Superseded physical attempt cannot close acceptance
- **WHEN** any tracked repository mutation or accepted product defect invalidates a candidate
- **THEN** a new candidate and immutable attempt generation is created, while every old intent, checkpoint, event, result, summary, workspace/config reference, PID record, and launch log remains unchanged as failed, inconclusive, complete-but-unselected, or diagnostic history; no old path is renamed, deleted, overwritten, or silently selected

#### Scenario: Completed-arm resume is a no-op
- **WHEN** a caller relaunches an arm whose result is already complete
- **THEN** the harness bounded-validates the create-once immutable result in that arm's sole-writer subtree and returns it without bootstrap, wake, process, canonical-ledger, or file side effects

#### Scenario: Interrupted scheduler resume preserves the original baseline
- **WHEN** the exact scheduler arm resumes before eligibility, late in the cadence wait, or after its admitted touch
- **THEN** the latest valid create-once checkpoint retains and validates the original result `startedAt`, bounded transcript identity/range/hash, eligibility `capturedAt`, and the 5-minute cadence plus 10-minute deadline tolerances derived from `OBSERVATION_ARMS`, reuses them for cadence and append proof, and rejects drift rather than overwriting a checkpoint or taking a fresh start/snapshot

### Requirement: Architecture documentation states the delivered execution boundary
The executable-composite-pipelines architecture document SHALL replace its reserved session-execution-layer text with the delivered contract. It SHALL distinguish reconciler action grants from caller execution, name reusable ownership and recovery responsibilities, and explain the authoritative interpretation of historical session placeholder values.

#### Scenario: Reserved section is replaced consistently
- **WHEN** a reader follows the architecture document's kernel, placeholder, and scope sections
- **THEN** each section points to one consistent delivered session execution layer and does not imply that the reconciler runs agents or that historical default placeholder values are operator-authored reuse limits

### Requirement: Acceptance defects remain completely owned and visible
The acceptance child SHALL own its integration tests, fixtures, harness, architecture update, and evidence protocol. Its ownership audit SHALL derive the complete changed set from the frozen baseline, actual worktree/index diff, and exact delivery manifest and require those sets to agree. A product defect SHALL remain an open acceptance failure and SHALL be routed through its bounded public-safe code to the uniquely owning host, registry, CLI, or scheduler child for repair and independent review.

#### Scenario: Ownership audit receives the complete changed set
- **WHEN** the ownership gate evaluates a candidate
- **THEN** the baseline, actual diff/index, and explicit manifest path sets are exactly equal, every child artifact is included, and an omitted forbidden edit or caller-supplied partial path list fails closed

#### Scenario: Evidence defect is fixed locally
- **WHEN** a failure is caused by an acceptance fixture, harness, assertion, documentation statement, or evidence-schema defect
- **THEN** this child repairs and re-verifies only its acceptance-owned surface

#### Scenario: Product defect routes back to its owner
- **WHEN** acceptance exposes a host lifecycle, registry/recovery, CLI/protocol, or scheduler behavior defect
- **THEN** the failing evidence and minimal reproducer identify that owner, acceptance remains blocked, and this child does not silently patch the owner's implementation file

#### Scenario: Nonzero CLI exit retains a safe attributable code
- **WHEN** a production CLI call returns any nonzero exit during an acceptance arm, including a malformed, oversized, missing, or otherwise unclassified public envelope
- **THEN** the harness retains no raw output, emits a stable safe public or harness code, records the CLI/protocol owner in `productGaps` through the full observer path, and never discards attribution into an ownerless generic exit/signal string

### Requirement: Native delivery evidence is bound to one exact repository commit
Final cross-platform acceptance SHALL be recorded only after explicit parent authorization of the single portfolio delivery. A controlled parent entrypoint SHALL freeze and later recompute the exact audited tracked delivery index/tree, excluding the pre-existing untracked `packages/ui/package-lock.json` and every incidental untracked file, and SHALL prove that the delivered commit contains that exact tree. The evidence SHALL bind the final candidate, delivery SHA, GitHub target repository, workflow run, and required jobs. Result-bearing physical and CI evidence SHALL live outside the tested repository commit.

#### Scenario: Exact candidate is the tracked delivery tree
- **WHEN** repository-local fixes, clean review, task/spec/local-delivery/archive state, and parent repository mutations are complete
- **THEN** the controlled entrypoint persists the normalized repository root, original frozen baseline SHA, delivery-manifest fingerprint, tree/content/binary fingerprints, complete tracked delivery index/tree, and explicit path/blob/mode manifest, rejects forbidden or omitted paths including every package lock, excludes incidental untracked files, and writes a candidate-freeze record without fabricating an attempt, arm result, or canonical acceptance ledger

#### Scenario: Missing parent authorization prevents remote delivery
- **WHEN** local closure or physical acceptance completes without explicit parent portfolio-delivery authorization
- **THEN** the external ledger remains awaiting authorization and no child pushes, opens a PR, triggers remote CI, or claims native evidence

#### Scenario: Controlled delivery proves the commit tree
- **WHEN** the parent authorizes the single portfolio commit and push or PR
- **THEN** the same controlled entrypoint compares the full persisted candidate identity, derives delivery recording from the persisted original baseline rather than a moving `HEAD`, recomputes the frozen tree, creates or accepts the delivery SHA only when `git show <sha>^{tree}` equals that tree, and records authorization and delivery externally

#### Scenario: Existing CI proves the exact delivered SHA
- **WHEN** the delivered repository's existing GitHub workflow runs
- **THEN** the accepted workflow target repository, GitHub origin, exact URL path segments, run ID, run attempt, run URL, and `head_sha` exactly match the controlled delivery record

#### Scenario: Every required job belongs to that workflow run
- **WHEN** required native job evidence is collected from actual GitHub workflow-jobs REST records that do not contain a fabricated `job.repository` field
- **THEN** repository identity is derived from exact `run_url` path segments and each exact named job has the same `run_id`, `run_attempt`, `run_url`, `head_sha`, target repository, job URL origin, and successful conclusion as the selected workflow; numeric-prefix collisions, attempt splices, inconsistent URLs, and caller-enriched substitutes cannot satisfy the gate

#### Scenario: Evidence recording does not change the tested commit
- **WHEN** physical or native CI conclusions become available
- **THEN** they advance only the canonical external ledger or immutable SHA-keyed CI artifact without a repository commit, task-box edit, archive mutation, or other change to the tested tree

#### Scenario: Substitute platform or commit evidence is rejected
- **WHEN** evidence comes from a partial child push, a different tree or SHA, WSL or container emulation, injected platform behavior, another GitHub repository, or a run missing any required named job
- **THEN** it may support local diagnostics but cannot close native exact-tree acceptance

#### Scenario: Superseded candidate resets CI and final bindings
- **WHEN** a candidate is superseded before final acceptance
- **THEN** its CI record is archived as history, current CI success is invalidated and atomically reset to pending, and the final gate requires exact agreement between `run.ciState`, the current CI document, candidate tree, physical results, full frozen identity, delivery SHA/tree, workflow run/attempt, and jobs

#### Scenario: Failed CI invalidates the candidate
- **WHEN** a required job fails or a tracked repository mutation is needed after the candidate is frozen
- **THEN** the failure routes to the owning child, `run.ciState` and the current CI document both record matching failure or pending supersession so no older success can close acceptance, the candidate remains failed evidence, and a repaired new tree and SHA must repeat physical and exact-SHA native gates

### Requirement: External acceptance state uses immutable attempts and controlled finalization
Every physical launch SHALL create a never-reused content-addressed or UUID attempt generation. The launcher SHALL own its create-once intent and summary; each observer SHALL write only create-once files in its disjoint named-arm subtree. No observer SHALL mutate a shared ledger, old attempt, legacy `acceptance-run.json`, or canonical v2 record. Legacy `acceptance-run.json` SHALL remain immutable bounded history. `acceptance-run-v2.json` SHALL be the only selected-attempt record for the immutable protocol, and the controlled E1 finalize operation SHALL be its sole creator or exact-idempotent validator after selecting exactly one bounded-valid complete attempt. No seed or preselection writer SHALL exist. Local evidence flags and log references SHALL be set only from canonical retained outputs.

#### Scenario: Concurrent arms preserve every update
- **WHEN** multiple physical observers update different named arms concurrently
- **THEN** every launcher uses a distinct attempt ID, every observer is the sole writer of one `attempts/<attemptId>/arms/<armId>/` subtree, checkpoints/events/results use create-once unique names, no acceptance lock or stale-reclaim path exists, and no observer can overwrite another arm, attempt summary, old attempt, or canonical ledger

#### Scenario: Competing launchers settle losers before dispatch
- **WHEN** two real multiprocess `launch-physical`/observe clients concurrently target overlapping product admission for the same candidate through the actual CLI/HTTP path
- **THEN** an actual management server/router, reusable-session service, durable registry, and coordinator execute the production lease/reservation/dispatch fence; the fake Claude executable may appear only at the agent-binary boundary, exactly one real create/dispatch occurs, the loser returns typed busy/inconclusive before Claude dispatch, actual registry session and wake-ledger facts agree, and no test-private slot or dispatch gate substitutes for product admission

#### Scenario: Completed arm reuse creates new immutable evidence
- **WHEN** a launcher proposes to reuse a completed arm from an earlier attempt
- **THEN** only a control arm may proceed after bounded no-follow validation of source bytes, full candidate identity, policy/constants, and provenance, creating a new immutable copy/reference under the target attempt without mutating the source

#### Scenario: Scheduler reuse is prohibited
- **WHEN** a caller proposes to reuse `scheduler-cadence-deadline` or finalization sees a scheduler result without a target-attempt-native valid checkpoint chain
- **THEN** the protocol returns a stable typed rejection before writing a reuse result/reference and finalization fails; a successful selected scheduler arm is always freshly observed in the target attempt with its own bounded-valid immutable checkpoints

#### Scenario: Legacy mutable evidence remains bounded history
- **WHEN** pre-strategy failed, incomplete, mutable-ledger, checkpoint, or result paths are discovered
- **THEN** they and legacy `acceptance-run.json` are bounded-catalogued in place, excluded from automatic selection, never renamed/deleted/overwritten, and cannot block or satisfy `acceptance-run-v2.json`; only validated control copy/reference is permitted

#### Scenario: Controlled finalization selects exactly one attempt
- **WHEN** physical arms are ready for final acceptance
- **THEN** the controlled finalize operation explicitly selects one attempt ID, bounded-validates one complete launcher-owned summary, all three immutable arm result paths, and the target-native scheduler checkpoint chain against the same candidate, rejects missing/ambiguous/cross-attempt evidence, and solely creates `acceptance-run-v2.json` or exact-idempotently validates the same record; a different/incompatible v2 file fails, `seedAcceptanceRun` is absent, legacy v1 remains unchanged, and all unselected attempts remain history

#### Scenario: Canonical local evidence agrees with retained logs
- **WHEN** local native-Windows, injected-POSIX, syntax, lint, validation, or other gates are recorded
- **THEN** every platform/gate flag is derived from an explicit typed gate record, and final acceptance reopens and rehashes all five canonical complete-output files plus exit files, requiring their recorded byte counts, SHA-256 values, and zero exits; an intentionally empty success log is retained explicitly and any missing, changed, or contradictory file keeps local closure incomplete
