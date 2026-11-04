## 1. Re-verify dependencies

- [ ] 1.1 Re-verify E1's exported surface: the bootstrap command's check-mode entry point and the report shape (`src/commands/bootstrap.ts`, `src/core/store/bootstrap.ts`). The doctor-readiness composer (group 4) calls into the same classification; confirm the function signatures.
- [ ] 1.2 Re-verify E2/E3's apply-mode exports are NOT needed here (E4 is read-only): confirm `bootstrap.ts` exposes a read-only check path that does not write, and that the readiness composer can call it without side effects.
- [ ] 1.3 Confirm `src/core/store/identity.ts`'s `primaryRepair` / `describeUnavailableStore` / `unavailable(...)` are still the single repair-text source, and that no consumer has started building its own.
- [ ] 1.4 Re-run the concurrent-session overlap check (design D6): `git status --porcelain` against E4's seven source-edit files. Confirm zero overlap still holds.

## 2. The bootstrap repair factory

- [ ] 2.1 Add `bootstrapRepair(label: StoreIdentityLabel): string` to `src/core/store/identity-diagnostics.ts`, returning `rasen bootstrap`. The factory takes a label for API symmetry with `registerRepair` even though the command carries no selector today; document why (bootstrap resolves against the current project, design D2).
- [ ] 2.2 Change `storeBootstrapRequired(label)`'s `fix` from `registerRepair(label)` to `bootstrapRepair(label)` (design D3). The diagnostic fires in exactly the state bootstrap closes.
- [ ] 2.3 Tests: the factory's output is pasteable; `storeBootstrapRequired`'s fix is `rasen bootstrap`.

## 3. Repair ordering in the resolver

- [ ] 3.1 In `src/core/store/identity.ts`, change the `not-registered` reason's repair array from `[registerRepair(expected), doctorRepair()]` to `[bootstrapRepair(expected), registerRepair(expected), doctorRepair()]` (design D1). Bootstrap first (whole-gap), register second (single-step), doctor last (diagnosis). Both call sites that build this array for `not-registered` (the uid path at L394 and the alias path at L474) get the same change.
- [ ] 3.2 Leave every identity-level reason's repair array unchanged: `metadata-missing`, `metadata-error`, `metadata_id_mismatch`, `uid-mismatch`, `root-unhealthy`, `alias-ambiguous`, `pointer-malformed`. Bootstrap cannot repair any of these. Assert in a test that none of their `primaryRepair` outputs is `rasen bootstrap`.
- [ ] 3.3 Tests: for `not-registered`, `primaryRepair` returns `rasen bootstrap`; `describeUnavailableStore` ends with `Next: rasen bootstrap`. For each identity-level reason, `primaryRepair` does NOT return `rasen bootstrap`.

## 4. Consumer-path tests (the breadth)

- [ ] 4.1 `src/core/root-selection.ts`: the `unavailable-store-declaration` notice carries `repair: 'rasen bootstrap'` for a `not-registered` binding, and the notice renderer prints it. Test the notice end-to-end through `resolveRootForCommand` with `allowUnavailableStore: true`.
- [ ] 4.2 `src/core/effective-config.ts`: the `StoreError` raised when a config layer cannot resolve a declared Store carries `fix: 'rasen bootstrap'` for the not-registered case. Test through `resolveConfigStoreLayer` / `requireConfigStoreLayer`.
- [ ] 4.3 `src/core/learned-skills/{context,stores}.ts`: the failure message from `describeUnavailableStore` ends with `Next: rasen bootstrap` for the not-registered case. Test one path through each.
- [ ] 4.4 `src/core/store/{membership,migration-ops}.ts`: `primaryRepair(binding)` surfaces `rasen bootstrap` for the not-registered case. Test one path through each.
- [ ] 4.5 `src/core/config-api/project-addressing.ts`: the `Next: ${primaryRepair(binding)}` message names bootstrap. Test through the config API.
- [ ] 4.6 A regression test asserting no consumer file builds its own repair string bypassing `primaryRepair` / `describeUnavailableStore` (a grep-over-source guard, like the existing identity-boundaries test).

