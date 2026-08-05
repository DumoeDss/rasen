## 1. Shared Foundation Contracts

- [x] 1.1 Create the pure Store-planning foundation module and public exports under `src/core/store/`, including branded value types and stable typed validation errors, without filesystem, registry, cwd, environment, command, or Git access.
- [x] 1.2 Centralize the existing Windows reserved-device-name list and implement canonical v2 project-id, target-line-id, Change-id, Git-ref, Git-OID, digest, and portable-relative-path validators without duplicating identifier policy.
- [x] 1.3 Add table-driven validator tests for valid UUID/kebab project ids, dotted target lines, non-canonical case, traversal, separators, control characters, trailing dot/space, reserved names, malformed refs/OIDs/digests, and portable evidence paths.

## 2. Layout V2 and Catalogs

- [x] 2.1 Extend Store metadata parsing and serialization with optional `layoutVersion: 2`, preserving legacy metadata byte shape when the field is absent and keeping metadata schema version independent.
- [x] 2.2 Add the strict version 2 project catalog contract alongside version 1 membership-record compatibility, including filename/id agreement, independent planning-binding state, bound/planning-member cross-field validation, credential-free remote validation, and no adoption ownership list in v2.
- [x] 2.3 Add the strict target-line catalog parser/serializer and filename/id validator for Store full refs and project-id-keyed full code refs.
- [x] 2.4 Implement immutable native/win32/posix layout v2 path computation for Store catalogs, project planning homes, specs, Store/project design docs, active Changes, target-line Archives, and instance-suffixed Archive entries, with validation-before-join and resolved containment proof.
- [x] 2.5 Add legacy/v2 catalog round-trip tests, strict unknown-field and cross-field failures, filename mismatch cases, no-machine-path fixtures, same-alias multi-project paths, target-line Archive partitioning, same-day retry disambiguation, and Windows/POSIX path expectations built with the matching `path` API.

## 3. Stable Identity and Change Metadata

- [x] 3.1 Implement canonical JSON SHA-256 identity helpers and strict parsers for `ps_`, `ci_`, `wt_`, and `wp_` prefixed 64-hex branded ids, reusing or neutrally re-exporting the repository's existing canonical JSON implementation.
- [x] 3.2 Implement `PlanningScopeId` derivation and 16-byte Change instance seed mint/parse plus `ChangeInstanceId` derivation/verification, excluding Change alias, paths, branch, and refs from portable preimages.
- [x] 3.3 Implement local `WorktreeInstanceId` derivation from adapter-supplied canonical repository/worktree identities and ordered `WorkspacePairId` derivation from verified Change, planning-worktree, and execution-worktree ids.
- [x] 3.4 Extend the strict Change metadata schema and read/write round trip with optional v2 identity and `implementation: code|none`, verify every derived instance id, preserve legacy metadata without injected fields, and keep command-side mint/write behavior unchanged.
- [x] 3.5 Add deterministic/domain-separation tests across object insertion order and platform paths, multi-project/multi-line/cross-attempt identity cases, branch/path stability, worktree replacement and role ordering, malformed typed ids, metadata tampering, planning-only intent, and legacy metadata round trips.

## 4. Finalization Outcome and Archive V2 Contracts

- [x] 4.1 Implement the four-way finalization-outcome discriminated contract and pure semantic validation for reason/successor rules plus same-Store/same-project supersession with cross-target-line allowance.
- [x] 4.2 Implement strict Archive v2 subcontracts for planning facts, code-merge proof, create/update/delete spec-sync actions, portable unique evidence, missing evidence, and ISO timestamps using verified identity values.
- [x] 4.3 Implement the Archive v2 discriminated/cross-field schema for code-backed landed, planning-only landed, superseded, cancelled, and abandoned records, structurally enforcing landed-only applied spec sync and null code merge on non-landed records.
- [x] 4.4 Implement deterministic Archive v2 parse/serialize/verify helpers with stable field order, two-space JSON, trailing newline, strict unknown-field rejection, and UTF-8 without BOM, while leaving existing Archive v1 accounting and engine mutation callers unchanged.
- [x] 4.5 Add outcome/successor tests, landed reachability-shape and `implementation: none` fixtures, passive-history byte-invariant action rejection, spec-action digest matrices, evidence escape/case-duplicate tests, strict-field failures, and deterministic Archive v2 byte round trips.

## 5. Integration Boundaries and Verification

- [x] 5.1 Export the foundation contracts from the appropriate Store/core entry points and add compile-time consumer fixtures proving downstream modules can use validated values without accessing internal regex, hash, or path implementations.
- [x] 5.2 Run focused Vitest files for Store metadata/catalog/layout, identity/Change metadata, and Archive v2 contracts; fix root causes and record the exact passing commands.
- [x] 5.3 Run the path fixture tests under the repository's existing Windows CI/test matrix (including win32 alias/case behavior) and confirm POSIX semantics remain covered without hard-coded separators.
- [x] 5.4 Run `pnpm run lint`, `pnpm run build`, the relevant existing Store/change-metadata/archive compatibility tests, and strict Rasen change validation.
- [x] 5.5 Audit the child diff to confirm it contains only contracts, pure validation, exports, and tests—no selector/command routing, Store or migration mutation, Git worktree operation, Archive apply logic, management API, UI, dependency addition, or unrelated formatting change.

## Verification Evidence

- `pnpm exec vitest run test/core/store/planning-validation-v2.test.ts test/core/store/planning-layout-v2.test.ts test/core/store/planning-identity-v2.test.ts test/core/store/finalization-v2.test.ts test/core/store/planning-foundation-consumer.test.ts` — 5 files, 119 tests passed on Windows; the layout file exercises native Windows case/alias protection plus explicit `path.win32` and `path.posix` expectations.
- `pnpm exec vitest run test/core/store/foundation.test.ts test/core/store/project-records.test.ts test/core/store/legacy-metadata.test.ts test/utils/change-metadata.test.ts test/core/archive-accounting.test.ts test/commands/store-remote.test.ts` — 6 files passed, 105 tests passed and 1 pre-existing platform skip.
- `pnpm run lint` — passed.
- `pnpm run build` — passed.
- `rasen validate 'store-planning-foundation-v2' --type change --strict` — passed.
