# Tasks — issue-ready-set-scheduling

## 1. Equivalence pins first (design D2)

- [x] 1.1 Add tests pinning `store issue start`'s candidate set on a multi-runnable plan (the
      several-candidates refusal's `candidates` array) and `confirm`'s launchable scope
      (contracts + unprepared) on the same fixture, asserting the two scopes agree today —
      the baseline the refactor must keep green without editing.
- [x] 1.2 Add the ready-set shape assertions as failing-first (or skip-marked) forms of the
      same fixtures: members, and per-non-member exit reasons per the spec vocabulary.

## 2. Archive-record basis threading (design D4)

- [x] 2.1 `readArchiveEntry` (`src/core/store/query/module.ts`): record which branch fired as
      additive `outcomeBasis: 'v2' | 'legacy' | 'invalid'` on `AggregateArchiveEntry`
      (`absent` and non-v2 shape → `legacy`; unparseable or schemaVersion-2-invalid →
      `invalid`; valid v2 → `v2`); `legacyRecord` display semantics unchanged.
- [x] 2.2 Thread `outcomeBasis` through `deriveReadiness` into `ResolvedPlanNode.resolution`
      (additive field beside `outcome`/`archived`); update `src/core/store/query/types.ts`
      and any wire-type mirrors that surface archive entries.
- [x] 2.3 Unit tests over a temp store covering all four null-outcome branches plus the valid
      v2 branch: basis values pinned per branch.

## 3. The projection ruling (design D3/D4, the MODIFIED spec)

- [x] 3.1 `observeNode` (`src/core/issue-status/projection.ts`): finalized branch becomes
      `archived ∧ outcomeBasis ≠ 'invalid'`; `legacy` basis finalizes with a diagnostic
      naming the legacy basis; `invalid` reports `unknown` with the new
      `invalid-archive-record` problem kind (types + problem-kind vocabulary in
      `src/core/issue-status/types.ts`).
- [x] 3.2 Tests pinning the ruling end-to-end on a temp store: an archived-legacy node counts
      toward progress, can carry the review phase, and releases a dependent node's
      `blockedBy`, with NO run-state located (the Issue #3 shape replayed — seeded archive
      entry with derived v2 identity and no v2 outcome).
- [x] 3.3 Fail-closed test: a schemaVersion-2 archive record that fails validation reports
      `unknown` + problem naming the file and reason, gates its dependents, and drives no
      phase/health/progress value.
- [x] 3.4 Confirm no stored bytes changed: pinned digest/byte-identity tests stay green
      untouched (no format change means no digest migration).

## 4. The ready-set derivation (design D1)

- [x] 4.1 `deriveIssueReadySet(status: IssueStatus)` in `src/core/issue-status/` (+ types:
      member entries with node id, project, line, alias, suggested pipeline, lifecycle;
      non-member exit reasons from the closed vocabulary — cancelled/superseded with
      recorded reason, intent pending Change creation, running with observation, failed,
      complete, blocked with per-blocker `issueBlockerState` naming, unknown with
      diagnostic); unreadable revision → no set.
- [x] 4.2 Unit tests per scenario of the new spec: serial chain head, cross-project release
      on completed work, parallel opportunities, determinism, unreadable revision, every
      exit-reason branch.

## 5. Compose the three surfaces (design D2)

- [x] 5.1 Refactor `binding.ts`'s `isRunnable`/frontier candidates to consume the shared
      derivation; observable refusal behavior byte-stable (task 1.1 stays green unedited).
      Round-1 carve-out: byte-stable holds for the fresh-launch/refusal scope; binding's
      input contract changed from recomputing the dependency gate to TRUSTING the
      projection rows' `blockedBy` (design D2's named invariant; prior-fixture disclosure
      in `evidence/fix-round-1.md`).
- [x] 5.2 Refactor `confirm.ts`'s classification to derive launchable scope from the ready
      set; task 1.1's confirm pin stays green unedited. Round-1 carve-out: one begun-node
      seam changes by design — a begun node with incomplete dependencies keeps its
      per-node resolution instead of landing in `waiting` (spec sentence in the
      `issue-execution-binding` delta + the round-1 covering fixture in the equivalence
      suite).
- [x] 5.3 Equivalence tests green: start candidates == ready members; confirm's fresh
      contracts + not-started unprepared == ready members (begun nodes' contracts and
      unprepared reports ride beside — the spec requirement pinned both ways).

## 6. The read verb (design D5)

- [x] 6.1 `rasen store issue ready <issue-id>` in `src/commands/store-issue.ts`: human
      rendering (ready members; non-members with reasons; visibility label; problems) and
      `--json` parity; planning refusal for no readable revision; write-nothing
      byte-identity test.
- [x] 6.2 Locale strings (en/ja/zh-cn) and completions sync (the three files `confirm`
      established); localized-command structure check passes.
- [x] 6.3 Read-only guard: extend `test/core/issue-status/issue-status-read-only-guard.test.ts`
      coverage to the new module and the CLI path.

## 7. Close-out

- [x] 7.1 Cross-project + legacy-release integration test on one temp store: two member
      projects, a seeded-legacy dependency in one releasing a downstream node in the other,
      ready answer naming member, blockers, and legacy basis.
- [x] 7.2 Focused suites green (`issue-status`, `issue-execution`, `store-aggregate-query`,
      `store-issue` commands, wire types); then the binned full-suite run per the ≤25
      files/box recipe — full failure list enumerated from a captured log, never inferred
      from a truncated tail.
- [x] 7.3 `architecture-index` sync: quick-locate rows for the ready-set derivation and the
      `ready` subcommand; module notes in `detail/modules/spec-store-engine.md`.
