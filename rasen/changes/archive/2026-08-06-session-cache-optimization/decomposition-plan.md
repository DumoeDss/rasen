# Decomposition plan — session cache optimization

## Portfolio DAG

```text
host-lifecycle
      |
registry-recovery
     / \
cli-surface   touch-scheduler
     \ /
acceptance-evidence
```

## Children

### 1. `session-cache-optimization-host-lifecycle`

Deliver the live stream-json process lifecycle in the existing management API
supervisor: create, repeated wake, single-flight rejection, clean retire, and
resume-based recovery after process loss.

Primary ownership:

- `src/core/management-api/supervisor.ts`
- narrowly related management API host types
- focused supervisor/session-host lifecycle tests

Must not persist the full registry schema or add the public `rasen session`
command surface yet.

### 2. `session-cache-optimization-registry-recovery`

Depends on `host-lifecycle`.

Persist `rasen-session-registry/1` beside run state, including host identity,
cwd, pid/session identity, state, touch policy, wake ledger, bounded
retry-on-lock, atomic replacement, and recovery/reconciliation against live
process/transcript facts.

Primary ownership:

- `src/core/management-api/session-registry.ts` and narrowly related API types
- registry/recovery tests

### 3. `session-cache-optimization-cli-surface`

Depends on `registry-recovery`.

Expose `rasen session exec|list|retire` with stable JSON/human output, complete
Commander structure, shell completion metadata, and English/Japanese/Chinese
catalog entries.

Primary ownership:

- `src/commands/session.ts`
- `src/cli/index.ts`
- `src/core/completions/command-registry.ts`
- `src/locales/{en,ja,zh-cn}.json`
- reusable-session service/protocol ownership in
  `src/core/management-api/reusable-session-api.ts`, `router.ts`, `server.ts`,
  and `wire-types.ts`
- a narrow additive conditional-wake/touch-metadata seam in
  `src/core/management-api/durable-session-registry.ts`
- `src/core/management-api/daemon-probe.ts`, including affirmative-absence
  classification, identified-daemon outer kill grace, and port-free budget
- `test/core/management-api/daemon-probe.test.ts`
- command, completion, presentation, and catalog tests

This child uniquely owns the authenticated `rasen-reusable-session-api/1`
loopback protocol. It supplies conditional coordinator wake and touch-policy
mutation plus durable touch ordinal/attempt accounting for the sibling
scheduler, but it does not own any timer, eligibility policy, backoff loop, or
daemon bootstrap. It does not edit `src/commands/daemon.ts` or
`src/locales/index.ts`.

### 4. `session-cache-optimization-touch-scheduler`

Depends on `registry-recovery`.

Add the daemon-side mechanical scheduler that reuses the normal wake path and
single-flight lock, touches only eligible idle sessions near the configured
window, rechecks state before execution, respects deadline/maxTouches and
sleep-gap cold handling, and degrades safely when the daemon is absent.

Primary ownership:

- new `src/core/management-api/session-touch-scheduler.ts`
- `src/commands/daemon.ts`
- new `test/core/management-api/session-touch-scheduler.test.ts`
- new `test/commands/daemon-touch-scheduler.test.ts`

This child calls the CLI-owned authenticated loopback protocol as a client and
tests itself with an injected fake service. It must not edit CLI command
registration, completion registry, locale catalogs or index, management
router/server/wire types, durable coordinator/registry, or
`src/core/management-api/daemon-probe.ts`. It consumes the probe's shutdown
constants read-only. That file-level separation is the positive independence
proof for parallel execution with `cli-surface`.

### Parallel ownership matrix

