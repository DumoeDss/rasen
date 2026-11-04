# Review — `issue-persistent-baseline` (VERIFY, small-feature)

Reviewer: independent (reviewer for child 3/3 of `issue-multi-change-execution`).
Date: 2026-08-20. Everything below re-derived by the reviewer against the live
store and the worktree, not from receipts. The live store was read-only to this
review (reads + `store issue show` only; zero writes, zero commits).

## Verdict

**PASS — 0 Blocker, 0 Major, 2 Minor** (both receipt-wording level; no code
findings). The change's central claim — the full Issue loop running against a
persistent, born-clean store over real evidence — verified against reality
exactly as claimed.

## Test gate (re-run, real exit codes, no pipes)

`pnpm run build` exit 0 first (CLI tests execute dist/). Batches re-run from
the worktree with `pnpm exec vitest run`, each redirect-only:

| batch | files | tests | exit |
| --- | --- | --- | --- |
| NEW `test/commands/store-setup-layout-cli.test.ts` | 1 | 7/7 | 0 |
| PRIOR `test/commands/store.test.ts` (zero edits — `git diff -- test/` empty) | 1 | 50/50 | 0 |
| trio: catalog + cli-presentation + command-registry | 3 | 34/34 | 0 |
| store family: openspec-root, identity, identity-writers, registry, store-git, store-add-project | 6 | 100/100 | 0 |
| store family: references, remote, identity-cli, identity-migration, declared-store-fallback | 5 | 66/66 | 0 |
| store family: migrate-layout-cli, migration-cli, aggregate-cli | 3 | 16/16 | 0 |
| **total** | **19** | **273/273** | **all 0** |

