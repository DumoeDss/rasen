# Design — issue-delivery-evidence-rollup

## Context

The Issue layer P1–P5 chain is complete: projection, gates, acceptance, exclusions, ready
set, attention, history preservation. The persistent store `issue-registry` holds four done
Issues whose twelve change nodes split into nine archived entries (all v1 ledgers) and three
run-terminal nodes located through workspace-index/execution-root run-state. Every archived
entry's `archive.json` is already fetched and parsed by `StoreAggregateQuery.readArchiveEntry`
(`src/core/store/query/module.ts:418`) — but only the outcome column survives that read; the
delivery facts (codeCommit, planningBranch, evidence inventory, missing names) are discarded.
Phase 6 g-001 is the aggregation read surface over those facts: no new writes, no new truth.

Constraints (portfolio fences): no UI (`packages/ui/**` frozen), `src/core/pipeline-registry/`
frozen, no version changes, one projection seam, close acts only in evidence, human/JSON
parity, absent evidence reads as named absence.

## Goals / Non-Goals

**Goals**

- Per-Change-node delivery facts on the Issue read surface, derived on read, store-pure.
- An Issue-level rollup a reviewer (and g-002's unified review) can consume: every entry
  listed, honest counts, named absences.
- Both archive-record generations read honestly: v1 ledger and v2 record, each in its own
  spelling, plus the record-absent and unreadable shapes.

**Non-Goals**

- No parsing of evidence documents (ship-log prose, review reports) into structured facts.
- No new CLI verb, option, or flag; no `list` changes; no UI; no persistence of any derived
  value.
- No reach into repo working trees — the evidence locator already on node lines is the
  pointer, and the rollup never follows it.
- No PR discovery: no structured PR fact exists in the Store; the answer says so.

## Decisions

### D1 — The facts ride the existing read chain; the rollup is a pure post-pass

`readArchiveEntry` already parses every archive record (JSON.parse, then the schemaVersion-2
branch validates v2). It gains an additive `delivery` block on `AggregateArchiveEntry`:
`null` when the record text was absent, otherwise the extracted facts. `deriveReadiness`
threads it onto `PlanNodeResolution` exactly where it threads `outcomeBasis` today
(`module.ts:709-715`). The projection copies it onto `IssueNodeStatus.delivery` in one
widening wrapper covering every change-node branch (the attribution pattern; `withLifecycle`
is the shape reference), and `deriveIssueDeliveryEvidence(status)` in the new
`src/core/issue-status/delivery.ts` aggregates — signature `(status: IssueStatus) =>
IssueDeliveryEvidence | null`, pure, no ambient reads.

*Why this over alternatives:* a separate reader (CLI-level re-read of archive blobs) would
create a second composition path that can disagree with show's status — the exact failure
the attention precedent (attention/show cannot disagree) exists to prevent; and deriving
from `(detail, status)` two-input would break the post-passes' single-input discipline.
Zero new blob reads: every delivery fact is inside the `archive.json` the outcome basis
already fetches — the evidence inventory and missing names are ledger fields, not files.

### D2 — One closed named-state vocabulary, mapped per branch

`IssueNodeDelivery` is one discriminated block, `null` for intent nodes:

| state | condition | facts |
| --- | --- | --- |
| `record` | archived, record parsed (v1 or v2) | basis (`v2`\|`legacy`), archivedAt, codeCommit, planningBranch, outcome (v2 only; legacy names its absence), evidence[], missing[], entryName, foundAtRef, blobPath |
| `no-record` | archived, `readArchiveEntry` got no text (the `text === null` branch) | entryName, foundAtRef — the record's absence named |
| `not-archived` | resolution resolved, `archived === false` | none — named "will exist when the Change archives" |
| `unreadable` | `outcomeBasis === 'invalid'` | none — the standing `invalid-archive-record` problem stays authoritative |
| `unattributed` | resolution unresolved/ambiguous | none — the reference problem is the answer |

Field mapping (each verbatim, never normalized): v1 `codeCommit` → codeCommit (null =
non-git root, the ledger's own statement); v2 `codeMerge.commit` → codeCommit when a code
merge exists, else the record's own no-merge absence; v1 `planningBranch` → planningBranch;
v2 `planning.sourceRef` → planningBranch (a full ref — the record's spelling is the
honesty); v2 `outcome` → outcome. v1 extraction is defensive-by-construction: the ledger
shape has no zod schema (the v1 writer's output), so a field that is absent or wrongly
typed reads as its named absence, never repaired — the legacy basis already says
"unvalidated".

*Why:* five states, not two (present/absent), because the four absences are different
truths a reviewer acts on differently (wait for archive vs. damaged bytes vs. broken
reference vs. pre-record entry). Collapsing them is the "empty reads as failure" lie.

### D3 — The ship-log is an inventory fact; prose is never parsed

The rollup surfaces the ship-log exactly as the ledger froze it: its store-relative path
and sha256 from the evidence inventory, presence or absence named. The human row renders
`ship-log: evidence/ship-log.md (sha256 …)` or `ship-log: none in inventory`. No parsing
of `**Status:**`/`**Commit:**`/PR lines — worker prose is not schema-validated content, a
parse miss would read as absence of the fact (a quiet lie), and a parse hit could disagree
with the ledger's authoritative codeCommit.

*Why not parse:* every honest fact in this repo is validated at WRITE time and dumbly read
back (digests, canonical JSON). Making ship-log prose structured is a write-path change
out of scope; noted as the future extension seam (a ship-stage validation would make those
facts honest), not smuggled in through the read path.

### D4 — Rollup shape: entries in canonical node order + counts; null on unreadable

```ts
interface IssueDeliveryEvidence {
  readonly revisionId: string;
  readonly entries: readonly IssueDeliveryEntry[]; // one per change node, canonical order
  readonly counts: { record: number; 'no-record': number; 'not-archived': number;
                     unreadable: number; unattributed: number };
}
// IssueDeliveryEntry: { nodeId, alias, projectId, lifecycle, observation, delivery }
```

Null when the revision did not read back (`progress: null` / empty-lanes reasoning: an
empty rollup would read "no delivery evidence", a different claim). Counts summarize;
entries stay full (the attention rule). Intent nodes contribute nothing.

### D5 — Surface: show only, both forms, additive payload key

`store-issue.ts` show: after `renderAcceptanceSection`, render `  delivery evidence:` —
one row per change node (`  <nodeId> <alias>@<project> — <observation> — <state>` plus
fact lines beneath, indented like attribution lines), closing with the counts line.
`--json` payload gains `delivery` beside `status`; the per-node facts ride
`status.nodes[].delivery` (projection output) — the rollup derives from them, so no second
truth exists. `list` untouched.

### D6 — Dogfood split: real store read-only, temp stores for bytes

The four closed Issues on `issue-registry` are read-only receipts material (the reviewer
re-reads them): expected facts are known constants — e.g. `issue-node-lifecycle` reads
commit `31d0b644…`, branch `feat/issue-phase2`, 7 evidence files, missing
`verification-report`; `issue-needs-attention` / `issue-persistent-baseline` /
`document-multi-project-issues` read `not-archived`. Byte-shape coverage (v1 ledger, v2
landed-code, v2 planning-only, v2 passive, record-absent, unparseable-json, digest-stable
double-read, parity diff, before/after store refs) runs on temp stores extending the
`store-archive-outcome-basis` five-shape fixture (`test/core/store/store-archive-outcome-basis.test.ts`
has the `createStoreWorkspaceFixture` + `serializeArchiveV2` recipe). Disk is tight (~3.4GB):
temp fixtures are cleaned as they run.

## Risks / Trade-offs

- [v1 ledger has no schema; a malformed field could read as silent absence] → the named
  absence IS the honest read for unvalidated bytes; the design refuses repair, and the
  byte tests pin the absent/wrong-type branches explicitly.
- [Evidence inventories are unbounded in principle; huge records could bloat `--json`] →
  the seeded ceiling is 20 entries and the inventory is a frozen archive fact — truncating
  it would invent absence; the rollup carries it in full. Noted, not mitigated by lying.
- [g-002 will want per-Change verification verdicts, which this surface cannot give] →
  honest by design: the store's granularity is inventory + recorded missing; g-002's
  review-ready narrative must compose these facts, not extract verdicts that do not exist.
- [Read cost: every show now extracts delivery from records already fetched] → zero new
  blob reads (D1); extraction is in-memory over already-parsed JSON.

## Migration Plan

Additive only: new types, new fields, one new module, additive CLI payload key. No stored
bytes change; no config; rollback is revert. The four closed Issues need no touch — their
v1 ledgers already carry every fact this change reads.

## Open Questions

None blocking. The g-002 consumption seam (`counts` + entries) may grow a derived
"evidence-complete" predicate later; that is g-002's call, on top of this surface.
