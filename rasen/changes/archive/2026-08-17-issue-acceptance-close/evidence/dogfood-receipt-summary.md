# Dogfood receipt summary — issue-acceptance-close (design D9)

Date: 2026-08-17. Machine: win32. CLI: `node bin/rasen.js` from the portfolio
worktree (branch `feat/issue-layer`, implementation complete at this working
tree, dist rebuilt from it).

## Phase A — rebuild (C1 trap list + C2 additions), receipt

- Store at `%LOCALAPPDATA%\Temp\rasen-issue-layer-dogfood`, uid
  `cb7aec85-1c36-4fa5-ad1b-8d081dcb3322`, registry id `issue-layer-dogfood`;
  created by `store setup`, then:
  - **branch renamed `master` → `main` BEFORE any publish** (C2 trap: the
    target line declares `refs/heads/main`; unrenamed, every publish fails
    `store_query_ref_unreadable` — verified paid off: plan 0001, conditions
    0001, plan 0002, and the accept all published clean);
  - `layoutVersion: 2` HAND-declared in `.rasen-store/store.yaml` (the
    migrate-layout-on-empty-store trap) and the empty flat `rasen/` tree
    removed, one commit;
  - `store add-project . --to issue-layer-dogfood` — membership keyed
    `e2ee72ed-04a1-4395-86aa-7e77d2b83ec7` (the REAL machine project identity;
    the worktree-share rule makes an `issue-layer` registration impossible
    without clobbering the main checkout — C2 finding 1, not re-fought here);
    expected config double-write (`rasen/config.yaml` hint + worktree
    `.rasen-store/store.yaml` residue) both cleaned at teardown;
  - `store target-line add main --store-ref refs/heads/main --code-ref
    refs/heads/feat/issue-layer` (full refs required);
  - three child changes seeded under
    `rasen/projects/e2ee72ed-…/changes/` with `.openspec.yaml` v2 identity
    blocks, ALL scalars quoted (the C1 trap), committed on the store's `main`;
  - `store issue new issue-layer-phase1` + three-node plan `0001`
    (`g-001..g-003`, serial `dependsOn`, naming the three seeded instances),
    committed. Store history: `2eabf1a` init → `b72875b` layout v2 →
    `28278ce` membership + line → `abc151d` seed children → `b91ffed`
    issue + plan.

## Phase B — conditions receipt

`evidence/dogfood-phase-b-conditions.txt` +
`evidence/dogfood-phase-b-show-gate.txt`: `store issue acceptance
issue-layer-phase1 --from-file <conditions.yaml>` published revision `0001`
with the three REAL portfolio conditions (projection shipped; binding loop
proven; acceptance gate proven — each with its verification note), and
`store issue show` displayed them with the gate: **not eligible**, naming
`node g-001 is unknown`, `node g-003 is in-flight`, and the g-001
`invalid-run-state` problem — together, not one at a time.

Live-truth note: at receipt time the worktree's real run-state showed
g-001 `unknown` (its C1-era `auto-run.json` records `openFindings` as strings
where the current reader expects objects — honest problem output, recorded as
a durable finding) and g-003 `in-flight` (this very child, mid-apply).

## Phase C — HOLD receipt

`evidence/dogfood-phase-c-hold.txt`: from the WORKTREE cwd (the execution
root where the live portfolio run-state lives), `store issue accept
issue-layer-phase1` refused with exit code 1, naming the live un-terminal
node (`g-003 is in-flight` — this child, in flight RIGHT THEN), plus
`g-001 is unknown` and the g-001 `invalid-run-state` problem. No acceptance
record was written.

## Phase D — CLOSE receipts

`evidence/dogfood-phase-d-close.txt`:

- The three children seeded as ARCHIVED entries (moved to
  `changes/archive/main/2026-08-17-<changeId>--<digest-prefix>/` with
  committed `archive.json` v2 records, outcome `landed`) and **plan revision
  `0002`** published naming the same instances → all three nodes read
  `finalized` from committed Store evidence alone.
- `store issue show` then reported the gate **eligible** (would accept
  conditions revision 0001) with the record still absent.
- `store issue accept … --note` → `accepted (resolved)`: the acceptance
  record written AND the state transitioned in one suggestion naming BOTH
  pathspecs (`accepted.yaml` + `issue.yaml`); the record froze conditions
  revision 0001 + its digest, the gate snapshot `3/3 waiting-human, 0
  problems standing`, and the note.
- After committing (the query prefers committed copies), `store issue show`
  reads `state: resolved`, `phase: done`, `health: healthy`, `progress: 3/3`,
  the acceptance block with the record line (`accepted 2026-08-17T01:56:38Z
  under revision 0001 (gate 3/3 waiting-human)`), and the gate honestly
  reading `not eligible — already carries an acceptance record`.
- `store issue list` shows `issue-layer-phase1  [resolved]  done/healthy 3/3`.
- A second `store issue accept` refuses `already carries an acceptance
  record` with the never-rewritten fix, exit 1.

The failed-health HOLD is covered by the labelled unit fixture in
`test/core/issue-acceptance/issue-acceptance-gate.test.ts` ("holds the gate
on failed health") — no real failure exists in this portfolio, and
fabricating one in live run-state would be theater (design D9's own rule).

## Phase E — teardown

- `store remove issue-layer-dogfood --yes` (registry entry removed).
- `git restore rasen/config.yaml` (the membership hint) and the worktree
  `.rasen-store/` residue deleted.
- The temp store tree and both temp YAML files deleted.
- Branch footprint verified: `git status` in the worktree lists exactly this
  change's own files (new module + tests + the widened seam + locales +
  command registry + the change directory). The main checkout and the
  canvas-ir-compiler worktree untouched.