Matches the implementer's claim exactly. `node bin/rasen.js validate
issue-persistent-baseline` → "Change 'issue-persistent-baseline' is valid",
exit 0 (positional form). Fence `git diff -- src/core/pipeline-registry/
packages/ui package.json` → **0 bytes**.

## The live loop (verified against reality)

`store issue show issue-multi-change-execution --store issue-registry --json`,
run by the reviewer from the worktree cwd (exit 0):

```
state: open | reason: null
phase: active | health: healthy | progress: 2/3
node issue-node-lifecycle      observation: run-terminal  locatedBy: execution-root
node issue-persistent-baseline observation: in-flight     locatedBy: execution-root
node issue-plan-publication    observation: run-terminal  locatedBy: execution-root
gate eligible: false | refusal: issue_accept_blocked
blockers: [{"kind":"un-terminal-node","nodeId":"issue-persistent-baseline","observation":"in-flight"}]
acceptance record: null | problems: []
```

Phase active, health healthy, progress 2/3, gate HOLDING with **exactly** the
one named blocker — zero deviation from the claim. Staged-not-accepted
confirmed on the store itself: `issue.yaml` `state: open`, `acceptance.record:
null`, and the store tree holds `issue.yaml` / `plans/0001.yaml` /
`acceptance/0001.yaml` with **no** acceptance record anywhere.

Store state (read-only): branch `main`, **clean tree, exactly 6 commits**
(`39847ce` bootstrap · `4b2908d` membership · `4964916` target line ·
`9d1452d` seeding · `b38b3f5` issue+plan 0001 · `7dabc20` conditions 0001);
`store.yaml` carries `version: 2` + `layoutVersion: 2` + uid
`f76edc31-229a-42bc-a5c7-848021eeb2da`; no flat `rasen/specs`/`rasen/changes`
ever exists in the tree; machine registry entry present under the uid.
Main checkout: membership hint present in `rasen/config.yaml` (` M`,
uncommitted) and `.rasen-store/store.yaml` (`??`, untracked) — tip still
`2fc92079`, **nothing committed there** by this change.

## Claims swept

- **Seeding is genuine, not fabricated.** All three committed instanceIds
  independently re-derived by the reviewer through the shipped helpers from
  the recorded seeds (`derivePlanningScopeId` → `ps_5e57bf1a…` matches the
  receipt; `deriveChangeInstanceId` → 3/3 MATCH the committed
  `.openspec.yaml` identities and plan-0001 nodes). Exactly 3
  `.openspec.yaml` under `rasen/projects/` (two dated archive entries + one
  active entry, distinct names) — the M-1 shape cannot arise; the seeding
  script's duplicate-name guard confirmed in source.
- **Mirror (Phase-3 finding i) verified lossless.** Dated mirrors vs undated
  sources differ in exactly one key, `openFindings`: bare strings →
  `{summary: <string>}` verbatim (g-001: 3, g-002: 2), no severity invented,
  every stage verbatim; all stages `done` in both mirrors — run-terminal comes
  from the children's REAL run-states. Undated sources untouched (still bare
  strings). Mirror dirs contain only the mirrored `auto-run.json`. Store tree
  clean — **no store-side truth was mutated to force the projection**.
- **`--layout 2` product delta.** Option value-validated before any prompt or
  disk touch (`parseSetupLayoutOption` at `src/commands/store.ts:626` runs
  ahead of id/path prompts); declaration rides the identity mint; existing
  legacy store refuses `store_setup_layout_existing_metadata` with a fix
  naming the real `migrate-layout` command; v2-rerun is a no-op success.
  Double-guarded in `prepareSetupPlan` and again in `setupPreparedStore`.
- **No-flag default pinned.** Prior `store.test.ts` byte-untouched (empty
  `git diff -- test/`) and green 50/50, including its own byte-exact
  `created_files` pins (store.test.ts:155/294/322); new suite additionally
  pins the legacy default shape and `not.toContain('layoutVersion')`.
- **Option-level three-way sync.** `git diff --numstat`: en/ja/zh-cn each
  +3/0 at `cli.root.commands.store.commands.setup.options.layout`; all three
  JSON-parse, zero U+FFFD (reviewer-scanned raw bytes); completions
  `layout takesValue` +4/0. Exact shape, nothing else rides along.
- **Spec delta.** Synced requirement holds exactly the 3 prior scenarios; all
  3 survive byte-identical in the delta, 0 dropped, 0 renamed; delta adds 2
  new scenarios (land at archive). Matches the script-verified 3/2/0 and the
  titles-are-identity-labels discipline.
- **Durability statement (5-1).** Records path, uid, registry entry, git
  history, member identity, target line, usage commands, backup follow-up —
  sufficient, with one gap → Minor 1.
- **architecture-index.** Quick-locate is command-level (`rasen store` →
  `src/commands/store.ts`); one option on an existing command needs no row.
  Reviewer concurs — no index change required.
- **Membership commit shape.** The 19 deletions in the store's config at
  `4b2908d` verified to be the optional comment scaffold dropped by the
  append rewrite; `schema`/`projectId` content preserved, `references` added.

## Fixture-coincidence (does the new suite discriminate?)

Yes, on every named mutation:

- **Flip the layout default / stop authoring the declaration** —
  `authors the layout-2 declaration…` fails at `metadataText` containment,
  `readStoreMetadataState` matchObject, and `readStoreLayoutState` declared 2;
  `passes an immediate add-project…` fails at `layout.declared === 2`.
- **Remove the existing-store refusal** — `refuses --layout 2 against an
  existing legacy store…` fails at exitCode 1 + `store_setup_layout_existing_metadata`
  + fix-names-migrate-layout + metadata-unchanged.
- **Default drift** — `keeps the no-flag default…` byte-pins the legacy
  `created_files` list and asserts no `layoutVersion`.

The suite drives the REAL CLI (dist) against temp stores — no writer mocks
that could coincide with the defect.

## Findings

### Minor 1 — durability receipt overstates what "from anywhere" shows

`evidence/5-1-durability.md:28-34` (and design Risks): "from anywhere else the
projection still derives phase/progress from committed evidence." True at the
letter, materially incomplete in effect. Reviewer ran the same `store issue
show` from a non-worktree cwd: **phase `ready`, progress `0/3`, every node
`not-started`, `runStateVisibility: none`** — because the seeded v1
`archive.json` legacyRecords carry no outcome and terminal observations are
execution-root-visible only. The receipt's worktree qualification covers
"live per-child run-state observation" but not the axis values themselves, so
a future session following the documented "from anywhere" commands sees an
Issue that looks untouched (0/3 ready vs the real active/2/3). Not a product
defect — shipped g-002 semantics, and the staged 4.3/4.4 steps correctly pin
cwd = worktree. Failure scenario: an operator runs the durability receipt's
"from anywhere" show command after this session, reads `ready 0/3`, and
concludes the loop never ran / regressed. Fix: one sentence in 5-1 stating
out-of-worktree reads show `ready`/`0/3`/`not-started` for legacy-record
claimants until records carry outcomes.

### Minor 2 — terminal observations hinge on worktree-local files; close the loop before any worktree cleanup

The g-001/g-002 `run-terminal` observations (and therefore the 3/3 + `review`
capture and the 4.4 gate evaluation) depend on machine-local, never-committed
files: the dated mirrors AND the undated real sources they normalize, both
under this worktree's `.rasen/changes/`. `4-issue-loop.md` documents the
mirror as "machine-local, regenerable" — regenerable holds only while the
undated sources survive, and those are equally worktree-local. Failure
scenario: the worktree is cleaned or reset after portfolio close but before
(or without) re-running 4.3/4.4 from it — the gate then sees `not-started`
nodes, `accept` refuses, and the sources needed to rebuild the mirrors are
gone (the seeding identities are committed, but the run-states are not).
Fix: add one line to the staged 4.3/4.4 section — run both from the worktree
BEFORE any worktree cleanup, and capture the 3/3 receipt at that moment.

Both findings are receipt/documentation-level; the code delta, the store, and
the live loop are clean as claimed.

## Round-1 re-review

Both fixes re-verified against the findings' requirements (reviewer re-read
the landed text; fences re-checked: `git diff -- src/core/pipeline-registry/
packages/ui package.json` still 0 bytes):

- **Minor 1 → CLEAN.** `evidence/5-1-durability.md:31-35` now carries the
  reviewer-measured caveat verbatim in substance: out-of-worktree reads show
  `ready` / `0/3` / every node `not-started` with `runStateVisibility: none`
  for these legacy-record claimants until store records carry outcomes,
  labeled as the designed g-002 semantics and NOT a regression of the
  captured loop — exactly the one clarifying sentence the finding asked for,
  placed directly after the sentence it qualifies.
- **Minor 2 → CLEAN.** `evidence/4-issue-loop.md` staged 4.3/4.4 section now
  opens with the pre-cleanup warning: run both steps from the worktree
  BEFORE any cleanup or reset, the terminal observations depend on
  worktree-local never-committed files (dated mirrors AND undated sources),
  unrecoverable after cleanup, capture the 3/3 receipt at that moment —
  exactly the sequencing guard the finding required.

**NEW findings: none.** Round-1 verdict: CLEAN — the change stands at
0 Blocker / 0 Major / 0 Minor open.
