# Fix round 1 — issue-ready-set-scheduling (implementer, 2026-08-22)

Four findings from `evidence/review-report.md` (0 Blocker / 2 Major / 2 Minor),
all fixed. Per item: what changed, where, the pin, and the numbers.

## MAJOR-1 — the equivalence wording overstated confirm's contract set

- **What**: The ADDED requirement said the ready set is "exactly the nodes
  `confirm` composes a launch contract or an unprepared report for" — literally
  false for begun nodes (confirm emits resume/report contracts beside the
  fresh scope). Qualified to fresh-launch scope.
- **Where**:
  `rasen/changes/issue-ready-set-scheduling/specs/issue-ready-set-scheduling/spec.md`
  — the requirement paragraph now says "composes a FRESH launch contract or an
  unprepared report for, its resume-oriented and report-only contracts for
  begun nodes riding beside that equivalence and never inside it"; the
  scenario "Confirm's launchable scope equals the ready set" now says "fresh
  launch contracts" and carries the ride-beside AND clause. Requirement title
  byte-stable; the other scenario untouched.
- **Pin**: the equivalence suite's both-way tests already asserted the
  narrowed claim (`mode === 'fresh'` filter); the spec now says what the pins
  assert. No code change.
- **Numbers**: equivalence suite solo — 12 passed, exit 0.

## MAJOR-2 — the begun-node seam made honest (spec + pin + carve-out)

- **What**: Pre-refactor, a begun wanted node with an incomplete dependency
  landed in confirm's `waiting`; the refactor routes it to its per-node
  resolution (resume/report contract, or unprepared). The reviewer judged the
  NEW behavior arguably right; it is now stated, pinned, and disclosed.
- **Where (a) spec sentence**:
  `specs/issue-execution-binding/spec.md` (NEW delta file in this change) —
  MODIFIED requirement "Confirming a plan composes the launch contract set"
  gains one sentence: "A node the plan still wants whose observation is
  anything other than `not-started` SHALL receive that same per-node
  resolution regardless of its dependencies' observed state — dependency
  gating applies to fresh launches, and a begun node is reported as what it is
  (a resume-oriented or report-only contract, or an unprepared report), never
  as waiting." — plus one new scenario ("A begun node keeps its per-node
  resolution over an incomplete dependency"). The four existing scenario
  titles are preserved byte-for-byte.
- **Where (b) covering fixture**:
  `test/core/issue-execution/issue-ready-set-equivalence.test.ts` — new
  describe "a begun node keeps its per-node resolution over an incomplete
  dependency", the probe receipt's exact shape: in-flight `g-run` depending on
  not-started `g-up` → `contracts [[g-up, fresh], [g-run, already-running]]`,
  `waiting []`, `unprepared []`; and the ready answer agrees (members
  `[g-up]`, exits `[{g-run, running(in-flight)}]`).
- **Where (c) carve-outs**: `proposal.md` Impact bullet (behavior-preserving
  scoped to fresh-launch, seam named); `design.md` D2 (the seam paragraph +
  the named invariant, below) and the D2 risk entry (pin-first covered the
  fresh seam; this seam had no pin); `tasks.md` 5.1/5.2 round-1 notes.
- **Pin**: the fixture above; no production code changed this round.
- **Numbers**: equivalence solo 12 passed (exit 0); issue-execution family 4
  files / 67 passed (exit 0) — 66 pre-round + the new fixture.

## MINOR-3 — prior-fixture disclosure: binding now TRUSTS `status.blockedBy`

- **What**: An input-contract change the design did not originally name:
  `binding.ts`'s frontier and `confirm.ts`'s launchable partition consume the
  projection rows' `blockedBy` (one derivation, one truth source) instead of
  recomputing work-completeness from the observations. Every production caller
  feeds projection-derived rows (`withBlockerFacts` is the sole writer), so
  the biconditional "`blockedBy` empty ⟺ every dependency's observed work
  complete" holds by construction; synthetic fixtures that hand-plant rows
  must honor it. Design D2 now names this invariant explicitly.
