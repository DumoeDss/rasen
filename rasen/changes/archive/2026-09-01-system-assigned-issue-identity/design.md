## Context

The current Issue model uses one `IssueId` for four jobs: the operator supplies it, `issue.yaml` treats it as identity, the layout uses it as a directory segment, and every CLI/API/UI call uses it as a selector. `collectIssues` also buckets directories by that value before parsing their records. Consequently the lowercase kebab-case path contract appears in a normal create form, and changing only that form would leave the coupling intact.

Rasen Stores are Git-backed, can be used offline, and can have concurrent refs, worktrees, and clones. Identity allocation therefore cannot depend on a central service, a mutable counter, or a persisted selector map. Existing V1 Issue, plan, acceptance, and digest bytes are already durable evidence and must remain readable without a read-side migration.

The relevant dependencies are local-substitutable: filesystem access, Store ref reads, coordination locks, time, and entropy already have injected production/test adapters. The identity algorithms themselves can be pure.

## Goals / Non-Goals

**Goals:**

- Make title the only normal user-authored input required to create an Issue.
- Give every new Issue an immutable, system-assigned UID and a stable generated human key.
- Keep presentation aliases and physical storage location outside authoritative identity.
- Route every selector through one resolver before a path, lock, or durable relationship is chosen.
- Preserve V1 records and historical digests byte for byte while making old Issue identifiers continue to work.
- Make new Issue-owned durable references carry UID explicitly.
- Keep all reads zero-write and keep Issue writes non-staging/non-committing.

**Non-Goals:**

- A globally sequential `ISS-42` counter.
- An eager directory move or bulk rewrite of existing Stores.
- A central identity allocation service.
- A persistent selector/index map that becomes a second source of truth.
- Title editing, slug-management UI, Issue deletion, or cross-Store Issue transfer.
- Changing node IDs or `dependsOn`, which remain revision-local graph identifiers.

## Decisions

### D1. Separate UID, key, slug/aliases, selector, and storage key

The domain adds branded types rather than renaming the existing `IssueId` and leaving its mixed semantics in place:

```ts
type IssueUid = string & IssueUidBrand;
type IssueKey = string & IssueKeyBrand;
type IssueSelector = string & IssueSelectorBrand;
type IssueStorageKey = string & IssueStorageKeyBrand;

interface IssueAliasV1 {
  readonly kind: 'legacy-id' | 'former-slug' | 'custom';
  readonly value: string;
}

interface IssueIdentityV2 {
  readonly uid: IssueUid;
  readonly key: IssueKey;
  readonly slug: string | null;
  readonly aliases: readonly IssueAliasV1[];
}

interface ResolvedIssueIdentity {
  readonly identity: IssueIdentityV2;
  readonly storageKey: IssueStorageKey;
  readonly sourceVersion: 1 | 2;
}
```

The invariants are:

- `uid` is the sole authority for locks, new durable relationships, equality, and canonical UI routes.
- `key` is an immutable generated human reference used in default CLI/UI presentation and accepted as a selector; it never locates files or joins records.
- `slug` and aliases are optional conveniences. They may be absent or collide, and never participate in locks, paths, or durable relationships.
- `storageKey` is internal physical location only. For new Issues it equals the UID; for V1 it remains the old directory name. It never crosses the HTTP/UI boundary.
- A raw selector never reaches a layout function.

New records use a strict V2 shape:

```yaml
version: 2
identity:
  uid: 75f3d57b-57e4-46ab-88e4-cbfec96bd257
  key: ISS-JMCJHQ6S28BZ0P8K
  slug: terminal-ledger
  aliases: []
title: Terminal ledger
state: open
reason: null
createdAt: 2026-08-31T08:00:00.000Z
```

The key is stored in the authoritative record, not in a side map. Validation proves its shape and its derivation from UID, which both fixes the algorithm as a protocol and prevents hand-authored replacement.

### D2. Use UUID v4 plus a collision-resistant derived human key

Production mints lowercase UUID v4 with Node `crypto.randomUUID()` through an injected `mintIssueUid()` dependency. This matches existing Store identity practice and adds no dependency or time-ordering claim.

The human key is:

```text
ISS- + CrockfordBase32(
  first 80 bits of SHA-256("rasen.issue-key.v1\0" + lowercaseUid)
)
```

