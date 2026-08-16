# Review report — issue-status-projection (VERIFY, reviewer 1)

- Date: 2026-08-17. Independent review of the working-tree delta on `feat/issue-layer`.
- Tree fingerprint: `git rev-parse HEAD^{tree}` = `07f850c4c3442cdc7a15df86def85c4aeba39e73`
  (HEAD = 2fc92079); the working tree is dirty with this change's own delta
  (`src/core/issue-status/` + 3 test files untracked, `src/commands/store-issue.ts` +
  architecture-index skill modified; the dogfood store's `rasen/config.yaml`
  `storeMemberships` entry and `.rasen-store/` residue were removed mid-review by the
  implementer — final `git status` is clean of both).
- Report-only review: nothing outside this file was modified.

## Verdict

**Blocker 0 · Major 2 · Minor 3 · Trivial 4.** The core promise holds — the projection
is genuinely derived-on-read with zero write surface, phase/health stay orthogonal,
`src/core/pipeline-registry/` is byte-identical, no version bumps, CLI parity and the
degraded visibility mode are real and tested, and the dogfood receipts capture a real
transition. The two Majors are wrong-answer edge conditions inside the derivation
table, both invisible to the current tests.

## Test gate (real exit codes, no pipes)

```
pnpm exec vitest run \
  test/core/issue-status/issue-status-projection.test.ts \
  test/core/issue-status/issue-status-read-only-guard.test.ts \
  test/commands/store-issue-status-cli.test.ts \
  test/commands/store-issue-cli.test.ts
```

Result: **4 files / 34 tests, all passed, exit 0** (duration ~104 s on win32).

Additional gates run by the reviewer:

- `node bin/rasen.js validate issue-status-projection` → "Change is valid", exit 0.
  (Note: tasks.md 7.2 records this as `validate --change <id>`; the flag form errors —
  see Trivial-9.)
- `pnpm run test:types` → 5/5, no type errors, exit 0.
- `pnpm exec tsc --noEmit -p tsconfig.json` → exit 0 (full-source typecheck;
  `test:types` alone only covers `*.test-d.ts`).
- `git diff -- src/core/pipeline-registry/` → empty; no untracked files under it.
  Frozen-module claim verified.
- No `package.json` in the diff; no version bumps anywhere in the delta.

## Major findings

### MAJOR-1 — An ambiguous (scope-conflicted) reference with archived evidence is reported `finalized`; the ambiguity signal is dropped entirely

