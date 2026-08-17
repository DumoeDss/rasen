# Review report — issue-execution-binding (VERIFY, small-feature child 2/3)

Reviewer: independent verifier (did not write the code). Date: 2026-08-17.
Tree: branch `feat/issue-layer`, HEAD `a176026f` (`e16fb06f` C1 beneath), tree
`cbe541faf37696367dff750e54334eed91bc6675`, dirty with the uncommitted C2 delta.
Mode: dispatched (report-only; nothing outside this file was modified).

## Verdict

**PASS with findings** — 0 Blocker, 0 Major, 3 Minor, 1 Trivial.
The delta implements what both spec deltas promise; the honest-refusal taxonomy,
read-only construction, locator-widening precedence, and attribution hygiene are
all real and discriminatingly tested. The findings are evidence-accuracy and
guard-coverage items, none of which gate ship.

## 1. Unit-test gate (re-run independently)

Command (cwd = this worktree, dist verified current — dist mtimes 07:53 > latest
src 07:22, no rebuild needed):

```
pnpm exec vitest run \
  test/core/issue-execution/ test/core/issue-status/ \
  test/core/completions/cli-presentation.test.ts \
  test/core/completions/command-registry.test.ts \
  test/commands/store-issue-cli.test.ts \
  test/commands/store-issue-start-cli.test.ts \
  test/commands/store-issue-status-cli.test.ts
```

Result: **10 files / 101 tests passed, 0 failed, exit 0.** Per file:
issue-execution-binding 23, issue-execution-read-only-guard 6,
issue-status-projection 21, issue-status-read-only-guard 5,
issue-status-locator-widening 7, store-issue-cli 9, store-issue-start-cli 9,
store-issue-status-cli 3, cli-presentation 11, command-registry 7.

`node bin/rasen.js validate issue-execution-binding` → valid, exit 0.
`git diff --check a176026f` → clean; new files LF, no trailing whitespace, no
U+FFFD in the ja/zh-cn locale additions.

## 2. Claim sweep

### Backward compatibility by construction — VERIFIED
`git diff a176026f -- test/core/issue-status/ test/commands/store-issue-cli.test.ts
test/commands/store-issue-status-cli.test.ts` is **empty** (0 bytes); those C1
suites ran green in my re-run over the widened sources (the C1 source-guard
scans the directory live and still passes). `runStateVisibility` still describes
only the current root (`projection.ts:675-678`); the new `locatedBy` label
carries the index source. The locator-widening suite's C1-shaped row asserts
omitted-input observations/phase/health/progress unchanged. New fields are
additions; omitted inputs cannot reach the widened legs.

### `start` writes nothing — VERIFIED
Three layers: (a) source guard over `src/core/issue-execution/**` (no write
calls, no effectful Git verbs, no process spawn, frozen-module imports
restricted to readers); (b) the same guard re-checks the widened
`src/core/issue-status/**` imports; (c) a behavioral byte-digest over a real
fixture (sha256 trees of the store's `rasen/` — issue records and plan
revisions, the execution root's `.rasen/` — run-state AND
`planning-binding.json`, and the machine workspace-index tree) taken around
both the widened projection and `resolveIssueLaunchBinding`, with the guard
first asserting the run-state really was located through the index
(non-vacuous). Command-layer seams are read-only by source inspection:
`resolveSessionLaunchContext` contains no write calls; `listNames`/`readWorkspaceIndexDocument`
readdir/read with ENOENT→[] and no mkdir. The guard's route-1 check injects a
throwing `launchContextFor` and still resolves `workspace-pair` — proving the
pair route consults no machine registry.

### Honest refusals discriminate — VERIFIED (one guard gap, finding 2)
Every refusal mode has a unit and/or CLI case asserting its exact code AND the
discriminating payload: candidates named (parallel pair, both ids asserted),
blockers named, unknown-node names the plan's real ids, intent-node refused,
unknown-observation carries its diagnostic, no-plan names planning+publish,
unprepared asserts the byte-exact preparation command (unit + CLI `fix` line),
launch-context failure passes the composition's message through, multi-entry
refusal names both roots, pipeline conflict names both values. CLI refusals
assert exit code 1 and the taxonomy code in the JSON `status` array (via
`StoreError.diagnostic` through `emitFailure`), successes exit 0.

