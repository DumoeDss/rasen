## 1. Bundle shape and readers (readers before writers)

- [x] 1.1 New `src/core/knowledge-bundle/schema.ts`: a strict, versioned bundle schema — `version`, `bundleId`, `projectId`, `createdAt`, `baseProjectCommit`, `records[]`.
- [x] 1.2 Each record carries `id`, `knowledgeKey`, `contentDigest`, the managed manifest, and **the record's canonical content** (design D3 — the plan's sketch omits it and a digest cannot reconstruct a record).
- [x] 1.3 The permitted-field list is an explicit named list of what is copied, never a scrub of what to remove (design D2). Keep bundle-level and record-level lists in one place referenced by both reader and writer.
- [x] 1.4 `assertNoMachinePath()`: reject Windows drive-letter, Windows network-share, and POSIX absolute forms — all three on every platform. Failure names the record and the field.
- [x] 1.5 Add a reader that parses and validates a bundle without writing anything, including refusal by version for a newer schema and rejection of unknown fields.
- [x] 1.6 Tests: schema round-trip; an unknown field is a parse error; each of the three absolute-path forms is rejected under both Windows and POSIX platform shapes; a newer version is refused by version and not partially read; a whole-tree snapshot proves every reader failure writes nothing.

## 2. Export

- [x] 2.1 New `src/core/knowledge-bundle/export.ts`. Resolve the project from `<projectId|root>` through the landed project identity surface; **the resolved identity is what enters the bundle, never the root**.
- [x] 2.2 Read the project's own catalog through `resolveProjectKnowledgeHome()` and the landed canonical-record reader. Include retired records with their status preserved.
- [x] 2.3 Exclude Store-owned and machine-wide knowledge; exclude ownership records for generated files, generated tool files, and any token/session/run state — by not reading them, per 1.3.
- [x] 2.4 Record `baseProjectCommit`; when no commit can be determined, record it as unavailable rather than inventing one.
- [x] 2.5 Run the strict schema and machine-path assertion over the complete serialized bundle before creating any destination-side file; fail naming the record and the field, producing no file.
- [x] 2.6 Treat any existing filesystem entry at `--to` as an occupied destination and refuse before creating a temporary file. Canonicalize existing-path comparisons so drive-letter case or separator differences cannot bypass the guard.
- [x] 2.7 Create an exclusive randomized `0700` private staging directory outside the user-specified destination directory and on the same filesystem. Hold the exclusively opened staging fd through publication and cleanup; require `fstat(fd)` / `stat(path)` inode identity before the atomic no-clobber hard link and again before unlink. Never publish or unlink a mismatched path. Publication is the commit point: never touch the destination afterward. If cleanup ownership cannot be proved or cleanup fails, keep the published destination and return success with an explicit warning.
- [x] 2.8 Human and JSON report the same project, record count, destination, and warnings, including deferred external staging cleanup.
- [x] 2.9 Tests: two checkouts of one project produce bundles naming the same identity and neither checkout; a retired record round-trips with its status; Store and machine-wide knowledge are absent; an occupied file or directory writes nothing; schema, path, read, write, and publication failures leave the destination directory unchanged; a foreign staging collision remains byte-identical; replacement before publication is neither published nor unlinked; replacement before cleanup is preserved while the correct destination remains readable; cleanup-deferred success adds exactly the named file and reports the same warning to human and JSON callers; destination-creator races, root destinations, and cross-filesystem staging are safely refused; the catalog, checkout, and registrations are byte-identical after export.
- [x] 2.10 Add each new identity-sensitive bundle file to `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts`, with the change's comment, and keep project resolution off by-id Store lookup.

## 3. Export command surface

- [x] 3.1 Add `rasen knowledge bundle export --project <projectId|root> --to <path> [--json]` in `src/commands/knowledge.ts`, reusing the existing owner-selector option helper where it fits. Do not add `--to-store` or any import command.
- [x] 3.2 Add the export subcommand and every export flag to `src/core/completions/command-registry.ts`.
- [x] 3.3 Route every new message through `src/commands/knowledge-messages.ts`; add no inline English messages.
- [x] 3.4 Tests: required and optional flag parsing; missing or incompatible inputs rejected before any work; JSON shape stable and matching the human output's facts; no excluded transport or import surface is registered.

## 4. Export acceptance tests

