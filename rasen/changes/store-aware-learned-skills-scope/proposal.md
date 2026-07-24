## Why

The typed owner context can identify a store without confusing it with a
project, but learned-skill persistence still understands only project and
global records. Store sharing needs a canonical, reviewable scope with
authority and promotion rules strong enough that candidate-declared identities
cannot publish durable guidance by themselves.

## What Changes

- Add store-scoped learned-skill candidates, manifests, canonical storage, and
  typed identities while continuing to read strict version-1 project/global
  data without rewriting it on read.
- Resolve store records only through the authoritative typed store registry and
  store identity metadata, storing shareable records in the selected store
  repository.
- Enable `rasen knowledge apply`, `list`, `show`, and `retire` for explicit
  store owners, with human/JSON output that preserves
  `(store,storeId,skillId)` identity.
- Validate project-to-store sharing against current many-to-many membership and
  exact managed source records; validate global promotion against distinct
  eligible project or store sources.
- **BREAKING**: version-1 promotion candidates remain parseable, but
  contributor IDs declared only in the candidate no longer satisfy a store or
  global evidence gate; the named evidence must resolve to eligible managed
  source records.
- Require informed, scope-specific approval for store sharing and global
  promotion, and refuse candidate-declared contributor IDs as proof.
- Keep existing project codification behavior and global version-1 records
  compatible.
- Expose canonical typed record and membership-validation seams for the later
  materialization child; this slice does not merge catalogs, choose precedence,
  or install tool copies.

## Capabilities

### New Capabilities

- `store-scoped-learned-skills`: Backward-compatible store persistence, typed
  canonical identity, knowledge management, verified sharing, and promotion
  policy.

### Modified Capabilities

- `learned-skill-knowledge-context`: Store owners resolved by the predecessor
  context slice become supported knowledge-operation targets instead of
  returning the temporary store-scope-unavailable diagnostic.

## Impact

- Code: learned-skill types/schemas/catalog/store resolution/mutation planning,
  knowledge commands and messages, typed store membership lookup, locks and
  atomic writes.
- Data: additive versioned store-capable candidate/manifest forms and canonical
  `rasen/learned-skills` content inside registered store repositories; v1
  project/global records remain readable and are not upgraded by reads.
- Security: promotion sources are exact managed canonical identities resolved
  through current registry/membership facts; approval is scoped separately for
  store and global writes.
- Operations: store mutations leave explicit reviewable changes in the store
  working tree and never commit or push them automatically.
- Tests/docs: compatibility matrices, typed identity collisions, membership and
  evidence gates, approval/consent mismatches, ownership collisions, atomic
  failure behavior, locale parity, and Windows path handling.
