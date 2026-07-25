## 1. Re-verify child A before writing anything

- [x] 1.1 Re-read child A's final exported surface in `src/core/store/index.ts` and confirm the SIGNATURES (not just the names) of `resolveStoreBinding`, `resolveConfigStoreLayer`, `requireConfigStoreLayer`, `hasStoreDeclaration`, `inspectRegisteredStore`, and the `identity-types.ts` vocabulary. Child A's review loop closed two Majors after this plan was written.
- [x] 1.2 Confirm `ResolvedProjectCheckoutRef` and `ProjectIdentityRef` are exported and unused — this change owns their first real consumer.
- [x] 1.3 Confirm the diagnostic factory convention in `src/core/store/identity-diagnostics.ts` and the exported code array this change extends.
- [x] 1.4 Confirm `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts` and note which files this change must add to it.

## 2. Membership record reader (no writer yet)

- [x] 2.1 Add `src/core/store/project-records.ts`: the `projects/` directory resolver under `getStoreMetadataDir()`, composed with `path.join()`.
- [x] 2.2 Add the record schema as a Zod `.strict()` shape (`version`, `projectId`, `id?`, `remote?`, `roles{planning,knowledge}`, `adoption{specs,changes,adoptedAt}?`) plus its serializer — both, per the `foundation.ts` convention.
- [x] 2.3 Add the recordable-identity check (design D3): valid UUID or valid kebab id, not a Windows reserved device name. Reserved names in an exported named constant `WINDOWS_RESERVED_DEVICE_NAMES`, checked by explicit lookup. Never sanitize an identity into a filename.
- [x] 2.4 Reader: list records, read one by projectId, and report a filename/`projectId` disagreement as `store_project_record_key_mismatch` without preferring either side.
- [x] 2.5 Route every recorded `remote` through child A's `assertCredentialFreeRemote` on write and `redactRemote` on display.
- [x] 2.6 Unit tests: schema round-trip, strictness (unknown key is an error), recordable/unrecordable identities incl. Windows reserved names, key mismatch, credential rejection. Reads leave files byte-identical.

## 3. Project-side locator hints

- [x] 3.1 Parse `storeMemberships` in `src/core/project-config.ts` with the same resilient hand-written path `references` uses: drop a malformed entry with a warning, keep the rest, de-duplicate on permanent identity.
- [x] 3.2 Add the writer that appends a hint, preserving every other field, de-duplicating on identity, and writing only identity + alias + credential-free remote.
- [x] 3.3 Guard every "does this repo declare a Store" check in the files this change touches through `hasStoreDeclaration(pointer)`, never `pointer.value !== undefined`.
- [x] 3.4 Tests: parse/write round-trip, malformed entry degrades, de-duplication, and an assertion that no written value is an absolute path (`path.isAbsolute()` over parsed values, not a string scan).

## 4. The membership provider