It therefore has sixteen uppercase Crockford characters, for example `ISS-JMCJHQ6S28BZ0P8K`. The domain separator, bit selection, alphabet, and casing are protocol constants with fixed test vectors. Allocation checks the complete visible Issue catalog before the first write and retries with another UID on a UID or key collision. A bounded exhaustion returns `issue_identity_allocation_failed` without writing.

`ISS-42` was rejected. Two offline clones can both allocate 42 from the same prior maximum, and a counter file either becomes a merge hotspot or silently permits duplicate numbers in distinct Issue directories. The random UID/key design remains decentralized and makes the extremely unlikely post-merge collision an explicit ambiguity rather than a guessed winner.

### D3. Put identity projection and selector resolution behind one deep seam

The new `store/issues/identity` module exposes three entries:

```ts
allocateIssueIdentity(input): IssueIdentityV2;
projectStoredIssueIdentity(input): ResolvedIssueIdentity;
resolveIssueSelector(input): ResolvedIssueIdentity;
```

`allocateIssueIdentity` hides entropy, key derivation, slug generation, collision checks, and bounded retry. `projectStoredIssueIdentity` validates V2 identity or projects V1 compatibility identity. `resolveIssueSelector` takes one invocation's authoritative catalog and resolves UID, key, slug, or alias to exactly one UID.

The aggregate repository remains responsible for I/O, but it must parse/project each directory before grouping and group by UID rather than directory name. Each copy retains its real `storageKey` and ref so plan/acceptance reads use the location that produced the record. The mutation repository builds the same projected catalog for its checkout before resolving a selector. Callers and tests cross the same identity interface.

Selector rules are explicit:

- lowercase UUID and `uid:<uuid>` match UID;
- `ISS-…` and `key:ISS-…` match keys case-insensitively;
- `legacy:<value>` restricts matching to legacy aliases;
- an unprefixed value matches the union of UID, key, slug, and aliases;
- zero matches returns `issue_not_found`;
- more than one distinct UID returns `issue_selector_ambiguous` with candidate UID/key/title facts;
- a mutation refuses when unreadable refs mean uniqueness cannot be proved.

No selector cache is durable. An implementation may memoize within one request or by immutable Git tree OID, but deleting that cache must lose no fact.

### D4. Project V1 identity deterministically and never write during compatibility reads

For a V1 record at `<legacyId>`, the compatibility view is:

```text
uid        = UUIDv5(namespace = storeUid,
                    name = "rasen:issue:v1:" + legacyId)
key        = deriveIssueKey(uid)
slug       = legacyId
aliases    = [{ kind: "legacy-id", value: legacyId }]
storageKey = legacyId
```

This is stable across refs, clones, machines, Store display-name changes, and filesystem paths. The same old ID in another Store intentionally gets another UID. V1 record state updates remain V1 writes. Reads never add identity fields, move directories, or rewrite a digest.

An optional legacy `issueId` accepted by the create compatibility adapter becomes a `legacy-id` alias only. It cannot choose the UID, key, lock, or directory. CLI and UI do not require or normally expose that adapter.

### D5. Version new Issue-owned resources around `issueUid`

New Execution Plans, acceptance-condition revisions, and accepted records use version 2 and carry `issueUid`. This applies to new V2 Issues and to newly published resources for a V1 Issue's projected UID. Existing version-1 resources retain `issueId`, their existing canonical serializers, and their exact digest rules.

A V2 revision may supersede a V1 ordinal; ordinal allocation does not change. Parsing verifies the original version's canonical bytes and digest before projecting a common domain view. A V1/V2 mixed revision history is therefore an intentional compatibility bridge, not an invitation to normalize old bytes.

The owner UID in a V2 child record must equal the resolved Issue UID. Mismatch returns `issue_resource_identity_mismatch` and writes nothing.

### D6. Address paths only with an internal storage locator and lock by UID

The planning layout's Issue address variants accept `IssueStorageKey`, not a user selector or presentation key. New content lands below `rasen/issues/<lowercase-uuid>/`; V1 content remains below its old portable directory.

Every mutation uses a Store-scoped allocation lock followed by the UID Issue lock. Creation needs that boundary for collision-free publication; selector-based mutations need the same boundary so a concurrent creation cannot make a previously unique slug/alias ambiguous after resolution. The declared order becomes:

