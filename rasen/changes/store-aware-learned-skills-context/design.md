## Context

PR #60 introduced project/global learned-skill persistence around an optional
`LearnedSkillContext.projectRoot`. `rasen knowledge` builds that context with
`findRepoPlanningRootSync(process.cwd())`. This worked while the nearest
planning root and the project owning the knowledge were normally the same
directory.

Stores make those identities independent. A pointer project can launch a change
whose planning root resolves to `store:S`, yet evidence and private learned
skills still belong to `project:P`. Conversely, launching directly in `S` does
not identify any one member project because store/project membership is a graph
and a project may belong to several stores. The existing typed machine registry
and project registry already provide authoritative IDs and canonical roots; the
knowledge layer should compose those mechanisms rather than infer identity from
candidate fields or duplicate store lookup.

This is the first child in a serial portfolio. It establishes identity and
invocation-state contracts only. `store-aware-learned-skills-scope` owns
store-backed schema/persistence/management/promotion, and
`store-aware-learned-skills-materialization` owns effective-set resolution,
precedence, conflict handling, ledger source identity, and tool-home policy.

## Goals / Non-Goals

**Goals:**

- Represent planning-root identity and knowledge-owner identity independently.
- Resolve typed global/project/store owners from explicit selectors or verified
  registry/config facts, never from candidate-declared identity or cwd alone.
- Preserve unambiguous in-repo and pointer-project behavior without forcing new
  flags.
- Make ambiguous, contradictory, unknown, and stale identity a typed,
  deterministic failure before canonical state changes.
- Freeze retain/codify knowledge identity so resume is independent of a later
  cwd or planning selector.
- Leave strict candidate and manifest v1 data readable.
- Define a narrow context interface that the next two children can consume
  without revisiting ownership resolution.

**Non-Goals:**

- Adding a store canonical directory or changing learned-skill manifest and
  candidate shapes; the scope child owns those changes.
- Selecting a project's effective store set, merging catalogs, or applying
  project/store/global precedence; the materialization child owns that work.
- Treating `references:` as an exclusive parent relationship. Membership is
  many-to-many and may be queried by the later materialization resolver.
- Trusting evidence `projectId` values as proof of promotion eligibility; the
  scope child owns evidence verification and promotion policy.
- Changing retention modes, archive behavior, profile formats, or artifact
  planning-root resolution.

## Decisions

### 1. Introduce one typed knowledge execution context

The learned-skill boundary will accept a resolved context shaped conceptually
as:

```ts
type KnowledgeOwnerRef =
  | { type: 'global' }
  | { type: 'project'; id: string }
  | { type: 'store'; id: string };

interface LearnedSkillExecutionContext {
  planningRoot: {
    type: 'project' | 'store';
    id?: string;
    root: string; // canonical, in-memory only
  };
  owner: KnowledgeOwnerRef & { root?: string }; // root resolved from id
  source: 'run-state' | 'explicit-project' | 'explicit-store' | 'launch-project' | 'direct-store';
  globalDataDir?: string;
}
```

The serializable identity is the typed `{type,id}` pair; canonical roots are
resolved for the current machine and remain in memory. `global` has no ID and
never borrows a project/store root. This replaces the semantic use of optional
`projectRoot` while retaining a short internal compatibility adapter where
existing unit tests or callers need incremental migration.

Typed identities prevent a store and project with the same bare ID from
colliding. Callers may not reconstruct owner directories themselves: canonical
project homes continue through `resolveProjectHome`, and store identities
continue through the typed store registry.

Alternative considered: extend `LearnedSkillContext` with optional `storeRoot`
and let each caller choose one. Rejected because combinations of optional roots
permit contradictory states and repeat precedence logic.

### 2. Resolve the launch project separately from the planning root

A single resolver will produce `LearnedSkillExecutionContext` from:

- the launch directory;
- an optional `--project <id>` or `--store <id>`;
- the operation's requested scope;
- optional frozen run-state identity; and
- the existing project/store registries and root-selection helpers.

Resolution order is:

1. A frozen run-state identity, when present, is authoritative. Conflicting
   selectors fail.
2. An explicit typed selector resolves in its exact namespace and validates
   metadata/root health.
3. Without a selector, a verified launch project wins when the launch directory
   belongs to a registered/config-identified project, including a pointer
   project whose planning root is a store.
4. A directly addressed, uniquely registered store root may identify a store
   owner.
5. Otherwise resolution refuses ambiguity and reports the selectors that would
   disambiguate it.

The planning root is resolved independently through the existing root-selection
contract. It is recorded for observability and contradiction checks but never
silently replaces the owner. A pointer project's result can therefore be
`planningRoot=store:S, owner=project:P`.

Cwd is only the starting location for verified config/registry resolution. A
directory basename, an unregistered `rasen/` folder, candidate `projectId`, or
model-selected value is not an identity source. All paths use `path.resolve`,
`path.join`, and existing canonicalization helpers; typed lookup uses explicit
registry keys rather than string prefixes or regexes.

Alternative considered: always require `--project` when planning resolves to a
store. Rejected because a registered pointer project is already an unambiguous,
authoritative project and the extra flag would break existing zero-flag
lifecycles.

### 3. Add knowledge selectors without reusing planning-root selection