- **Where (the exact prior fixtures rewritten)**:
  `test/core/issue-execution/issue-execution-binding.test.ts` —
  1. `baseInput()` — g-002/g-003 rows gained projection-consistent
     `blockedBy` (not-started deps listed);
  2. "refuses naming why when no node is runnable" — g-002/g-003 rows gained
     `blockedBy` (in-flight g-001 listed);
  3. "falls back to the pipeline the located run-state records" — the status
     override rows gained `blockedBy`;
  4. "runs a dependent whose dependency is terminal-but-unarchived ... (D3
     pin)" — the deliberately-stale planted `blockedBy` rows (a terminal
     dependency listed) were rewritten to the current projection shape
     (terminal deps not listed). The pin's discriminating half is intact and
     commented: the plan read's ARCHIVE-based `blockedBy` is still planted
     non-empty, and keying the gate on it still fails the test;
  5. the `crossInput` helper — g-down's row derives `blockedBy` from the
     upstream observation.

  `test/core/issue-execution/issue-execution-confirm.test.ts` — the
  `nodeStatus` helper gained a `blockedBy` extra; "reports a wanted node
  waiting on dependency work instead of a contract" plants the in-flight
  blocker. All assertions in both files unedited.
- **Pin**: the equivalence suite pins the trust (the reviewer's own mutation —
  frontier on a private copy ignoring `blockedBy` — failed 20 tests); the
  read-only guard pins `ready-set.ts` into the walked, write-free set.
- **Numbers**: binding + confirm suites 48 passed inside the family run above
  (exit 0).

## MINOR-4 — evidence receipts completed

- **What**: `local-gates.md` corrections.
- **Where**: bin-03 row now carries its own receipt (20 files / 293 passed /
  exit 0, captured in `evidence/bin-summaries.txt` alongside bins 00–02); the
  reviewer's independent four-bin run (83 files / 1506 passed + 2 skipped) is
  recorded with attribution to `review-report.md`; the issue-execution row is
  corrected 63 → 66 (the 63 predates the task-5.3 both-way tests landing) and
  now runs 67 with the round-1 fixture.
- **Pin**: `evidence/bin-summaries.txt` (all four captured summaries), the
  reviewer's table in `review-report.md`.
- **Numbers**: see both.

## Round-1 gates (all real exit codes, never piped)

| Gate | Result | Exit |
| --- | --- | --- |
| `pnpm run build` | dist rebuilt | 0 |
| `test/core/issue-execution/issue-ready-set-equivalence.test.ts` solo | 12 passed | 0 |
| `test/core/issue-execution/` family solo | 4 files / 67 passed | 0 |
| `issue-ready-set.test.ts` + `issue-status-legacy-archive-ruling.test.ts` solo | 12 passed | 0 |
| `store-issue-ready-cli` + `store-issue-confirm-cli` solo | 8 passed | 0 |
| `node bin/rasen.js validate issue-ready-set-scheduling` | valid (incl. the new third delta file) | 0 |
| fences (`src/core/pipeline-registry/`, `pipelines/`, `packages/ui`, `package.json`) | 0 bytes | — |

No production source changed this round; the deltas are spec text, docs
(proposal/design/tasks), one new test fixture, and evidence receipts.

## Round-1b — Major 5, the unprepared arm of the same seam

- **What**: The round-1 qualification was still literally false on its
  UNPREPARED arm — a wanted node reading `unknown` (corrupt run-state, or this
  change's own `invalid-archive-record` world) skips confirm's waiting gate,
  reaches `resolveIssueLaunchBinding`, and lands in `report.unprepared`
  WITHOUT being a ready member, while the ride-beside clause named CONTRACTS
  only and the sibling `issue-execution-binding` delta already lists "an
  unprepared report" as a begun-node outcome. Reviewer reproduction: fresh
  [], unprepared [g-broken], waiting [g-down], members [].
- **Where**: `specs/issue-ready-set-scheduling/spec.md` — the requirement's
  equivalence clause now reads "...exactly the nodes `rasen store issue
  confirm` composes a FRESH launch contract or an unprepared report for among
  its not-started nodes, its resume-oriented contracts, report-only
  contracts, and unprepared reports for begun nodes riding beside that
  equivalence and never inside it...", and the scenario's arm reads "...the
  nodes it reports unprepared for a fresh launch..." with the ride-beside AND
  clause extended to "or its unprepared report". `tasks.md` 5.3 carries the
  qualified form ("confirm's fresh contracts + not-started unprepared ==
  ready members; begun nodes' contracts and unprepared reports ride beside").
  Requirement and scenario titles byte-stable; no code, no tests, no
  behavior.
- **Pin**: the disclosed, round-1-pinned design itself (the begun-node
  fixture and the reviewer's mutation check — regressing to the old
  `blocked.length > 0` partition fails 7 of 12 in the equivalence suite).
- **Numbers**: `validate issue-ready-set-scheduling` exit 0 (3 delta files);
  fences 0 bytes.
