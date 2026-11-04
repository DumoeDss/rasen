## Context

Phase 2 shipped its machinery and proved it on temp stores: `issue-plan-publication`
(g-001, ship `bfb63865`) publishes an Issue Execution Plan from a parent
change's real portfolio run-state; `issue-node-lifecycle` (g-002, ship
`31d0b644`) made the four lifecycle states mean one thing through projection,
gate, health, and launch. Both dogfoods used OS-temp stores with
fixture-minted identities and were torn down (receipts in the archives).

The real portfolio's state exists and is live:
`.rasen/changes/issue-multi-change-execution/ephemera/portfolio-run.json`
names the three children with their DAG (g-001 `done`, g-002 `done`, g-003
`in_progress`), and each child has real per-child run-state under the
worktree's ephemera (g-001's `auto-run.json` reads all stages `done`).

Machine facts verified for this design: `E:\...\Reference\` is outside every
Git repository; the machine registry (`~/.rasen/stores/registry.yaml`) holds
several stores, including one stray empty v1-layout `rasen-store` beside the
repo (single "Initialize" commit, no members); `rasen store setup` today
writes the flat v1 scaffold and no layout declaration, which is exactly the
`store_layout_mixed_residue` trap every temp-store dogfood had to retire by
hand (g-002 implementer finding (a), binding).

## Goals / Non-Goals

**Goals:**

- A persistent Store, born clean (layout 2 declared at creation, no flat
  residue), at a durable path outside every repo and outside temp, surviving
  this change as the machine's Issue registry.
- This repository registered as its member project through the real
  three-step chain, addressed at the main checkout.
- The real portfolio's children as the store's first committed evidence —
  explicit list, shipped identity helpers, one copy per instance.
- Issue #1 = `issue-multi-change-execution`: revision 0001 from the real
  run-state, live projection as g-003 completes, acceptance at portfolio
  close, the Issue read back resolved and `done`.
- The one product capability the clean baseline needs: `rasen store setup
  --layout 2`. Near-zero code; default unchanged.
- Receipts for every step + a durability statement.

**Non-Goals:**

- A product surface for the seeding (operator bootstrap tooling under this
  change's ephemera `research/`, using shipped helpers; a repeatable
  `store seed` command is a follow-up, not this change).
- Migrating this repository's planning root into the store (planning stays
  repo-local; membership carries no planning binding — "membership alone
  never binds").
- Cross-project anything, UI, pipeline changes, version bumps.
- Tearing down or altering the stray `rasen-store` (the operator's store;
  noted in receipts as retirement candidate).
- Re-publishing the plan when a child drops (no child is dropped; if one
  were, g-002's cancel flow applies verbatim).

## Decisions

### D1 — Fresh store at `Reference\rasen-issue-store` (id `issue-registry`), not reuse of the stray

The stray `rasen-store` is registered, uid-minted, and empty — reuse was
considered and declined: it is v1-shaped, so reuse re-runs the manual
flat-retirement dance the new flag exists to eliminate; its generic name and
unknown provenance ("Initialize" only) make it the operator's to retire, not
this change's to repurpose; and the mandate calls for `store setup` at a
chosen durable location. The new store is created with `--layout 2`, so the
residue trap never exists for it. `Reference\` verified outside every Git
repository; nothing about the store is machine-layout product truth — the
path is operator choice recorded in receipts, not in specs.

### D2 — `rasen store setup --layout 2`: explicit authoring, default unchanged

One option on `setup [id]`: `--layout 2` (value-validated; anything else
refused naming the accepted value). With it, the bootstrap writer emits
`layoutVersion: 2` beside `version: 2` in `store.yaml` and creates no flat
planning tree (the v2 store's planning content arrives with its first member
project; an empty v2 store needs none — `store-registration` already holds
that empty planning directories are optional for health). Without it, setup
is byte-for-byte today's behavior. This composes with the declaration
requirement it modifies: the declaration remains explicit and independent —
the flag IS the explicit request — and no read path infers anything. Locale
keys + completions entry for the new option; three-way-sync trio runs in the
child gate (one option added, expecting exactly that diff).

### D3 — Member registration: the main checkout, through the real chain

`rasen store add-project E:\...\Reference\OpenSpec-code --to issue-registry
--as rasen`. The main checkout satisfies the chain by nature (path exists as
a repo; healthy rasen root), and the v2-native store has no residue, so the
chain passes without hand-holding — which is the point of D2. The command
writes the membership authority record in the store and the membership hint
into the main checkout's `rasen/config.yaml`; both get pathspec-scoped
commits (the store's by this change; the main checkout's coordinated with
the operator/LEAD — a cross-checkout write this design explicitly flags).
The worktree is never registered (Phase-1 lesson 6: worktree-share
penetration). No `--set-primary`; the hint makes the store a resolution
candidate, membership binds no planning. Target line `line-0.2`:
`storeRef refs/heads/main` (store), codeRef `refs/heads/dev/0.2.0` (the
line this portfolio ships onto).

### D4 — Seeding the real children: explicit list, shipped helpers, one copy per instance

For each child BY NAME (no pattern matching, per project rules):

- **Archived children** (`issue-plan-publication`, `issue-node-lifecycle`):
  mirror the repo's real archive entry under
  `rasen/projects/<projectId>/changes/archive/line-0.2/<entry-name>/`,
  adding an identity-carrying `.openspec.yaml` (every scalar quoted — the
  fixture-documented YAML typing trap). The repo's `archive.json` rides
  along as the legacy record it is (`readArchiveEntry` reads it as
  `legacyRecord` with no outcome — honest: the finalized observation comes
  from the children's real terminal run-states, which "count the same").
- **The active child** (`issue-persistent-baseline`): metadata-only entry
  under `rasen/projects/<projectId>/changes/issue-persistent-baseline/` —
  its artifacts are still moving; the committed-evidence contract needs
  identity, and its observation comes from its live run-state.

Identities minted with the shipped helpers — `derivePlanningScopeId(storeUid,
projectId, line-0.2)` + `deriveChangeInstanceId({planningScopeId,
instanceSeed})` — exactly what the g-002 fixture and the store-planning
resolver do; seeds recorded in the receipts beside the instanceIds they
derive (the `.openspec.yaml` carries and proves the identity itself).
Exactly ONE committed copy per instance in the store, so the g-001 M-1
active+archived refusal shape cannot arise — the repo's own archive is not
store evidence and never enters the search. Archive entry names keep the
repo's dated form (`2026-08-20-issue-plan-publication`); g-001's resolver
matches them through the archive engine's own date-prefix splitter.

### D5 — Issue #1: the real loop, from the worktree, into the store

`rasen store issue new issue-multi-change-execution --store issue-registry
--title ...`; `rasen store issue plan issue-multi-change-execution
--from-portfolio issue-multi-change-execution` run with cwd = the worktree,
so the publication resolves the real run-state through the resume seam
(worktree ephemera) and the projection's run-state locator sees per-child
ephemera (g-002 implementer finding (b)); `rasen store issue acceptance
... --from-file` with the portfolio's real completion criteria. As g-003
drives to ship/archive, `rasen store issue show --store issue-registry` from
the worktree shows the tri-axis moving (2/3 → 3/3, `active` → `review`). At
portfolio close — all children run-terminal or finalized — `rasen store
issue accept` records the acceptance, resolves the Issue, and it reads back
`done`. Every store write commits pathspec-scoped on the store's `main`;
nothing is staged by Rasen anywhere.

Chicken-and-egg note: the gate needs every required node's work complete,
including g-003 itself; acceptance is therefore a portfolio-close act after
g-003's own pipeline reaches terminal — the sequence the loop already
implies, stated here so the operator stages it that way.

### D6 — Durability statement (receipt content, not spec)

The store persists at the durable path with its own Git history (bootstrap,
membership, target line, seeding, Issue content — one commit each,
pathspec-scoped), registered in the machine registry under its permanent
uid. Future sessions reach it with `--store issue-registry` from anywhere,
and the repo's membership hint makes it the store candidate for this
project's store-scoped commands. Backup is the operator's follow-up (add a
remote when desired); receipts state this plainly.

## Risks / Trade-offs

- [The main checkout receives a config write (membership hint)] → Flagged
  dependency: coordinated with the operator/LEAD; pathspec-scoped, one line,
  committed on the main checkout; planning resolution unchanged (hint ≠
  binding).
- [Seeded identities are new facts about historical changes] → Honest
  bootstrap: the identities live in the store's committed metadata and prove
  themselves; the receipt records seed→instanceId mappings; nothing in the
  repo's own history is rewritten.
- [Run-state visibility is worktree-local] → Reads that want live per-child
  observation run from the worktree (documented in receipts); from anywhere
  else the projection still derives phase/progress from committed evidence —
  the designed behavior, exercised deliberately both ways.
- [Store durability without a remote] → Local-path + Git history + machine
  registry is durable for this machine; remote/backup is the operator's
  follow-up, stated in the durability receipt.
- [CRLF warnings on store Git operations (seen in every dogfood)] →
  Cosmetic Windows autocrlf chatter; no action, receipts note it.
- [`--layout 2` interacts with existing setup consumers] → Additive option,
  default path untouched; focused tests pin both branches; the stray
  v1 `rasen-store` is untouched evidence the default still produces legacy
  stores.

## Migration Plan

The product delta is one additive option (rollback = revert). The machine
state is deliberately NOT rolled back: the store persists by design. If the
baseline must be undone, `rasen store remove issue-registry` plus removing
the hint line from the main checkout's config reverses it — documented in
the receipts, not planned.

## Open Questions

- None blocking. (Whether the seeding deserves a product surface, and
  whether the stray `rasen-store` should be unregistered, are operator
  follow-ups recorded in the receipts.)
