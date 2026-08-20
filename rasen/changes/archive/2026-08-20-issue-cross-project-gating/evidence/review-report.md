# Review report — `issue-cross-project-gating` (VERIFY, reviewer-1, 2026-08-20)

Independent verification of the uncommitted delta on `feat/issue-phase3` (`d3c02b0c` + working tree).
Scope per dispatch: unit-test gate, claim sweep, fixture-coincidence mutations. Report-only.

**Verdict: CLEAN.** Blocker 0 · Major 0 · Minor 0 · Info 2.

## 1. Unit-test gate — green, real exit codes

Build first (`pnpm run build`, exit 0 — includes the type widening compiling clean), then
fresh vitest runs, every exit code read from the shell, not from a pipe:

| Batch | Files | Tests | Exit |
| --- | --- | --- | --- |
| binding + projection + blocker-basis-degradation | 3 | 62 | 0 |
| store-issue-status-cli + store-issue-start-cli (dist) | 2 | 14 | 0 |
| store family (identity, identity-boundaries, store-aggregate-query, store-query-lock-free, store-query-read-only-guard, store-issue-plan-canonicalization, store-issue-target-project, store-issue-node-lifecycle) | 8 | 126 | 0 |
| three-way-sync proof (cli-presentation, command-registry, completion) | 3 | 51 | 0 |

My re-run: 16 files / 253 tests / 4×exit 0 — a representative subset of the implementer's
27/342 claim covering every claimed area. The digest golden literals live in the
canonicalization suite that ran green. My store-family pick differs slightly from the
implementer's (126 vs 135 tests); both are green, neither selection is the other's.

Tree fingerprint (delta = 11 modified files + this change dir + the new degradation suite;
`git diff d3c02b0c --shortstat` = 687 insertions / 46 deletions):

```
b0826ceb… src/commands/store-issue.ts            48b50987… src/core/issue-status/projection.ts
4027dc82… src/core/issue-execution/binding.ts    ae2ad2f5… src/core/issue-status/types.ts
6e1bd2ee… src/core/issue-status/index.ts         efa6cdeb… test/.../issue-status-blocker-basis-degradation.test.ts
d8d68474… test/commands/store-issue-start-cli.test.ts    fd8362e9… test/commands/store-issue-status-cli.test.ts
091c30f3… test/core/issue-execution/issue-execution-binding.test.ts
97de3626… test/core/issue-status/issue-status-projection.test.ts
```

## 2. The semantic heart — the WORK basis

All verified in source and by independent re-read:

- **`ObservedNode` no longer has `blockedBy`** — `src/core/issue-status/projection.ts:82-85`
  adds `'blockedBy'` to the `Omit` list, and every observation branch dropped its
  `blockedBy: resolved.blockedBy` copy (7 removals in the diff). Structural: no branch
  CAN copy the archive list; it does not have the field.
- **`withBlockerFacts` is the sole writer** — `projection.ts:672`. Grep over `src/` for
  `blockedBy` assignments inside issue-status finds only the post-pass (`projection.ts:682`).
  The store query's own archive-based derivation (`src/core/store/query/module.ts:690`,
  `readiness !== 'finalized'`) and its `string[]` type (`query/types.ts:315`,
  `wire-types.ts:1531`) are byte-untouched — `git diff d3c02b0c -- src/core/store/` is
  empty. The other `blockedBy` hits in `src/core/store/foundation|registry|upgrade-identity`
  are the unrelated registry-upgrade field.
- **Filter is the gate's own rule** — the post-pass filters on
  `!isTerminal(observation)` with `isTerminal` = `finalized | run-terminal`, `undefined`
  fail-closed (`projection.ts:588`), the same pair `binding.ts:41-43` gates on.
- **Persistent-store ground truth, re-read myself (read-only)**:
  - sha256 of `Reference\rasen-issue-store\rasen\issues\issue-multi-change-execution\plans\0001.yaml`
    = `477f89625a36a561ed7a5b5c42ca5aba2ae5603d3455321bc599702cdc079d66` — identical to
    g-001's baseline. Revision bytes untouched.
  - Fresh `node bin/rasen.js store issue show issue-multi-change-execution --store
    issue-registry` (exit 0) is byte-identical to the implementer's
    `dogfood-persistent-human.txt`, and against g-001's archived after-receipt the diff is
    EXACTLY the two `(blockedBy …)` segments on the run-terminal-unarchived lines — zero
    axis lines, zero other lines. Work-complete display basis confirmed on real store data:
    deps that are run-terminal-but-unarchived read as non-blockers; `--json` carries
    `"blockedBy": []` on all three nodes.

## 3. Cross-project refusal discrimination and gate integrity

- **Naming**: `blockerName` (`binding.ts:87-93`) renders `<id>@<project> (<state>)` via the
  shared `issueBlockerState` (`projection.ts:648`) — refinements `not-started, no local
  run-state` (locatedBy null) and `unknown (<diagnostic>)` included; undefined view
  fail-closes to `unknown (…)`. Applied in both the `--node` fresh refusal
  (`binding.ts:391`) and the frontier `awaits` reasons (`binding.ts:342-350`).
