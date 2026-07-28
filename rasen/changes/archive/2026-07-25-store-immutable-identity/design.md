## Context

Today a Store is identified by `id`, a kebab-case string that lives in three places at once and means something slightly different in each:

- `<store>/.rasen-store/store.yaml` — `{ version: 1, id, remote? }`, travelling in the Store's own Git repository.
- `~/.rasen/stores/registry.yaml` — `{ version: 1, stores: { <id>: { type?, backend } } }`, machine-local, alias-keyed, with an extra `project:<id>` namespace for in-repo projects registered via `store add-project`.
- `<project>/rasen/config.yaml` — `store: <id>`, a bare string read by `readStorePointer()` (`src/core/project-config.ts:1207`).

Every consumer resolves that string itself. `src/core/root-selection.ts:209` filters `listStoreRegistryEntries()` and calls `inspectRegisteredStore()`; `src/core/effective-config.ts:104` does its own `stores.find(...)`; `src/core/config-api/project-addressing.ts:115` does a third variant; `src/core/store/registry.ts` has a fourth via `getRegisteredStoreOrThrow()`. There are 16 `listRegisteredStores()` call sites across the codebase. Their failure semantics disagree: root selection throws, project addressing returns a 404/409 result, and effective config returns `null`.

That last one is the bug this change exists to kill. `resolveConfigStoreLayer()` ends with `if (!store) return null;` (`src/core/effective-config.ts:125`) — a project whose declared Store is missing resolves configuration exactly like a project that never declared one. A malformed pointer takes the same path two lines earlier. The user is told nothing and gets global/default values that look legitimate.

Constraints this design works under, all from the development plan (`rasen/explorations/global-store-project-unification-development-plan.md`) and its locked-decision list §33:

- UUID, not a global counter — offline machines cannot allocate numbers safely (§6.1).
- No absolute path may enter a Git-shared file (§9.1).
- Ordinary commands never implicitly clone, register, mint, upgrade, or repair (§5.6, §20.1). `doctor` is read-only (§33.18).
- Readers ship before writers; legacy data stays readable; the new shape is written only by an explicit mutation (§30.2, §7.2).
- Windows is a first-class target: `path.join()` everywhere, canonical path comparison, no hardcoded separators.

## Goals / Non-Goals

**Goals:**

- One immutable Store identity (`uid`) that survives rename, re-registration, and re-clone.
- One resolution path — `resolveStoreBinding()` — that every Phase A consumer calls, returning an exhaustive tri-state rather than a nullable.
- An unresolvable Store is a named, diagnosable state with a repair command; it never degrades into "no Store".
- v1 metadata, v1 registry, and string pointers stay fully readable; the v2 shapes are written only on explicit mutation.
- Alias lookup has explicit arity semantics (0 / 1 / N) with no silent pick.
- No machine-absolute path and no credential ever reaches a Git-shared file.

**Non-Goals:**