## 5. Doctor readiness — types and composition

- [ ] 5.1 In `src/core/relationship-health.ts`, add `BootstrapReadinessInput` and `BootstrapReadiness` types (design D5). The input carries `storeBinding`, `membership`, and `machineHomeRegistered`; the output carries `state` (`complete` | `degraded` | `blocked`) and `findings` (each with a stable `code`, `severity`, `message`, `repair`). Document the F4 extension point as a comment on the input type.
- [ ] 5.2 Add `bootstrapReadiness?: BootstrapReadinessInput` to `InspectRelationshipsInput` and `bootstrapReadiness: BootstrapReadiness` to `RelationshipHealth`.
- [ ] 5.3 Implement the composer inside `inspectRelationships`: derive the findings from the existing inputs (the planning Store's resolved-or-unavailable state, the membership findings, the machine-home registration). `complete` only when the Store resolves, membership is confirmed, and the checkout is registered. `blocked` when the Store is unavailable with no remote. `degraded` otherwise. No I/O.
- [ ] 5.4 Tests: each end state; each finding carries a pasteable repair; a mismatched-identity Store does NOT produce a bootstrap finding (it produces the existing `doctor` finding); `complete` requires all three facts.

## 6. Doctor readiness — gather and render

- [ ] 6.1 In `src/commands/shared-gather.ts` (or `doctor.ts`'s `gatherHealth`), populate `input.bootstrapReadiness` from the facts `gatherHealth` already assembles — no new reads. The Store binding, membership, and machine-home entry are all present by the time `inspectRelationships` runs.
- [ ] 6.2 In `src/commands/doctor.ts`, render the `bootstrapReadiness` section in human output: the end state, each finding's message and repair. Render it in JSON alongside the existing `health` payload.
- [ ] 6.3 Tests: doctor's human and JSON output carry the readiness section; the repairs in both modes match; doctor writes nothing (whole-tree snapshot around a `doctor` invocation that reports a degraded state).

## 7. Diagnosis and bootstrap agree

- [ ] 7.1 A test proving `rasen doctor` and `rasen bootstrap --check` name the same Stores as missing and the same repairs for each, for a project with one absent Store and one present-unregistered Store. This is the spec's structural guard against drift.

## 8. Locale parity

- [ ] 8.1 Add every new doctor-section string and repair string to `src/locales/{en,zh-cn,ja}.json`. No English fallback for new keys (inherited constraint). The repair command `rasen bootstrap` is locale-neutral (a command string, not prose).

## 9. Docs

- [ ] 9.1 `docs/cli.md`: a bootstrap troubleshooting section with one entry per blocked and degraded state and its repair. State that doctor reports the same readiness read-only.

## 10. Verification and integration

- [ ] 10.1 Diff scenario SETS, not just requirement titles, for any MODIFIED block that emerges during implementation. This change carries zero MODIFIED blocks; confirm that still holds.
- [ ] 10.2 Re-run the portfolio-wide collision sweep over ALL active change directories: shared capabilities and any requirement with more than one MODIFIED owner. This change ADDs one requirement to `store-bootstrap` and claims no new capability.
- [ ] 10.3 `node bin/rasen.js validate store-bootstrap-repair-text --changes --strict --json` clean.
- [ ] 10.4 Rehearse the spec merge (`rasen archive --json --yes`) before ship. E1→E2→E3→E4 archive in sequence; confirm E4's ADD does not collide with any prior child's scenarios.
- [ ] 10.5 Confirm the concurrent sessions' files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `src/commands/pipeline{,-messages}.ts`, `src/core/pipeline-registry/**`, `src/core/{keepalive,runtime-adapters,codex,management-api,templates}/**`, `src/cli/index.ts`.
- [ ] 10.6 Confirm no version number in `package.json` was changed by this work.
- [ ] 10.7 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test` (serial vitest).
