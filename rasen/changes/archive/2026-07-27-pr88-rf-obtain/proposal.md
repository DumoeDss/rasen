## Why

PR #88's obtain/register surface has five defects that together make bootstrap's
"close the gap" step unsafe to trust on a real machine:

- **B3 (Blocker)** — two processes cloning into the same absent target race on a
  single `fs.existsSync` proof; the loser of the race can `rm -rf` the winner's
  successful checkout. The proof lives in one function but is not exclusive.
- **B4 (Blocker)** — the Store obtain path clones first, then calls
  `registerExistingStore({ path })` and marks the entry `obtained+verified`
  WITHOUT re-reading the clone's metadata and comparing its permanent identity
  against what the project declared. A swapped or wrong remote is registered as
  the Store the project wanted, and bootstrap reports success.
- **M1** — the Project obtain path (the reference impl bootstrap.ts:2720-2739)
  only rejects when the cloned `projectId` exists AND is not equal. A missing or
  unreadable cloned identity still registers via the Store's recorded ID and
  reports `obtained`.
- **M2** — `BootstrapInput.globalDataDir` is threaded through nearly every read
  path in bootstrap.ts, but the three `registerExistingStore()` call sites and
  `registerExistingStore()` itself (operations.ts:945-1071) drop it, always
  writing to the default registry path. A≠B data-dir routing is impossible.
- **M11** — `buildBootstrapReport` (bootstrap.ts:2933-2938) swallows every
  metadata-read exception to `null` and then uses only the modern `.rasen-store`
  directory to decide Store-first vs Project-first. A corrupt legacy-only
  `.openspec-store/store.yaml` misroutes to Project-first and can report
  `origin: project, state: complete` over a machine that is actually broken.

The canonical `store-bootstrap` spec already forbids every one of these
behaviors. This change reconciles the code to the spec; it does not introduce
new capability behavior and does not need new scenarios.

## What Changes

- **B3 — Clone goes through an exclusive staging directory, published by an
  ownership-proven move.** `cloneWithCleanupGuard` no longer records
  `targetExistedBefore` or deletes `target` on failure. Each call clones into a
  per-call staging sibling of the target (`<target>.rasen-stage.<pid>.<rand>`)
  and publishes via `fs.rename(staging, target)`. The rename is atomic on the
  same filesystem and FAILS if `target` now exists — so two processes racing on
  the same absent target produce exactly one winner; the loser's rename fails
  EEXIST, the loser keeps its own staging dir for inspection or cleanup, and
  neither can delete the other's work. The old `targetExistedBefore` proof and
  the `bootstrap_obtain_target_preserved` diagnostic are removed; cleanup now
  ONLY ever touches the txn's own staging dir.
- **B4 — Store obtain verifies clone identity before register, zero-write on
  mismatch.** After a successful clone (now into the staging dir) and BEFORE
  calling `registerExistingStore`, bootstrap re-reads the clone's Store metadata
  (via the same modern+legacy probe M11 introduces) and strict-compares its
  permanent UID against `entry.uid`:
  - expected UID declared, clone metadata readable and UID matches → proceed to
    register
  - expected UID declared, clone metadata readable and UID MISMATCHES → fail
    closed, registry zero-write, staging dir left in place with a diagnostic
    that names it and an `rm -rf` command for cleanup
  - expected UID declared, clone metadata MISSING or UNREADABLE → fail closed
    identically (the fail-closed invariant forbids treating "cannot read" as
    "matches")
  - no expected UID declared (the rare alias-only path) → proceed; register's
    own identity-confirmation gate still applies
- **M1 — Project obtain treats missing/unreadable identity the same as
  mismatch.** The existing identity check at bootstrap.ts:2727-2740 grows an
  `else` for "clone metadata missing or unreadable" → fail closed, registry
  zero-write, checkout left in place. The diagnostic uses the same
  `bootstrap_obtain_identity_mismatch` family so the test for B4 covers M1.
- **M2 — `registerExistingStore` accepts and threads `StorePathOptions`.**
  `RegisterExistingStoreInput` gains `globalDataDir?: string`. Internally,
  `readStoreRegistryState()`, `commitStoreRegistration()`, and
  `findRegistryEntryKeys()` are called with the resulting `StorePathOptions`.
  The three call sites in bootstrap.ts (1635, 1824, 2607) pass
  `input.globalDataDir` from `BootstrapInput` (which already extends
  `StorePathOptions`).
