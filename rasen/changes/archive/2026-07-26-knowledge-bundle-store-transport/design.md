## Context

This is Phase F child F2. F1 has landed and archived the strict bundle schema, non-writing reader, portable-field contract, and export serialization in `src/core/knowledge-bundle/{schema,export}.ts`, with the command surface in `src/commands/knowledge.ts`. F2 consumes that complete bundle; it does not create a second shape or writer.

The Store dependency has also landed. `resolveStoreBinding(input)` in `src/core/store/identity.ts` accepts an alias or durable declaration and returns the exhaustive `absent | resolved | unavailable` union. A resolved arm carries the canonical Store identity and root; an unavailable arm carries its exact reason, diagnostics, and ordered copy-pasteable repairs. Existing Store-owner resolution in `src/core/learned-skills/context.ts` establishes the selector rule: a permanent Store UID becomes a durable declaration and any other selector becomes an alias declaration.

The risk is not bundle serialization. It is writing into a shared Git repository at a derived path while preserving the boundary that carriage is not ownership. The collapsing invariant is: nothing the Store owns changes; exactly one derived untracked bundle file appears; nothing is staged, committed, or pushed.

## Goals / Non-Goals

**Goals:**

- Add optional `--to-store <store>` to the landed export command while keeping `--to <path>` required and preserving all F1 destination guarantees.
- Place the exact F1 bundle at one collision-free, cross-platform location reserved for transported bundles.
- Keep the Store's catalog, project records, metadata, membership, Git index, commits, and remotes unchanged.
- Fail closed when Store resolution is absent or unavailable, retaining the resolver's reason and a copy-pasteable repair.
- Keep transport-specific human and JSON output factually equivalent and localized.

**Non-Goals:**

- Bundle import, validation-on-import, conflict planning, `--dry-run`, or ownership rules on the import side (Phase F child F3).
- The original Store-transport-plus-import end-to-end acceptance requirement; it remains whole for F3.
- Machine-preparation integration (Phase F child F4 / original group 8).
- Any Phase E behavior.
- Staging, committing, pushing, pruning, or otherwise managing transported files after placement.

## Decisions

### D1 — One disjoint ADDED requirement against the existing capability

`portable-project-knowledge` now exists in `rasen/specs/` because F1 archived first. F2 adds *A Store used as transport receives a file and nothing it owns changes* verbatim, with all seven original scenarios. It carries no `MODIFIED` block and changes none of F1's requirements.

This is the feature-area seam fixed by the decomposition plan: F2's title is disjoint from every other Phase F title, so archive ordering is safe. `validate` cannot prove the cross-change merge; the archive rehearsal remains the structural gate.

### D2 — `--to-store` is additive and reuses F1's completed bundle

`--to <path>` remains required. The exporter continues to produce the user-held file under F1's universal rule: exactly one file at the user-named destination, and every occupied filesystem entry is refused.

When `--to-store` is present, the Store receives the same already-built, schema-validated bundle and canonical serialized bytes. The F1 implementation currently returns the validated `bundle` and serializes it once in `src/core/knowledge-bundle/export.ts`; F2 extends that existing seam so both destinations use one serialization contract and the same exclusive new-file publication behavior. It does not reread the project's catalog or reconstruct a second bundle.

Alternatives rejected:

- Making `--to-store` replace `--to`: the original design keeps the user-held artifact independent of a Store and leaves `--to` required.
- Copying or reserializing through a separate transport contract: it could drift from the reader/writer contract F1 already validated.
- Overwriting a pre-existing derived path: bundle identity is the collision key, and an occupied path is never evidence that replacement is safe.

### D3 — Resolve Store identity through the landed tri-state, never by registry lookup

The `--to-store` selector follows the landed Store-owner seam:

- a syntactically valid permanent Store UID is passed to `resolveStoreBinding` as `{ form: 'durable', uid }`;
- any other selector is passed as `{ form: 'alias', id }`.

Only `kind: 'resolved'` authorizes a destination. Every other arm is handled explicitly. An unavailable Store preserves `reason` and its first diagnostic in both output modes. An ambiguous display name therefore fails rather than picking by registry order, preserves every candidate in that diagnostic, and prints only the non-mutating `rasen store list --json` inspection command. It never manufactures a mutating export retry by choosing one candidate identity for the user.

A direct by-id registry lookup is rejected because it would collapse UID selection, duplicate aliases, and broken registrations into an apparently usable Store.

### D4 — The destination is a reserved transport path keyed by bundle identity