```text
issue-allocation -> issue -> scope -> workspace -> change -> integration
```

The allocation lock covers catalog validation and selector resolution together with UID/key allocation and atomic expected-absent publication of `issue.yaml`. It is machine coordination, never Store truth; cross-clone safety still comes from UUID/key entropy plus fail-closed aggregate collision detection. Selector mutations resolve while holding allocation, then take the UID lock and re-read the chosen storage record before writing. A gated create-versus-selector regression fixes the linearization point: a selector that was unique before a same-slug creation must resolve only after that creation publishes and therefore refuse ambiguity, rather than writing through a stale resolution.

The V2 record is the create commit point. Exact committed bytes observed after an atomic-writer exception still mean success with the assigned identity and a path-free warning. If the record cannot be read, contains unverifiable bytes, or is absent while owned intent/claim/backup carriers may remain, the outcome is `issue_publication_indeterminate`: it carries the intended immutable UID/key and `retrySafe: false`, and tells the caller to inspect that identity before any fresh create. It never reuses `issue_identity_allocation_failed`, whose zero-write meaning is reserved for bounded allocation failure that occurs before publication. Rasen retains uncertain carriers rather than deleting anything whose ownership cannot be proved. Plans/acceptance directories are created on demand. The optional README is secondary output and cannot become identity authority; its public warning is stable and path-free while the raw cause remains core-only.

### D7. External contracts expose structured identity and keep compatibility fields narrow

Core and wire results add:

```ts
identity: {
  uid: string;
  key: string;
  slug: string | null;
  aliases: readonly { kind: string; value: string }[];
}
```

`issueId` remains temporarily as a deprecated preferred-selector field so old consumers can transition, but new code uses `identity.uid` for component keys/links/relationships and `identity.key` for human presentation. The storage key is never serialized. The shared public projection also removes it from unreadable-record fallbacks: `issueId`, aggregate `itemId`, paths, reason/diagnostic text, and divergence-copy fields all become path-free public values when no authoritative identity can be proved.

Canonical creation is title-only:

```text
rasen store issue new --store demo --title "Fix login timeout"
POST /api/v1/stores/issues { "title": "Fix login timeout" }
```

The CLI's former positional is optional for one compatibility cycle and is recorded only as a legacy alias. Human output names the key and title; `--json` includes the full identity. The Board create dialog contains only Title. Unlinked Changes must consume the creation response UID when publishing the first plan or showing partial-create recovery; it cannot reconstruct identity from request input.

Unlinked Changes also consumes the structured recovery identity when creation returns `issue_publication_indeterminate`. That result permanently closes the fresh-create path for the current dialog mount, keeps the returned UID/key visible, refreshes Store truth, and offers only an explicit inspect/attach recovery read addressed by the canonical UID. Ordinary submission-state reset, mode switching, or a failed recovery read cannot unlock another create; closing and mounting a genuinely new dialog establishes the next fresh state.

Execution Plan HTTP projection never decides public identity from `ResolvedExecutionPlan.issueId`, because that core field can carry a storage fallback in degraded reads. Every flat, path-scoped, detail, and projection caller supplies the associated `IssueSummary`; the projector emits its verified public UID or the explicit unavailable marker and applies the same authority to problem `itemId` values. A real unreadable selector remains fail-closed, while the defensive projection still redacts any query-shaped degraded result that reaches the boundary.

Issue cards display key plus title. Canonical detail routes use UID. A key, slug, or legacy deep link resolves through the server and is replaced with the UID route after success.

### D8. Fail closed with an identity-specific error vocabulary

The core adds or narrows these errors:

- `issue_title_required` / `issue_selector_required` / `issue_selector_invalid` → 400;
- `issue_not_found` → 404;
- `issue_selector_ambiguous`, `issue_identity_conflict`, `issue_key_conflict`, `issue_alias_conflict`, and `issue_storage_identity_mismatch` → 409;
- `issue_resource_identity_mismatch` → 422;
- `issue_identity_allocation_failed` → 500 with zero writes.
- `issue_publication_indeterminate` → 500 with `{kind, identity:{uid,key}, retrySafe:false}` recovery facts and no retry-safety claim.

