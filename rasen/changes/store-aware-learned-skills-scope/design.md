## Context

PR #60 stores learned skills under either a project machine home or the global
data directory. Its strict candidate and manifest version 1 shapes close scope
to `project | global`, identify evidence with a candidate-declared `projectId`,
and authorize global promotion from two distinct declared project IDs plus
approval. The context child adds an authoritative typed execution context, so
the core can now distinguish `project:P`, `store:S`, and `global` without using
the planning root as the owner.

This slice turns that store owner into a real canonical scope. A store is a
registered standalone Rasen repository, and `store add-project` records typed
`project:<id>` references in its configuration. Those edges are many-to-many:
several stores may reference the same project, and one store may reference many
projects. Candidate data remains untrusted input. Therefore a declared
contributor is only a locator request; evidence authority comes from exact
managed source records plus current typed registry/membership facts.

The next child, materialization, will consume these canonical APIs. It alone
will decide which stores contribute to one project's effective set, merge
catalogs, apply `project > store > global`, detect cross-store content
conflicts, type ledger sources, and enforce global-only tool-home rules.

## Goals / Non-Goals

**Goals:**

- Persist shareable store-owned learned skills with canonical identity
  `(store,storeId,skillId)`.
- Keep existing strict v1 project/global candidates and manifests readable,
  with no read-triggered migration.
- Validate every target and promotion source through the context resolver,
  typed registries, managed manifests, knowledge keys, and current membership.
- Require explicit, scope-specific informed approval for store sharing and
  global promotion.
- Preserve project codification and human-owned collision protections.
- Make store mutations atomic and reviewable in the store working tree without
  committing or pushing.
- Expose one typed record/catalog interface for later materialization.

**Non-Goals:**

- Discovering the set of stores effective for a project.
- Merging project/store/global catalogs or choosing a winner for duplicate IDs.
- Materializing, updating, or pruning any AI-tool skill directory or ledger.
- Treating a project's single config-inheritance `store:` pointer as its only
  possible membership.
- Creating a semantic-equivalence engine. Stable knowledge keys and accepted
  managed records are deterministic inputs; retain/codify still synthesizes and
  judges semantic guidance.
- Git commit, push, clone, fetch, or conflict resolution for store repositories.

## Decisions

### 1. Store canonical records live in the registered store repository

The canonical directories are:

```text
<global data dir>/learned-skills/<id>/
<project machine home>/learned-skills/<id>/
<registered store root>/rasen/learned-skills/<id>/
```

Store resolution starts from the typed `{type:'store', id}` owner produced by
the context slice, looks up that exact store namespace entry, validates store
identity metadata and Rasen-root health through existing helpers, and then
joins the named `rasen`, `learned-skills`, and ID path segments with the Node.js
path module. It never accepts a candidate path or reconstructs a root from the
ID.

Putting records under `rasen/learned-skills` makes them ordinary shareable
store content and keeps them beside the store's other Rasen-owned data. A
successful mutation reports the exact store root and changed canonical
identity; it does not invoke Git. Staging directories are created and removed
inside the same filesystem parent so final renames remain atomic. Per-store
lock files live in a named machine-data lock area keyed by the typed store ID,
not in the repository.

Alternative considered: store-scoped records in a machine-local cache. Rejected
because “store scope” would then not be shared with the store and clones could
silently see different canonical knowledge.

Alternative considered: put records below `.rasen-store`. Rejected because
that directory primarily carries store identity metadata; learned skills are
Rasen content and belong under the normal `rasen` root.

### 2. Use strict versioned unions and normalize only in memory

Candidate and manifest parsers become discriminated unions:

- candidate/manifest v1 keep their exact project/global shape;
- v2 adds `store` scope, typed owner/source identities, and exact promotion
  source-record locators;
- store records always use v2;
- a global record requiring store-source provenance uses v2.

On read, v1 evidence `projectId` is normalized in memory to a typed project
contributor and the resolved canonical root supplies the record owner. Reading
does not rewrite bytes. Project/global mutations whose meaning remains fully
representable in v1 may keep v1; a mutation that needs store identity writes
v2. This avoids eagerly making every existing project record unreadable to an
older CLI while keeping the new schema strict.

