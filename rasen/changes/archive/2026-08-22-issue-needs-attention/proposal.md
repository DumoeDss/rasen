# Proposal — issue-needs-attention

## Why

Phase 5's operator question — "what across my Issues needs a human right now" — has no single
answer today: each Issue's tri-axis status carries its health honestly, but a human watching a
portfolio must open every Issue to learn that one node failed, another waits parked, a third's
run-state is unreadable, and a fourth Issue sits in review awaiting its acceptance. The
roadmap's §8 exit criteria name this surface directly (失败/阻塞/等待人工的统一视图, 失败不被
运行掩盖), and the P5 foundations — health separation (P1), named blockers (P3), the exit-reason
vocabulary and ready set (g-001) — exist precisely so an aggregation can consume them without
inventing a second basis. This is the Phase 5 finale: the aggregation entry, plus the Issue #4
dogfood that walks the whole layer end to end on the persistent store.

## What Changes

- A deterministic attention derivation per Issue, composed from the status projection's own
  facts (beside the ready set, one seam, persisted nowhere): `failure` items (wanted nodes
  observing failed), `blocked-behind` items (not-started nodes whose direct blockers observe
  failed/waiting-human/unknown — the blast radius of trouble, named with their blockers;
  ordinary serial waits are NOT attention), `waiting-human` items (parked stages),
  `acceptance-awaiting` items (Issues in review — open with required work complete, or
  resolved without a verified record — carrying the gate evaluation), and `problem` items
  (every standing status problem: invalid run-state, invalid archive record, unreadable
  plan or acceptance, unresolved or ambiguous references, unsearched refs).
- The cross-Issue read verb `rasen store attention [--store] [--issue <id>] [--json]`: a scan
  summary (every Issue scanned with its phase/health and attention count — healthy in-flight
  work visible as scanned, honestly absent from the items) followed by the items grouped by
  kind in fail-first order, every item carrying its Issue's phase and health so a failure
  among running siblings reads as failed, never masked. An honest empty state when nothing
  needs attention. Writes nothing.
- Issue #4 dogfood on the persistent store `issue-registry` (staged at implementation):
  author this portfolio as Issue #4 through the P4 path on the real planning members, seed
  the shipped children's archived evidence store-side so their nodes read terminal, capture
  aggregation receipts at each stage (authoring, shipped-children-terminal, g-003 in-flight
  as scanned-active-healthy — honest absence, staged failure shape surfacing unmasked), and
  STAGE the close (conditions + accept documented; executed only if genuinely terminal at
  the implementer's hands, the LEAD close precedent).
- The P5 exit-criteria evidence set (replanning-preserves-history receipts from g-002's
  shipped pins; failure-not-masked receipts; the aggregation receipts) lands in this change's
  evidence directory.

## Capabilities

### New Capabilities

- `issue-needs-attention`: the attention vocabulary and derivation through the projection,
  the honesty of absence (ordinary progress is not attention), the never-masked failure
  grouping, and the `rasen store attention` cross-Issue read surface.

### Modified Capabilities

- None — every consumed fact (health, observations, blockers, problems, gate) is already
  spec truth in its owning capability; this change only aggregates them.

## Impact

- `src/core/issue-status/` — a new `attention.ts` derivation module + types (a projection
  post-pass like the ready set; the projection itself unchanged).
- `src/commands/store.ts` — the store-level `attention` subcommand with `--issue` narrowing
  and `--json` parity; locale (en/ja/zh-cn) and completions sync per the command-surface
  discipline.
- Tests — per-scenario unit pins, the cross-issue aggregation suite, the
  failed-among-running-siblings integration receipt, read-only guard and determinism.
- Dogfood (implementation-stage): persistent-store commits on `issue-registry` (Issue #4
  authoring, seeded child evidence, receipts) — the repo's planning roots untouched by
  dogfood acts; close acts only in evidence.
- Fences kept: no UI, no `src/core/pipeline-registry/` change, no version bumps, the five
  Issue mutations stay five (attention is a read), manual selection only.
