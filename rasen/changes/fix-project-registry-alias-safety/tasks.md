## 1. Lock the RSR regressions

- [x] 1.1 Add project-registry tests that permute direct, live-alias, and missing-alias insertion order and prove the direct or unique-live fixed home always survives canonical collapse.
- [x] 1.2 Add conflicting-live-alias tests that exercise explicit registration and best-effort refresh, asserting refusal before registry bytes or any existing home directory changes.
- [x] 1.3 Add an alias-only read-only self-heal regression with an absent recorded home, asserting no home/config/new claim is created while any permitted owned registry refresh remains deterministic.
- [x] 1.4 Add project-home and root-selection tests with a canonical main entry plus a legacy worktree entry naming another home, and a separate missing-main direct-fallback case; assert every probe is side-effect free.
- [x] 1.5 Add Store-planning resolver tests for normalized-id, display-name, and absolute-root selection against drifted config identity, plus an equivalent-normalized-identity success case and byte-level no-mutation checks.

## 2. Make registry alias ownership explicit

- [x] 2.1 Refactor canonical claimant reduction in `src/core/project-registry.ts` to retain raw aliases, liveness, directness, normalized identity/home fixed tuples, and an explicit representative-or-conflict result independent of raw key order.
- [x] 2.2 Apply the direct-then-live representative policy consistently to registration, refresh, claimant listing, and canonical lookup, ensuring missing aliases never replace live fixed metadata.
- [x] 2.3 Gate every alias deletion, path rebind, home placement, and registry write on absence of live fixed-metadata conflict; surface explicit registration conflict while best-effort self-heal leaves state unchanged.
- [x] 2.4 Separate ensure authority from refresh authority at the directory-creation boundary so only explicit state-requiring registration can create a project home.

## 3. Unify project-home and planning selection

- [x] 3.1 Route `resolveProjectHome(..., { ensure: false })` through `findProjectRegistryEntry()` with the caller's global-data options, preserving canonical main-first lookup and the surviving-worktree direct fallback.
- [x] 3.2 Require normalized agreement between root config and the canonical registry entry before a non-ensuring probe returns a home, with no touch, identity mint, registry write, or directory creation on mismatch.
- [x] 3.3 In `src/core/store-planning/internal/resolver.ts`, establish the normalized identity of canonically unified registry matches before reading/adopting config evidence.
- [x] 3.4 Raise `planning_selection_conflict` naming both identities when a declared config `projectId` disagrees, before assigning `explicitProjectSelector`, following a binding, or locating planning content; retain legacy missing-id and equivalent-normalized behavior.

## 4. Cross-platform verification

- [x] 4.1 Cover case, separator, and dot-segment aliases with the existing Windows path policy and platform-safe `path.join`/`path.resolve` expectations; confirm POSIX case-sensitive behavior remains unchanged.
- [x] 4.2 Run `test/core/project-registry.test.ts`, `test/core/project-home.test.ts`, `test/core/root-selection.test.ts`, and the focused `test/core/store-planning/store-planning.test.ts` selection cases.
- [x] 4.3 Run the repository's Windows registry/root-selection CI coverage and record that alias ownership, no-create probes, and identity-drift refusal pass under real Windows path semantics.
- [x] 4.4 Run relevant TypeScript/lint checks and strict change validation, then verify the implementation diff is limited to assigned registry/project-home/resolver surfaces, focused tests/helpers, and this change's artifacts.