A v2 store manifest carries `{type:'store', id}` and must match the selected
store's authoritative identity. Copying a managed directory from one store to
another therefore produces a typed owner mismatch, not ownership transfer.
Transfer requires a new approved promotion plan.

Conceptually, every read returns:

```ts
interface CanonicalKnowledgeIdentity {
  owner:
    | { type: 'global' }
    | { type: 'project'; id: string }
    | { type: 'store'; id: string };
  id: string;
}

interface CanonicalLearnedSkill {
  identity: CanonicalKnowledgeIdentity;
  manifest: LearnedSkillManifestV1 | LearnedSkillManifestV2;
  evidence: NormalizedTypedEvidence[];
  directory: string;
  content: string;
}
```

Alternative considered: add optional `storeId` fields to v1. Rejected because
strict v1 readers reject unknown fields and optional identity combinations
permit contradictory records.

### 3. Promotion evidence resolves exact managed source records

V2 promotion candidates name source canonical identities as locators, not
proof. Planning resolves every source through the authoritative registry and
canonical catalog, then requires:

- the record exists, is active, and carries Rasen managed ownership;
- its resolved typed identity matches the requested source;
- its stable knowledge key equals the promotion candidate's key; and
- its stored content/evidence digest is internally valid.

Version-1 promotion candidates remain parseable. Their existing
`projectId`/skill-ID/knowledge-key facts are adapted to exact project source
lookups. A declared project ID with no matching eligible managed record is
rejected. Thus compatibility is shape compatibility, not continued trust in an
unverified declaration.

Current-run evidence is stamped with the frozen context owner before a project
record is written. Cross-owner promotion then builds on accepted canonical
records; one invocation cannot fabricate another project's evidence merely by
putting its ID in JSON.

Alternative considered: cryptographically sign candidate evidence. Rejected
for this slice because no machine/team trust infrastructure exists. Exact local
managed records plus registry and membership validation close the present
authority hole without inventing a key distribution system.

### 4. Apply homogeneous, target-specific promotion gates

Store sharing and global promotion use distinct gates:

**Project to store**

- The target is one explicitly selected registered store.
- Sources are at least two distinct active project records with the same
  knowledge key.
- Every source project is currently a typed `project:<id>` member of the target
  store.
- The user gives informed store approval.

The same gate applies to a store create or rewrite, so shared guidance cannot be
rewritten from one project's new claim. Store retirement uses the existing
explicit confirmation flow because it removes shared guidance rather than
publishing a new instruction.

**Project/store to global**

- Sources are either at least two distinct eligible project records or at least
  two distinct eligible store records.
- A single plan uses one source class; mixed project/store counting is refused
  rather than assigning arbitrary weights.
- Every source is registry-valid, active, managed, and carries the same
  knowledge key.
- The user gives informed global approval.

The project-source path preserves the useful PR #60 promotion route but replaces
self-declared project IDs with exact records. The store-source path permits
knowledge independently accepted by multiple stores to become global. Multiple
changes or clones with one stable owner ID count once.

Promotion planning displays the target typed identity, source typed identities,
knowledge key, applicability, and planned create/rewrite before approval.
Approval is a commit-time precondition and is rechecked under the target lock.

Alternative considered: require every global skill to pass through a store.
Rejected because it would break valid existing project-to-global workflows and
make a store mandatory for unrelated projects.

Alternative considered: allow a mix of one project and one store. Rejected
because the store may already contain that project, making “two sources”
non-independent and expensive to reason about.

### 5. Membership is a reusable typed graph query, not parent selection

One helper reads the selected store's existing `references:` declarations,
keeps only explicit project-namespace entries, resolves those project entries
through the typed registry, and returns stable project IDs plus diagnostics.
Unprefixed references remain store references and do not count as projects.
Duplicate references deduplicate by typed project ID.

Promotion refuses an unresolved or unhealthy claimed member. It does not modify
membership and does not follow referenced stores transitively. The helper
answers “is project P currently an eligible member of store S?”; it never
answers “which one store owns P?”

The materialization child may reuse the typed low-level membership facts, but
it exclusively owns reverse-enumerating all stores effective for a project and
ordering/merging their catalogs.

### 6. Extend management with scope-bound consent