### Attribution hygiene — VERIFIED
`sessionsFromStages` (`projection.ts`) reads only stageId/role/runtime/sessionId/
threadId/transcript; `agentId` appears in the widened sources only inside
comments. The discriminating fixtures plant `agentId: 'agent-1'` /
`'agent-live-handle'` and assert the rendered human output and the JSON node
do not contain it; a bare-string worker contributes no session fact; portfolio
records report empty sessions and null pipeline with no substitution of the
parent's own record.

### `locatedBy` precedence — VERIFIED
Code order: current-root chain (ephemera → legacy work dir → planning change
dir) first, index chains after (`projection.ts`, D6 block). The widening test
populates BOTH roots with disagreeing states (current in-flight vs index
run-terminal) and asserts the current root wins with `locatedBy:
'execution-root'`; dropping the current-root input flips the same entry to
`workspace-index`. Discriminating.

### Dual-delta integrity — VERIFIED
The MODIFIED `issue-status-projection` delta edits exactly the base requirement
"Run-state visibility is located and labelled" (`rasen/specs/issue-status-projection/spec.md:161`)
and adds only: index locator searched after the working directory's own root,
per-node locator labelling, and the not-started answer applying only when
neither locator provides run-state — matching the proposal's Modified
Capabilities paragraph word for word. Attribution is specified under the NEW
capability (its "Run and Session facts are attributed per node" requirement),
not smuggled into the MODIFIED delta. All four retained/new scenarios map to
implemented, tested behavior (the corrupt-run-state scenario is covered for
both locators through the shared `nodeFromLocated`; only the current-root leg
has a direct corrupt-file test).

### Locale + completions — VERIFIED
`start` + `store`/`node`/`pipeline`/`json` option descriptions landed in
en/ja/zh-cn (17 lines each, structural parity enforced by the green
cli-presentation suite); COMMAND_REGISTRY gained the `start` entry (positional
`issue-id` + the four flags) and the registry structure test is green. All
three surfaces present.

### Fences — VERIFIED byte-empty
`git diff a176026f -- src/core/pipeline-registry/ packages/ui/ package.json
packages/ui/package.json` → 0 bytes each. `pipeline-registry` is imported
read-only (`resolver` catalog, `run-state`/`portfolio-state` readers; the
guard's import allowlist enforces it).

## 3. Dogfood deviations — graded ACCEPTABLE (recorded, pre-authorized)

The two recorded deviations are real machine constraints, not implementation
shortcuts:

1. **Worktree-share rule** — the design Context's premise (this worktree
   registered as project `issue-layer`) is unachievable without clobbering the
   main checkout's real registration; the dogfood used the real project
   identity, so receipt 1's L6 cwd is the registered MAIN checkout. The L6
   composition ran live against real machine truth (membership vouching by the
   store's own record), which is what the route-2 scenario actually requires.
2. **`execution-root-outside-repository`** — pair reuse of this worktree
   refused by the pair machinery's own validation (the worktree is nested in
   the repository). D9's second named fallback ran: temp execution roots +
   `initializeRunState`-born run-state (pending stages, no fabricated
   signal), bound through the sanctioned writer (`store workspace plan
   --existing-change` + `apply`).

What the substitute evidence substantiates: the closed loop's MACHINERY —
index-located observation from a directory that resolves no execution root,
over real index documents and real writer-born run-state (receipt 2: g-001/g-002
`pipeline: small-feature (located by workspace-index)` from the store root);
the workspace-pair launch contract with cwd from the index (receipt 2b, mode
`fresh`, D5 pipeline fallback); the honest blocked refusal (receipt 2c); the
L6 checkout route (receipt 1).

What evaporated (openly, not silently): the instance-specific promise — "a
binding whose cwd is where this very change runs" and "observes the live run".
Neither was achieved with this worktree as the subject; the already-running
mode over live in-flight state is unprovable here without fabricating
progression, and the receipt summary says so explicitly under "Not proven in
this dogfood", pointing at the suites that cover the mode over real writer
bytes (guard behavioral test + CLI cases over `writeRunState` bytes + a real
fixture index document — verified, the counts it cites are accurate). The
receipt summary's Phase C bullets describe the actual receipts accurately (the
"run-terminal / already-running" language lives only in design.md D9's
pre-fallback plan text). Per D9's anti-theater rule the blocking condition was
the attribution receipt, which WAS reached. Grade: acceptable; nothing silently
evaporated.

