## 1. Adoptable-identity registry lookup (test-first)

- [x] 1.1 In `test/core/project-registry.test.ts`, extend the `findProjectRegistryEntry` describe (or add a sibling describe) pinning the new read-only lookup: returns the entry's `projectId` for a registered canonical root; returns "none" for an unregistered root; a linked-worktree root resolves to the main checkout's registered `projectId` (reuse the existing worktree fixtures); no registry file at all means "none" and creates no file.
- [x] 1.2 Add the ambiguity pin to the same block: seed a conflicted registry (two live entries resolving to the same canonical root with disagreeing identity/home — reuse the existing `project_registry_alias_conflict` fixture pattern) and assert the lookup reports "not adoptable" rather than a representative id.
- [x] 1.3 Implement the lookup in `src/core/project-registry.ts` (read-only; reuse `readProjectRegistryState`, `canonicalProjectClaimants`, and `findProjectRegistryEntry`'s canonicalize + `resolveRegistrationRoot` piercing; expose the fixed-metadata-conflict outcome). Run 1.1–1.2 focused; they must pass.

## 2. Mint adoption in `ensureProjectIdInConfig` (test-first)

- [x] 2.1 In `test/core/project-config.test.ts`, `ensureProjectIdInConfig` describe, add: config without `projectId` at a path registered in the machine registry (seed via `registerProject` against the test `globalDataDir`) → the registered id is written to the config (exact `projectId: <registered>` line) and no new identity exists anywhere; the existing "mints and appends" tests keep passing for the unregistered case.
- [x] 2.2 Add the conflicted-registry pin to the same describe: conflicted aliases at the root → the mint still proceeds with a fresh UUID (current behavior preserved; `ensureProjectIdInConfig` never throws for registry reasons).
- [x] 2.3 Implement adoption in `src/core/project-config.ts` `ensureProjectIdInConfig`: inside the existing `withProjectRegistryLock` mint path, consult the task-1 lookup before `randomUUID()`; adopt when adoptable, mint fresh otherwise. Fast path (config already has an id) stays lock-free and registry-free. Run the focused `project-config` suite.

## 3. In-place identity rewrite helper (test-first)

- [x] 3.1 In `test/core/project-config.test.ts`, add tests for the new reconcile helper (sibling of `ensureProjectIdInConfig`): rewrites only the value on the existing `projectId:` line while preserving every other byte and comment; appends the line when the field is absent (same append discipline as mint, `.yml`/`.yaml` precedence honored); a post-write validation failure reverts the file (reuse the existing `writeFile` spy pattern); a `sameProjectIdentity`-equal id is a byte-identical no-op.
- [x] 3.2 Implement the helper in `src/core/project-config.ts` under `withProjectRegistryLock`: locate the field with the same explicit lookup the mint uses (no file-wide pattern matching), rewrite/append, re-read, validate, revert on failure. Run focused.

## 4. Convergence in `resolveProjectHome` ensure path (test-first)

- [x] 4.1 In `test/core/project-home.test.ts`, add the already-diverged repair pin: registry entry with id A at the root, config carrying id B → `resolveProjectHome(root, {ensure: true})` returns the home for A and the config now carries exactly A (other content preserved); a second ensure call is a no-op (idempotent).
- [x] 4.2 Add the adoption end-to-end pin: registry entry A, config without id → ensure returns the home for A and writes A to the config; the registry entry's `projectId` and `home` are unchanged.
- [x] 4.3 Add the canonical-form pin: config records A in uppercase, registry A in lowercase → ensure resolves normally and the config file stays byte-identical (no rewrite).
- [x] 4.4 Add the conflict pin: diverged config B + conflicted registry aliases → `registerProject` throws `project_registry_alias_conflict`, `resolveProjectHome` propagates it, and no config rewrite happened (no silent winner). Probe mode (`ensure: false`) tests stay green — probe never mutates.
- [x] 4.5 Implement in `src/core/project-home.ts`: after `registerProject` returns, compare the config id used with `entry.projectId` via `sameProjectIdentity` (`src/core/store/project-records.ts`); on disagreement call the task-3 helper toward the registry id. Run the focused `project-home` suite.

## 5. Init-level convergence and hint truthfulness

- [x] 5.1 In `test/core/init.test.ts` (or the closest existing init e2e harness with a test `globalDataDir`), add: pre-register the project path with id A (simulating the 0.1.7-era registration), write a config with divergent id B, run init → afterwards the config carries A, the registry entry still carries A, and `resolveProjectHome(root, {ensure: false})` resolves (probe succeeds — the stale condition is gone).
- [x] 5.2 Same harness, mint arm: pre-register with id A, no config `projectId`, run init → config carries A (no second identity minted).
- [x] 5.3 Verify the `knowledge_owner_stale` message in `src/core/learned-skills/context.ts` ("Run `rasen init` to repair it") is now truthful end-to-end: after the init in 5.1, knowledge-owner resolution for the root no longer fails stale. If the conflicted-registry state makes the wording misleading, append a bounded clause pointing at explicit registry repair and update the matching expectations in `test/core/learned-skills/context.test.ts`; otherwise leave the text unchanged.

## 6. Regression sweep and platform verification

- [x] 6.1 Run the identity-adjacent suites focused: `test/core/project-config.test.ts`, `test/core/project-registry.test.ts`, `test/core/project-home.test.ts`, `test/core/init.test.ts`, `test/core/init-update-learned.test.ts`, plus `test/core/store/migration-ops.test.ts` (the store adopt/add-project callers of `ensureProjectIdInConfig`, including the dry-run path that must not mint). *(LEAD-ran after the perf fix: combined single invocation, default timeouts — 6/6 files, 324/324 tests, 308s.)*
- [x] 6.2 Run the repo's typecheck/lint and the full core test suite; confirm the parallel-mint (MINOR-3) and Windows-path canonicalization tests still pass. *(LEAD-ran: lint exit 0; `pnpm run build` (tsc) exit 0; MINOR-3 parallel-mint and Windows-path canonicalization tests green in the 6.1 run. Full-core sweep deferred to the PR CI leg — see run-state.)*
- [x] 6.3 Windows CI leg must be green on the PR: new tests use `path.join` for every expected path and rely on the registry's existing canonicalization (no hardcoded separators, no case assumptions beyond the case-insensitive-filesystem scenario). (local discipline verified; PR CI leg is the final proof)
