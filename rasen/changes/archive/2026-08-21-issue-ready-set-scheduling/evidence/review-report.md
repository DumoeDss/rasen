# Review report — issue-ready-set-scheduling (VERIFY, independent reviewer, 2026-08-22)

Reviewer: reviewer-ready-set (dispatched). All runs on the `feat/issue-phase5`
worktree at the uncommitted delta over base `3f2d1067`, Windows, real exit
codes captured from the shell (never from a pipe tail). Report-only.

## Verdict

**0 Blocker, 2 Major, 2 Minor, 2 Notes.** The ruling sweep itself is sound:
the basis split is correct and fail-closed, nothing is minted on any read
path, the zero-mirror release reproduces independently, the three surfaces
consume one derivation with real tripwires, and the query's own readiness is
untouched. The two Majors are both about the same seam — what confirm does
with BEGUN nodes — one in the spec's wording, one in the behavior.

## Findings

### Major 1 — the spec's headline equivalence overstates: confirm's contracts include begun nodes, only the FRESH scope equals the ready set

- Where: `specs/issue-ready-set-scheduling/spec.md:140` ("exactly the nodes
  `rasen store issue confirm` composes a launch contract or an unprepared
  report for") and `:154-159` (Scenario: Confirm's launchable scope equals the
  ready set).
- Fact: confirm composes resume/report-only contracts (`mode:
  'already-running'` / `'already-complete'`) for begun wanted nodes whose
  dependencies are complete. Those nodes are in `report.contracts` and are NOT
  ready-set members. The suite itself pins the narrowed claim —
  `test/core/issue-execution/issue-ready-set-equivalence.test.ts:602-612`
  filters `binding.mode === 'fresh'` with the comment "the begun g-001 keeps
  its report-only contract beside it, never inside the equivalence".
