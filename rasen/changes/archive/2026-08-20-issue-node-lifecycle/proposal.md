## Why

Phase 2's goal says an Issue's status must respect `required`, `optional`,
`cancelled`, and `superseded` nodes — today it cannot, because a plan node
carries no lifecycle at all: every Change node in a revision counts toward
progress, holds the acceptance gate, and is launchable. A portfolio whose
operator drops one child, or whose work is partly nice-to-have, has no honest
way to say so; the only available plan is "everything required forever".
g-001 deliberately froze the node schema (`issue-plan-publication` design
D3/D6) and left this decision to this change: how the four states are
expressed, and what each means through the whole stack — projection, gate,
health, and launch — with history preserved when a state changes.

## What Changes

- Plan nodes gain a **closed lifecycle vocabulary**: an optional `lifecycle`
  field on Change nodes — `required` (the default, and the value an absent
  field has always meant), `optional`, `cancelled`, `superseded` — with a
  mandatory recorded `reason` for `cancelled` and `superseded` (portable
  durable text, refused rather than trimmed).
- The decision g-001 deferred is made: **schema extension on the node
  itself, not a sibling record**. A lifecycle change is a re-publication —
  the next revision says what the current one no longer does, and the earlier
  revision's bytes never change. No new mutation enters the five-mutation
  vocabulary; both existing publication sources carry it (`--from-file`
  authors it; `--from-portfolio` keeps publishing required-only).
- Compatibility with shipped revisions: g-001's `0001`/`0002` (no lifecycle
  field) read back unchanged with every node required, and their digests
  verify byte-identically — the stored canonical form omits `lifecycle` when
  it is `required`, exactly as it omits an absent `changeAlias`.
- The states mean one thing everywhere:
  - **required** — counts toward progress, must complete for review and the
    acceptance gate;
  - **optional** — counted in neither part of progress, never blocks the gate
    on completion, but its work is real: it runs, and its failure is failed
    health like any wanted work;
  - **cancelled / superseded** — outside the execution graph: excluded from
    progress and the gate's required total (the recorded reason shown beside
    the gate), never a launch candidate, and `rasen store issue start` refuses
    one naming its state and reason; their recorded run-state drives neither
    phase nor health;
  - failures and blockages still land in **health**, never in phase.
- Progress reports required nodes only; a readable plan with no required
  nodes reports `0/0`, distinct from the no-value an unreadable plan reports.
- The Issue read surface names each node's lifecycle on its node line (when
  it is not required), in both human and `--json` forms.

## Capabilities

### New Capabilities

(None — the lifecycle vocabulary is plan-revision content, so it lands in
`store-issue-resources`; every derivation rule lands in the spec that owns
that seam.)

### Modified Capabilities

- `store-issue-resources`: ADDED requirement — plan nodes carry a closed
  lifecycle vocabulary (states, default-as-absent, recorded reasons,
  portability, refusal of undefined values); MODIFIED the graph-normalization
  requirement — an explicitly-`required` node and an absent lifecycle are one
  plan.
- `issue-status-projection`: MODIFIED phase (review follows required nodes;
  cancelled/superseded are outside the execution graph), health (failures of
  wanted work only), progress (required-only counting, `0/0` for a readable
  plan with no required nodes), and the read surface (node lines carry the
  lifecycle).
- `issue-acceptance-close`: MODIFIED the gate — only required nodes block on
  completion; optional nodes never block on terminality; cancelled/superseded
  nodes are excluded from the required total with their recorded reason shown
  beside the gate.
- `issue-execution-binding`: MODIFIED node resolution — the runnable frontier
  considers wanted nodes only, and `--node` addressing a cancelled or
  superseded node is refused naming the state and the recorded reason.

(`issue-plan-publication` is deliberately untouched: the channel keeps
publishing exactly what the run-state says, which is lifecycle-free.)

## Impact

- `src/core/store/issues/plans.ts` + `types.ts`: node schema, validation,
  canonicalization, digest body, serializer.
- `src/core/issue-status/` (the one projection seam): lifecycle-aware
  progress/phase/health and node lines.
- `src/core/issue-acceptance/`: required-scoped gate blockers and
  exclusion-with-reason reporting; acceptance gate snapshot stays coherent at
  `0/0`.
- `src/core/issue-execution/`: frontier filter and the two start refusals.
- `src/commands/store-issue.ts`: show/list/gate/start renders. No new CLI
  options or subcommands — the three-way-sync trio (cli-presentation /
  command-registry / locales catalog) must verify UNCHANGED.
- Tests: schema/projection/gate/binding unit suites, CLI render tests, and
  the M-1 pin test stays green untouched (lifecycle adds no reference
  resolution path; the active+archived publication refusal must not weaken).
- Dogfood on a temp store: publish `0001` from a portfolio, publish `0002`
  via `--from-file` cancelling one node (with reason) and marking another
  optional, verify `0001` bytes unchanged, progress re-scoped, gate
  exclusion named, start refused; receipts under `evidence/`.
- Untouched: `src/core/pipeline-registry/` (frozen), `packages/ui/**`,
  version numbers, `issue-plan-publication` channel behavior.