Aggregate reads report invalid copies and collisions through their existing completeness/problem channels. They never choose by timestamp, ref order, directory order, or case. Mutations require one complete, coherent resolution.

### D9. Alternatives compared

**Alternative A — minimal compatibility patch.** Keep `issueId` as the path identity, generate a kebab ID from title, and hide it in UI. This makes the default caller easy but preserves the mixed domain type, title/path coupling, and inability to rename or use non-ASCII titles safely. It is shallow: complexity reappears in every caller.

**Alternative B — persisted counter and selector map.** Allocate `ISS-42`, store a UID behind it, and maintain a map from aliases/numbers to UID. This is flexible in a centralized database, but shallow and unsafe in an offline multi-ref Store: map and records can diverge, counters conflict, and imports require renumbering.

**Alternative C — identity/repository seam (chosen).** UUID is authority, a stable generated key is human-facing, aliases remain conveniences, and the resolver index is generated from records per snapshot. This concentrates V1/V2, ref, path, and ambiguity complexity behind three entries. Its cost is broader initial migration across core/wire/UI types, but deleting the module would redistribute that complexity throughout the system, demonstrating that the module is earning its depth.

The chosen shape combines Alternative A's title-only default with Alternative C's durable separation. It deliberately rejects Alternative B's sequential presentation.

## Risks / Trade-offs

- **[Broad type migration]** Many Issue status, execution, publication, acceptance, API, and UI shapes currently carry `issueId: string`. → Introduce identity types at the Store seam first, then move callers vertically while retaining a deprecated wire field until all in-repo consumers use structured identity.
- **[Legacy/V2 mixed histories]** A V1 Issue can own old V1 revisions and new V2 revisions. → Keep version-specific codecs/digests and test V1→V2 ordinal/supersedes behavior with golden bytes.
- **[Cross-ref key/alias collision]** Two offline writers can create colliding presentation selectors. → UID remains authoritative; aggregate reads report ambiguity/conflict, writes refuse, and no selector chooses a winner.
- **[Selector scans cost more than direct paths]** Resolving a key/alias requires an Issue catalog. → Reuse the aggregate reader's per-invocation ref memoization; add only disposable tree-OID caching if evidence shows a need.
- **[Canonical URL changes]** Old bookmarks and scripts use legacy IDs. → Continue accepting every legacy selector and replace successful browser routes with canonical UID URLs.
- **[README partial output]** A secondary narrative write could fail after record creation. → Treat `issue.yaml` as the commit point and report secondary failure honestly; never delete the published Issue as compensation.
- **[Indeterminate atomic publication]** A failure can occur after the UID directory or owned carriers exist but before the caller can observe the record. → Preserve the assigned UID/key and raw internal cause, publish only path-free recovery facts with `retrySafe:false`, and never translate the outcome into the zero-write allocation code or delete unproven carriers.
- **[Implementation size]** V2 child-resource codecs add work beyond removing one UI field. → Implement/test by vertical seams and preserve V1 serializers untouched.

## Migration Plan

1. Add identity brands, UUID/key/slug/legacy projection algorithms, deterministic entropy injection, V2 Issue record codec, and fixed vectors without changing callers.
2. Add V1/V2 catalog projection and selector resolution; change aggregate grouping from storage directory to UID while retaining each copy's storage locator.
3. Change layout and lock interfaces to accept storage key and UID respectively; implement title-only V2 creation with atomic allocation.
4. Resolve every existing mutation/query selector through the shared catalog; retain legacy selector compatibility.
5. Add V2 plan/acceptance/accepted codecs and publish UID-bearing resources while preserving V1 golden bytes.
6. Widen core and HTTP results with structured identity, update CLI creation/output/selectors, then update UI API mirrors, Board/Detail routes, and Unlinked create→plan recovery.
7. Run mixed-store, cross-ref, concurrency, Windows/POSIX, CLI/API parity, and UI suites; update the architecture index for the new core identity module.

Rollback is code rollback only. V2 records already created by a released build are not readable by the old binary, so release packaging must ship the dual reader with every creation surface in one version. No rollback step may delete or rewrite V2 content; forward recovery is to restore the dual-reader binary.

## Open Questions

None for implementation. A future explicit physical migration of V1 directories can be designed separately using the existing stage/verify/manifest/recover transaction machinery; it is not required for identity correctness or compatibility in this change.