- Store-scoped learned knowledge and its materialization (later child, adapting PR #65/#66).
- `<store>/.rasen-store/projects/<projectId>.yaml` membership records and `storeMemberships` locators (later child).
- The `rasen bootstrap` clone/register state machine (later child) — Phase A only *names* `store_bootstrap_required` and prints a `store register` repair command.
- Legacy `sourcePath` removal from `adoptions.yaml` (later child).
- Portable run checkpoint (out of this release entirely).
- Migrating the four consumers owned by later children (see D12).

## Decisions

### D1 — The resolver is a new module in `src/core/store/`, not in `root-selection.ts`

`src/core/store/identity.ts` exports the shared identity types and the single entry point:

```ts
export function resolveStoreBinding(input: {
  pointer: StorePointerRead;      // from project-config
  projectRoot?: string;
  globalDataDir?: string;
}): Promise<StoreBindingResolution>;
```

The plan's code map (§31) assigns "Store binding tri-state" to `src/core/root-selection.ts`. Placing the resolver's *implementation* there would invert the existing dependency direction: `root-selection.ts` already imports `store/registry.js` and `store/foundation.js`, and both `effective-config.ts` and `config-api/project-addressing.ts` would then have to import `root-selection.ts` to resolve a Store layer — pulling command-facing reporters, banners, and space derivation into the config path.

`src/core/store/` is already the leaf every consumer imports. The resolver lives there; `root-selection.ts` keeps §31's responsibility as the tri-state's *adapter*, mapping each `unavailable` reason onto its `RootSelectionError`. Alternative considered and rejected: a top-level `src/core/store-identity.ts` — it would split the Store module in two for no gain.

### D2 — Schema versions are explicit gates, and reads never upgrade

| File | v1 (read) | v2 (read + write) | What writes v2 |
|---|---|---|---|
| `store.yaml` | `{version: 1, id, remote?}` | `{version: 2, uid, id, remote?}` | `store setup` (new Store); `store upgrade-identity --apply` |
| `registry.yaml` | `{version: 1, stores: {<alias>: …}}` | `{version: 2, stores: {<uid>: {id, backend}, 'project:<id>': …}}` | any explicit registry mutation (`register`, `unregister`, `remove`, `setup`, `add-project`) |
| project `store:` | `store: <alias>` | `store: {uid, id?, remote?}` | `store upgrade-identity --apply`; `store setup`/`register` when it wrote the pointer |

The registry key grammar is chosen by the file's own `version` field, never guessed: in a v1 file a bare key is an alias; in a v2 file a bare key MUST parse as a UUID and anything else is an `invalid_store_registry` diagnostic. `project:`-prefixed keys keep their existing meaning in both versions (D7).

No read path upgrades anything on disk. A v1 read yields the same in-memory `ResolvedStoreRef` a v2 read yields, with `uid` absent — which is itself a legitimate resolution outcome carrying `store_pointer_legacy` / metadata-legacy diagnostics.

Alternative considered: auto-upgrade metadata on the next registration, the way `copyForwardLegacyStoreMetadata()` copies `.openspec-store/` forward. Rejected — that helper copies a file the user already owns to a new name; minting a *new identity* into a Git-tracked file the user has not asked to change would produce an unexplained diff in their Store repository.

### D3 — The tri-state is exhaustive and `unavailable` is never collapsed

```ts
export type StoreBindingResolution =
  | { kind: 'absent' }
  | { kind: 'resolved'; store: ResolvedStoreRef; pointer: StorePointerV2; diagnostics: StoreDiagnostic[] }
  | { kind: 'unavailable'; expected: StoreIdentityRef; reason: StoreUnavailableReason;
      diagnostics: StoreDiagnostic[]; repair: string[] };

export type StoreUnavailableReason =
  | 'not-registered' | 'metadata-missing' | 'uid-mismatch'
  | 'root-unhealthy' | 'alias-ambiguous' | 'pointer-malformed';
```

`absent` means the project declares no Store — the only state that legitimately resolves with no Store layer. Every other failure is `unavailable`, carries the identity that was expected, and carries `repair` as an ordered list of copy-pasteable commands. Consumers switch exhaustively (`const _: never = resolution`), so a future reason cannot silently fall into a default branch. `resolveConfigStoreLayer()`'s signature changes from `Promise<StoreConfigLayer | null>` to the tri-state precisely so the `return null` line cannot come back.

Shared durable ref types land here too, matching the plan's §12 vocabulary — `StoreIdentityRef`, `ProjectIdentityRef`, `GlobalIdentityRef`, `DurableOwnerRef`, `ResolvedStoreRef`, `ResolvedProjectCheckoutRef`. Phase A introduces and uses the Store half; the project half is exported for the sibling children so the vocabulary is defined once.

### D4 — Fail-closed everywhere except the diagnostic surfaces

An `unavailable` binding stops any command that would read the Store's planning content or inherit its configuration. Three surfaces are carved out, because they are how a user *learns* the binding is broken and would otherwise be unreachable in exactly the state they are needed:

- `rasen doctor` and `rasen store doctor` — report the reason and repair, exit non-zero, mutate nothing.
- `rasen store list` — lists what is registered; a broken pointer elsewhere is not its business.
- `rasen config --scope global` (machine scope; there is no `--global` flag) — resolves no project layer, so no Store layer applies. This holds for the no-subcommand form too, which is otherwise a project-scoped view and fails closed like any other.

`rasen init`'s existing pointer guard keeps reporting rather than failing, for the same reason. Everything else — root selection, project-scoped effective config, the config HTTP surface, space resolution — fails closed with the reason and repair. The failure message states which of UID or alias was resolved, whether the command touched the network (it never does), and the next command to run.

### D5 — UID is authority; alias is a lookup with declared arity

Resolution order for a pointer:

1. **Object pointer with `uid`** — look the UID up in the registry. Found and the checkout's metadata UID agrees → `resolved`. Found and metadata disagrees → `unavailable/uid-mismatch`. Not found → `unavailable/not-registered` (repair names the pointer's `remote` when it has one). The pointer's `id` and `remote` are *display and locator only*: an alias that no longer matches the Store's metadata is a `store_pointer_alias_drift` warning, a remote that differs from the Store's canonical remote is a `store_pointer_remote_divergence` info note, and neither blocks resolution.
2. **String pointer (legacy)** — resolve by alias against the store namespace, then apply arity:
   - 0 matches → `unavailable/not-registered`
   - 1 match → `resolved`, plus a `store_pointer_legacy` info note offering the pointer upgrade command
   - N matches → `unavailable/alias-ambiguous`, listing every candidate UID, alias, and root, with the repair being the upgrade command carrying an explicit `--uid`
