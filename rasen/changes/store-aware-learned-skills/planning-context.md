# Store-aware learned skills portfolio context

## Intent

Continue the merged PR #60 learned-skill work with deterministic awareness of
whether a run is project- or store-backed. Knowledge must remain distinguishable
as machine-global, store-shared, or project-private, and the CLI must not infer
ownership from an unrelated current working directory.

This is an explicit `rasen-auto auto-decompose` run. Global gate policy is
`off`, so LEAD-audited stages proceed automatically. The user explicitly
requested one reviewable pull request per dependency slice.

## Settled design constraints

- PR #60 is merged history and will not be reopened.
- Planning-root identity and knowledge ownership are separate. A change may use
  `planningRoot=store:S` while its knowledge owner is `project:P`.
- Canonical knowledge identity is typed:
  `(global,id)`, `(store,storeId,id)`, `(project,projectId,id)`.
- Candidate files may request a scope, but deterministic CLI/root resolution
  stamps and validates the actual owner. Candidate-declared IDs, model output,
  and cwd alone are not authority.
- Existing strict learned-skill candidate and manifest v1 data remains readable.
  Shape changes require explicit compatibility handling.
- Project/store membership is a graph and may be many-to-many.
- Effective precedence is `project > store > global`. Byte/semantic-identical
  store copies may deduplicate; conflicting store copies must fail
  deterministically instead of selecting an arbitrary store.
- Global-only tool homes such as Hermes receive only global knowledge.
- Store sharing and global promotion require explicit approval and evidence
  from distinct eligible projects/stores.

## Audited decomposition

The code paths for resolution, schema/persistence, and materialization overlap,
so the safe DAG is serial:

1. `store-aware-learned-skills-context`
   - Add a deterministic knowledge execution/owner context independent of the
     planning root and cwd.
   - Thread explicit project/store selectors through `rasen knowledge` and
     retain/codify invocation state.
   - Preserve current project/global behavior and refuse ambiguous ownership.
2. `store-aware-learned-skills-scope`
   - Depends on context.
   - Add backward-compatible store-scoped schemas, canonical store resolution,
     typed owner identity, management operations, and promotion policy.
3. `store-aware-learned-skills-materialization`
   - Depends on scope.
   - Resolve and materialize the effective project + member stores + global
     skill set with deterministic precedence, deduplication/conflict behavior,
     typed ledger source identity, and global-only-home restrictions.

Self-audit result: no child can safely run in parallel. `scope` relies on the
owner context contract, and `materialization` relies on both the store schema
and owner identity. The serial split keeps each PR independently reviewable and
prevents simultaneous edits to learned-skill core contracts.

## Delivery topology

- PR 1: `feat/store-aware-learned-skills-context` → `dev/0.1.5`
- PR 2: `feat/store-aware-learned-skills-scope` →
  `feat/store-aware-learned-skills-context`
- PR 3: `feat/store-aware-learned-skills-materialization` →
  `feat/store-aware-learned-skills-scope`

All work is performed in the isolated worktree
`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-auto-store-knowledge`.
The dirty primary workspace is out of scope and must not be reset, cleaned, or
overwritten.

## Planner continuity

Use one persistent planner for the proposal stage of all three children. After
each child proposal, append durable cross-child conclusions to this document so
later proposals remain coherent. Every non-proposal stage uses a cold,
role-isolated leaf worker; author and verifier must be different workers.

## Planner findings

### After `store-aware-learned-skills-context`

- Resolve the launch project independently from the planning root: a verified
  pointer project can yield `planningRoot=store:S` and `owner=project:P`
  without an extra flag, while a direct store launch must never choose one of
  several member projects.
- Persist typed owner/planning IDs in retain run-state and re-resolve canonical
  roots on resume; machine-specific absolute paths are validation results, not
  durable identity.
- The context child owns selector/resolver/run-state plumbing only. Store
  schema, canonical storage, management, and promotion belong solely to the
  scope child; effective merging, precedence, ledger typing, and tool-home
  policy belong solely to materialization.

### After `store-aware-learned-skills-scope`

- Store canonical records live as reviewable shared content under the
  authoritative registered store root at `rasen/learned-skills/<id>`; mutation
  reports the separate store working-tree change but never commits or pushes it.
- Promotion evidence is an exact managed source-record lookup, not a trusted
  candidate claim: store publication requires two distinct current
  member-project records, while global promotion requires two homogeneous
  project sources or two homogeneous store sources, always with scope-specific
  approval.
- Strict v1 project/global data remains readable and byte-stable on reads via a
  versioned-union/in-memory normalization boundary. Scope exposes typed catalogs
  and membership facts only; materialization still exclusively owns effective
  store discovery, merge precedence, conflict refusal, ledgers, and tool homes.

### After `store-aware-learned-skills-materialization`

- A project's effective store layer reverse-discovers every healthy explicit
  project-membership edge. Planning-root and config-inheritance stores are
  neither implicit members nor priority signals, and traversal order never
  selects a winner.
- Applicability runs before `project > store > global`. Store copies deduplicate
  only with the same stable knowledge key and verified canonical bytes; an
  effective divergence blocks all learned-file/ledger writes for the run and
  reports every typed source instead of applying a tie-breaker.
- Project-local ownership moves to a dedicated typed learned ledger (migrated
  write-new-before-clearing legacy learned sections), while global-only homes
  use an explicitly global machine ledger and never receive project or store
  knowledge. Unavailable prior store sources defer destructive cleanup rather
  than masquerading as retirement.