One named transport-directory constant defines a location under the resolved Store root that is disjoint from the Store knowledge catalog, project records, and metadata. The destination is composed from the canonical Store root, that constant, the project identity, and a filename containing the validated bundle identity. `path.join()` / `path.resolve()` compose every segment; no separator is embedded in a string.

The bundle identity makes two exports distinct even for the same project. Publication uses exclusive new-file semantics, so a pre-existing entry cannot be replaced even under an unexpected collision or race. Transported bundles are ordinary Git files the user may later prune.

The resolved root is canonicalized through `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve()` fallback before destination comparison. Tests construct expectations with `path.join()` and cover Windows drive-letter-case and separator variants as one Store location.

The reserved subtree is authorized as that exact lexical path, not merely as
some canonical location still contained by the Store. Every existing component
below the canonical Store root is checked with `lstat`; symlinks, junctions,
and other path redirection are refused even when they point back inside the
Store. After parent creation, its canonical path must equal the intended
reserved path.

### D5 — Transport is a file write, never a Store mutation

The placement code writes only the derived bundle file and any otherwise-absent parent directories needed to hold it. It does not call catalog writers, membership writers, metadata writers, `commitStoreFiles`, or any stage/commit/push operation.

Transport staging uses a private randomized sibling of the canonical Store
root on the same filesystem. It is never created inside the Store, so even a
successful publication whose owned staging cleanup is deferred leaves exactly
one Store-untracked file: the transported bundle.

Preparation captures the authorized destination parent's canonical path and
filesystem identity (`dev`/`ino`). Immediately before the no-clobber hard-link
publication, placement rechecks every reserved-path component, exact canonical
path equality, and the captured parent identity. A detected parent rename,
symlink, or junction swap therefore fails closed. Node does not expose a
portable directory-descriptor `openat`/`linkat` publication primitive, so an
unavoidable residual race remains between that final identity check and
`linkSync`; the hard-link operation still never replaces an occupied entry.

Tests snapshot the Store catalog, every project record, metadata, membership, HEAD, and Git index before placement and compare them after placement. `git status` is asserted with individual untracked files visible so the only new file is the derived bundle. The assertion is on disk and Git state, not on output text.

### D6 — Command output reports transport facts without weakening F1 output

`BundleExportOptions` and the Commander registration gain optional `toStore`. Completion metadata gains only that option. Transport-specific success data includes the resolved Store identity, derived destination, and the file the user needs to commit. JSON and human output report the same facts.

Transport failures go through `src/commands/knowledge-messages.ts` and the three locale catalogs. Commander descriptions remain localized through the repository's existing description convention; command logic contains no new inline prose.

## Risks / Trade-offs

- **Transported bundles accumulate in a Store's Git history.** → Accepted: they are ordinary files users can prune, and unique identity is safer than replacement.
- **Two destinations create more than one failure point.** → Keep F1's user destination contract intact, resolve Store identity explicitly, publish each destination with no-overwrite semantics, and report the destination that failed.
- **An ambiguous or broken Store could be mistaken for an empty one.** → Exhaustively handle the resolver union and fail closed with its exact reason and repair.
- **A message-only test could conceal ownership mutation.** → Snapshot Store-owned files, membership, and Git state byte-for-byte.
- **Path spelling can diverge on Windows.** → Canonicalize the resolved Store root, compose with Node's path module, and cover drive-case and separator variants in Windows-sensitive tests.

## Migration Plan

Two path-specific failure modes are handled explicitly:

- A user-selected `--to` path could point into the same Store through a
  different spelling or link. The exporter canonicalizes the user destination
  parent and refuses every destination contained by the selected canonical
  Store before project reads or transport-directory creation.
- Store placement can fail after the independent user file is published. Human
  and JSON errors report the user destination and its published state
  explicitly; they never imply that the successful user file was rolled back.

1. Reverify the landed F1 exporter/result and Store resolver signatures.
2. Add collision-free Store placement using F1's validated bundle and publication semantics.
3. Add the optional command flag, completion metadata, human/JSON reporting, locales, and transport-only tests.
4. Update export documentation and release notes to say that Store transport is available while import remains outside this child.
5. Validate strictly and rehearse the one-requirement spec merge in a scratch Rasen root before ship.

Rollback removes the option and placement path. Existing transported bundle files remain inert ordinary files; no Store-owned format changed.

## Open Questions

None. The scope, ownership boundary, selector semantics, and archive ordering are locked by the Phase F design and decomposition plan.