3. **Malformed pointer** (unparseable YAML, or a `store:` value that is neither a string nor an object with a usable `uid`) → `unavailable/pointer-malformed`. The existing `readStorePointer()` contract of *reporting* malformation instead of dropping it is preserved and extended to the object shape.

A v1 Store (metadata with no `uid`) registered under an alias resolves through path 2 and reports as legacy. It is never blocked and never auto-upgraded.

The no-transitivity rule is unchanged and stays mechanical: a root that is itself a registered Store never resolves its own `store:` declaration into a layer (`isRegisteredStoreRoot()` today; UID-compared after this change).

### D6 — A UID mismatch performs zero writes

`commitStoreRegistration()` currently may create metadata and then update the registry, with a rollback that deletes the metadata it created only when no registry entry references it. Identity verification moves *ahead* of both: the checkout's metadata UID is compared to the expected UID before any file is touched. On mismatch the command throws `store_uid_mismatch` having written nothing — no metadata, no registry entry, no lock-file side effects beyond acquire/release. This is asserted directly (snapshot the registry file bytes and the metadata mtime around the failing call), not inferred from the absence of an error.

`register --id <alias>` likewise never overwrites an existing identity: an alias mismatch stays the existing `store_metadata_id_mismatch` error, and a UID is never taken from a flag at all.

### D7 — Registry v2 re-keys the store namespace only

v2 keys store entries by UID with the alias moved into the entry body:

```yaml
version: 2
stores:
  9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7:
    id: elftia-store
    backend: { type: git, local_path: E:\repos\elftia-store, remote: … }
  project:elftia:
    type: project
    backend: { type: git, local_path: … }
```

`project:`-prefixed entries keep alias keying and `(type, id)` uniqueness untouched. Their authority moves to per-`projectId` records in a later child; re-keying them here would churn the same data twice and would need a project identity Phase A does not resolve.

Consequences inside the store namespace: uniqueness becomes per-UID, so two Stores may share an alias (which is what makes `alias-ambiguous` reachable at all), and the path-conflict check stays per canonical path. `parseRegistryKey()` / `registryKeyFor()` gain the version as a parameter rather than growing a second guessing rule. A v1 store entry that has no UID cannot be keyed by UID; the v2 writer therefore refuses to rewrite a registry containing v1 store entries that lack resolvable metadata UIDs, and reports which entries need `store upgrade-identity` first — rather than inventing UIDs for them.

### D8 — UID generation and comparison

