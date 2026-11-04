# Proposal — issue-revision-history-preservation

## Why

Replanning is the Issue layer's normal motion — revisions add work, mark nodes superseded, and
retarget nodes across member projects — but the guarantees that make replanning safe are
pinned nowhere: nothing yet proves that publishing a revision never disturbs existing nodes'
observed history, that a superseded node's exit is total across every consuming surface, or
that a retargeted node's observation lineage is exactly the new instance's. One piece is
genuinely missing rather than merely unpinned: the durable acceptance record freezes a
required-total that shrinks when nodes are superseded, but carries no record of WHY — the
exclusions with their reasons live only in a later read's evaluation, so an accepted Issue's
own close evidence cannot explain its own arithmetic.

## What Changes

- The observation-continuity invariant, landed as spec truth and pinned: publishing a new
  revision never changes a node's observed execution state except through real execution or
  Store evidence — adding nodes, re-edging, and lifecycle changes on other nodes leave
  untouched nodes fact-for-fact identical; a superseded/cancelled node keeps its observation
  on its node line outside the graph.
- Superseded semantics verified total and pinned across every consumer: the ready-set exit
  with its recorded reason (g-001 truth), the acceptance gate's required-total exclusion with
  its reason (P2 truth — verified, not rebuilt), and history queryability (the revision delta
  names the lifecycle change; the prior revision stays immutable and readable; the superseded
  node's observation stays on its line).
- The durable acceptance record carries its own arithmetic: the gate's cancelled/superseded
  exclusions — node, lifecycle, recorded reason — are written into the accepted record, so
  the total it freezes is explained by the record itself. The field is omitted from the
  canonical form when no exclusion stands, and records accepted before the field existed
  read back unchanged with their digests verifying.
- The retarget rule named and pinned: a Change node whose target project or line changes
  between revisions carries a new Change instance (publication refuses the old instance
  under `issue_reference_scope_conflict`), the new revision reads it fresh unless the new
  instance carries its own run-state or archive evidence, no observation is inherited across
  the retarget, and the prior lineage's facts stay readable in the prior revision and the
  revision delta's retarget entry.

## Capabilities

### New Capabilities

- None — every requirement lands in the capabilities that own the surfaces it constrains.

### Modified Capabilities

- `issue-status-projection`: two ADDED requirements — publishing a revision preserves other
  nodes' observations (the continuity invariant, lifecycle and edge changes included), and a
  retargeted node starts a new observation lineage (fresh unless the new instance carries
  evidence; prior lineage stays readable where it lives).
- `issue-acceptance-close`: MODIFIED requirement — the acceptance record is durable close
  evidence that explains its own required-total, carrying the gate's lifecycle exclusions
  with their recorded reasons; omitted from the canonical form when empty, with pre-field
  records reading back unchanged.

## Impact

- `src/core/store/issues/acceptance.ts` + `types.ts` — the optional exclusions field on
  `IssueAcceptedRecordV1`, the strict schema, and the digest body (absent omitted, the
  plan-node suggestion-field precedent).
- `src/core/issue-acceptance/orchestration.ts` — `acceptIssue` writes the gate evaluation's
  exclusions into the record; read surfaces that present the record present the exclusions
  it carries (`store issue acceptance` / `show`'s acceptance block, human and `--json`).
- `src/core/store/issues/module.ts` + `src/commands/store-issue.ts` — the accept
  mutation seam that writes the field (an empty accounting canonicalized to the
  absent form before any byte lands) and the renderers that present the carried
  exclusions beside the gate snapshot (`accept`'s write result and `show`'s
  acceptance block, human and `--json` — design D3's coverage, named file by
  file).
- Tests — the continuity, retarget, and exit pins (temp stores; several are expected to pass
  immediately as structural truths — their deliverable IS the pin, with at least one
  mutation check that the guard bites), the durable-carry suite including old-record
  compatibility and empty-exclusion byte identity.
- No CLI surface added; no new derivation seam (the projection is unchanged code-wise — the
  invariants are its existing behavior stated and pinned); fences kept: no UI, no
  `src/core/pipeline-registry/` change, no version bumps, five Issue mutations stay five,
  the persistent store untouched (Issue #4 dogfood is g-003's).
