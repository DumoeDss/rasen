## 1. B7 — Extend post-clone identity check for alias-only obtain

- [x] 1.1 In `src/core/store/bootstrap.ts`, replace the `if (entry.uid !== undefined)` guard (line 1785) with a unified check that also covers alias-only: always probe the staging metadata; when `entry.uid !== undefined`, verify UID (existing logic); when `entry.uid === undefined && entry.id !== undefined`, verify `probe.metadata.id === entry.id`; when both undefined, fail closed
- [x] 1.2 On alias mismatch, set `entry.action = 'obtain-failed'`, push a diagnostic with code `bootstrap_obtain_identity_mismatch` naming the expected alias, the found metadata ID, and the staging path (same diagnostic shape as the UID-mismatch path). Return `'obtain-failed'` without publishing or registering

## 2. M1 — Bundle file identity binding across consent

- [x] 2.1 At dry-read time (after `preview` succeeds, ~line 1431), capture the bundle file identity: `const bundleStat = fs.statSync(action.resolvedPath, { bigint: true })` and store `{ dev, ino, size, mtimeMs }`
- [x] 2.2 After consent is confirmed (after line 1471, before the apply call at line 1474), re-stat the file and compare all four fields. If any differs, set `action.outcome = 'refused'` with code `knowledge_bundle_import_consent_swap`, message naming the path and stating the file changed during consent. `continue` without applying
- [x] 2.3 If the stat comparison passes, proceed with the existing apply call

## 3. Regression tests

- [x] 3.1 B7: test alias-only obtain with remote-ID mismatch — set up a declaration with alias `expected` and no UID; clone a Store whose metadata says `other`; assert no publish, no register, staging left for inspection, diagnostic names both IDs. Deterministically red on `728688ba` (where the check is skipped)
- [x] 3.2 B7: test alias-only obtain with matching ID succeeds — same alias, matching metadata ID; assert normal publish + register
- [x] 3.3 M1: test bundle swap during consent — set up a bundle import action; in the consent callback, replace the bundle file with different content; assert the import is refused with `knowledge_bundle_import_consent_swap`, no records imported
- [ ] 3.4 M1: test symlink swap during consent — point the bundle path at a symlink; in the consent callback, repoint the symlink at a different file; assert refusal
- [x] 3.5 M1: test unchanged bundle passes — preview, consent (no swap), apply succeeds normally

## 4. Verification

- [x] 4.1 Run affected test files in isolation (bootstrap tests, bundle import tests)
- [x] 4.2 Run `pnpm exec tsc --noEmit` — confirm no type errors
- [x] 4.3 Run `pnpm lint` on changed files — confirm clean
