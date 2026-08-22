# Tasks — issue-revision-history-preservation

## 1. Continuity pins (spec: publishing preserves other nodes' observations)

- [x] 1.1 Temp-store fixture: revision N (node A terminal run-state, node B not-started),
      publish N+1 adding node C (new instance); assert the N+1 read reports A and B
      fact-for-fact identical to the N read (observation, runStatePath, locatedBy,
      attribution) and C not-started carrying no sibling observation.
- [x] 1.2 Lifecycle-change pin: N+1 marks A `superseded` with a recorded reason; assert A's
      terminal observation stays on its node line beside the lifecycle and reason, while
      phase/progress/ready-set exclude it (the exit vocabulary's superseded reason).
- [x] 1.3 Edge-change pin: N+1 adds an edge B→Z (Z non-terminal); assert B's observation
      unchanged and B's dependency facts now name Z.
- [x] 1.4 Write-nothing pin: publishing N+1 leaves every run-state file, the Issue record,
      and revision N byte-identical (hash before/after).
- [x] 1.5 Mutation check for 1.1: between the two readings, perturb A's run-state (advance
      a stage) and assert the pin DETECTS the observation change — proving it reads real
      evidence; restore and re-verify green.

## 2. Retarget lineage pins (spec: a retargeted node starts a new observation lineage)

- [x] 2.1 Refusal pin: author a revision redeclaring node X under project B while naming the
      instance committed under project A; assert publication refuses with
      `issue_reference_scope_conflict` naming node, declared project/line, committed
      project/line; no revision created.
- [x] 2.2 Fresh-lineage pin: revision N (X@A terminal), N+1 retargets X to project B with a
      new instance (no run-state, no archive); assert N+1 reads X not-started, the delta
      names the retarget with both projects, and revision N still reads X terminal under A
      (resolveExecutionPlan on the prior ordinal; assert via the same read confirm uses).
- [x] 2.3 Evidence-carrying instance pin: retarget naming an instance that already carries
      terminal run-state; assert N+1 reports the terminal observation attributed to the NEW
      instance's run-state location, never the prior lineage's.
- [x] 2.4 Intent-node pin: retarget an intent node; observation stays not-started; delta
      names the retarget with both projects.

## 3. Durable exclusions carry (spec: the record explains its own total)

- [x] 3.1 Types + schema: optional `exclusions` on `IssueAcceptedRecordV1`
      (`src/core/store/issues/types.ts`) and `AcceptedRecordSchema`
      (`src/core/store/issues/acceptance.ts`); each exclusion `{nodeId, lifecycle:
      'cancelled'|'superseded', reason}`; omit from the stored/digest canonical form when
      the array is empty (extend `acceptedRecordDigestBody` accordingly).
- [x] 3.2 `acceptIssue` (`src/core/issue-acceptance/orchestration.ts`) writes the gate
      evaluation's exclusions verbatim into the record.
- [x] 3.3 Read surfaces: `store issue acceptance` and `show`'s acceptance block present the
      record's carried exclusions beside the gate snapshot, human and `--json` parity.
- [x] 3.4 Byte-identity test: an accept with no exclusions produces bytes identical to the
      pre-field shape (construct the same accept under the old code path's expected bytes —
      or pin the exact serialized form — and compare).
- [x] 3.5 Compatibility tests: a pre-field record reads back with its digest verifying and
      no exclusions; a record with exclusions stripped from its bytes fails its digest
      (tamper path now covering the new field); an unrecognized extra field on the record is
      still refused (strictness kept).
- [x] 3.6 Carry test: accept over a plan with one superseded exclusion (reason names its
      successor); the record carries node/lifecycle/reason; both read forms present it.
- [x] 3.7 Mutation check: hand-craft the exclusion's reason wrongly in the record bytes and
      assert the digest refuses — the carry is covered, not decorative.

## 4. Superseded-exit totality pins (composed truths, verified together)

- [x] 4.1 One fixture walking the full supersede: N (X required, terminal run-state; Y
      required not-started), N+1 marks X superseded (reason names Y as successor) — assert
      in ONE test: ready answer names X's exit with reason; gate excludes X with reason and
      reports eligible once Y completes; delta names the lifecycle change; X's observation
      stays on its line; `confirm --revision` over N still composes X's terminal fact.

## 5. Close-out

- [x] 5.1 Focused suites green: issue-status, issue-acceptance, store-issue commands,
      store-v2 acceptance/query suites touching the record schema; full failure list from a
      captured log, never a truncated tail.
- [x] 5.2 Binned full-suite run per the ≤25 files/box recipe (Windows command-length and
      single-process constraints).
- [x] 5.3 Architecture-index sync only if module boundaries moved (expected: none — no new
      modules; verify the acceptance record fields are reflected wherever the record shape
      is documented, e.g. wire types if they mirror it).
