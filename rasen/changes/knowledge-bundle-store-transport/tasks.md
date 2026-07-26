## 1. Re-verify landed seams

- [x] 1.1 Re-verify F1's final exported surface in `src/core/knowledge-bundle/{schema,export}.ts`: the validated bundle result, canonical serialization, exclusive publication behavior, and the universal `--to` invariant. Reuse them; do not create a second bundle shape or serialization contract.
- [x] 1.2 Re-verify `resolveStoreBinding`'s final signature and `absent | resolved | unavailable` union, UID-versus-alias declaration construction, `primaryRepair`, Store-root canonicalization, and `unambiguousStoreSelector`; never resolve `--to-store` with a by-id registry lookup.
- [x] 1.3 Confirm every file that will resolve a Store is already covered by `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts`; if implementation introduces a new consumer, append that exact file under a `knowledge-bundle-store-transport` comment.

## 2. Store transport

- [x] 2.1 Derive the in-Store location under one named reserved transport directory, including project identity and bundle identity so two exports never collide. Compose every segment with `path.join()` / `path.resolve()` and canonicalize the resolved Store root.
- [x] 2.2 Extend the landed F1 export seam so the exact same validated bundle and canonical bytes are published to the derived Store destination with exclusive new-file semantics; keep `--to` required and preserve its one-file/refuse-if-occupied invariant on every path.
- [x] 2.3 Place the bundle file only. Do **not** write the Store's knowledge catalog, project records, metadata, or membership, and do not call any stage, commit, or push operation.
- [x] 2.4 Handle every `resolveStoreBinding` arm explicitly. An unavailable or ambiguous Store fails with its exact reason and a copy-pasteable repair, is never treated as empty, and receives no file.
- [x] 2.5 Return the resolved Store identity, derived destination, and exact file the user needs to commit; a later placement must leave every earlier transported bundle present and byte-identical.

## 3. Command surface and messages

- [x] 3.1 Add optional `--to-store <store>` to `rasen knowledge bundle export --project <projectId|root> --to <path> [--json]` in `src/commands/knowledge.ts`; do not add an import subcommand or any import flag.
- [x] 3.2 Add only the `--to-store` option metadata under the existing bundle-export node in `src/core/completions/command-registry.ts`, preserving the existing command tree and F1 options.
- [x] 3.3 Route every transport-specific description, success fact, refusal reason, and repair through `src/commands/knowledge-messages.ts`; keep human and JSON output factually equivalent and reject incompatible input before Store or filesystem work.

## 4. Store-state and acceptance tests

- [x] 4.1 Add core tests that snapshot the Store's knowledge catalog, every project record, metadata, and membership byte-for-byte; after placement only the derived bundle file may differ.
- [x] 4.2 Add Git-state tests that show exactly one derived untracked file with individual untracked files visible, with the index, HEAD, and configured remote unchanged; assert disk and Git state rather than only messages.
- [x] 4.3 Test unavailable and ambiguous Stores: retain the resolver reason and every candidate, provide only a copy-pasteable non-mutating inspection repair when duplicate display names make a choice unsafe, and write nothing to either Store.
- [x] 4.4 Test two exports for the same project: the second has a distinct bundle-identity destination and leaves the first file present and byte-identical.
- [x] 4.5 Add command tests for flag parsing, pre-work rejection, localized human output, stable JSON shape, and human/JSON parity while preserving F1's occupied-`--to` and exactly-one-user-file coverage.
- [x] 4.6 Add cross-platform tests for the derived Store path using `path.join()` expectations, including Windows drive-letter-case and separator variants resolving to one location; confirm Windows CI includes every path-sensitive test file.

## 5. Docs, locales, and release contract

- [x] 5.1 Update `docs/cli.md` and `docs/retention-and-learned-skills.md` for optional Store transport: Store knowledge travels by cloning, project knowledge remains machine-local by default, and transport carries one explicit bundle file without granting ownership.
- [x] 5.2 Update `docs/migration-guide.md` with the export-to-Store step and state plainly that this child does not import the bundle; leave conflict resolution and the original export-plus-import walkthrough for F3.
- [x] 5.3 Add every transport key to `src/locales/{en,zh-cn,ja}.json` with no fallback, and update the `0.1.5` `CHANGELOG.md` export entry to include Store transport while still excluding import, machine-preparation integration, and portable run checkpoints.

## 6. Verification and archive gate

- [x] 6.1 Run the focused Store-transport, F1 regression, command, completion, locale, identity-boundary, and Windows-path tests serially; never run concurrent Vitest batches.
- [x] 6.2 Run `pnpm lint`, `pnpm build`, and the full test suite. Confirm any known `test/release-contract.test.ts` or `test/commands/handoff.test.ts` failure in isolation and against the exact F2 base before classifying it as pre-existing.
- [x] 6.3 Run `rasen validate knowledge-bundle-store-transport --changes --strict --json` and require this change's own result to be valid with exactly one ADDED requirement, seven scenarios, and zero MODIFIED requirements.
- [x] 6.4 Re-run the portfolio-wide active-change collision sweep. Confirm all Phase F requirement titles remain disjoint and this child is the sole owner of *A Store used as transport receives a file and nothing it owns changes*.
- [x] 6.5 Before ship, rehearse `rasen archive knowledge-bundle-store-transport --json --yes` from a temporary root containing only copied `rasen/config.yaml`, `rasen/specs/`, and this change directory. Require a clean one-ADD merge and leave the real worktree unchanged.
- [ ] 6.6 Confirm `grep -rl "TBD - created by archiving" rasen/specs/` is empty after rehearsal and real archive, the existing portable-project-knowledge Purpose remains verbatim, the shared dirty worktree and sibling change directories are untouched and unstaged, and `package.json` version is unchanged.