Every `rasen knowledge` subcommand will accept `--project <id>` and
`--store <id>` as mutually exclusive knowledge-owner selectors. They reuse the
same typed namespaces and friendly diagnostics as other CLI surfaces, but they
do not mean “move the planning root.”

For this first slice:

- project and global v1 operations continue to work;
- a project operation must resolve a matching project owner;
- global operations resolve the global owner and reject an unrelated owner
  selector;
- a successfully resolved store owner reaches the typed context boundary, but
  a store-scoped mutation/list is reported as unavailable until the scope child
  adds the store data contract.

Keeping the selector seam now lets retain and direct CLI calls share one
identity contract, while keeping store persistence out of this PR. JSON errors
carry stable codes and the typed owner/planning identities where safe:
`knowledge_owner_unknown`, `knowledge_owner_ambiguous`,
`knowledge_owner_stale`, `knowledge_owner_scope_mismatch`, and
`knowledge_selector_conflict`.

Alternative considered: interpret `--store` as a planning selector and infer a
project from the store's members. Rejected because stores can have zero, one, or
many members and membership is many-to-many.

### 4. Freeze typed identity in retain run-state

On the first retain/codify entry, the orchestrator resolves and records:

```json
{
  "knowledgeContext": {
    "version": 1,
    "planningRoot": { "type": "store", "id": "team" },
    "owner": { "type": "project", "id": "web-app" }
  }
}
```

Only typed IDs are persisted. Resume resolves their current canonical roots and
validates that registry/config facts still support them. A missing or rebound
identity fails with a stale-owner diagnostic; it does not fall back to the new
cwd. The existing frozen `retention` field remains independent.

Existing run-state without `knowledgeContext` remains readable. At the first
knowledge operation it receives one compatibility resolution using the same
strict resolver, then persists the result. If that run is launched directly
from an ambiguous store, it pauses with disambiguation guidance instead of
guessing.

Alternative considered: store absolute roots in run-state. Rejected because
roots are machine-specific, can move, and can hide registry drift.

### 5. Stamp the resolved owner at the deterministic core boundary

The command translates strict candidate v1 into a mutation request, then passes
the resolved owner context separately. The core validates that the requested
v1 scope is compatible with that owner before planning. Candidate scope and
evidence IDs express a request/provenance claim; they are not the authority for
where a record is read or written.

The context result is also exposed to retain/codify candidate construction so
new candidates use the resolved project identity. This slice does not redesign
the evidence schema. The scope child will decide how verified evidence is
represented for store/global promotion and how v1 evidence remains readable.

All knowledge operations (`apply`, `list`, `show`, `retire`) use the same
resolver. There is no list/show fallback that silently reads a different owner
when mutation would refuse it.

### 6. Keep child ownership explicit

This child owns:

- typed execution/owner context and resolver;
- knowledge selector parsing and identity diagnostics;
- retain/codify context freeze and v1 run-state migration;
- threading the context through existing project/global core operations.

The scope child exclusively owns:

- store candidate/manifest compatibility and store canonical directories;
- typed canonical record identity and store management operations;
- evidence/approval rules for store sharing and global promotion.

The materialization child exclusively owns:

- computing member stores and the effective project/store/global set;
- precedence, store deduplication/conflict refusal;
- typed ledger sources and global-only-home behavior.

This boundary avoids three children editing the same behavior under different
names and keeps each PR reviewable.

## Risks / Trade-offs

- **[Direct store launches become stricter]** A run that previously happened to
  use the store directory as a “project” may now be refused. → Report the
  resolved planning root and exact `--project`/`--store` remedy.
- **[Registry drift blocks resume]** Moving or unregistering an owner after
  retain starts prevents silent continuation. → Keep IDs in run-state, provide
  doctor/init guidance, and allow resume after registry repair.
- **[Temporary store-selector limitation]** The context PR understands a store
  owner before store persistence exists. → Emit a stable unsupported-scope
  diagnostic and make the scope child the only task that removes it.
- **[Resolver duplication with root selection]** Knowledge identity has a
  different purpose but shares low-level facts. → Reuse registry, metadata,
  canonicalization, and inspection helpers; keep only the owner decision tree
  new.
- **[Legacy callers pass only `projectRoot`]** A hard cut could create a large,
  hard-to-review diff. → Use one compatibility adapter at the public boundary,
  migrate production callers in this PR, and prohibit new optional-root logic.
- **[Windows path aliases create false disagreement]** Drive case, junctions,
  and separators may spell the same root differently. → Compare canonical
  existing paths through existing helpers and use typed IDs as persisted truth.

## Migration Plan

1. Add typed schemas/types, resolver, and diagnostics with registry/canonical
   path tests.
2. Thread the resolver through knowledge subcommands and existing project/global
   operations.
3. Add versioned `knowledgeContext` to run-state parsing/writing and update
   retain/codify instructions to freeze it on first entry.
4. Preserve parsing for candidate/manifest v1 and run-state without the new
   field; exercise pointer-project and direct-store migrations.
5. Document the selector semantics and the temporary store-scope diagnostic.

Rollback removes the additive run-state field and selector use. Candidate and
manifest files require no rollback because this slice does not rewrite their
shape or store location.

## Open Questions

None for this slice. Store evidence identity, promotion thresholds, and
effective multi-store ordering are intentionally settled by the next two child
changes, within the parent portfolio constraints.
