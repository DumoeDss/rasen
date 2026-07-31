# Session cache acceptance protocol

This directory defines the repository-owned half of
`rasen-session-cache-acceptance/2`. Result-bearing records live in the
canonical external Rasen work directory.

## Immutable physical attempts

Every physical launch creates a never-reused UUID generation:

```text
attempts/<attemptId>/
  intent.json
  summary.json
  arms/<armId>/
    checkpoints/00000001.json
    checkpoints/00000002.json
    events/00000001.json
    result.json
    product-gap.json       # only when a bounded product gap occurs
    reuse.json             # only for a validated immutable copy
```

The launcher is the only writer of its create-once `intent.json` and
`summary.json`. Each observer is the only writer of one named arm subtree.
Checkpoints and events are monotonically named create-once files; each arm
result is create-once. Observers never write legacy `acceptance-run.json`,
canonical `acceptance-run-v2.json`, another arm, or another attempt.

There is no acceptance filesystem lock, mutation guard, stale reclaim, release,
or shared observer ledger. Concurrent launchers create different attempt IDs.
Immediately before product dispatch, every observer repeats the live capacity
and product-owned admission checks. A losing observer writes an immutable
pre-dispatch inconclusive result and never calls Claude.

The controlled parent finalizer explicitly selects one complete attempt:

```text
RASEN_SESSION_CACHE_PARENT_CONTROLLED=1 node \
  scripts/session-cache-acceptance/parent-delivery.mjs \
  --repository-root <candidate-worktree> \
  --work-dir <canonical-external-work-dir> \
  --ownership-manifest <ownership-manifest.json> \
  --delivery-manifest <delivery-manifest.json> \
  --finalize-attempt --attempt-id <attemptId>
```

It bounded no-follow reads the selected intent, summary, and three exact result
paths, validates their full candidate/identity/policy/provenance bindings, and
only then creates `acceptance-run-v2.json`. An exact existing v2 record is
validated idempotently; an incompatible or different record fails. Legacy
`acceptance-run.json` remains bounded byte-immutable history and is never
parsed as v2. Other complete, incomplete, failed, or inconclusive attempts
remain immutable unselected history.

A completed control arm can be reused only when its bounded immutable result,
candidate, identity, `OBSERVATION_ARMS` policy/constants, and provenance
validate. Reuse creates `reuse.json` plus a new immutable result copy under the
new attempt; the source bytes never change. Scheduler reuse is rejected before
any target-arm write, and finalization requires a target-native scheduler
result plus its bounded-valid immutable checkpoint chain. Pre-strategy
`observations/`, `history/`, physical configs, and the historical
`7af1e71b...` generation are bounded-catalogued in place, excluded from
automatic selection, and never renamed, deleted, or overwritten.

## Physical observation

The three exact arms are `control-hit-55m`, `control-miss-65m`, and
`scheduler-cadence-deadline`. Preparation creates their exact canonical Runs,
reconciler-admitted actions, isolated Git workspaces, candidate/build/Claude
fingerprints, and diagnostic live-capacity proof:

```text
node scripts/session-cache-acceptance/prepare-physical.mjs \
  --repository-root <candidate-worktree> \
  --work-dir <canonical-external-work-dir> \
  --rasen-home <daemon-rasen-home> \
  --claude-bin <exact-claude-executable-or-shim> \
  --claude-home <home-containing-.claude>
```

Launch all three with the explicit real-time opt-in:

```text
RASEN_SESSION_CACHE_REAL_OBSERVATION=1 node \
  scripts/session-cache-acceptance/launch-physical.mjs \
  --work-dir <canonical-external-work-dir>
```

The scheduler `startedAt` checkpoint is created before bootstrap, transcript
baseline capture, or eligibility. Its checkpoint sequence restores that exact
start and derives the 5-minute cadence and 10-minute deadline-application
tolerances directly from immutable `OBSERVATION_ARMS`. A result and checkpoint
that agree with each other on altered values still fail.

The scheduler result proves this complete order:

```text
startedAt <= eligibilityAt <= touchAt <= touchSettledAt
  <= configuredDeadlineAt <= deadlineAppliedAt <= endedAt
```

It also binds the exact transcript-derived touch/assistant/result chain,
durable wake, preterminal owner history, and production-valid terminal owner
absence. Controls retain bounded raw usage counters and exact live owner,
host, PID, and process-creation bindings. Identity or clock ambiguity is
inconclusive, never a forced hit/miss.

## Candidate ownership and parent delivery

The ownership audit derives the full baseline-to-index/worktree change set and
requires exact agreement with `delivery-manifest.json` and
`ownership-manifest.json`:

```text
node scripts/session-cache-acceptance/ownership-audit.mjs \
  --repository-root <candidate-worktree> \
  --baseline-ref <frozen-baseline-sha>
```

Product files, ECP Direction, every package lock, omitted paths, and
unclassified paths fail closed. The pre-existing untracked
`packages/ui/package-lock.json` is excluded and must never be staged.

Remote mutation remains default-denied. The controlled parent first freezes the
exact audited tracked delivery tree, then finalizes one physical attempt. Only
after physical acceptance and explicit authorization may it record the single
portfolio delivery. The delivered commit tree must equal the frozen tree.

## Exact-SHA CI and local evidence

`ci-evidence.mjs` seeds pending state or validates bounded GitHub REST snapshots
for one exact delivered SHA, repository, run, attempt, and these five literal
job names:

- `Test (linux-bash)`
- `Test (linux-bash-node24)`
- `Test (windows-pwsh-shard-1)`
- `Test (windows-pwsh-shard-2)`
- `Test (windows-pwsh-shard-3)`

The collector is read-only with respect to GitHub. Partial-child, different-SHA,
emulated, enriched, URL-spliced, missing, duplicate, or non-success evidence
cannot close acceptance.

The five local gates are typed evidence. Final acceptance reopens and rehashes
all five retained output/exit pairs and requires zero exits. Native Windows and
injected POSIX local claims never imply native Linux CI or physical retention.