## 4. Fixture-coincidence sweep

Guards that guard (checked by reading the assertions against the fixture
planted data): read-only digest (non-vacuous pre-assertions + throwing
launchContextFor proving route-1 precedence), agentId exclusion (handle planted,
negative containment asserted), current-root-first (disagreeing dual states),
ambiguous frontier (a chooser yields `ok:true` and fails the test), pipeline
conflict (both names asserted), already-complete (`launch` null asserted),
determinism (repeat CLI run `toEqual`). One gap found — finding 2.

## 5. Findings

### Minor 1 — tasks.md 6.2 misreports the test count
`rasen/changes/issue-execution-binding/tasks.md:35` records "[10 files / 124
tests passed, exit 0]". The same 10-file affected set measures **101 tests**
(two independent runs agree; vitest reports "Tests 101 passed (101)"). 23 is
exactly the binding-suite's case count, suggesting a double count of
`test/core/issue-execution/issue-execution-binding.test.ts` in the implementer's
tally. Failure scenario: the archiver/operator trusts 124 as the affected-set
size and a later run's 101 reads as a regression hunt. Fix: correct the
bracket to the measured numbers.

### Minor 2 — the D3 observation-rule accept side is unguarded (fixture coincidence)
`src/core/issue-execution/binding.ts:54-60` derives runnability from
observations (`workComplete` on `IssueNodeStatus.observation`), deliberately
NOT from the plan read's archive-based `blockedBy` (design D3: finished-but-
unarchived counts). No test discriminates the two: every synthetic
`resolvedNode`/`nodeStatus` fixture in
`test/core/issue-execution/issue-execution-binding.test.ts:87,142` hardcodes
`blockedBy: []`, and the CLI fixtures only exercise refusals where both rules
agree (dependency not-started; receipt-2c likewise — g-001 was pending, not
terminal). Failure scenario: a refactor swaps `isRunnable`'s dependency test to
`status.blockedBy`; the whole affected set stays green; `start` then refuses
nodes whose dependencies' work is terminal but unarchived — silently narrowing
the spec's "dependencies' work is complete" semantics the design deliberately
chose. Fix: one unit with `blockedBy: ['g-001']` on the addressed node's
resolved row while g-001's observation is `run-terminal`, asserting acceptance.