- **Gate rules byte-identical**: diff touches no line of `workComplete` / `isRunnable` /
  `refuse` / `refusalFix` / the frontier candidate logic — only the two name-rendering
  sites changed. Same-project gating from C2 is structurally intact (the rule never read
  projectId); the prior-suite assertions (`g-002 awaits g-001@app-a (in-flight)` etc.)
  pin it.
- **Phase-2-shaped serial reads**: receipt `10-phase2-serial-show.txt` = ready/healthy 0/2
  with `p-002 … (blockedBy p-001@alpha-core: not-started, no local run-state)`; the
  degradation suite (green in my run) hand-authors Phase-2-era bytes + module-computed
  digest and asserts `problems: []` — digest verification is load-bearing there (an
  unverifiable digest yields a problem and no nodes).
- **Envelope discipline**: API-level `refusal.blockers` stays the bare-id identity list
  (`binding.ts:395`, asserted in tests); CLI `--json` refusal is unchanged
  severity/code/message/fix (receipt 2) — enriched facts live in the message both forms
  print. Parity holds: `--json` `blockedBy[]` carries raw `observation`, and the
  dependency's own node row in the same payload carries `observation`/`locatedBy`/
  `diagnostic` (verified against the JSON receipt's node keys) — the exact facts the human
  label derives from.

## 4. Prior-test touches

Exactly four prior suites touched (matches the claim's three edit kinds across them):

- `issue-status-projection.test.ts`: bare-ids → structured triples, same exact list
  membership and order (`['g-001']` → `[{nodeId:'g-001', projectId, observation:'not-started'}]`).
- `store-issue-start-cli.test.ts` / `store-issue-status-cli.test.ts`: render assertions
  strengthened to full names (node lines carry `@project` per g-001's contract); start-cli
  additionally gained the human-form (stderr, exit 1) assertions.
- `issue-execution-binding.test.ts` D3-pin: planted `blockedBy` rows rewritten to the
  structured shape with `observation: 'run-terminal'` planted on a terminal dep and
  `not-started` on the live one — still maximally disagreeing with what binding should
  derive, so the pin stays discriminating (binding ignores `blockedBy` whatever it says).

No other prior test touched: grep for `blockedBy` over `test/` + `packages/` finds only
these four, the new suite, the untouched `identity*` files (registry-upgrade field), and
the untouched UI fixtures (wire mirror of the query's string[]).

## 5. Fixture-coincidence mutations (both restored byte-identical, sha-verified)

- **Mutation 1 — revert the filter to the archive basis** (`!== 'finalized'` instead of
  `!isTerminal(...)`): projection 27-test run → 2 failed, exactly
  "drops a dependency whose work is terminal but unarchived from the blocker list" and
  the degradation suite's two-project terminal case. The work basis is pinned, not
  fixture-coincident.
- **Mutation 2 — `blockerName` returns the bare id**: binding suite → 8 failed (all six
  g-002 naming tests plus the two strengthened prior assertions), while the gate tests —
  release-on-work, refusal codes — stayed green, exactly the discrimination the claim
  needs: naming killed → naming tests die; gate untouched → gate tests live.

Restore verified: `projection.ts` sha `48b50987…`, `binding.ts` sha `4027dc82…` —
identical to pre-mutation hashes.

## 6. Fences and delta hygiene

- `git diff d3c02b0c -- src/core/pipeline-registry/ packages/ui/ src/core/templates/` —
  empty. Frozen fences hold.
- Scenario titles byte-stable: every pre-existing scenario title under both MODIFIED
  requirements is byte-identical to the current spec; the seven new scenarios are pure
  additions. No RENAMED, no title drift.
- `rasen validate issue-cross-project-gating` (positional) — exit 0, "is valid".
- Architecture-index updates (quick-locate row + module notes) present, additive, accurate.

## Findings

**Info-1** — `test/commands/store-issue-status-cli.test.ts:120`: the shared `beforeEach`
widened `projects: [PROJECT]` → `[PROJECT, PROJECT_B]`. This serves the new cross-project
scenario in the same file, and the prior scenarios' assertions are unchanged and green
(membership of an unused project moves nothing they assert), but strictly the prior
scenarios now run on a widened fixture. No action needed; noted so the "no other prior
test touched" claim is read precisely: no prior assertion or scenario body changed.

**Info-2** — Verifier arithmetic, not a defect: my store-family batch is 8 files / 126
tests green against the implementer's claimed 8f/135 (different file selection within the
same family; the readiness-basis and digest-golden files are covered in mine). CI remains
the authority for the full set.

No Blocker, Major, or Minor findings. The change does what its specs say, the display
basis switch is real and structurally single-writer, the gate is untouched, and the
persistent store proves the story on real data with zero collateral movement.