Minted with `crypto.randomUUID()`, matching how `projectId` is minted (`src/core/project-config.ts:1326`). Accepted on read in any RFC 4122 textual form — the same policy the session id check already uses (`src/core/management-api/router.ts:200`) — because the check exists to reject junk, not to pin a version. Comparison lowercases and trims first, so a hand-edited uppercase UID in a YAML file is not reported as a mismatch. A `uid` that fails the format check is an `invalid_store_metadata` diagnostic, never a silently-accepted opaque string.

### D9 — Credentials are rejected by URL parsing, not by pattern-matching

A remote is parsed with `new URL()`. If the parse succeeds and the result carries `username` or `password` userinfo, the remote is rejected on write (`store_remote_credentials`) and redacted to `<scheme>://<redacted>@<host><path>` in every output, human and JSON. The scp-style `git@github.com:org/repo.git` form carries a username but no secret and is explicitly allowed — it is the ordinary SSH form. An unparseable string is not guessed at: it is passed through as an opaque remote exactly as today, since the rejection rule targets embedded secrets, not URL well-formedness. No regex scan for token-shaped substrings — that would produce false positives on legitimate paths and false confidence on unknown formats.

### D10 — The numeric-alias warning fires on new aliases only

`store setup`, `store register --id`, and the alias-rename path warn when the alias is all digits: it reads like an identity, and the UID is the real one. Aliases already on disk keep resolving silently — a warning a user cannot act on without renaming their Store is noise, and the resolution behavior is unchanged either way.

### D11 — Alias rename cannot change canonical identity

Renaming an alias rewrites `id` in the Store's metadata and the `id` field of its registry entry, keyed by the unchanged UID. Nothing else moves: the registry key, every UID-bearing pointer, and any UID recorded elsewhere stay valid. A string pointer that named the old alias becomes `unavailable/not-registered` with a repair that upgrades it to the UID — which is the honest report, since a bare alias genuinely no longer identifies that Store.

Phase A ships no command that rewrites the metadata alias: renaming is the user editing `<store>/.rasen-store/store.yaml`'s `id` and re-running `rasen store register <path>`, which verifies the identity, finds the existing entry BY UID, and updates that entry's `id` in place (`aliasRenamed`). The registry therefore follows the metadata rather than the other way round, and `verifyStoreIdentity` keeps a single rule — the metadata id and the registered id must agree — with no caller-supplied exemption. A dedicated `store rename` command is a later, additive change; the invariant above is what Phase A guarantees.

### D12 — Phase A migrates its own file set; the rest is scoped to later children

The single-resolver rule is enforced across the plan's Phase A file set: `root-selection.ts`, `effective-config.ts`, `config-api/project-addressing.ts`, `config-api/config-context.ts`, `relationship-health.ts`, `project-home.ts`, `store/migration-ops.ts`, `commands/store.ts`, `commands/doctor.ts`, `commands/config.ts`, `commands/pipeline.ts`, `agent-context.ts`, plus the `store/` module itself. Two remaining `listRegisteredStores()` consumers stay on the compat surface because their resolution semantics are being rewritten by the very children that own them: `learned-skills/context.ts` (Store-scoped knowledge) and `management-api/spaces.ts` (session runtime context). They keep working unchanged against the compat reader.

The boundary is made mechanical rather than aspirational, in two layers:

- a test asserts that no file in the Phase A set imports `listRegisteredStores`, and the compat exports carry a doc comment naming the child that retires each one;
- a second test enumerates every read of a declaration's display alias in `src/` — any `…pointer.value` / `…pointer?.value` property access and any `{ value } = …pointer` destructuring — against an allowlist with a per-file reason, and fails equally on a stale allowlist entry. A hand-maintained file list only covers files someone remembered to add; this one fails on any new site that asks "does this repo declare a Store?" by reading the display alias instead of `hasStoreDeclaration()` — the exact shape of defect that reached `project-home.ts` and `migration-ops.ts`. It is a source scan, not a type-aware one: a pointer bound to a name that does not end in `pointer` would escape it.

**Surfaces that still name a Store by display alias only, each with its owner.** They are recorded here rather than left implicit, because each is a place a later child would otherwise inherit unknowingly. None is a data-safety problem: every one fails loudly with a repair rather than resolving the wrong Store.

