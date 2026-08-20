# Review report — `issue-project-grouped-views` (VERIFY, reviewer-1, 2026-08-20)

Independent verification of the uncommitted delta on `feat/issue-phase3` (`0ae54a56` + working
tree). Scope per dispatch: unit-test gate, live-loop verification (the finale's essence),
claim sweep, fixture-coincidence mutations. Report-only; the persistent store was read, never
written.

**Verdict: CLEAN.** Blocker 0 · Major 0 · Minor 0 · Info 3.

## 1. Unit-test gate — green, real exit codes

`pnpm run build` first (exit 0, includes the native capsule rebuild), then fresh vitest runs,
every exit code read from the shell (`$?` / appended marker), never from a pipe:

| Batch | Files | Tests | Exit |
| --- | --- | --- | --- |
| `test/core/store/` (full store family) | 80 | 1482 passed + 2 skipped | 0 |
| `test/core/issue-status/` (incl. both new suites) | 8 | 55 | 0 |
| `test/core/issue-acceptance` + `issue-execution` + `issue-publication` | 6 | 77 | 0 |
| `test/core/issue-acceptance/` alone (count check) | 2 | 15 | 0 |
| store-issue CLI family (`store-issue-{cli,status-cli,start-cli,lifecycle-cli,plan-portfolio-cli,target-project-cli,acceptance-cli}.test.ts`, dist) | 7 | 42 passed + 1 timeout flake | 1 → adjudicated |
| ↳ isolated re-run of the flaked file (`store-issue-status-cli.test.ts` alone, dist) | 1 | 5 | 0 |
| three-way-sync trio (cli-presentation, command-registry, completion) | 3 | 51 | 0 |

The 2 skips in the store family match the claimed "2 pre-existing skips". The CLI batch's
single failure is the known Windows machine-state cluster, not a logic regression: the
PRE-EXISTING test "degrades to a labelled visibility-none answer from an unrelated directory"
(`store-issue-status-cli.test.ts:211`) timed out at its default 30s while the batch ran four
spawn-heavy files in parallel (937s tests over 264s wall), then hit `EPERM` deleting its temp
dir — the EBUSY/rmdir/timeout shape the machine has hit before. Full failure list enumerated:
exactly that 1 test, 0 others. Isolated re-run of the whole file: 5/5, exit 0. My totals:
104 files / 1710 passed + 2 skipped + 1 adjudicated flake, real exit codes throughout — a
representative cover of every claimed area.
The implementer's exact "93 files/1633" and "10/99 issue-status" selections cannot be
reconstructed from directory boundaries (Info-2); coverage is equivalent, CI stays the
authority for the full set.

Tree fingerprint (delta vs `0ae54a56`, 8 modified files + the 2 new suites + this change dir;
`git diff 0ae54a56 --shortstat` = 320 insertions / 22 deletions over 8 files):

```
850fbebc… src/commands/store-issue.ts              f13f3725… src/core/issue-status/types.ts
3ae1f8ce… src/core/issue-status/projection.ts      240f983d… src/core/issue-status/index.ts
47ce9dfe… test/commands/store-issue-status-cli.test.ts    b265d591… rasen/config.yaml
e438a76f… test/core/issue-status/issue-status-project-lanes.test.ts
afdb88cc… test/core/issue-status/issue-status-project-lane-degradation.test.ts
```

## 2. Live-loop verification — the finale, re-driven myself (all read-only)

**Issue #2, current live projection** (`node bin/rasen.js store issue show
issue-cross-project-execution --store issue-registry`, exit 0): `active/healthy 2/3`, two
lanes in code-point id order — `project rasen-site (6ca78b98-…): 0/1` then
`project rasen (e2ee72ed-…): 2/2` — lane pairs summing to the Issue pair (2/2 + 0/1 = 2/3,
the intent node counting nowhere), the cross-project blocker named on the site node
(`blockedBy issue-project-grouped-views@e2ee72ed-…: not-started, no local run-state`), and
`acceptance: conditions (none published)`. My fresh human output is **byte-identical** to
`dogfood-issue2-3-show-lanes.txt`; my fresh `--json` `status.projects` array is identical to
`dogfood-issue2-5-show-json.json` (site lane alias `rasen-site`, rasen lane alias `rasen`,
nodeIds in canonical order). `list` reproduces `dogfood-issue2-4-list-summary.txt` byte for
byte, including Issue #1's single-lane `[rasen 3/3]`.

This state explains the receipts' staging narrative exactly: g-003's own apply is complete on
the machine but its Store evidence is staged (staged-close Leg 1), so the intent node
truthfully reads not-started and the rasen lane stays 2/2 over the two seeded terminal
children.

**The gating refusal re-run** — `store issue start issue-cross-project-execution --node
document-multi-project-issues --store issue-registry`, both forms, exit 1, byte-identical to
both receipts: names `issue-project-grouped-views@e2ee72ed-…
(not-started, no local run-state)` with code `issue_start_node_not_runnable`. The current
state explains it: the site node's release depends on the intent node's promotion + terminal
evidence (Legs 1–2 of the staged close), which has deliberately not been executed — the
refusal is the gate holding, not a stale receipt.

**Issue #1 degradation** — fresh `show` is byte-identical to
`dogfood-issue1-degradation-show.txt`: `done/healthy 3/3`, digest `e9b0cd65…` (recorded
contentSha256, unchanged), file sha256 `477f8962…` (the pin g-001/g-002 reviews recorded),
exactly one lane `project rasen (e2ee72ed-…): 3/3` equal to the Issue pair. Zero axis
movement on the Phase-2-era single-project revision.

**Store mutations** — the store's git log carries exactly the five sanctioned commits
(`a7db2fb` widen rasen + add rasen-site + extend line-0.2 map; `f12d3ea` site reference;
`dd0c1a7` children seeded; `79cf6e5` site change authored; `f8f7776` Issue #2 + plan 0001)
and nothing after; the member catalogs read back the widened roles (`rasen:
planning: true`; `rasen-site` registered with catalog id `rasen-site` — the alias the live
lanes render); Issue #2's content is exactly `issue.yaml` + `plans/0001.yaml` — **no
acceptance conditions, no accepted record** (staged-close only). Store working tree clean.
Plan `0001` on disk: 4 nodes (2 rasen changes with the seeded instanceIds, the intent node,
the site change with `dependsOn: [issue-project-grouped-views]`), digest `efaf70ef…` — the
cross-project edge is real committed Store content.

## 3. Claim sweep

- **`progressOver` is THE one completion predicate.** `projection.ts:620` is the only
  completion-pair function in the projection seam; the Issue pair (`projection.ts:937`) and
  every lane pair (`projection.ts:655`) call it — one rule, two scopes, exactly D2. The
  refactor out of the inline IIFE is behavior-identical (same `isRequired` filter + same
  `isTerminal` count; the whole store family + issue family green is the independent
  witness). The acceptance gate's own `isTerminal` pair-computation (`issue-acceptance/
  gate.ts:221`) predates this change (C3), is untouched by the delta, and is a different
  domain's verification summary — not a third read-surface basis.
- **Lane order code-point; canonical nodeIds.** `deriveProjectLanes` sorts project ids with
  a plain string comparator (`projection.ts:647`); `nodeIds` follow the built `nodes` order
  (canonical, `normalizePlanNodes`-sorted). Live store confirms code-point order
  (`6ca78b98…` lane before `e2ee72ed…`).
- **No lanes on unreadable plans.** `projects` derives only under `plan.revision !== null`
  (`projection.ts:941`), else `[]` — pinned by the unreadable-revision test and by the
  no-progress parity of the reasoning.
- **Parity.** Human lane headers carry alias + id + pair; `--json` `status.projects` carries
  the same facts; the CLI parity test asserts `list`'s and `show`'s lane arrays deep-equal on
  both commands, and the live reads agree with both receipts. List omits the lane segment
  entirely when none derive (`store-issue.ts:598-606` — `.length > 0` guard).
- **Prior touches.** `rasen/config.yaml` +3 = the sanctioned `storeMemberships` hint (uid +
  display id of `issue-registry`); `rasen status --change issue-project-grouped-views`
  still resolves every root repo-local (change root, evidence, archive all inside the
  worktree). The CLI test edit is append-only — `git diff 0ae54a56` on
  `store-issue-status-cli.test.ts` has **zero deleted lines** (one new `it`, +141, writing
  its own catalog fixtures; no `beforeEach` widening). Nothing else in `src/` or `test/`
  moved: the delta is exactly the 8 files above + the 2 new suites.
- **Fences.** `git diff 0ae54a56 -- src/core/pipeline-registry/ packages/ui/
  src/core/templates/` is empty. The two architecture-index detail edits are additive and
  accurate against the code.
- **Scenario titles byte-stable.** All 9 pre-existing scenarios of the MODIFIED requirement
  are byte-identical to the current spec; the 2 new scenarios are insertions; the ADDED
  requirement's 6 scenarios are new titles with no collision. The MODIFIED body diff against
  the current spec is pure insertion (one `node tar…` → `project lanes with their progress
  pairs, per-node targ…` widening inside the `--json` enumeration) — no pre-existing clause
  dropped.
- **Three-way sync N/A.** No new command/option/locale key/completion entry; the trio
  (cli-presentation, command-registry, completion) runs 51/51 green — same count the g-002
  review recorded, i.e. no drift.
- **`rasen validate issue-project-grouped-views`** (positional) — exit 0, "is valid".

## 4. Fixture-coincidence mutations (restored byte-identical, sha-verified)

- **Mutation 1 — lane-local archive-based copy** (replaced `progressOver(laneNodes)` with an
  inline `{completed: count of 'finalized'}` IIFE, the classic drift a "third basis" would
  be): lane suite → **2 failed**, exactly the two sharing pins —
  "derives one lane per distinct target project, per-lane pairs summing to the Issue pair"
  (`expected {completed:+0,total:2} to deeply equal {completed:1,total:2}` — the
  terminal-but-unarchived cell) and "derives exactly one lane for a single-project plan…"
  (lane pair ≠ Issue pair). The degradation suite survives it (its shape has no
  discriminating observation — correctly so; the lane suite is the discriminator). The
  shared predicate is pinned, not fixture-coincident.
- **Mutation 2a — reversed lane sort**: lane suite → **2 failed** (the two order-pinned
  `[app-a, app-b, app-c]` assertions), real exit 1.
- **Mutation 2b — sort removed (insertion order)**, the subtle regression: **1 failed** —
  the alias test, whose nodeIds (`a-down` < `a-up`) make first-appearance order
  `[app-b, app-a]` disagree with code-point order. The fixtures do NOT coincide with the
  bug; the code-point property is genuinely discriminated. (I checked this because the other
  lane fixtures and even the live store's canonical node order visit projects in ascending
  id order — the alias test is the one fixture that breaks the coincidence, and it exists.)

Restores verified: `projection.ts` sha `3ae1f8ce…` and `store-issue.ts` `850fbebc…`,
identical to the pre-mutation fingerprints. `dist/` was built before the mutations and never
rebuilt during them, so no CLI-test contamination.

## Findings

**Info-1** — The sanctioned widening run created `.rasen-store/store.yaml` (`id:
issue-layer`) at the worktree root (the receipt `dogfood-store-1-widen-rasen.json` records
`"metadata_created": true` for the source project). Untracked machine-local byproduct of a
sanctioned mutation, not repo content — keep it out of any commit pathspec at ship time.

**Info-2** — Verifier arithmetic, not a defect: the implementer's "93 files / 1633 + 2
skips" and "10/99 issue-status" selections don't reconstruct exactly from directory
boundaries; my equivalent batches (104 files / 1710 + 2 skips + 1 adjudicated flake) cover
every claimed area including both new suites, the full core store family, the CLI family on
dist, and the trio. CI is the authority for the full set.

**Info-3** — `renderIssueList`'s lane-omission branch (no lanes → no `[ … ]` segment,
`store-issue.ts:598-606`) is implemented but not pinned by a CLI test: a render regression
to always printing the bracket segment (e.g. `[]` on an unreadable-revision line) would pass
the suite, since the projection-side absence (`projects: []`) is what the tests pin and the
prior list assertions are `toContain`-based. Cosmetic failure mode; noted so the omission
guarantee is read as design-D4-verified-by-inspection, not test-pinned.

No Blocker, Major, or Minor findings. The lanes are one rule over two scopes and the
mutations prove the tests can tell; the live Store read carries the two-lane projection, the
still-holding cross-project gate, and the byte-stable degradation exactly as the receipts
claim; the staged close leaves the remaining legs honest (no acceptance record exists).
