## Why

Two findings in `src/core/store/bootstrap.ts`:

1. **B7:** When `entry.uid === undefined` (alias-only obtain), the post-clone identity verification at line 1785 is skipped entirely — the code only checks UID when one is present. The comment at line 1783 even documents this: "The rare alias-only path skips this check." But `registerExistingStore` (line 1834) also receives no expected ID, so a project hint declaring alias `expected` while the cloned remote's metadata says `other` gets published and registered as `other`, and bootstrap reports `obtained/verified`. The unified ID probe (`probeStoreAtLocation`, lines 980-1009) already handles the alias fallback — it checks `metadata.id === expected.id` when UID is absent — but this code path doesn't use it.
2. **M1:** Bootstrap dry-reads a bundle path (line 1419, `dryRun: true`), awaits async user consent (lines 1462-1471), then re-reads the SAME path and applies (line 1474). A file or symlink swap during the consent window imports unconfirmed content — the user consented to preview A but the apply reads content B.

## What Changes

- **B7:** Extend the post-clone identity check to cover the alias-only case. When `entry.uid === undefined` but `entry.id !== undefined`, probe the staging metadata and verify `metadata.id === entry.id`. On mismatch, fail closed: no publish, no register, staging left for inspection. Reuse the same probe logic that `probeStoreAtLocation` already uses for the alias comparison, rather than maintaining a second branch.
- **M1:** Capture the bundle file's identity (content digest + file stat: dev/ino/size/mtimeMs) at dry-read time. After consent, re-stat the file and verify the identity hasn't changed. If it changed (file swap, symlink replacement), refuse the import with a diagnostic — do not apply unconfirmed content.

## Capabilities

### New Capabilities

- `store-obtain-identity-verification`: A Store obtained by alias-only declaration is verified against the declared alias after clone, before any publish or registration. A mismatch writes nothing.
- `bundle-consent-content-binding`: A bundle import previewed for consent is bound to its file identity. A swap during the consent window is detected and refused.

### Modified Capabilities

## Impact

- `src/core/store/bootstrap.ts` — extend the alias-only identity check (B7, ~line 1785); add bundle file identity capture and post-consent re-verification (M1, ~lines 1417-1482).
- Tests: alias-only remote-ID mismatch (B7); bundle swap during consent callback (M1).
- No public API changes. No dependency changes.
