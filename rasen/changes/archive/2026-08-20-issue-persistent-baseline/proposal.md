## Why

g-001 and g-002 shipped the Issue layer's Phase 2 machinery — portfolio→plan
publication and the four-state node lifecycle — but proved it only on
throwaway temp stores. The machine has no persistent Issue registry: no
durable Store this repository is a member of, no real Issue, and no run of
the full loop (publish from a real portfolio → live tri-axis projection →
acceptance over real archived children) against state that survives the
session. Phase 2 closes only when that loop runs for real and the store
persists as the machine's registry going forward.

## What Changes

- **The first persistent Store for this workflow**, created at a durable
  location outside every Git repository and outside temp space:
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\rasen-issue-store`
  (store id `issue-registry`), registered on the machine and outliving this
  change. It is not torn down; receipts carry a durability statement (where
  it lives, how future sessions use it).
- **One small product capability the baseline needs to be born clean**:
  `rasen store setup --layout 2` — creating a store that declares planning
  layout version 2 from the start, so the flat v1 scaffold and the
  `store_layout_mixed_residue` retirement dance (hit by every temp-store
  dogfood so far) never exist for a new store. `--layout` is an explicit
  operator request; without it setup stays exactly as it is. This is the
  change's only product-code delta; everything else is the real-world
  integration of shipped capabilities.
- **This repository registered as the store's member project** through the
  real three-step chain, addressed at the MAIN checkout (never a worktree —
  the worktree-share lesson), with the membership hint committed on both
  sides, and a real target line (`line-0.2`) whose store ref carries the
  project partition.
- **The bootstrap seeding of the portfolio's real children** as the store's
  first committed evidence — by explicit list, no pattern matching:
  `issue-plan-publication` and `issue-node-lifecycle` as archive entries
  mirroring their real archived directories, `issue-persistent-baseline` as
  an active entry, each carrying an identity minted with the shipped
  planning-identity helpers. One copy per instance, so the g-001 M-1
  active+archived refusal shape cannot arise.
- **Issue #1: `issue-multi-change-execution`** — this portfolio itself.
  Revision 0001 published from the real portfolio run-state via
  `--from-portfolio` (run from the worktree so per-child ephemera is
  observable), acceptance conditions authored, the live tri-axis watched as
  g-003 completes, and at portfolio close the acceptance gate evaluated over
  the children's real evidence and the Issue accepted — resolved and `done`
  through the recorded acceptance.
- Receipts under `evidence/` for every step, plus follow-up notes for the
  ergonomics gaps observed but not blocking (the seeding is operator
  bootstrap tooling, not product; the stray empty `rasen-store` beside the
  new one is the operator's to retire).

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `store-planning-layout-v2`: MODIFIED "Layout version is declared explicitly
  and independently" — setup can author the declaration at creation as an
  explicit operator request; nothing is inferred and the no-flag default is
  unchanged. Two scenarios added, none renamed.

## Impact

- Product code (near-zero): `rasen store setup` (`src/commands/store.ts` +
  the bootstrap writer) gains `--layout 2`; locale keys for the option in
  en/ja/zh-cn; completions registry entry. No other module changes; the one
  projection seam, `src/core/pipeline-registry/`, and `packages/ui/**`
  untouched; no version bumps.
- Machine state (persists): the store at
  `Reference\rasen-issue-store` + its machine-registry entry; the main
  checkout's `rasen/config.yaml` membership hint (operator-committed); the
  store's own Git history (membership, target line, seeded children, Issue
  content).
- Operational: the seeding script lives in this change's ephemera
  `research/` and uses only shipped helpers; receipts under
  `rasen/changes/issue-persistent-baseline/evidence/`.
- Tests: focused coverage for `--layout 2` (v2-native store.yaml, no flat
  scaffold, no residue on immediate add-project) and the no-flag default
  unchanged; the loop itself is receipt-verified on the real store.