| Surface | Why it is deferred | Owner |
|---|---|---|
| `rasen knowledge list\|show\|apply\|retire --store <id>` (`learned-skills/context.ts:235`) | A documented user-facing flag with its own alias-only owner resolution; the whole knowledge-owner model is being rewritten around Store-scoped knowledge. A permanent identity reports `Unknown store knowledge owner` today. | child D (`store-aware-learned-skills-integration`) |
| `management-api/session-launch-context.ts:174` — compares `pointer.value !== resolvedSpace.space.id` | A uid-only declaration (legal: the alias is optional) makes a live member return 409 `execution_unavailable`. Phase A's `deriveProjectMode` fix makes that state reachable by routing uid-only projects to `mode: 'store'`. Bounded: no rasen command emits a uid-only declaration — `writeDurablePointer` always records `id` — so it is hand-authored only. | child C (`unified-session-runtime-context`) |
| `references:` in a Store's config, and the `project:<id>` entries `store add-project` appends | Entries are project-namespace ids, and the project namespace stays alias-keyed in BOTH registry versions (D7). No identity form can exist for them until project identity does. | child B (`project-keyed-store-membership`) |
| Session records freeze `space: {type:'store', id}` (`management-api/session-registry.ts:42`), derived from `deriveSpaceFromCwd` | A durable record carrying a display name: with two Stores sharing one, a frozen space cannot be re-resolved later. The record's wire shape is the session runtime's to change, not this change's resolver call sites. | child C |
| Next-step hints render `--store <root.storeId>` (`change-status-policy.ts:73`, `artifact-graph/instruction-loader.ts:521`) | `--store <uid>` now resolves, but the hint printed back always names the display alias — so a user who used an identity BECAUSE the name is ambiguous gets a suggested command that fails as ambiguous. Fixing it means carrying the identity on `ResolvedOpenSpecRoot` and teaching every hint site to choose, which is wider than Phase A's file set. | follow-up (additive) |

### D13 — Diagnostic codes

Phase A owns this subset of the plan's §20.2 vocabulary, and siblings reuse rather than re-coin:

| Code | Severity | Meaning |
|---|---|---|
| `store_bootstrap_required` | error | pointer names a Store not registered on this machine |
| `store_uid_mismatch` | error | the registered checkout is not the expected Store |
| `store_alias_ambiguous` | error | the alias matches more than one registered Store |
| `store_pointer_legacy` | info | the pointer is a bare alias string |
| `store_pointer_remote_divergence` | info | pointer locator differs from the Store's canonical remote |
| `store_pointer_alias_drift` | warning | pointer alias no longer matches the Store's metadata alias |
| `store_metadata_legacy` | info | Store metadata is v1 (no UID) |
| `store_remote_credentials` | error | a remote carrying credentials was supplied |
| `store_alias_numeric` | warning | a newly-assigned alias is all digits |
| `store_remote_divergence` | info | the Store's own recorded remote differs from its checkout's origin |
| `store_registry_rekey_blocked` | info | a registry mutation kept the alias-keyed form; the named entries have no identity yet |
| `store_alias_repeated` | warning | a registration succeeded under a display name another Store already uses |
| `store_alias_renamed` | info | a re-registration moved a registry entry's display name, keyed by the unchanged identity |

`store_pointer_alias_drift`, `store_metadata_legacy`, `store_remote_credentials`, and `store_alias_numeric` are new to the vocabulary and are recorded back into the portfolio's shared list. Human and JSON output render the same code, message, and repair — one formatter, asserted by a parity test.

The last two rows deserve their distinction. `store_remote_divergence` predates this change (`store doctor` and `rasen doctor` both emitted it) but was never declared, so the parity test did not cover it; it stays a SEPARATE code from `store_pointer_remote_divergence` rather than being folded into it, because the two compare different pairs of values — this one the Store's metadata against its own checkout's origin (no project declaration involved), the other a project declaration's locator against the Store's canonical remote. Renaming either onto the other would make a doctor finding lie about which value disagreed. `store_registry_rekey_blocked` is new: it is how the refusal in D7 reaches the user from the ordinary mutations (`register`, `unregister`, `remove`, `setup`, `add-project`), which previously discarded it.

