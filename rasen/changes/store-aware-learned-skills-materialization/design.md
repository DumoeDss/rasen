## Context

PR #60 materializes applicable project and global learned skills into configured
tool homes. Its project-local resolver inserts global records first and project
records second into an ID map, yielding `project > global`; its project ledger
records only `skillScope: project | global`. Hermes uses a separate
machine-global ledger and receives only global records.

The first portfolio child makes execution ownership independent of the planning
root. The second adds authoritative store catalogs, typed canonical identities,
exact membership facts, and promotion policy. This final child consumes those
contracts to answer a new read-side question: for resolved project `P`, which
single content (if any) should occupy each learned-skill ID in each kind of tool
home?

The difficult case is many-to-many store membership. Several member stores may
publish the same ID. Registry order, filesystem order, planning-store identity,
and the project's config-inheritance pointer are not conflict-resolution
policies. The system must either prove the copies equivalent or refuse to
choose. It must also retain exact ownership when equivalent content has several
canonical store sources.

## Goals / Non-Goals

**Goals:**

- Discover all currently eligible stores for one resolved project.
- Resolve one deterministic active/applicable set with
  `project > store > global`.
- Deduplicate equivalent store records without inventing a winning store.
- Block learned-skill reconciliation on divergent effective store copies before
  any learned file or ledger write.
- Record every canonical source behind a materialized copy with typed identity.
- Migrate legacy learned ledger entries conservatively and preserve human edits.
- Keep global-only tool homes global-only and project independent.
- Give init/update actionable, order-independent results for conflicts,
  degraded stores, additions, updates, removals, and skips.

**Non-Goals:**

- Re-resolving the launch owner or planning root; the context child owns it.
- Adding/changing store schemas, storage paths, membership eligibility,
  management operations, or promotion approval; the scope child owns them.
- Semantic similarity inference over different canonical bytes.
- Choosing one store based on priority settings, registration time, path,
  planning location, or membership declaration order.
- Materializing learned skills while operating directly as a store owner into a
  guessed member project's local tool home.
- Committing store content or changing profiles/workflow selection.

## Decisions

### 1. Reverse-discover stores from authoritative typed membership

Effective resolution requires a resolved project owner and its project root.
The resolver enumerates typed store-namespace registry entries in stable
store-ID order and asks the scope layer's membership/catalog APIs whether each
healthy store explicitly contains `project:P`. The sorted traversal makes
diagnostics reproducible; it does not establish priority.

Only explicit project-namespace membership edges count. The planning root,
`store:` config-inheritance pointer, unprefixed store references, directory
proximity, and transitive store references do not add an effective store. The
same project may therefore receive records from zero, one, or many stores.

Each discovery result is typed:

```ts
type EffectiveStoreFact =
  | { status: 'member'; store: { type: 'store'; id: string }; catalog: CanonicalLearnedSkill[] }
  | { status: 'not-member'; store: { type: 'store'; id: string } }
  | { status: 'unavailable'; store: { type: 'store'; id: string }; diagnostic: string };
```

The materialization layer does not parse `references:` itself or create a
second store-health resolver; those are scope-layer facts.

Alternative considered: use only the planning store or config-inheritance
store. Rejected because knowledge membership is many-to-many and planning
location is explicitly distinct from ownership.

### 2. Build a pure effective-set plan before learned writes

`resolveEffectiveLearnedSkills` consumes:

- the predecessor's resolved project execution context;
- that project's active canonical catalog;
- all member-store active canonical catalogs;
- the active global catalog;
- project-root applicability facts; and
- previous typed ledger membership/source facts used only for degraded cleanup
  safety.

It returns a sorted, immutable plan:

```ts
interface EffectiveLearnedSkill {
  id: string;
  effectiveScope: 'project' | 'store' | 'global';
  sources: CanonicalKnowledgeIdentity[]; // sorted; one or several stores
  knowledgeKey: string;
  canonicalContentDigest: string;
  resolutionDigest: string;
  renderedContent: string;
}

interface EffectiveLearnedSkillPlan {
  status: 'ready' | 'degraded' | 'blocked';
  skills: EffectiveLearnedSkill[];
  conflicts: StoreSkillConflict[];
  unavailableStores: StoreDiagnostic[];
  deferred: DeferredMaterialization[];
}
```

Resolution performs no filesystem mutation. A known effective store conflict
sets the whole learned plan to `blocked`; init/update may continue their
ordinary workflow generation, but no learned-skill file or learned ledger is
added, refreshed, or removed for any tool in that run. This avoids a
tool-order-dependent partial learned set.

Alternative considered: reconcile each store as it is discovered. Rejected
because later stores could reveal a conflict after an earlier tool copy was
already overwritten.

### 3. Filter eligibility before applying precedence

For a project-local home, each layer first keeps only records that are:

- valid, managed, and active according to the scope catalog;
- applicable to the project root using the existing path-exists evaluator; and
- eligible for materialization under existing generated-content restrictions.

Precedence is then applied per canonical skill ID:

1. An applicable project record wins.
2. Otherwise the applicable store layer is resolved.
3. Otherwise an applicable global record wins.
4. Otherwise the ID is absent.

A present but non-applicable or retired higher-layer record does not shadow an
applicable lower layer. A project winner intentionally shadows every store and
global copy of that ID; divergent store copies below that winner are reported
as a latent diagnostic but do not require choosing a store and therefore do not
block the current effective result. A store winner similarly shadows global.

The active-description context budget is evaluated after winners and exact
store deduplication, before rendering or writes. Exceeding it blocks the learned
plan with the existing named-budget guidance.

Alternative considered: precedence before applicability. Rejected because a
project-specific predicate that does not match would incorrectly suppress
valid shared guidance.

### 4. Store equivalence is exact and order-independent

When store is the effective layer for an ID:

- one applicable store record is the winner;
- several records deduplicate only when they have the same stable knowledge
  key and verified canonical content digest/bytes;
- equivalent records produce one effective item whose `sources` contains every
  typed store identity in lexical ID order;
- any knowledge-key or content divergence produces one conflict listing all
  participating store IDs, knowledge keys, and digests.

The conflict is computed from the entire group, never pairwise “first match
wins,” so results are invariant under registry and filesystem ordering. The
resolver does not claim that byte-different prose is semantically identical
merely because an ID or knowledge key matches. Users resolve a conflict by
reviewing and aligning, renaming, or retiring canonical store records through
the scope management surface.

This is intentionally conservative relative to “byte/semantic-identical copies
may deduplicate”: exact bytes plus stable knowledge key are the deterministic
equivalence proof available in the core. Agent-judged semantic equivalence is
not performed during installation.

Alternative considered: use lexical store ID as a tie-breaker. Rejected because
that silently turns shared persistent instruction into registry-order policy.

Alternative considered: deduplicate any equal knowledge key. Rejected because
two stores may carry different revisions or procedures under one key, and
selecting either content would still be arbitrary.

### 5. Materialized output carries an effective resolution identity

The rendered `SKILL.md` retains the canonical description and instructions and
adds bounded generated metadata:

- generated ownership marker;
- learned-skill ID;
- effective scope;
- sorted typed canonical source identities; and
- a resolution digest over ID, knowledge key, source identities, canonical
  digests, and rendered body.

For equivalent store copies there is no synthetic “winner store”; all sources
are recorded. Metadata values remain within the string-valued Agent Skills
frontmatter contract. No executable sidecar is introduced.

The `resolutionDigest`, rather than one untyped canonical digest, is the refresh
key. A source/precedence change is therefore auditable even when instructions
happen to stay the same.

### 6. Move learned ownership to a dedicated typed project ledger

The existing `rasen/.workflow-artifacts.json` remains the workflow ledger and
must not be version-bumped merely to widen learned sources. Materialization
adds a named dedicated project learned ledger, conceptually:

```json
{
  "version": 1,
  "stores": {
    "team": { "lastMembership": "member" }
  },
  "tools": {
    "claude": {
      "learned": {
        "typescript-cli-routing": {
          "effectiveScope": "store",
          "sources": [
            { "owner": { "type": "store", "id": "platform" }, "id": "typescript-cli-routing" },
            { "owner": { "type": "store", "id": "team" }, "id": "typescript-cli-routing" }
          ],
          "resolutionDigest": "sha256:...",
          "file": { "scope": "project", "path": "...", "sha256": "sha256:..." }
        }
      }
    }
  }
}
```

On first successful reconcile without the dedicated ledger:

1. Read legacy learned entries from `.workflow-artifacts.json`.
2. Normalize `project` to the resolved project owner and `global` to global.
3. Reconcile using exact file/digest ownership checks.
4. Atomically write the new typed ledger.
5. Remove only the legacy `learned` sections from the workflow ledger while
   preserving its version, workflows, and workflow artifacts.

The write-new-before-clear order is crash-safe: if both representations remain,
the new ledger is authoritative and cleanup can be retried. After migration an
older CLI sees no legacy learned ownership, so it preserves installed learned
directories as untracked collisions rather than deleting them. The workflow
ledger stays readable to old versions.

Alternative considered: bump the combined workflow ledger. Rejected because an
older strict reader would lose workflow ownership information unrelated to this
feature.

### 7. Version the machine-global ledger with an explicit global source

The machine-global learned ledger remains separate because a global-only tool
home is shared across projects. Its parser accepts legacy v1 entries and a new
strict version that records the typed global canonical identity and resolution
digest. On a successful global-only reconcile it writes the new form
atomically. A legacy entry normalizes to `{type:'global'}` without any project
inference.

No project or store source identity can be written to this ledger. This keeps
one project's init/update from claiming or pruning shared global-only content.

### 8. Reconciliation remains exact and degrades without destructive guesses

For each configured project-local tool, reconciliation compares the pure
effective plan with the dedicated typed ledger:

- create when the target is absent;
- refresh only an unchanged exact ledger-owned file;
- update ledger provenance when resolution changes;
- remove only an exact unchanged file whose source is authoritatively no longer
  desired;
- preserve and drop/hold tracking for missing, symlinked, or user-modified
  occupants according to existing ownership rules.

Unavailable stores are not treated as empty or retired. If a store was a
previous source or the project's authoritative pointer/frozen facts show it may
contribute, removals or same-layer replacements depending on that unknown state
are deferred and reported. A higher-layer project winner may still replace a
previous store result because precedence does not require inspecting the lower
layer. An unavailable store with no evidence of prior/current membership is
reported and excluded, without blocking unrelated skills.

Known conflicts differ from degraded availability: a conflict blocks every
learned write for the run; a degraded plan may reconcile unaffected IDs while
preserving uncertain tracked copies.

Alternative considered: prune every ledger entry absent from currently readable
catalogs. Rejected because a temporarily unavailable store would look like a
retirement and erase still-valid shared guidance.

### 9. Global-only homes resolve global knowledge independently

A global-only adapter, currently Hermes, does not consume the project effective
plan. It resolves every active approved global canonical record, ignores
project-root applicability as before, and reconciles through the machine-global
typed ledger. Project and store records are never rendered there, even if their
applicability is broad or their content matches a global record.

The command reports local-scope exclusions in a bounded diagnostic rather than
attempting to install them. One project's membership, marker result, store
availability, or project-local conflict cannot remove a global-only copy.

### 10. Init and update share one planner

`rasen init` and `rasen update` call the same effective resolver and
reconciliation core:

- init uses it after a project owner and configured project-local/global-only
  tool homes are known;
- update uses it for refresh, exact pruning, ledger migration, and reporting;
- both preflight the learned plan before any learned file write;
- both preserve ordinary workflow generation as a separate concern.

Human and JSON results expose added, updated, removed, skipped, deduplicated,
conflicting, unavailable, and deferred outcomes with typed sources. A blocked
learned plan yields a non-success learned-materialization result and exact
repair guidance; it never silently reports the command as fully reconciled.

### 11. Preserve child ownership

This child consumes `LearnedSkillExecutionContext`, typed canonical catalogs,
and store membership facts. It does not change their resolution, schema,
canonical paths, mutation safety, evidence gates, or approval policy.

Its owned modules are effective-set planning, precedence/equivalence/conflicts,
materialized rendering, dedicated/typed ledger compatibility, project-local and
global-only reconciliation, and init/update integration. No task in this child
repeats context or scope implementation.

## Risks / Trade-offs

- **[Scanning registered stores adds I/O]** Many-to-many reverse discovery
  requires inspecting store membership. → Reuse scope-level parsed facts,
  traverse once per init/update in stable order, and share one plan across tools.
- **[A broken unrelated store produces noise]** Its membership may be unknown.
  → Report it, but defer destructive behavior only when prior/pointer/frozen
  facts indicate it may affect this project.
- **[Conservative conflict rules require manual alignment]** Byte-different but
  semantically equivalent copies are blocked. → Report every source/key/digest
  and exact knowledge management commands; avoid unsafe automatic preference.
- **[Dedicated ledger migration spans two files]** A crash can leave both old
  and new learned entries. → Write the new ledger first, treat it as
  authoritative, then idempotently clear only legacy learned sections.
- **[Older CLIs stop managing migrated learned copies]** → They preserve the
  directories as untracked instead of deleting them; workflow ownership remains
  intact, and upgrading restores typed management.
- **[Source metadata changes installed bytes]** Adding an equivalent store can
  refresh frontmatter despite identical instructions. → Use exact ownership
  checks and report provenance-only refreshes.
- **[Windows target and ledger paths differ in case/separators]** → Use
  platform path primitives, existing canonical/symlink guards, portable stored
  relative paths, and typed IDs for identity.
- **[Partial tool failure remains possible]** Filesystem errors can occur after
  a ready plan. → Keep reconciliation exact and atomic per file/ledger, report
  each tool result, and never delete unverified occupants.

## Migration Plan

1. Add pure effective-store discovery and resolution types/tests over the
   predecessor APIs.
2. Add precedence, exact store equivalence, conflict diagnostics,
   applicability, and post-resolution budget tests.
3. Add effective rendering and the dedicated typed project ledger with
   write-new-before-clear legacy migration.
4. Add typed global-ledger compatibility and global-only restrictions.
5. Refactor project/global reconciliations to consume the plan, then integrate
   init/update reporting.
6. Run targeted, cross-platform, and full-suite verification on the stacked
   context → scope → materialization branch.

Rollback leaves the dedicated ledger and materialized files in place. The
predecessor CLI will not understand store-effective ownership and therefore
must leave those untracked files untouched. Reinstalling the materialization
version resumes management from the typed ledger; no canonical project/store/
global records need conversion or rollback.

## Open Questions

None. Store ordering is deliberately not configurable in this version; content
divergence is a conflict, not a priority decision.
