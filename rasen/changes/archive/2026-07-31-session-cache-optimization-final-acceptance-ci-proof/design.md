## Context

The acceptance protocol intentionally separates three evidence domains:
canonical local gates, one selected physical attempt, and native exact-SHA CI.
`AcceptanceRunV2Schema` enforces that separation by making
`localEvidence.nativeLinux` the literal value `false`. `recordLocalEvidence`
also always preserves that value while deriving only native-Windows and
injected-POSIX claims from the five retained local gate records.

`collectSuccessfulCiEvidence` is the native-CI authority. It accepts only one
successful workflow for the controlled delivered SHA and repository, validates
the exact run and URL provenance, requires all five named jobs to succeed, then
writes strict successful CI evidence and advances `run.ciState` to
`successful`.

The contradiction is isolated to `assertFinalAcceptanceComplete`: its initial
guard requires `localEvidence.nativeLinux` to be truthy even though the schema
forbids that state. The later half of the same function already validates
successful current CI evidence and cross-binds it to the candidate and
delivered SHA.

## Goals / Non-Goals

**Goals:**

- Make E4 reachable only when the existing successful exact-SHA CI contract is
  satisfied.
- Preserve `localEvidence.nativeLinux: false` in schema, finalization, local
  evidence recording, and returned final state.
- Retain the dual check of `run.ciState` and the strict current
  `ci-evidence.json` document.
- Add focused regression coverage for both successful final closure and
  incomplete CI.
- Keep the repair acceptance-owned and force the repository candidate to be
  superseded after implementation.

**Non-Goals:**

- Add a native-Linux local gate or reinterpret injected POSIX coverage.
- Relax exact repository, SHA, workflow, run-attempt, URL, job-name, or job
  conclusion validation.
- Change physical attempt selection, local-log revalidation, authorization, or
  controlled delivery.
- Run physical observations, start a daemon or scheduler, mutate immutable
  attempts, push, open a PR, or collect remote evidence in this child.
- Edit product-owner code or the pre-existing untracked package lock.

## Decisions

### D1. Remove the impossible cross-domain predicate, not the truthful local claim

`assertFinalAcceptanceComplete` will stop requiring
`run.localEvidence.nativeLinux` as part of its initial completeness guard.
Every other prerequisite remains: selected physical evidence, native-Windows
and injected-POSIX local claims, physical retention, completed arms, no product
gaps, controlled delivery, and `run.ciState === "successful"`.

The local schema and writers remain unchanged, so a completed final state still
contains `localEvidence.nativeLinux: false`.

Alternative considered: set `nativeLinux` to `true` after CI. That would merge
remote evidence into a local-evidence namespace, contradict the literal schema,
and make local evidence claim a platform it did not execute on.

### D2. Native CI remains proven by both state and strict evidence

The existing two-layer CI validation remains authoritative:

1. the canonical v2 run must say `ciState: "successful"`; and
2. the current `ci-evidence.json` must strict-decode as `successful`, bind the
   same candidate fingerprint and delivered SHA, and carry the already
   validated exact workflow plus five ordered required job records.

The repair does not introduce a new flag, infer native CI from local platform
claims, or duplicate CI provenance logic in the final assertion.

Alternative considered: treat `ciState` alone as sufficient. That would allow
state/document drift and bypass the existing exact-SHA evidence cross-check.

### D3. Exercise the complete final assertion with deterministic protocol fixtures

Focused coverage will extend the existing protocol test that already creates a
complete immutable physical attempt, records all five local gates, authorizes
and records parent delivery, and builds valid GitHub workflow/job fixtures.

The test will:

- import and invoke `assertFinalAcceptanceComplete`;
- prove pending/incomplete CI keeps final acceptance incomplete;
- collect the successful exact-SHA five-job record;
- prove final acceptance succeeds while the returned
  `localEvidence.nativeLinux` remains `false`; and
- cover a missing or unsuccessful required job as incomplete CI without
  changing local evidence.

The fixtures use only temporary directories and deterministic records. They do
not read or modify the canonical external physical-attempt directory.

Alternative considered: test only the removed boolean expression. That would
not prove that current CI state/document binding still gates the end-to-end
final assertion.

### D4. Treat the repair as a new candidate

Because `protocol.mjs`, its focused test, and this change package alter the
repository tree, the existing frozen candidate and every prior physical
attempt remain immutable history. After implementation, local verification,
and independent review, the parent must update its manifests and freeze a new
exact tree before any later coordinated physical run.

Alternative considered: call the repair process-only and retain the old
candidate. That would make physical and CI evidence refer to code that does not
contain the repaired final gate.

## Risks / Trade-offs

- **[Removing one predicate could appear to weaken native proof]** → Keep both
  `run.ciState` and strict current CI document checks, and assert the successful
  five-job path end to end.
- **[A positive-only regression could miss pending/failed behavior]** → Add an
  explicit incomplete-CI assertion before or alongside the successful path.
- **[The repository mutation invalidates accumulated physical work]** →
  Preserve all attempts as immutable history and communicate that the later
  user-coordinated physical run must target the new freeze.
- **[Scope could drift into evidence collection]** → Limit implementation to
  the acceptance protocol assertion, focused test, and this change package.

## Migration Plan

1. Update the final assertion without changing evidence schemas or writers.
2. Add focused positive and incomplete-CI regression cases.
3. Run only the invalidated focused local verification during implementation
   and obtain independent non-author review.
4. Locally deliver/archive the child, update parent portfolio/manifests, and
   freeze a new candidate.
5. Leave physical E1, parent delivery, exact-SHA CI, and final archive for the
   later coordinated gate sequence.

Rollback removes the assertion/test delta and this child package before a new
candidate is frozen. No external evidence migration is required because this
change never mutates immutable attempts.

## Open Questions

None. The evidence authorities and required CI job list are already defined by
the accepted protocol.
