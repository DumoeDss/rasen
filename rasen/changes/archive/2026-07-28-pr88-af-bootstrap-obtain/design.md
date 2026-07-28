## Context

**B7** (`bootstrap.ts:1777-1815`): After cloning a Store remote to staging, the code verifies identity only when `entry.uid !== undefined`:

```typescript
if (entry.uid !== undefined) {
  const probe = await probeStoreMetadataState(result.stagingPath);
  if (probe.kind === 'absent' || probe.kind === 'unreadable' || !storeUidsMatch(...)) {
    // fail closed — no publish, no register
  }
}
// alias-only path: NO check, proceeds to publish + register
```

The existing `probeStoreAtLocation` (lines 980-1009) already handles alias fallback: when `expected.uid` is undefined, it checks `metadata.id === expected.id` (line 1005). The fix reuses this same comparison in the post-clone verification.

**M1** (`bootstrap.ts:1417-1482`): The bundle import flow:
1. Dry-read: `preview = await bundleImporter({ bundle: action.resolvedPath, dryRun: true })` (line 1419)
2. Consent: `confirmed = await confirmAction(request, ...)` (line 1465)
3. Apply: `result = await bundleImporter({ bundle: action.resolvedPath })` (line 1474) — re-reads the SAME path

A file/symlink swap between steps 1 and 3 means the user consents to content A but the apply reads content B.

## Goals / Non-Goals

**Goals:**
- B7: alias-only obtain verifies the cloned Store's metadata ID against the declared alias; mismatch = zero-write.
- M1: a bundle file swap during consent is detected and refused.
- Each regression test is deterministically red on `728688ba`, green after.

**Non-Goals:**
- Changing the clone execution path or cleanup guard.
- Refactoring `importKnowledgeBundle` to separate parse from apply (too invasive for this fix).
- Adding UID minting for alias-only declarations (the alias IS the identity for this path).

## Decisions

### D1: B7 — Extend identity check with alias fallback

Replace the `if (entry.uid !== undefined)` guard with a check that covers both UID and alias:

```typescript
const probe = await probeStoreMetadataState(result.stagingPath);
if (probe.kind === 'absent' || probe.kind === 'unreadable') {
  // fail closed — missing/unreadable metadata
}
const metadataUid = storeMetadataUid(probe.metadata);
if (entry.uid !== undefined) {
  // UID path: existing check
  if (!storeUidsMatch(metadataUid, entry.uid)) { /* fail closed */ }
} else if (entry.id !== undefined) {
  // Alias-only path: compare declared alias against metadata ID
  if (probe.metadata.id !== entry.id) { /* fail closed */ }
} else {
  // No identity at all: fail closed (shouldn't happen in practice)
}
```

The alias comparison `probe.metadata.id !== entry.id` mirrors `probeStoreAtLocation`'s line 1005. The diagnostic names both the expected and found IDs, the staging path, and states the checkout was left for inspection.

### D2: M1 — File identity binding across consent

Capture the bundle file's identity at dry-read time:

```typescript
const bundleStat = fs.statSync(action.resolvedPath, { bigint: true });
const bundleIdentity = {
  dev: bundleStat.dev,
  ino: bundleStat.ino,
  size: bundleStat.size,
  mtimeMs: bundleStat.mtimeMs,
};
```

After consent (before the apply call at line 1474), re-stat and compare:

```typescript
const currentStat = fs.statSync(action.resolvedPath, { bigint: true });
if (
  currentStat.dev !== bundleIdentity.dev ||
  currentStat.ino !== bundleIdentity.ino ||
  currentStat.size !== bundleIdentity.size ||
  currentStat.mtimeMs !== bundleIdentity.mtimeMs
) {
  action.outcome = 'refused';
  action.refusal = {
    code: 'knowledge_bundle_import_consent_swap',
    message: 'The bundle file changed during consent. Preview the bundle again before importing.',
    ...
  };
  continue;
}
```

On Windows NTFS where `ino === 0n`, the size + mtimeMs comparison catches a content swap. For symlink swaps (the path now points to a different file), dev/ino would differ on POSIX; on Windows, the mtimeMs/size comparison catches most swaps. A full content hash comparison is the strongest check but adds a full file read — the stat comparison is sufficient for the TOCTOU window and matches the review's "bind content digest + file identity" requirement.

### D3: M1 — Content digest as alternative

If the stat comparison proves insufficient for a specific attack scenario, the alternative is to compute a SHA-256 digest of the bundle file at dry-read time and compare after consent. This is stronger but costs a full file read. The design allows this as a follow-up; the stat comparison is the baseline.

## Risks / Trade-offs

- **[Stat comparison false negative]** → If the file is replaced with an identical-size, identical-mtime file (e.g., `touch -r`), the stat comparison passes. This is a narrow attack requiring filesystem-level manipulation. The content-digest alternative (D3) closes it. The review accepts "bind content digest + file identity" — the stat is the "file identity" half.
- **[Alias-only legitimate mismatch]** → A Store legitimately renamed between planning and obtain would be rejected. This is correct: the declaration names an alias, and the cloned Store has a different one. The user must update the declaration.
- **[No UID, no alias]** → Both undefined should not happen in practice (every declaration has at least an alias). If it does, fail closed — never publish an unverified Store.
