## Context

Phase 3's first two children landed the substance: plan nodes carry
authoritative target projects (`IssueNodeStatus.projectId`/`targetLineId`,
g-001) and dependency waits carry `{nodeId, projectId, observation}` on the
one work-complete rule (`IssueNodeBlocker` + the shared `issueBlockerState`
vocabulary, g-002). The `projectId` field's own doc comment ends with
"grouping and per-project views are a later capability's delivery" — this is
that capability. What exists today: `show` prints one flat node list;
`list` prints the Issue-level `phase/health x/y`; the projection computes
Issue-level progress with the work-complete rule over required change nodes.

The persistent `issue-registry` Store (uid `f76edc31-…`) holds Issue #1
(`issue-multi-change-execution`, done, single project `e2ee72ed-…` = rasen)
and its member record for rasen still says `roles.planning: false` — the
drift g-001's refusal surfaces. The chosen second member, `rasen-site`
(projectId `6ca78b98-777f-45bc-8d9b-b84c34e1a531`), is a real, small, active
repo: own git history, GitHub remote, a `rasen/` workspace with three real
specs and real change history, `main` branch, a `docs/` area. g-001/g-002
are shipped and archived; this change (`issue-project-grouped-views`) is not
yet committed Store evidence.

Constraints: manual selection only, no routing; `packages/ui/**` and
`src/core/pipeline-registry/` frozen; the one projection seam extended in
place; no version bumps; no UI (project chips are the UI era).

## Goals / Non-Goals

**Goals:**

- Per-project lanes derived in the projection: one lane per distinct target
  project of a readable revision, carrying identity, input-supplied display
  alias, its node ids, and its progress pair — same rule, same scoping, same
  work-complete basis as the Issue's own progress.
- `show` renders lanes over the existing node lines; `list` carries the
  per-project summary; human/JSON parity; flat node list untouched.
- Issue #2 on the persistent Store: real two-project plan, real site work,
  the real loop driven (projection receipts, cross-project gating refusal,
  staged close per the Phase-2 precedent).
- Honest degradation: single-project revisions read with identical axes and
  exactly one lane; Issue #1's receipts comparable byte-for-byte on axes.

**Non-Goals:**

- Project chips, filtering, swimlane UI — the UI era.
- Any new gate, publication rule, or health value (g-001/g-002 own those;
  dependency waits stay `healthy`).
- Auto-deriving "which project should own new work" — the roster confers
  eligibility, never a routing decision.
- Grouping by target LINE, sub-lanes, or cross-project edge rendering as a
  diagram — lanes group by the one stable fact the revision records.

## Decisions

### D1 — Lanes derive in the projection and REFERENCE the flat node list

`IssueStatus` gains `projects: readonly IssueProjectLane[]`,
`IssueProjectLane = { projectId, alias: string | null, nodeIds: readonly
string[], progress: IssueProgress }`. The lane lists node IDS, not node
copies: the flat `nodes` array stays the single node truth and a lane is a
grouping over it (no second copy of node facts to drift). Lane order is
project-identity code-point order; `nodeIds` follow the revision's canonical
node order (`normalizePlanNodes` sorts by `nodeId` — consumers find rows by
`nodeId`, never by position). A lane exists only for a project the
revision's nodes name; an unreadable revision reports no lanes (mirroring
the no-progress rule: empty lanes would read "no projects", which is a
different claim than "no readable revision").

### D2 — Lane progress is the Issue progress rule, scoped per project, shared not rewritten

The lane pair counts the lane's change nodes whose lifecycle is `required`,
complete on the work-complete basis — the same predicate and the same
required-scoping the Issue-level progress applies. Implementation shares the
projection's existing completion logic (one function, two scopes), exactly as
g-002 shared `issueBlockerState` rather than re-stating states: a per-project
"what's left" that disagreed with node lines or the start gate would be a
third basis, and the whole point of g-002's basis unification was that there
is one. A lane with zero required nodes reports `0/0` (no work demanded, the
same statement the Issue-level zero pair makes); optional and cancelled
completions appear in the lane's node list and count nowhere.

### D3 — The display alias is an input fact; identity stays the project id

Lane headers of raw UUIDs would defeat the grouping's purpose, but the
projection must not read Store catalogs itself (it is pure over its inputs —
its contract since C1). The alias therefore arrives as INPUT: the CLI's
`resolveStoreWideningContext` already resolves the store root
(`registeredRoot`); it additionally reads the project catalogs
(`listProjectEntries`) and maps projectId → catalog display `id` when one
resolves, null otherwise. The lane carries `{projectId, alias}` — identity
is always the id, the alias renders beside it and falls back to the id when
null. A missing or invalid catalog degrades to the id, never to a guess.
This is display-only composition at the CLI seam, the same shape as the
machine-local locators the CLI already supplies.

### D4 — Rendering and parity