The context child already parses explicit owner selectors. This slice removes
the temporary store-scope-unavailable branch:

- `--store S` plus store scope addresses only `(store,S,...)`;
- `--project P` plus project scope addresses only `(project,P,...)`;
- global scope addresses only global state;
- mismatched selector and candidate/request scope fails before planning.

`knowledge apply` gains `--approve-store` alongside `--approve-global`.
Consent flags are mutually scope-bound: project operations reject either,
store operations reject global consent, and global operations reject store
consent. Interactive approval is available only for human output on a TTY;
JSON/non-interactive calls require the matching explicit flag.

List/show/retire never scan every store implicitly. A store record requires an
explicit store owner, which prevents cwd or registry ordering from broadening a
management command. Store retirement requires the existing `--yes`/interactive
confirmation and exact managed identity.

### 7. Reuse existing mutation safety for typed stores

Plan/commit remains the sole persistence authority. It validates schema,
budgets, identity, applicability, evidence gates, approval requirements,
writability, and collisions before commit. Commit locks the selected typed
registry, re-reads ownership and source preconditions under lock, stages both
manifest and content, verifies content digests, atomically swaps, and rolls back
on failure.

An unmanaged occupant, invalid manifest, typed-owner mismatch, user-edited
material, or changed promotion source blocks the operation and remains
byte-for-byte unchanged. Lock/staging names use declared constants and exact
identities; cleanup never uses a learned-skill prefix scan.

### 8. Preserve the serial child boundary

This child owns store schemas, canonical store resolution, typed canonical
identity, exact source validation, membership eligibility, management
operations, approval policy, and atomic store persistence.

It deliberately leaves `resolveLearnedSkills` returning catalogs without an
effective merged winner. It does not edit project/global/store precedence,
cross-store duplicate behavior, materialization plans, tool adapters, artifact
ledger source identity, description budgets across merged sets, or Hermes
policy. Those are tasks only in
`store-aware-learned-skills-materialization`.

## Risks / Trade-offs

- **[Store mutations dirty a separate repository]** Users may overlook where
  the shared change landed. → Report typed identity, absolute store root, and
  exact changed files; never claim the code-repo commit contains them.
- **[Membership changes invalidate a pending plan]** A project can be removed
  between planning and commit. → Re-resolve source and membership preconditions
  under the target lock and require re-planning on drift.
- **[Older CLIs cannot interpret v2 global records with store provenance]** →
  Never upgrade on read, keep v1 where semantics permit, document the minimum
  version, and have older clients leave unknown managed data untouched.
- **[Two projects can repeat the same weak lesson]** Distinct ownership is an
  evidence floor, not semantic proof. → Require stable knowledge-key agreement,
  existing accepted managed records, and informed approval showing all sources.
- **[Copied store directories appear managed]** A valid manifest could be
  copied across repositories. → Match its typed owner against authoritative
  store identity and block on mismatch.
- **[Many-to-many lookup is incomplete on a machine with missing project
  registrations]** → Treat unresolved members as ineligible with actionable
  registration/doctor guidance; never count declarations alone.
- **[Windows store roots have aliases and cross-volume constraints]** → Resolve
  canonical roots with existing helpers, use platform path primitives, and
  stage under the target parent so renames do not cross volumes.

## Migration Plan

1. Add strict v2 schemas and normalized in-memory typed record/evidence types
   while retaining exact v1 parsers and fixtures.
2. Add registered store canonical resolution, machine-data locks, catalog
   owner validation, and atomic store write tests.
3. Add typed membership/source resolution and promotion gate planning.
4. Enable store management in the knowledge CLI with localized approval and
   compatibility diagnostics.
5. Document store repository changes, v1/v2 compatibility, promotion sources,
   and downgrade behavior.
6. Run targeted and full tests before stacking this PR on the completed context
   PR.

Rollback leaves store directories and v2 global records untouched. Returning to
the predecessor version restores project/global v1 behavior; upgrading again
restores visibility of v2 records. Operators may revert the explicit store
working-tree change through their normal Git workflow, but the CLI does not do
that automatically.

## Open Questions

None for this slice. Effective-store discovery, byte/semantic deduplication,
conflict refusal, precedence, and global-only tool homes are locked to the
materialization child.