| Implementation surface | Unique owner | Other child contract |
|---|---|---|
| `src/cli/index.ts`, `src/commands/session.ts` | `cli-surface` | scheduler read/write forbidden |
| completion registry and three locale catalogs | `cli-surface` | scheduler read/write forbidden; locale index remains read-only |
| reusable-session router/server/wire service | `cli-surface` | scheduler calls frozen HTTP schema only |
| conditional durable wake, touch-policy, and touch ledger seam | `cli-surface` | scheduler never imports or edits the registry |
| `src/core/management-api/daemon-probe.ts` and its focused test | `cli-surface` | scheduler read/write forbidden; constants/results are read-only |
| `src/core/management-api/session-touch-scheduler.ts` | `touch-scheduler` | CLI read/write forbidden |
| `src/commands/daemon.ts` | `touch-scheduler` | CLI read/write forbidden |
| focused child tests | owning child by path declared above | no shared test file |

The shared seam is a versioned bearer-authenticated loopback protocol, not a
shared implementation file. If either implementer needs the other child's
unique file, Tier-A parallelism is revoked and that work is serialized.

### 5. `session-cache-optimization-acceptance-evidence`

Depends on both `cli-surface` and `touch-scheduler`.

Prove the complete P1 contract: create→wake×N→touch→retire, concurrent wake
rejection, retired wake rejection, registry/transcript agreement, recovery
after host loss, real cadence/deadline behavior, and correct operation with the
daemon off. Cover the six reconciler-supported built-in pipelines; retain the
designed `auto-decompose` fail-closed behavior. Insert the delivered session
execution layer into the architecture documentation's reserved section.

Primary ownership:

- integration/E2E/durability tests and fixtures
- `docs/architecture/executable-composite-pipelines.md`
- acceptance evidence artifact(s) under this child change
- exact-tree cross-platform delivery evidence: the final integrated commit SHA,
  existing GitHub CI run URLs, successful `linux-bash` and
  `linux-bash-node24` jobs, and every Windows PowerShell shard

Implementation gaps found here route back to the owning child rather than being
silently patched into the evidence slice.

This child inherits registry review P2 as a portfolio delivery gate, not as
permission to weaken it. Native Windows focused coverage plus injected POSIX
semantics can close the registry child's local task, but they are not real
POSIX CI. Acceptance remains incomplete until the existing GitHub matrix is
green on the final exact tree; evidence from another SHA, local emulation, or a
partial child push is insufficient.

## Execution policy

- `host-lifecycle` and `registry-recovery` run strictly serially.
- After `registry-recovery` is implementation-complete and review-clean,
  `cli-surface` and `touch-scheduler` may run in parallel under Tier A because
  their declared implementation files do not overlap.
- `acceptance-evidence` starts only after both parallel children are
  implementation-complete and review-clean.
- Each child uses `small-feature`, ships locally, and is archived only as
  allowed by its recorded local delivery. The parent performs the single
  portfolio-level delivery.
- Once the acceptance slice has integrated all children and its local gates are
  green, the parent may create one explicitly authorized exact-tree Draft PR
  while physical E1 is deferred. The Draft PR is review-only, remains unmerged,
  and does not count as E2 or native CI. E1 later binds that same PR head; after
  E1 the parent authorizes E2, marks only that unchanged PR head ready, and the
  acceptance slice records the exact SHA and run URLs. It does not complete
  until all required Windows and POSIX jobs pass. Any tree/head change repeats
  freeze and E1.

## LEAD self-audit

- Slice coherence: each child has one observable product responsibility and a
  bounded primary file set.
- DAG correctness: every consumer waits for the host/registry contracts it
  needs; the merge-node acceptance slice waits for both public control and
  scheduler paths.
- Independence: only `cli-surface` and `touch-scheduler` qualify, based on
  explicit non-overlapping implementation ownership. Any scope drift removes
  parallel eligibility.
- Recursion: children use decompose-free `small-feature`.
- Safety: uncertain overlap is serialized; no child pushes independently.
- Evidence ownership: child-local platform injection proves deterministic
  branches only; final native Windows/POSIX matrix evidence belongs to the
  acceptance merge node and parent delivery.