### Minor 3 — CLI-level `start` has no behavioral write-guard
The byte-digest guard covers the core composition (`projectIssueStatus` +
`resolveIssueLaunchBinding`) but not the command path
(`src/commands/store-issue.ts` `start` action), which additionally calls
`resolveQueryStore`, `listAllWorkspaceIndexEntries` (production coordination),
and the real `resolveSessionLaunchContext`. All three are read-only by source
inspection (verified: no write calls in `session-launch-context.ts`;
coordination `listNames` is readdir-with-ENOENT), and the family convention
(C1's guard) is also core-level — but the spec scenario "The start command
writes nothing" names the command. Failure scenario: a future seam added to
the command path (e.g., a launch-log temptation) passes every existing guard.
Fix (optional, family-consistent): digest the fixture's store/index trees
around one real `runCLI` `start` invocation in the CLI suite.

### Trivial 1 — the sibling guard's re-check name overstates its breadth
`test/core/issue-execution/issue-execution-read-only-guard.test.ts:158-172`
("keeps the widened issue-status Module equally write-free") checks 5 write
verbs, versus the 15 in C1's untouched guard over the same directory. Not a
hole — C1's suite carries the full list in the same run — but the test name
implies equivalence it doesn't itself provide.

## 6. Notes (no action)

- The `--store`-omitted edge is unreachable: `resolveQueryStore` refuses
  (`issue_scope_required`) before any widening or launch-route matter, matching
  the code comment in `resolveStoreWideningContext`.
- `evidenceLocatorFor`'s `claimants[0]` is the single committed claimant by
  construction (`resolveChangeReference` returns `resolved` with exactly one
  committed claimant, or the single local one) — matches D7's wording.
- Index-entry matching is storeUid-filtered at the command layer exactly as
  `gatherReferenceEvidence` does; multi-entry per instance is refused in
  `start` (named) and first-hit in the read locator (labelled) — the two
  surfaces' rules differ by design and both are tested.

## Round-1 re-review (2026-08-17)

**CLEAN** — no open Blocker/Major; all three Minors and the Trivial from round 1
are resolved. No new findings. Delta reviewed: test-only round, verified
against `evidence/fix-round-1.md` claim by claim.

### Resolution verification

- **MINOR-1 (test-count record) — RESOLVED, and the fixer's correction of my
  hypothesis is accepted.** The original 124 was a different valid 10-file set,
  not a double count: I re-ran the two named suites myself —
  `store-aggregate-query` + `store-query-read-only-guard` = 2 files / 41 tests,
  exit 0 — and the reconciliation holds exactly (101 + 41 − 18 = 124; my
  round-1 bracket files measured 11 + 7 = 18). The tasks.md 6.2 bracket now
  records the canonical 10 files / 103 tests with the per-file breakdown and
  names both file sets, so the earlier 124 is auditable rather than mysterious.
  The finding (a bare number over an unnamed set) was real; my stated cause
  was wrong.
- **MINOR-2 (D3 pin) — RESOLVED.** The pin exists
  (`issue-execution-binding.test.ts:344`) and pins BOTH rows: the resolved rows
  via the new `blockedByFor` planting seam (`g-002 → ['g-001']`,
  `g-003 → ['g-001','g-002']`) and the status rows via the `nodeStatus`
  `blockedBy` override, with g-001 observation `run-terminal` and the frontier
  asserted `g-002` / mode `fresh`. The mutation claim is consistent with the
  code: under the archive-based predicate the pinned rows leave zero runnable
  nodes, so `expect(result.ok).toBe(true)` fails; the file now counts 24
  (1 failed | 23 skipped under `-t` reconciles). Verified byte-restored:
  `isRunnable` reads exactly as in round 1 (observation rule), the `git diff`
  src subset is unchanged from round 1 (8 files, 606+/76−), and a grep for
  MUTATION markers over both modules is empty. The historical mutation run
  itself is not independently reproducible, but its discriminating logic is
  re-derived here and holds.
- **MINOR-3 (CLI-level write-guard) — RESOLVED, non-vacuous.** The new test
  (`store-issue-start-cli.test.ts:456`) runs the real built CLI twice — a
  successful pair-route already-running report (output asserted: the mode line
  and `cwd: <execRoot>`) and an `issue_start_node_not_runnable` refusal — and
  asserts sha256 tree digests of the store's `rasen/` (issue records + plan
  revisions), the execution root's `.rasen/` (run-state), and the machine
  workspace index identical before/after both invocations. The success-output
  assertions precede the after-snapshot, so a silently failing command cannot
  pass vacuously.
- **TRIVIAL-1 (guard rename) — RESOLVED without weakening.** The sibling test
  is renamed to "keeps the widened issue-status Module write-free on its new
  imports (C1's guard carries the full verb list over the same directory)";
  C1's untouched guard (0-byte diff) still carries the 15-verb list over the
  same directory in the same run.

### Gates (re-run independently this round)

Canonical affected set (the round-1 command): **10 files / 103 tests passed,
0 failed, exit 0** (binding 24 incl. the pin, exec-guard 6, projection 21, C1
status-guard 5, widening 7, store-issue-cli 9, store-issue-start-cli 10 incl.
the write-guard, store-issue-status-cli 3, cli-presentation 11,
command-registry 7). Store-query pair: 2 files / 41 tests, exit 0.
`node bin/rasen.js validate issue-execution-binding` → valid, exit 0.
Fences byte-empty (`src/core/pipeline-registry/`, `packages/ui`, both
`package.json`); C1 suites byte-untouched (0-byte diff); no production source
changed this round.

### Verdict

Round-1 findings: 3 Minor + 1 Trivial, all closed. Open findings: none.