- [x] 4.1 Add `src/core/store/membership.ts` with `listStoreMembers`, `resolveProjectMembership`, and `listProjectStoreCandidates`, returning the normalized `StoreMembershipRecord` shape with `provenance`.
- [x] 4.2 Normalize `legacy-adoption` from `adoptions.yaml`: projectId key, specs/changes/timestamp, `sourcePath` ignored, roles inferred as planning-only with an "inferred" diagnostic.
- [x] 4.3 Normalize `legacy-reference` from the Store's `references: [project:<alias>]` via the machine project namespace; unresolvable entries report `store_legacy_reference_unresolved` rather than being dropped.
- [x] 4.4 Precedence: `v2-record` wins outright; a legacy source contributes only a projectId that has no record. De-duplicate on projectId.
- [x] 4.5 Reach the Store only through `resolveStoreBinding()` / the tri-state — never `listRegisteredStores().find(id)`. Use `requireConfigStoreLayer` on non-diagnostic paths and `resolveConfigStoreLayer` on diagnostic paths.
- [x] 4.6 Eligibility union (design D5): declared hints ∪ locally recorded members, with an unavailable Store returned marked unavailable (child A's reason + repair), never filtered out and never reported as empty.
- [x] 4.7 Add this change's new diagnostic codes to `src/core/store/identity-diagnostics.ts` following the one-factory-per-code convention, and add the matching `storeReason*` locale keys to all three catalogs.
- [x] 4.8 Tests: one provider answer across all three provenances, precedence, unresolvable legacy reference, eligibility union, unavailable-not-empty, and zero writes on every read path.

## 5. Two-repository mutation

- [x] 5.1 Add the `MembershipMutationPlan` shape (`projectBaseCommit`, `storeBaseCommit`, `projectWrites`, `storeWrites`, `repairNeeded`), with a null base commit for a non-git root degrading rather than blocking.
- [x] 5.2 Implement ordered apply: verify identities and base SHAs → write Store record → verify → write project hint → verify both directions. Atomic temp-then-rename for every write.
- [x] 5.3 On a failed project-side write, keep the Store record, emit `project_membership_locator_missing` into `repairNeeded` with its repair command, and roll nothing back.
- [x] 5.4 Wire `--dry-run` preview that lists every file it would write in each repository and changes nothing.
- [x] 5.5 Never stage, commit, push, fetch, or pull; render per-repository suggested commits with the existing `renderSuggestedCommit`.
- [x] 5.6 Tests: preview writes nothing, ordering (record readable before the hint is written), failed project write leaves the record standing with repair reported, no git index is ever written.

## 6. add-project and adopt

- [x] 6.1 `storeAddProject` (`src/core/store/operations.ts`): write the Store membership record and the project locator hint through the ordered apply, keeping the existing `project:<id>` references append as a documentation index only.
- [x] 6.2 Keep add-project idempotent: re-running changes no file; references de-duplicate on store id, hints de-duplicate on permanent identity.
- [x] 6.3 Add the `--set-primary` opt-in to `store add-project` (design D12): default off, never inferred from any other flag or from the project's state.
- [x] 6.4 `--set-primary` write path: with no existing planning Store, record the target Store as the project's planning Store and report the binding SEPARATELY from the membership in both human and JSON output.
- [x] 6.5 `--set-primary` refusal path: when a DIFFERENT planning Store is already bound, refuse — naming the bound Store, the requested Store, and the rebinding command — and leave the pointer untouched. The membership record and locator established by the same invocation still stand (never rolled back).
- [x] 6.6 `--set-primary` no-op path: already bound to the target Store succeeds and rewrites nothing.
- [x] 6.7 `adoptProject` (`src/core/store/migration-ops.ts`): record ownership (specs, changes, `adoptedAt`) in the membership record; stop writing `sourcePath`; record the project as a planning member; write the project hint. Adopt's own pointer write is unchanged and is NOT routed through `--set-primary` — adopt binds by definition.
- [x] 6.8 Preserve adopt's existing resume-after-interruption behavior against the new record.
- [x] 6.9 Tests: add-project without the opt-in leaves the planning Store byte-identical; all three opt-in paths (bind / refuse / no-op); refusal leaves membership intact; adopt records ownership with no source path; everything idempotent; neither command touches the project's specs/changes.

## 7. sourcePath removal and eject destination

- [x] 7.1 Relax `AdoptionEntry.sourcePath` to optional on READ in `src/core/store/migration.ts`; remove every write of it. Nothing may read it for behavior.
- [x] 7.2 Report `shared_metadata_contains_local_path` wherever legacy shared data still carries an absolute path.
- [x] 7.3 `ejectProject`: take ownership from the membership record, falling back to the legacy manifest while it exists.
- [x] 7.4 Implement the ordered destination rule: `--into` > current checkout with matching projectId > single live registry checkout > fail naming `--into` and listing candidates. Comparison via `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback.
- [x] 7.5 Assert the forbidden paths are unreachable: no legacy `sourcePath` read, no remote→path inference, no alias guess, no first-of-several.
- [x] 7.6 Tests: all four destination branches, the multi-checkout failure listing candidates, and a legacy `sourcePath` present but provably ignored.

## 8. Migration command

- [x] 8.1 Add `rasen store migrate-membership <store> [--dry-run] [--apply] [--json]` in `src/commands/store.ts`, kept separate from child A's `store upgrade-identity`.
- [x] 8.2 Convert `adoptions.yaml` + `references` + project namespace into `projects/<projectId>.yaml` records; drop `sourcePath`; map `timestamp` → `adoption.adoptedAt`.
- [x] 8.3 Delete `adoptions.yaml` only after every record is written AND re-read successfully; report the deletion in `storeWrites` for the user to commit.
- [x] 8.4 Leave an unresolvable project untouched and report it; make the command idempotent and re-runnable.
- [x] 8.5 Tests: dry-run writes nothing, a mid-apply record failure leaves the legacy file intact, second run is a no-op, unresolvable entry is reported and preserved.

## 9. Surfaces and diagnostics

- [x] 9.1 `src/core/management-api/spaces.ts`: members become the union of the provider's records and the existing pointer-derived entries, de-duplicated per project identity; a recorded member with no live checkout is listed without a root. Read stays write-free.
- [x] 9.2 `src/core/relationship-health.ts`: add membership health as pure composition (no I/O).
- [x] 9.3 `src/commands/doctor.ts` and `store doctor`: report all membership codes with their repair commands, read-only, human/JSON parity.
- [x] 9.4 Update `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts` for every file this change migrates off by-id lookup, and refresh the compat-export doc comments in `src/core/store/registry.ts`.
- [x] 9.5 Confirm `spaces.ts` still only ENUMERATES stores (legitimate) and record the decision either way rather than leaving it implicit.

## 10. Tests

- [x] 10.1 Two-machine shard proof: two different projects added to one Store write two different files with no overlapping edit.
- [x] 10.2 Same display alias, two different project identities, coexisting as two records.
- [x] 10.3 Planning binding and membership proven independent: a project whose planning Store is A and which is a knowledge member of B.
- [x] 10.4 "No machine-absolute path enters Git": assert over parsed values of every written record, hint, and ownership block with `path.isAbsolute()`.
- [x] 10.5 Interrupted two-repo mutation is diagnosable and repairable end to end.
- [x] 10.6 Windows path scenarios: record paths under a Windows store root, canonical destination matching differing by drive-letter case and separator form, and rejection of reserved device names. Expected paths built with `path.join()`.
- [x] 10.7 Human/JSON diagnostic parity for every new code.
- [ ] 10.8 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`.

## 11. Docs and locales

- [x] 11.1 `docs/cli.md`: `store add-project` including `--set-primary` and its refusal behavior, `store adopt`, `store eject` destination rules, and the new `store migrate-membership`.
- [x] 11.2 Store troubleshooting: one entry per membership diagnostic with its repair command.
- [x] 11.3 Migration guide: the two intentional breaks (`sourcePath` no longer written or read; eject asks for `--into` where it previously guessed) with the exact repair for each.
- [x] 11.4 Migration guide — REQUIRED by LEAD adjudication: state plainly, as its own passage rather than a passing mention, that `store migrate-membership` DELETES `adoptions.yaml` (this change's only non-reversible step), why it is deleted rather than renamed (any archived copy would keep a machine-absolute path in Git), that every fact it held is carried into the per-project records, and that the pre-migration file remains recoverable from the Store's Git history — with the concrete `git log` / `git show` commands that recover it.
- [x] 11.5 Agent contract: membership is roster and eligibility only, never where a change is implemented.
- [x] 11.6 JSON examples for the membership record, the hint list, and the mutation plan/`repairNeeded` output.
- [x] 11.7 CLI completion registry entry for `store migrate-membership` and its flags.
- [x] 11.8 Locale bundles `en`, `zh-cn`, `ja`: every new message, warning, diagnostic, and repair string, with no English fallback for the new keys.

## 12. Verification and integration

- [x] 12.1 Confirm Windows CI covers this change's path-sensitive test files; add the matrix entry if they are not already included.
- [x] 12.2 Hand cross-check every MODIFIED requirement AND scenario title against `rasen/specs/*/spec.md` — `validate --changes` does not apply deltas to main specs, so a retitled scenario passes validation and only detonates at archive.
- [x] 12.3 Confirm this change's deltas do not touch any requirement child A's deltas already modify (`config-resolution`, `store-config-inheritance`, `store-project-namespace`) — two MODIFIED blocks for one requirement would have the second clobber the first at archive.
- [x] 12.4 `node bin/rasen.js validate project-keyed-store-membership --changes --strict --json` clean.
- [ ] 12.5 Rehearse the spec merge (`rasen archive --json --yes`) before ship.
- [x] 12.6 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, and the sibling change directories.
- [x] 12.7 Confirm no version number in `package.json` was changed by this work.