`src/core/issue-status/projection.ts:167-177` — the committed-evidence check
(`resolution.archived && resolution.outcome !== null`) runs BEFORE the resolution-status
check at `:179`. But the aggregate query deliberately marks a scope conflict (committed
identity naming a different project/line than the node declared) as `status: 'ambiguous'`
WHILE still carrying `archived: true` and the archive outcome
(`src/core/store/query/module.ts:651-670`: "a read reports it as ambiguous with both
claimants rather than silently preferring either side"). For that node the projection
returns:

- observation `finalized` — no `ambiguous-reference` problem is ever pushed, violating
  design D7 ("unresolved/ambiguous references … surface as `statusProblems[]` entries")
  and the spec's fail-closed philosophy ("nothing is guessed");
- the node counts toward `progress.completed`;
- `aliasFor` presents `claimants[0].changeId` as THE alias — a choice the query layer
  explicitly refuses to make.

Failure scenario: a plan node declares `projectId: A`; the committed Change instance for
its `changeInstanceId` lands under project B and is archived `landed` (identity moved /
manual edit — exactly the state the scope-conflict path exists for). `rasen store issue
show` reports the node `finalized`, progress +1, `problems: []`, `complete: true` — a
conflicted reference presented as finished work. Fix direction: gate the finalized
branch on `resolution.status === 'resolved'` (move the status check first), letting the
conflicted node fall into the existing `unknown` + problem path. No test covers
`ambiguous-reference` at all (only `unresolved` is tested,
`test/core/issue-status/issue-status-projection.test.ts:673`), which is why this survives
a green suite.

### MAJOR-2 — A node observed `unknown` falls through to phase `planning`, contradicting the phase requirement

`src/core/issue-status/projection.ts:346-372` (`derivePhase`): `unknown` appears in none
of the enumerations — it is not terminal (so not `review`), not in `ACTIVE_SIGNALS`
(`:356-363`, so not `active`), and not `not-started` (so the `ready` guard
`nodes.every(node => node.observation === 'not-started')` fails) — so the function
returns `planning`. The spec's phase requirement allows `planning` only while "the Issue
has no readable published plan or while its plan names only intent nodes and nothing has
started", and design D5's planning clause enumerates the same four conditions — none of
which is "a node's observation is unknown".

Failure scenarios (both reachable, both spec-supported states of this very feature):

1. Readable 3-change-node plan; child-a's `auto-run.json` is corrupt (partial write after
   a crash — the exact scenario of the spec's "A corrupt run-state is reported, not
   guessed"). Nodes `[unknown, not-started, not-started]` → the Issue reports
   **`planning/healthy 0/3`**: the operator is told the Issue has no readable plan when
   the plan is fine and a child crashed mid-run. Per the spec the crashed child "has
   started", so the honest phase is at least `active`.
2. Readable plan whose node's committed evidence disappeared after publication
   (`unresolved` → `unknown`) → same `planning` fall-through.

Fixture-coincidence note: every test that produces an `unknown` node omits the phase/health
assertions — `issue-status-projection.test.ts:644-671` (corrupt) asserts observation,
problems, `complete`, progress but not phase; `:673-694` (unresolved) asserts observation
and problem only; `store-issue-status-cli.test.ts:207-225` asserts the problem lines but
not the status segment. The suite is green precisely because it never pins the value the
derivation table has no row for. Fix direction: decide the row (the natural candidate is
`active` — a located-but-unreadable run-state or a broken reference is activity-adjacent
trouble, and `planning`'s meaning "no readable plan" must be preserved for the
unreadable-plan case, which is separately derived), then pin it with phase assertions in
all three tests.

## Minor findings

### MINOR-3 — `changesDir: ''` from a store-aggregate root produces a relative planning-change tail — the ambient read the module forbids

`src/core/root-selection.ts:750` sets `changesDir: ''` for store-aggregate scopes;
`src/commands/store-issue.ts:144` passes it through unchanged (only `undefined` is
guarded), and `projection.ts:227` computes `path.join('', alias)` = the bare relative
`alias`, so `stateFileSearchChain` (`:238`) probes `<alias>/auto-run.json` against
`process.cwd()` and can report a relative `runStatePath`. This contradicts
`types.ts:142-146` ("no ambient reads inside the module") and `projection.ts:229-231`'s
own comment ("A relative tail would be an ambient read, which this module forbids") — the
guard checks `undefined`, not falsy/relative. Reachable by running `store issue list/show`
from a store-aggregate checkout root. Mitigations: it faithfully mirrors `pipeline.ts`
resume's identical construction (`src/commands/pipeline.ts:2701`), wrong-file pickup is
unlikely, and visibility is labelled `none` there (execution root is undefined for
store-aggregate) — though that label then understates that relative probing still
occurred. Fix direction: treat a non-absolute `changesDir` as absent in
`resolveProjectionContext` (or in the projection's chain construction).

### MINOR-4 — Design D7's `complete`-flag rule and the implementation disagree

Design D7: "Invalid run-state, unresolved/ambiguous references, and unsearched refs
surface as `statusProblems[]` entries … **and lower a `complete` flag**". The
implementation (`projection.ts:442-446`) lowers `complete` only for `invalid-run-state`
and `unreadable-plan`; unresolved/ambiguous references do not lower it (unsearched refs
still do, via the carried `detail.complete`). `types.ts:130-139` documents the contrary
split as deliberate ("Reported-but-honest answers (an unresolved reference) do not lower
it"). The spec delta is silent on `complete`, and the code's split arguably matches the
aggregate query's philosophy better than the design sentence — but the design text was
not reconciled. One of the two documents should move; if the code's rule stands, D7's
sentence needs rewriting (and MAJOR-1's fix will make the ambiguous case moot for
`complete` anyway, since it currently never even reports).

### MINOR-5 — D4 table rows and spec scenarios left untested

- Portfolio `delivery.status: 'escalated'` → `failed` has no test (only child escalation
  is exercised, `issue-status-projection.test.ts:352-383`; the delivery branch at
  `projection.ts:124-130` is untested).
- The spec scenario "Finalized and run-terminal nodes count the same" is covered by two
  disjoint tests (one finalized-of-three at `:457`, one run-terminal-of-three at `:279`),
  never the combination (finalized + run-terminal siblings ⇒ 2/3).
- No `ambiguous-reference` test (see MAJOR-1 — this gap is what hides it).

## Trivial findings

- **TRIVIAL-6** — `isPortfolioComplete` accepts `delivery: 'skipped'` where design D4's
  table says "delivery `done`" (`projection.ts:137` vs design D4). Reusing the module's
  own contract is the right call and the code comment says so; the design table's letter
  differs.
- **TRIVIAL-7** — The source guard's forbidden-write list
  (`issue-status-read-only-guard.test.ts:92-106`) misses `rmSync` (and e.g. `truncate`);
  the behavioral byte-identity half compensates. The guard also always injects
  `workDirFor: null`, so the default `resolveChangeWorkDir(…, {ensure:false})` seam's
  read-only-ness is trusted from its own contract rather than asserted here.
- **TRIVIAL-8** — A `dropped` Issue with an all-finalized plan reports `active` (review
  requires `state === 'open'`, done requires `resolved`; `dropped` falls to the active
  signals). Unspecified by design/spec; the state column still shows `dropped`, so the
  facts are jointly visible. Likewise a record-null (divergent/unreadable) Issue can
  never reach `review`/`done` — conservative, and the existing renderer surfaces the
  record diagnostic independently.
- **TRIVIAL-9** — `tasks.md` 7.2 records the validate invocation as
  `node bin/rasen.js validate --change issue-status-projection`; the CLI takes the
  positional form (`validate issue-status-projection`) and errors on the flag. The
  recorded command as written fails; the validation itself passes.

## Claim sweep (by claim, not by token)

| Claim | Verdict |
| --- | --- |
| D1 new top-level module, store-pure boundary intact | Holds — `src/core/store/` untouched; module imports readers only |
| D2 explicit inputs, CLI resolves machine-local ones | Holds (with the MINOR-3 `''` caveat) |
| D3 location parity with `pipeline resume` | Verified against `pipeline.ts:1067-1079` and `:2699-2726` — identical options construction (`ephemeraDir(executionRoot, name)` first, `resolveChangeWorkDir(…, {ensure:false})`, planning change dir tail) |
| D4 observation table | Implemented; escalation-over-activity precedence is a reasoned refinement satisfying the spec's failure-among-running scenario; untested rows per MINOR-5; MAJOR-1 breaks the ambiguous row |
| D5 phase/health precedence | Implemented; `unknown` nodes missing from the table (MAJOR-2); done gated on operator-resolved only — verified |
| D6 progress + unreadable-plan rule | Holds — unreadable revision ⇒ `progress: null` + reason; finished-but-unarchived counts |
| D7 problems + `complete` | Problems carried; `complete` rule diverges from design text (MINOR-4); ambiguous case dropped (MAJOR-1) |
| D8 CLI surface, additive JSON, no new options | Holds — renderers English-literal, `--json` additive `status` object, exit codes unchanged |
| D9 reconciler caveat | Documented in module header; reported as recorded |
| D10 dogfood | Receipts 1–3 present under `evidence/`, including the real no-plan → `active/healthy 0/3` transition read from this worktree's live portfolio run-state (receipt 2 shows real `auto-run.json` paths); store registry cleanup observed complete during review |
| Spec: derived-on-read, never persisted | Holds — zero write calls in `projection.ts`; source guard + byte-identity behavioral test, non-vacuous (asserts the read reached run-state) |
| Spec: phase/health orthogonality | Holds — `active/failed` and `active/waiting-human` both tested |
| Spec: reserved `blocked`/`stale` never fabricated | Holds — not derivable from the code paths |
| Spec: visibility located and labelled | Holds — labels the consulted execution root; degraded mode tested from an unrelated cwd |
| Spec: corrupt run-state reported not guessed | Reported (problem + `unknown` + `complete: false`) — but the phase value is itself wrong (MAJOR-2) |
| Bookkeeping 7.1 architecture-index | Done — SKILL.md map row + `spec-store-engine.md` module section + two quick-locate rows |

## Fixture-coincidence check

The suites are substantially real: a real-Git store fixture, run-state written with the
frozen production writers, real `runCLI` processes for the CLI tests, parity asserted
field-by-field between the human and JSON facts, and the read-only guard asserts the
read actually reached run-state before asserting bytes unchanged. The one soft spot is
the cluster around `unknown` observations (MAJOR-2): the assertions stop exactly where
the derivation table has no row, so the suite cannot distinguish the intended phase from
the fall-through. The guard's source-scan half is substring-based and misses `rmSync`
(TRIVIAL-7), but the behavioral half carries the claim.

## Round-1 re-review

Date: 2026-08-17. Delta reviewed in isolation against the round-1 findings; every claim
in `evidence/fix-round-1.md` was checked against the actual code/tests, not taken on its
face. Same tree (`07f850c4c3442cdc7a15df86def85c4aeba39e73`), dirty with the change's own
delta; `src/commands/store-issue.ts` byte-identical to round 0 (not in this round's
scope); `git diff -- src/core/pipeline-registry/` still empty; no version bumps.

### Verdict: **CLEAN** — 0 Blocker / 0 Major / 0 Minor / 1 Trivial (new, accepted).

### Test gate (re-run by the reviewer, real exit code, no pipes)

`pnpm exec vitest run` over the four affected suites → **4 files / 38 tests, all passed,
exit 0** (~120 s on win32; projection 21, guard 5, status-cli 3, store-issue-cli 9 —
matches the fixer's claimed numbers exactly). Also green: `tsc --noEmit -p tsconfig.json`
(exit 0), `node bin/rasen.js validate issue-status-projection` (exit 0). The CLI corrupt
test's `phase: active` assertions run against `dist/`, so their pass also proves the
dist build is current with the fixed source (a stale dist would print `phase: planning`).

### Per-finding verification

- **MAJOR-1 — FIXED and verified.** `projection.ts:177-200`: the resolution-status check
  now gates the committed-evidence branch (`:206-216`); a non-resolved reference falls to
  the `unknown` + problem path regardless of `archived`/`outcome`. `aliasFor`
  (`:77-83`) returns `node.changeAlias` for non-resolved references — no claimant chosen;
  `types.ts:95-99` and design D3 (`design.md:81-84`) reconciled to match.
  **Fixture authenticity (the CRITICAL check):** the ambiguous test
  (`issue-status-projection.test.ts:865-922`) archives child-c under line `main` with a
  committed `landed` outcome, then hand-commits a revision (forged with the module's own
  `executionPlanDigest` + `serializeExecutionPlanRevision`, so the revision reads clean)
  whose node declares `targetLineId: 'side'` while naming that instance. On read this is
  the genuine `module.ts:651-670` path: `resolveChangeReference` resolves by instanceId
  (`found.archived: true`), the scope predicate finds `found.targetLineId ('main') !==
  node.targetLineId ('side')` → `resolution.status: 'ambiguous'` with the outcome
  carried — not a lookalike state. Pre-fix, the old `:167` check would have answered
  `finalized`, so the test's observation/problem/progress/phase assertions all fail
  against the round-0 code. The fixture note in `fix-round-1.md` explaining why the
  revision must be hand-committed (`publishPlan` refuses the conflict; editing the
  identity yields `unresolved`) matches the schema semantics it cites.
- **MAJOR-2 — FIXED and pinned.** `'unknown'` added to `ACTIVE_SIGNALS`
  (`projection.ts:388`) with the rationale in the `derivePhase` docblock (`:356-370`) and
  design D5 (`design.md:117-122`). Phase pinned `active` in all three tests round 1 named:
  `:833` (corrupt, health `healthy` pinned too — correct, since nothing readable records
  an escalation), `:861` (unresolved), `store-issue-status-cli.test.ts:219,224` (human
  segment + JSON). The pins are discriminating by construction: remove the row and the
  fall-through is `planning` (unknown is neither terminal nor `not-started`), which
  contradicts `toBe('active')` deterministically; the CLI pins exercise the built dist.
  `planning` retains its "no readable plan" meaning via the independent unreadable-plan
  path (unchanged, still tested at `:924`).
- **MINOR-3 — FIXED.** `projection.ts:248-251`: the planning tail is built only when
  `path.isAbsolute(input.changesDir)`; `''` (and any relative value) is treated as absent.
  The chdir test (`:734-764`) plants `child-a/auto-run.json` with `in_progress` in a real
  directory, chdir's into it, passes `changesDir: ''`, and asserts `not-started` +
  `runStatePath: null` — pre-fix the relative probe finds the planted file and the test
  fails (verified against the round-0 chain construction). cwd restored before cleanup;
  per-file fork isolation documented in the test.
- **MINOR-4 — FIXED (docs).** Design D7 (`design.md:149-159`) now states the implemented
  rule: carried `complete` lowered further only by invalid-run-state / unreadable-plan;
  unresolved/ambiguous reported-but-honest; unsearched refs lower at the query layer.
  Matches `projection.ts:468-472` and `types.ts`. The ambiguous test additionally pins
  `complete: true` beside the problem (`:921`).
- **MINOR-5 — FIXED.** Delivery-escalated → `failed` test (`:454-483`, pins observation,
  health, phase, progress); combined finalized + run-terminal ⇒ `2/3` test (`:675-700`,
  observations `['run-terminal','not-started','finalized']`); ambiguous gap covered by the
  MAJOR-1 test.
- **TRIVIAL-6/7/9 — FIXED.** D4 row now `delivery done|skipped` with the
  one-terminality-authority note (`design.md:99,106`); guard list includes `rmSync` and
  `truncate` (`issue-status-read-only-guard.test.ts:106-107`); tasks.md 7.2 records the
  positional validate command (`tasks.md:39`).
- **TRIVIAL-8 — accepted-known, untouched per instruction.**

### Regression watch on the reorder

The legit archived-AND-resolved path still reports `finalized` ("derives finalized from
committed archive evidence, with no execution root at all" and the combined 2/3 test both
green; the resolved-node alias still prefers the claimant per `aliasFor:82`). Escalation-
over-activity precedence in `observeAutoRun`/`observePortfolio` is byte-identical to
round 0 (`:102-148`), and its tests (failure-among-running, parked-stage,
delivery-escalated) are green. `not-created` references land in the same unknown+problem
path they did before (archived is false for them, so the reorder is behavior-neutral
there).

### New observation this round (accepted Trivial, no action required)

- **TRIVIAL-10** — the ambiguous test's alias pin (`issue-status-projection.test.ts:914`)
  is non-discriminating: in this fixture the single claimant's `changeId` and the node's
  recorded `changeAlias` are both `'child-c'`, so the assertion passes under the old
  `claimants[0]` behavior too. The MAJOR-1 core assertions (observation, problem,
  progress, phase) do discriminate, so the finding's fix is properly pinned; only a
  regression limited to `aliasFor`'s non-resolved branch would slip this particular line.
  `fix-round-1.md`'s phrasing ("alias is the node alias and NOT the archive entry name
  claimants[0] carries") overstates the fixture's discriminating power on that one
  assertion. A discriminating variant would rename the archived entry relative to the
  node's `changeAlias`; not required for CLEAN.

### Bottom line

All round-1 Blocker/Major/Minor findings are fixed with discriminating coverage; the
docs now match the code they describe; the frozen-module and no-version-bump gates hold;
the gate numbers reproduce exactly. **CLEAN**, with TRIVIAL-8 (accepted-known) and
TRIVIAL-10 (accepted, fixture-strength nit) on record.
