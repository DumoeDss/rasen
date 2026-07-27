## Why

PR #88's validation surface has three defects that violate fail-closed,
credential-safety, and identity-normalization invariants:

- **M9** — the bootstrap obtain path reads a remote from a durable Store
  declaration and passes it directly to `git clone` without checking for
  embedded credentials. The normal write path rejects credential-bearing
  remotes via `assertCredentialFreeRemote()`, but hand-written or legacy
  declarations bypass that gate. The remote lands in the process argv
  (visible via `ps`) and, on failure, `cloneRepository` folds git's
  `error.message` — which echoes the URL — into the user-facing diagnostic.
- **M5** — `readStoreCatalog` silently skips `.rasen-learned-skill-backup-*`
  directories (filtered by `isOsJunkEntryName` because they start with a dot).
  A mutation killed mid-swap renames the record directory to this backup
  prefix; until the next mutation runs `sweepMutationDebris`, the catalog
  reads as EMPTY. The effective-materialization path
  (`effective.ts:596`) uses `loadStoreCatalog` (which returns only `.records`)
  and therefore sees nothing — it may pick a global fallback or destructively
  reconcile away generated files that the backed-up record still owns. This
  violates the fail-closed invariant: recoverable data treated as absent.
- **M10** — the export path normalizes the project identity via
  `normalizeProjectIdentity()` (trim + lowercase), so a bundle carries the
  lowercase canonical form. The registry keeps the original string the user
  typed (potentially uppercase). Import (`import.ts:1107`) compares the
  bundle's lowercase ID strictly to the registry's original — mismatch → the
  bundle is refused. An uppercase-UUID project exports a valid bundle that
  cannot be imported back.

## What Changes

### M9 — Credential-bearing remotes rejected before obtain; errors redacted

The fix reuses the existing `assertCredentialFreeRemote` from
`src/core/store/remote.ts:57-72` — the SAME guard the write path already
enforces at `foundation.ts:869`, `membership.ts:759,806`,
`operations.ts:666`, `project-records.ts:472`, and `upgrade-identity.ts:199`.

- **`cloneWithCleanupGuard`** (`bootstrap.ts:1515`) is the single clone
  chokepoint: both the Store obtain path (`obtainAbsentStore` line 1765) and
  the project obtain path (line 2912) route through it. Add
  `assertCredentialFreeRemote(remote, 'store.pointer')` as the FIRST statement
  inside the existing `try` block, before `cloneRepository`. The thrown
  `StoreError` is caught by the existing catch block, which pushes a
  diagnostic (containing only the redacted URL, because
  `assertCredentialFreeRemote`'s message uses `redactRemote`) and returns
  `{ ok: false }`. No staging directory exists yet at that point, so the
  cleanup `fs.rmSync(stagingPath, { force: true })` is a safe no-op.
- **`cloneRepository`** (`git.ts:160`) gains defense-in-depth: import
  `redactRemote` and replace the raw remote with its redacted form in the
  error message before constructing the `StoreError`. This ensures that even
  if a future caller bypasses `cloneWithCleanupGuard`, git's error output
  (which echoes the URL) cannot leak credentials into the diagnostic.

Spec satisfied: **`store-identity/spec.md:181-200`** — "Store metadata never
carries credentials." The rejection scenario ("the rejected value is not
echoed back in full") and the redaction scenario ("every human and JSON
surface that displays it shows a redacted form") are both now enforced at
the obtain path. No delta spec needed — the code reconciles to the existing
requirement.

### M5 — Recoverable backup debris reported as degraded, not empty

- **`StoreCatalogRead`** (`catalog.ts:317-326`) gains a `recoverableBackups:
  string[]` field naming every `.rasen-learned-skill-backup-*` directory
  found during the read.
- **`readStoreCatalog`** (`catalog.ts:345`) detects entries starting with
  `LEARNED_SKILL_BACKUP_PREFIX` BEFORE the `isOsJunkEntryName` filter, adds
  them to `recoverableBackups`, and continues (they still don't enter
  `records` because their directory-name/id mismatch is not a verifiable
  record). Other dot-prefixed entries (`.DS_Store`, etc.) remain silently
  skipped as before.
- **`effective.ts:596`** switches from `loadStoreCatalog` to
  `readStoreCatalog`. When `recoverableBackups.length > 0`, the Store is
  pushed as `status: 'unavailable'` with a diagnostic explaining the catalog
  has a recoverable backup and the repair is to run any learned-skill
  mutation (which triggers `sweepMutationDebris`). The Store is NOT pushed
  as `status: 'member'` with an empty catalog, so the effective resolution
  treats it as degraded and defers cleanup rather than destructively
  reconciling.

Spec satisfied: **`store-scoped-learned-skills/spec.md:143-158`** — "no
content is destroyed." Also reconciles to
**`learned-skill-effective-materialization/spec.md:110-133`** — "A Store
that cannot be reached is never treated as one with nothing in it." A delta
to `store-scoped-learned-skills` adds one scenario making the read-path
debris guarantee explicit.

### M10 — normalizeProjectIdentity at every comparison

- **`import.ts:1107`** — the bundle-vs-registry project-ID check becomes
  `normalizeProjectIdentity(bundle.projectId) !==
  normalizeProjectIdentity(project.ref.projectId)`.
- **`import.ts:1137-1138`** — the catalog-drift identity checks normalize
  both sides.
- **`project-registry.ts:337,465,544`** — same-ID lookups normalize both
  sides so an uppercase registry entry is found when a lowercase input
  arrives (and vice versa). The registry KEEPS the original string for
  display; only comparisons change.
- **Test** — add an uppercase-UUID export→import roundtrip test that exports
  a bundle from a project whose registry carries an uppercase UUID and
  imports it back successfully.

Spec satisfied: **`portable-project-knowledge/spec.md:103-111`** — "the
project identity it carries is the project being imported into." The
identity IS the normalized form (`project-records.ts:97-99`); the fix makes
the code's comparison consistent with that definition. No delta spec needed.