### D14 — Cross-platform

Every path is composed with `path.join()` / `path.resolve()`; root comparisons go through `FileSystemUtils.canonicalizeExistingPath()` with the existing `path.resolve()` fallback for a stale root, so a Windows drive-letter case or separator difference still matches. Tests build expected paths with `path.join()`, never literals. A Windows-specific scenario covers a registry whose `local_path` differs from the resolved pointer path only by drive-letter case, plus a UID-mismatch case where the two Stores' roots differ only by separator form.

## Risks / Trade-offs

- **Fail-closed is a behavior break for anyone whose declared Store is not registered.** → `absent` (no pointer at all) is untouched, so a project that never used a Store is unaffected. Every failure names the expected identity and a repair command, `doctor` keeps working in exactly that state, and the migration guide documents each reason with its fix. This is decision §33.10 in the plan and is the point of the change.
- **The diff is large: three schemas, one new module, and six consumer files.** → The consumer migration is bounded to the plan's own Phase A file set (D12) and the four later-child consumers keep the compat reader. If the diff still reviews as too large, the natural split is [metadata + registry + resolver] and [pointer v2 + consumer migration + diagnostics] — but they would land in the same release and the second half is untestable without the first.
- **Alias ambiguity is newly reachable, so a `--store <alias>` invocation that worked can start failing.** → It can only happen once two Stores actually share an alias, which v1 could not represent on one machine; the error lists every candidate with its UID and root.
- **v2 registry cannot be written while any store entry lacks a UID.** → The writer reports which entries need `store upgrade-identity` instead of minting UIDs behind the user's back; until then the registry keeps being written as v1, which stays fully supported.
- **A hand-edited or merge-mangled `uid` reads as a different Store.** → Format-validated on read with an `invalid_store_metadata` diagnostic, compared case-insensitively, and a mismatch fails closed with zero writes rather than re-registering.
- **`store upgrade-identity` touches two repositories (the Store and the project) and cannot be atomic.** → Plan/apply with `--dry-run`, ordered so the Store's own metadata is written and verified first; on partial failure the Store metadata stands (it is legitimate on its own) and the output names the pointer write that still needs doing. Files are written atomically (temp + rename) and never committed automatically.

## Migration Plan

1. **Readers first.** v2 metadata, v2 registry, and object-pointer parsing land as readers, with v1/string paths untouched. At this point nothing on disk changes and every existing installation behaves identically.
2. **Resolver + consumers.** `resolveStoreBinding()` lands and the Phase A file set switches to it. This is where the fail-closed behavior appears; it is also where `resolveConfigStoreLayer()` stops returning `null`.
3. **Writers, explicitly gated.** `store setup` mints a UID for a *new* Store. `store upgrade-identity <store> [--dry-run|--apply] [--json]` upgrades an existing Store's metadata, its registry entry, and — when run from or pointed at a project — that project's pointer. Nothing else writes v2.
4. **Diagnostics + docs.** `doctor`, `store doctor`, and the effective-config view report the new codes; `docs/cli.md`, Store troubleshooting, the migration guide, JSON examples, the completion registry, and the three locale bundles are updated in the same change.

Rollback: reverting the change leaves v2 files on disk that the previous version cannot parse. That is bounded by step 3 — v2 is written only where a user explicitly ran `store setup` or `store upgrade-identity`, and the upgrade command's output says so before it writes. No read path can produce a file the previous version chokes on.

## Open Questions

- Should `store upgrade-identity` also offer a `--all` sweep over every registered Store, or stay one Store per invocation? One-at-a-time is assumed here (it keeps the two-repo failure story simple); a sweep is a small additive follow-up if the fleet size makes it tedious.
- The `repair` list is currently rendered as shell commands for the current platform. Whether JSON consumers want a structured `{ command, args }` form instead of a string is deferred until the UI actually consumes it.