- [x] 4.1 Prove the collapsing invariant with before/after snapshots of the user-specified destination directory: a successful command, including cleanup-deferred success, creates exactly one new file at the user-named destination, while an occupied destination and every reported failure create none there; include private-staging collision preservation, descriptor/path mismatch before publication and cleanup, injected staging-cleanup warning, and destination creator races; all sources remain byte-identical.
- [x] 4.2 Prove the bundle whitelist by assertion over a produced bundle: no machine path, no ownership record, no generated file, and no token/session/run state (plan §28.6, Gate 6 "bundle 白名单", "无 transient state").
- [x] 4.3 Prove the identity boundary with separate checkout fixtures: exporting the same project from either checkout names the same permanent project identity and neither machine-local root.
- [x] 4.4 Prove the reader accepts a produced bundle and remains non-writing; build every expected path with `path.join()`.
- [x] 4.5 Windows coverage: destination composition; occupied-destination refusal under a path differing only by drive-letter case or separator form; and all three absolute-path forms rejected.
- [x] 4.6 Confirm Windows CI covers this change's path-sensitive test files.
- [x] 4.7 Run serially, never as concurrent Vitest batches: focused schema/reader tests, focused export tests, command tests, then `pnpm lint`, `pnpm build`, and `pnpm test`.

## 5. Docs and locales

- [x] 5.1 Update `docs/cli.md` with the export subcommand, every export flag, and what a bundle contains and deliberately does not contain. Do not document Store transport or import as available.
- [x] 5.2 Update `docs/retention-and-learned-skills.md` with the three-way distinction stated plainly: Store knowledge is shared by cloning the Store, a project's knowledge is machine-local by default, and it leaves that machine only through an explicit bundle export.
- [x] 5.3 Add migration guidance for exporting and carrying a project's knowledge to a new machine, stating explicitly that importing the bundle is a later child and is not available in this change.
- [x] 5.4 State that `baseProjectCommit` is provenance and never a gate, and that resuming an in-flight run across machines is not in this release — so nobody reads a bundle as a checkpoint.
- [x] 5.5 Add a stable JSON export example and refusal examples for an occupied destination and a non-portable record.
- [x] 5.6 Add every new message, state name, refusal reason, and repair string to `src/locales/{en,zh-cn,ja}.json`; allow no English fallback for new keys.
- [x] 5.7 Add release-note text that this child introduces explicit project-knowledge bundle export and does **not** include Store transport, import, preparation integration, or portable run checkpoints.

## 6. Validation and archive rehearsal before ship

- [x] 6.1 Confirm the delta contains exactly one `ADDED` requirement — `A bundle carries an explicitly listed set of portable fields and nothing that belongs to a machine` — with its full wording and scenarios verbatim from Phase F, and zero `MODIFIED`, `REMOVED`, or `RENAMED` blocks. Confirm the export-and-import requirement is absent and deferred whole.
- [x] 6.2 Re-run the portfolio-wide collision sweep over all active change directories. Confirm the retained F1 title is disjoint from the seven deferred Phase F titles and this change has no cross-change title collision.
- [x] 6.3 Run `rasen validate knowledge-bundle-export --changes --strict --json` and require this change's own result to be valid.
- [x] 6.4 **Before ship**, rehearse the only structural spec-merge gate with zero blast radius: create a temporary Rasen root containing copied `rasen/config.yaml`, `rasen/specs/`, and only this change directory; from that temporary root run `rasen archive knowledge-bundle-export --json --yes`; require a clean merge and verify the real worktree is unchanged.
- [x] 6.5 Do not hand the change to ship until task 6.4 is clean; record the rehearsal verdict for the shipper.
- [x] 6.6 Confirm the shared dirty main worktree and the concurrent Phase E1 session's edits are untouched and unstaged by this isolated worktree, including `src/core/completions/command-registry.ts` and `src/locales/{en,ja,zh-cn}.json`.
- [x] 6.7 Confirm no version number in `package.json` was changed by this work.

## 7. Real archive completion

- [ ] 7.1 After the real archive creates `rasen/specs/portable-project-knowledge/spec.md`, restore its `## Purpose` body verbatim from this change's archived delta; do not leave the archiver's `TBD - created by archiving change ...` placeholder.
- [ ] 7.2 Run a repository-wide search equivalent to `grep -rl "TBD - created by archiving" rasen/specs/` and require zero matches before declaring archive complete.