- Reproduced (reviewer probe, serial shape with g-001 run-terminal):
  contracts = `[g-001 (already-complete), g-002 (fresh)]`, members = `[g-002]`.
  The scenario's THEN clause is literally false on that fixture; a conformance
  test written verbatim from the scenario fails, and the next consumer
  (g-003's Needs-Attention grouping) inherits an ambiguity about what
  `contracts` means.
- Fix: qualify the requirement and scenario to "fresh launch contract" /
  "launchable scope" (one-line spec edit), matching what the pins actually
  assert. No code change implied.

### Major 2 — undisclosed behavior change in confirm: a BEGUN node with incomplete dependencies moves from `waiting` to a contract

- Where: `src/core/issue-execution/confirm.ts:158-172` — the new gate is
  `observation === 'not-started' && !memberIds.has(nodeId)`. The pre-refactor
  code (`git show 3f2d1067:src/core/issue-execution/confirm.ts`, verbatim
  read) gated ONLY on `blocked.length > 0` with no observation check.
- Old behavior: an in-flight / finalized / unknown wanted node with an
  incomplete dependency → `waiting` ("awaits g-up@app-a (not-started)").
  New behavior: it falls through to `resolveIssueLaunchBinding` → resume
  contract (`already-running`), report contract (`already-complete`), or
  `unprepared` (unknown).
- Reproduced (reviewer probe): g-up not-started, g-run in-flight depending on
  g-up → `contracts: [[g-up, fresh], [g-run, already-running]], waiting: []`.
  Old code provably reported `waiting: [g-run "awaits g-up@app-a
  (not-started)"]`.
- Reachable: a re-plan that adds a dependency edge to a begun node (exactly
  this portfolio's replanning world), or a dependency whose observation
  regresses to unknown (e.g. this same change's `invalid` archive basis).
- Why Major: the proposal ("behavior-preserving refactor"), design D2
  ("The refactor is behavior-preserving"), and task 5.1 ("observable refusal
  behavior byte-stable") are all false in this corner, and NO pin covers it —
  the fixture-coincides shape this portfolio's discipline exists to catch. The
  new classification is arguably the more sensible one (a running node is not
  "waiting"; it also matches the ready answer's `running` exit) — but it is a
  change, so it needs either a deliberate spec sentence plus a covering
  fixture in the equivalence suite, or a restoration of the old partition.
  Either way the behavior-preservation claims in proposal/design/tasks must
  stop saying "byte-stable" without the begun-node carve-out.

### Minor 3 — prior-test containment: `issue-execution-binding.test.ts` fixtures were edited beyond the pin-first class, forced by an input-contract change the design did not name

- Where: `test/core/issue-execution/issue-execution-binding.test.ts` —
  `baseInput` and three more fixtures gained `blockedBy` rows, and the
  deliberately-stale-rows test at (current) `:382-403` was REWRITTEN: it
  previously planted stale archive-shaped `blockedBy` to pin that binding
  IGNORED the status rows' dependency-facts array; binding now TRUSTS it.
- The edits were forced, not optional: under the new frontier, a not-started
  row with empty `blockedBy` is a member regardless of plan deps, so every
  old hand-built fixture would have failed. The surviving discriminating half
  (against the PLAN READ's archive-based `blockedBy`) is intact and commented.
- Why only Minor: the trust shift IS design D1/D2 ("`blockedBy` empty IS the
  dependency clause"), all production callers feed projection-derived rows
  (`withBlockerFacts` sole writer), and the read-only guard now pins
  `ready-set.ts` into the no-write scan. But the review charter sanctions
  only pin-first prior edits, and the design/proposal never disclose that
  binding's input contract changed from "recompute from observations" to
  "trust the projection rows" — that disclosure (and the fixture-edit class)
  belongs on the record. Suggest one sentence in design D2 naming the
  invariant the equivalence now rests on.

### Minor 4 — evidence receipts incomplete in `evidence/local-gates.md`

- The store-family binned table's bin-03 row reads "(see receipt)" for both
  tests and exit; no receipt exists — `evidence/` holds exactly four files
  (local-gates.md, zero-mirror-acceptance.txt, validate.txt,
  implementer-findings.md), and the header's "Full logs kept beside this file
  where noted" is true of none of them.
- The issue-execution group is recorded as 63 tests; the tree runs 66 (the
  three task-5.3 both-way equivalence tests postdate the table or were
  miscounted).
- Closed independently: this reviewer re-ran the full store family in four
  ≤25-file bins — 83 files, 1506 passed + 2 skipped, every bin exit 0 — and
  the issue-execution family (66 passed, exit 0). Bookkeeping only.

### Note 5 — `dist/` older than one src file at review time

`src/core/issue-status/ready-set.ts` (mtime 06:00) postdates the dist build
(05:38) the CLI receipts ran against. The compiled
`dist/core/issue-status/ready-set.js` was compared and is semantically
identical to current src, and this reviewer's own CLI reproduction used the
same dist with matching behavior — no action. If anything touches src before
ship, rebuild before the CLI suites.

### Note 6 — pin-first ordering is attested, not git-verifiable

The whole delta is one uncommitted working tree, so "pins verified green
against the UNREFACTORED code before the refactor ran" cannot be checked from
git history — it rests on the local-gates attestation and the suite's own
comments. If the ship lands as a single commit, that audit trail stays
attestation-only; a two-commit split (pins, then refactor) would make the
discipline verifiable.

## The ruling sweep — verified

1. **Basis split** (`src/core/store/query/module.ts:436-498`): record-absent →
   `legacy`; non-schemaVersion-2 → `legacy`; unparseable JSON → `invalid`
   (with reason); v2-fails-validation → `invalid` (with reason); valid v2 →
   `v2`. `legacyRecord` display boolean unchanged on all four null-outcome
   branches. Pinned branch-by-branch on BOTH surfaces (grouped entries and
   plan resolutions) by `store-archive-outcome-basis.test.ts`, including the
   query's own readiness staying archive-outcome based. Matches design D4 and
   tasks 2.1 exactly.
2. **Projection ruling** (`src/core/issue-status/projection.ts:487-514`):
   `invalid` → `unknown` + `invalid-archive-record` problem naming file
   (ref) and reason, BEFORE the finalized branch; `legacy` → `finalized` with
   the named-basis diagnostic; `v2`/outcome → unchanged; basis absent →
   pre-ruling behavior. The unresolved/ambiguous guard runs BEFORE the basis
   branches, so a scope conflict still reports ambiguous-reference.
   `invalid-archive-record` also joins the problem kinds excluded from the
   acceptance block's gate input list (projection.ts:1045-1050), so damaged
   evidence cannot silently pass the gate.
3. **Nothing minted at seed/read time**: no write call anywhere on the read
   paths; `issue-status-read-only-guard.test.ts` now pins `ready-set.ts` into
   the walked, write-free set; the ready CLI suite and this reviewer's
   reproduction both fingerprinted Store + global data dir byte-identical
   across reads. The outcome column stays null on every legacy/invalid
   branch — no outcome value is invented anywhere.
4. **Zero-mirror acceptance — independently reproduced (PASS)**: reviewer-built
   fixture (own seeds/ids; plan published via the module API, read via the
   REAL CLI from a nowhere directory): seeded-legacy dependency in project B
   (no archive.json at all) releases the downstream node in project A as the
   sole ready member; the dependency exits `complete` with the legacy basis
   named; `runStateVisibility: none`; ZERO run-state files anywhere under the
   fixture world before and after; Store + data-dir fingerprints unchanged.
   Matches the shipped `zero-mirror-acceptance.txt` shape.
5. **One derivation, three consumers**: `ready-set.ts` is the single
   implementation; `binding.ts` (frontier), `confirm.ts` (launchable scope),
   and the `ready` verb all call the exported `deriveIssueReadySet`
   (binding.ts:316-320, confirm.ts:135-139, store-issue.ts ready action).
   Membership `wanted ∧ not-started ∧ blockedBy empty` is propositionally the
   old `isRunnable` clause given `withBlockerFacts`'s sole-writer rule
   (isTerminal = finalized | run-terminal; undefined fail-closes).
6. **Query untouched**: `deriveReadiness`'s own `readiness`/`readyToResolve`
   computation unchanged (only the additive basis spread); pinned by the
   outcome-basis suite's final block.
7. **Mutation spot-checks (all caught, all reverted, post-mutation regression
   green)**:
   - Flip the split (invalid finalizes like legacy): the task-3.3 fail-closed
     test FAILS (1 failure) — the guard has discriminating power.
   - Drop the cancelled exit's recorded reason: 2 tests FAIL (ready-set unit
     + equivalence shape).
   - Point the frontier at a private copy ignoring `blockedBy`: 20 tests FAIL
     (equivalence pins + binding suite). (A first vacuous mutation that
     reduced to identity passed 66/66 — noted as a reviewer artifact, then
     replaced with the real one.)

## Numbers run (all real exit codes, never piped)

| Batch | Files | Tests | Exit |
| --- | --- | --- | --- |
| new suites (issue-ready-set, legacy-archive-ruling, store-archive-outcome-basis) | 3 | 13 | 0 |
| issue-execution family (pins + equivalence) | 4 | 66 | 0 |
| store-issue-ready-cli (real CLI) | 1 | 3 | 0 |
| `test/core/issue-status/` (whole dir, incl. extended guard) | 12 | 74 | 0 |
| digest anchors + wire mirror + aggregate query + query guard | 4 | 55 | 0 |
| store-issue CLI suites (start/confirm/status/lifecycle/acceptance/target-project/aggregate) | 8 | 47 | 0 |
| completions + cli-locale | 12 | 322 + 13 skipped | 0 |
| store family, reviewer bins ≤25 (21/21/21/20) | 83 | 1506 + 2 skipped | 0 |
| query consumers (issue-publication + issue-acceptance) | 5 | 45 | 0 |
| post-mutation regression (issue-execution + issue-status) | 16 | 140 | 0 |

Also: `node bin/rasen.js validate issue-ready-set-scheduling` exit 0; fences
(`src/core/pipeline-registry/`, `pipelines/`, `packages/ui`, `package.json`)
diff 0 bytes; MODIFIED delta preserves the five current scenario titles
byte-for-byte and adds two (note: the dispatch's "6 preserved" was off by one
— the requirement carries 5 + 2); every ADDED/MODIFIED requirement paragraph
opens with a SHALL sentence; locales en/ja/zh-cn and completions synced
(structure tests green); architecture-index rows present (quick-locate +
spec-store-engine).

Working tree left exactly as received (reviewer throwaway tests deleted,
mutations reverted byte-exact; `git status` re-checked).

## Round-1 re-review (2026-08-22, same reviewer, delta only)

Fix set read against `evidence/fix-round-1.md`; file mtimes confirm the
round-1 blast radius (projection delta untouched at 05:04; the eight round-1
files all 06:58–07:04).

### Verified fixed

- **Major 1 (contract arm)** — the ready-set delta's requirement and
  "Confirm's launchable scope equals the ready set" scenario now scope the
  equality to FRESH launch contracts with begun-node contracts riding beside
  (`specs/issue-ready-set-scheduling/spec.md:138-159`); requirement and both
  scenario titles byte-stable. The contract arm now matches the code exactly.
- **Major 2 (begun-node seam)** — stated, pinned, disclosed: the new
  `specs/issue-execution-binding/spec.md` delta adds exactly one sentence to
  "Confirming a plan composes the launch contract set" (requirement body
  otherwise verbatim vs the current spec; 4 scenario titles preserved
  byte-for-byte + 1 new scenario) — and the sentence is TRUE against the code
  (every non-`not-started` wanted node reaches per-node resolution; nothing
  but not-started non-members lands in `waiting`). The covering fixture
  (`issue-ready-set-equivalence.test.ts:623-680`) pins the probe receipt's
  exact shape. Carve-outs present in proposal Impact, design D2 + risk
  entry, tasks 5.1/5.2.
- **Minor 3 (disclosure)** — design D2 now names the trust invariant and the
  biconditional; fix-round-1 lists the five rewritten binding fixtures + the
  confirm helper change, assertions unedited.
- **Minor 4 (evidence)** — bin-03 receipt present (20/293/exit 0 in
  `evidence/bin-summaries.txt`, all four bins; matches this reviewer's
  independent four-bin run exactly: 440 / 327+1skip / 446+1skip / 293);
  63→66 corrected with provenance; my reviewer run attributed.

### Round-1 gates (reviewer, real exit codes)

| Gate | Result | Exit |
| --- | --- | --- |
| equivalence suite solo | 12 passed | 0 |
| `test/core/issue-execution/` family | 4 files / 67 passed | 0 |
| ready + confirm CLI suites | 2 files / 8 passed | 0 |
| `validate issue-ready-set-scheduling` (3 delta files) | valid | 0 |
| fences (pipeline-registry, pipelines, packages/ui, package.json) | 0 bytes | — |

Mutation re-check: regressing confirm's begun-node handling to the old
`blocked.length > 0` partition fails 7 of 12 in the equivalence suite —
including the new fixture ("a begun node keeps its per-node resolution over an
incomplete dependency": `expected [] to deeply equal [['g-up','fresh'],…]`)
and the task-5.3 released-by-terminal pin. The seam is pinned with teeth.
Mutation reverted byte-exact; family re-run green (67/0) after revert.

### NEW findings

#### Major 5 — the qualified equivalence is still literally false on its UNPREPARED arm: a node reading `unknown` lands in confirm's unprepared set without being a ready member

- Where: `specs/issue-ready-set-scheduling/spec.md:141-143` (requirement
  body: "exactly the nodes confirm composes a FRESH launch contract or an
  unprepared report for, its resume-oriented and report-only contracts for
  begun nodes riding beside...") and `:157-159` (scenario: "the nodes confirm
  composes fresh launch contracts for, together with the nodes it reports
  unprepared, are exactly the ready set's members"). The ride-beside carve-out
  names CONTRACTS only — begun nodes' UNPREPARED reports stay inside the
  equality.
- Code path: a wanted change node whose reference resolves but whose
  observation is `unknown` (corrupt run-state, or — this change's own
  headline world — a v2 archive record that fails validation →
  `invalid-archive-record`) skips confirm's waiting gate (observation ≠
  `not-started`), reaches `resolveIssueLaunchBinding`, and hits the explicit
  unknown refusal (`binding.ts`, "Node 'X' is unknown: ...") →
  `report.unprepared`, while being a `running`/`unknown` EXIT, never a
  member (`confirm.ts:158-172`, `binding.ts` unknown-refusal branch).
- Reproduced (reviewer probe, the fail-closed fixture's own shape: g-broken
  unknown via invalid basis + g-down blocked on it):
  `fresh contracts: []`, `unprepared: [g-broken "Node 'g-broken' is
  unknown: archive record does not validate..."]`, `waiting: [g-down]`,
  `members: []` — the scenario reads `unprepared=[g-broken]` vs
  `members=[]`. A conformance test written verbatim from the scenario fails
  on the legacy-ruling suite's own fixture world.
- Internal contradiction: the round-1 `issue-execution-binding` delta itself
  lists "an unprepared report" as a begun-node outcome, while the ready-set
  delta's equality still admits unprepared only for members. The two sibling
  deltas disagree on this arm.
- Fix (one clause): extend the ride-beside wording to begun nodes' unprepared
  reports ("its resume-oriented and report-only contracts and unprepared
  reports for begun nodes riding beside..."), or scope the scenario's arm to
  "the nodes it reports unprepared for a fresh launch". No code change —
  the behavior is the disclosed, pinned design.
- Supporting residue: `tasks.md` 5.3 still carries the unqualified shorthand
  "confirm contracts+unprepared == ready members".

### Round-1 verdict

**NOT CLEAN — 1 new Major (Major 5, the unprepared arm of the same seam);
everything else in the fix set verified fixed.** Major 5 is a one-clause spec
wording fix in the ready-set delta (no code, no tests, no behavior); it does
not reopen any round-1 finding. Note 6's two-commit split remains the
shipper's call, per the dispatch.

### Round-1b (one-clause fix for Major 5) — CLEAN

`specs/issue-ready-set-scheduling/spec.md` only (mtime 07:12; the sibling
binding delta untouched at 06:59, `validate` exit 0 re-run by reviewer).
Verified against the code, arm by arm: the requirement body now scopes the
equality to "a FRESH launch contract or an unprepared report for **among its
not-started nodes**" (not-started nodes in `unprepared` are exactly failing
members — not-started non-members go to `waiting` — so fresh contracts ∪
fresh-unprepared == members, TRUE), and the ride-beside clause now carries
"resume-oriented contracts, report-only contracts, **and unprepared
reports** for begun nodes" — exactly the three begun-node outcomes the code
produces and exactly the sibling `issue-execution-binding` delta's outcome
list, so the two deltas agree with no remaining contradiction. The scenario's
THEN/AND carry the same two qualifications ("unprepared for a fresh launch";
begun unprepared report rides beside). Requirement and both scenario titles
byte-stable; scenario count 19 unchanged; no other content touched. **CLEAN.**
