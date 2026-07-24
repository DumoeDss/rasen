## 1. Dry-run archive preview

- [x] 1.1 In `src/core/store/migration-ops.ts`, hoist a `dryRun: true` call to `handleAdoptArchive` outside the `if (!input.dryRun)` guard in `adoptProject`, share the move options with the mutating call, and leave the mutating call in place after the manifest write so the resume invariant holds.
- [x] 1.2 Make `handleAdoptArchive` dry-run safe for `external`: `ensure: !options.dryRun` on `resolveProjectHome`, throw only when not a dry run, fall back to a symbolic `<project-home>/archive` target, and guard the `archive.destination` write.
- [x] 1.3 Stop minting identity on a dry run: read `readProjectConfig(...)?.projectId` and fall back to the exported `UNASSIGNED_PROJECT_ID`, keeping `ensureProjectIdInConfig` on the real path only.

## 2. Coverage

- [x] 2.1 Add `test/core/store/migration-ops.test.ts` cases for the real archive count on `--archive move --dry-run`, external-mode inertness (no home minted, no `archive.destination`), and config byte-identity plus the unassigned-id placeholder and real-id passthrough.
- [x] 2.2 Add a case proving a real adopt after a dry run still moves the full archive into the store.
- [x] 2.3 Rework the interrupted-adopt resume test to mint its project id via `ensureProjectIdInConfig` rather than relying on a dry-run side effect.

## 3. Verification

- [x] 3.1 `npx tsc --noEmit` clean; `test/core/store`, `test/commands/store.test.ts`, `test/commands/doctor.test.ts`, `test/core/global-config.test.ts`, `test/core/project-home.test.ts` green (157 + 102 + 23).
- [x] 3.2 CLI smoke on a built dist over a fixture repo with 3 archived changes: `--archive move --dry-run` and `--archive external --dry-run` both report `3 entries`, leave `git status` empty, and create no machine home; the real adopt then moves all 3 into the store.