- **M11 — Metadata probe at the routing seam returns
  `absent | valid | unreadable`.** `buildBootstrapReport` no longer uses
  `.catch(() => null)` plus an `existsSync` on the modern dir. A new helper
  `probeStoreMetadataState(root)` returns a discriminated union: `{ kind: 'absent' }`
  when neither modern nor legacy metadata is present, `{ kind: 'valid', metadata }`
  when either resolves to a readable file, and `{ kind: 'unreadable', path, failure }`
  when a metadata file exists at either location but cannot be parsed. Routing
  becomes: `valid` → Store-first; `unreadable` → blocked report naming the
  unreadable file; `absent` → Project-first. The `valid` path reuses the same
  `resolveReadableStoreMetadataPath` (modern first, legacy second) the rest of
  the codebase already uses, so the probe covers BOTH locations.

## Coherent obtain→register design

The five fixes interlock around one staged-transaction shape:

1. **Pick the final target** (existing `selectBootstrapLocation` logic, unchanged).
2. **Compute an exclusive staging path** as a sibling of the target — same
   filesystem, so the publish rename is atomic (B3).
3. **Clone into the staging path.** On failure, `rm -rf` the staging path only
   — it is this txn's exclusive dir, so deletion is provably safe (B3).
4. **Read clone metadata from the staging path** using the new
   `probeStoreMetadataState` helper (M11's reader, reused for B4's verify step).
5. **Verify identity** against the expected UID before any write (B4, M1).
   Mismatch / unreadable / missing-with-expected-UID → fail closed, leave the
   staging dir in place with a named diagnostic.
6. **Publish** via `fs.rename(staging, target)`. EEXIST → another process won;
   keep the staging dir for inspection.
7. **Register** through `registerExistingStore` with `globalDataDir` threaded
   from `BootstrapInput` (M2).

`probeStoreMetadataState` is the single new helper; it serves both M11's routing
decision and B4's post-clone verification. The Store and Project obtain flows
share it; they already share `cloneWithCleanupGuard`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Every behavior below is a reconciliation to an EXISTING requirement in
`rasen/specs/store-bootstrap/spec.md`. No scenario is renamed, added, or
rewritten.

### Requirements this change reconciles to (no spec edit)

Each fix satisfies a requirement the canonical spec already states. These
citations are for review traceability; no spec file is touched.

- **B3** → `A failed retrieval is cleaned up only when provably safe`
  (rasen/specs/store-bootstrap/spec.md:360-371). The current
  `targetExistedBefore` proof cannot survive a concurrent process that creates
  the target between the proof and the cleanup; the staging-dir design restores
  the "provably safe" guarantee the spec already requires.
- **B4** → `A mismatched checkout writes nothing`
  (rasen/specs/store-bootstrap/spec.md:395-399, under "Commands that cannot
  resolve a Store name bootstrap as the repair"). The spec already mandates
  that a checkout carrying a different identity SHALL fail without writing
  anything; the code simply skips the check on the Store obtain path.
- **M1** → same scenario (spec.md:395-399), applied to the project side. The
  spec's wording ("a checkout that turns out to be a different Store SHALL fail
  without writing anything") covers the project identity too; the code only
  rejects an explicit mismatch, not a missing/unreadable identity.
- **M2** → `One command reports everything a machine still needs for a project`
  (spec.md:7-38). The spec's promise that bootstrap composes the whole gap in
  one place implies that the registry write also goes where bootstrap is told
  the registry lives (`globalDataDir`); the code currently hardcodes the
  default path inside `registerExistingStore`.
- **M11** → `Machine state that cannot be read is reported, not crashed on`
  (spec.md:34-38). The spec already says state that exists but cannot be read
  SHALL be reported as blocked; the current `.catch(() => null)` +
  `existsSync(modern dir only)` routing silently re-classifies a corrupt
  legacy metadata file as "no Store here" and reports Project-first complete.

## Non-goals (strictly out of scope)

- Other PR #88 review findings (B5/M7/M8 → C2, B2/M3/M4 → C3, M9/M5/M10 → C4,
  M6 → C5, M12/M13/M15/Minor 1/Minor 2/Trivial 1/Trivial 2/B1 → C6).
- The `store-bootstrap` Purpose line (spec.md:5) — that is child C6's job
  (finding M12).
- Any change to `registerExistingStore`'s identity-minting policy
  (`allowCreateIdentity`). Only the path-options plumbing changes.
- Any change to `resolveReadableStoreMetadataPath`'s modern-first-then-legacy
  ordering. M11 reuses it unchanged.
- Redacting remotes in diagnostics (M9, child C4).