`show`: under the status block, one lane header per project —
`project <alias|id> (<id>): <completed>/<total>` — followed by that
project's existing node lines (unchanged format: they already carry
`projectId`, observations, dependency facts). `list`: the line's status
segment extends to `phase/health x/y [<alias|id> a/b · …]`, lanes in the
same order, omitted entirely when no lanes derive (unreadable revision —
the same absence the Issue-level pair reports as `-/-`). `--json`:
`status.projects` carries the lane array beside the untouched `nodes`.
No new command, option, locale key, or completion entry — the
commander/locale/completions three-way sync does not apply (stated for the
child gate's trio check).

### D5 — The Issue #2 dogfood: staging, script, and the intent-promotion dance

All Store mutations are REAL and durable (the persistent store takes no
throwaway writes; byte-level tests stay on temp stores):

1. **Prerequisites** — widen the rasen member to planning (re-run
   `rasen store add-project <rasen-repo> --to issue-registry`; roles
   OR-widen, g-001's finding), add the site (`rasen store add-project
   <rasen-site-repo> --to issue-registry`; its workspace carries
   `projectId: 6ca78b98-…`), and extend `line-0.2`'s `projects` map with
   the site's code ref (`refs/heads/main`). Commit the store-side metadata.
2. **The site node's Change** — authored in the Store's site partition via
   the store-scoped planning root (`rasen new change
   document-multi-project-issues --project 6ca78b98-…`): a REAL small
   change — a `docs/` page in `rasen-site` documenting multi-project Issue
   execution (what an Issue is, how plans target member projects, the
   work-complete gate) — proposed through its own small-feature flow and
   committed to the store's main (committed-优先: publication sees committed
   evidence only).
3. **Issue #2** — `rasen store issue new issue-cross-project-execution
   --store issue-registry --title "Issue layer Phase 3: one Issue across
   member projects"`, then plan revision `0001` via `--from-file`:
   `issue-target-project-binding` (rasen, change — already terminal),
   `issue-cross-project-gating` (rasen, change — already terminal),
   `issue-project-grouped-views` (rasen, **intent** — this very change is
   not yet committed evidence; the intent node is how a plan names work
   whose Change does not exist), and `document-multi-project-issues` (site,
   change, `dependsOn: [issue-project-grouped-views]` — the cross-project
   edge). The store's rasen partition must already carry the two shipped
   children's committed evidence (portfolio ship bookkeeping; a refusal
   names any gap).
4. **Receipts during apply** — multi-lane `show` (two lanes, per-lane
   pairs: rasen `2/2` over its required changes, site `0/1`), `list`
   summary, the cross-project gating refusal (`start --node
   document-multi-project-issues` while the intent node is un-terminal —
   names `issue-project-grouped-views@<rasen> (not-started)`), and the
   degradation receipt (Issue #1: exactly one lane, axes identical to
   g-001's persistent-store receipts).
5. **Staged close (evidence, not checkboxes)** — the release-and-accept
   legs are documented close steps for the portfolio close: after this
   change ships and its store bookkeeping commits, publish revision `0002`
   promoting the intent node to a change node (the ordinal-revision
   discipline demonstrated on real data — `0001`'s bytes never move), the
   site node's gate releases, the site node is driven terminal by its real
   pipeline run from the site's checkout, and the acceptance gate-holds
   receipt plus the exact accept step (`acceptance --from-file`, then
   `accept`) are recorded for the LEAD-sequenced close. No acceptance
   happens unless every node is genuinely terminal at hand.

The intent-promotion dance is not decoration: a plan node naming a Change
requires committed evidence (Phase 1), this change cannot be committed
before it ships, and the revision discipline turns that fact into the
demonstration — the plan says today what is true today, and says more in
`0002`.

### D6 — Degradation

No schema field moves, no digest changes, no gate changes. The lane list is
additive on `IssueStatus`; single-project revisions derive exactly one lane
whose pair equals the Issue-level pair; the flat node list and every node
line are unchanged. Issue #1's single-project revision is the degradation
receipt: axes identical to the pre-change persistent-store receipts, one
lane.

## Risks / Trade-offs

- [Lane progress drifts from Issue progress] → One shared predicate, two
  scopes (D2); tests assert lane pairs sum to the Issue pair over required
  nodes and disagree with nothing the node lines say.
- [Alias composition reads the checkout's catalogs] → Display-only,
  identity-safe (D3): a wrong or missing alias never changes grouping,
  gating, or progress — the id is the key everywhere.
- [The dogfood leaves real state if abandoned midway] → Every mutation is
  state the Store truthfully wants (the widened roster records reality; the
  site change is real work; Issue #2 is the phase's own record). The staged
  close documents the remaining legs rather than pretending them.
- [Intent node's promotion forgotten at close] → The staged-close document
  names revision `0002` and the release leg explicitly; the acceptance gate
  holds until every node is terminal, so the close cannot silently skip the
  promotion (the intent node would block `done` forever — fail-closed by
  design).
- [Render churn breaks sibling assertions] → Same discipline as g-001/g-002:
  render-asserting suites update in this change's commit; the list line's
  new segment is append-only beside existing segments.
- [Windows path/locale pitfalls] → Lane headers carry ids/aliases and
  numbers only; no new locale keys exist to miss.

## Migration Plan

Additive derivation and rendering; no data migration; rollback is reverting
the commit. The dogfood's Store-side mutations (roster, line map, site
change, Issue #2) are durable real state, deliberately not rolled back —
they are the phase's completion evidence. Byte-level tests stay on temp
stores per the staging discipline.

## Open Questions

- None blocking. Phase 4 (auto-decompose generating target bindings) will
  consume these lanes as the display side of its routing decisions; whether
  the alias map deserves a wider seam (daemon/API) is Phase 4's question.
