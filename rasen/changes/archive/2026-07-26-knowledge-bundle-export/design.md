## Context

Plan §23. Phase F part 1 is not here. The logical project knowledge home (`~/.rasen/project-knowledge/<projectId>/learned-skills/<id>`) and its conflict-safe migration off per-clone catalogs landed in child D2 (`learned-knowledge-effective-resolution`), because multi-checkout correctness is a precondition for D2's resolution rather than a follow-on.

The complete Phase F design covers cross-machine bundle export and import. This first child is narrower: it defines the portable bundle format, a validating non-writing reader, and the one writer that exports a project's own knowledge to a user-named destination. Store transport, import, and machine-preparation integration remain whole requirements for later children.

Two facts about the tree shape this change:

- The managed record is already close to portable. `LearnedSkillManifest` (`src/core/learned-skills/schema.ts`) carries `id`, `knowledgeKey`, `scope`, `status`, `contentDigest`, `description`, `applicability`, `evidence`, and timestamps — and `EvidenceReference.artifact` is an artifact *kind* (`proposal`, `design`, …), not a path. The canonical body lives beside it in `SKILL.md`. So the excluded categories are excluded by *what is not read*, not by scrubbing a structure that contains them.
- The canonical project knowledge home and managed-record reader have landed in `src/core/project-knowledge-home.ts` and `src/core/learned-skills/catalog.ts`. Implementation consumes their final exported surfaces rather than reproducing catalog or record parsing.

## Goals / Non-Goals

**Goals:**

- One explicit export route for a project's own knowledge, and no implicit one.
- A bundle whose contents are chosen by an explicit permitted-field list, not by scrubbing.
- A validating reader that writes nothing and exists before the exporter that produces bundles.
- On every path, the user-specified destination directory gains exactly the named file on success, or gains nothing on refusal or failure.

**Non-Goals:**

- Store transport and `--to-store`.
- Bundle import, preview, conflict handling, and import ownership.
- The declared-bundle step in machine preparation and all other Phase E work.
- The project knowledge home and the per-clone catalog migration — child D2.
- The Store catalog, publication evidence, and approval — child D1.
- Portable run checkpoints. `baseProjectCommit` is recorded for audit; it never turns the bundle into a checkpoint.

## Decisions

### D1 — Spec surface: one NEW capability, one ADDED requirement, zero MODIFIED blocks

`portable-project-knowledge` is introduced through the one `ADDED` requirement whose complete contract F1 satisfies: *A bundle carries an explicitly listed set of portable fields and nothing that belongs to a machine*. Its title is disjoint from every other Phase F requirement.

The requirement *A project's knowledge travels between machines only when the user exports a bundle* is deferred whole. Despite its export-focused title, its first normative sentence promises both export and import; landing it in this export-only child would add a contract F1 satisfies only partly. The six transport, import, and preparation requirements also remain whole for later children.

The eight Phase F titles remain pairwise disjoint, so this carving keeps the F branch archive-order independent. `validate` cannot detect cross-change collisions, so the archive spec merge is rehearsed in an isolated temporary Rasen root before ship.

### D2 — What excludes machine state is a permitted-field list, not a scrub

The bundle writer names the fields it copies. Anything not named is absent because it was never read. This is the project's standing rule that generated artifacts are tracked by explicit named lists rather than pattern matching, applied to serialization: a scrub pass is a denylist, and a denylist silently ships whatever a later field addition introduces.

On top of that, an assertion pass runs over the serialized bundle before it is written, and rejects any value that is an absolute path in **Windows drive-letter form, Windows network-share form, or POSIX form** — all three regardless of the exporting platform, because the bundle is read on the other one, and a POSIX-absolute value produced on Linux is exactly as wrong on Windows as the converse. Failure names the record and the field.

### D3 — The bundle record carries the canonical content

The illustrative plan shape `{id, knowledgeKey, contentDigest, manifest}` is insufficient because a digest cannot reconstruct a record: the canonical body lives in `SKILL.md`, and `LearnedSkillManifest` carries `description` but not `instructions`. Each record therefore also carries its **canonical content**, and the recorded `contentDigest` is what a later importer will validate.

### D4 — Readers precede writers and share one closed contract

`src/core/knowledge-bundle/schema.ts` owns the strict versioned schema, the explicit permitted-field constants, the all-platform machine-path assertion, and a reader that parses and validates without writing. The exporter is implemented only after those reader-side contracts and tests exist, and builds values accepted by that same reader.

Unknown fields are rejected. A schema version newer than the reader understands is refused by version rather than partially interpreted. The reader has no write dependency and creates no destination, cache, migration, or catalog state.

### D5 — `--to` names the only file F1 may create

`--to <path>` is required and names the bundle file the user will carry. There is no derived second destination and no `--to-store` option in this child.

The destination is treated as occupied if any filesystem entry already exists there; export refuses before staging. After all reads, schema checks, and machine-path checks pass, the writer creates an exclusive randomized private staging directory with mode `0700` **outside** the user-specified destination directory and on the same filesystem. It exclusively opens the staging file inside that directory and holds the descriptor open through publication and cleanup. Immediately before the path-based hard link, `fstat(fd)` and `stat(path)` must still identify the same inode; otherwise export refuses without publishing or unlinking the changed path. Publication is an atomic no-clobber hard link and is the commit point. Before cleanup, the same descriptor/path proof is repeated; a mismatch or verification failure never enters path cleanup and instead returns successful publication with the explicit `staging_cleanup_deferred` warning. The writer never checks, deletes, or otherwise touches the destination path after commit.

Node has no portable fd-based atomic hard-link primitive and no primitive that atomically combines inode verification with unlink. The private directory therefore states the concurrency boundary honestly: ordinary concurrent exporters and destination creators neither share nor enter another invocation's randomized staging directory, so the two descriptor/path proofs preserve ownership across the supported concurrency model. Deliberate tampering by another process running as the same OS principal that discovers and mutates the owner-private directory in the interval between proof and link/unlink is an adversarial local-security case outside this export feature's concurrency model; the implementation does not claim to close that gap with unavailable Node primitives.

Thus success — including cleanup-deferred success — adds exactly the named destination inside the user-specified directory, while every refusal or reported failure adds nothing there. A cleanup-deferred success may leave only the owned or detected-foreign staging entry inside the private directory outside the destination directory for recovery. A filesystem root or mount boundary with no safe same-filesystem external staging location is refused before staging. The source catalog, checkout, and registrations remain byte-identical.

### D6 — Only project-owned canonical records enter the bundle

Export resolves `<projectId|root>` to the permanent project identity and reads that project's canonical catalog through the landed project-knowledge seam. The identity, never the checkout root, enters the bundle. Retired records are included with status preserved. Store-owned and machine-wide records, generated-file ownership records, materialized tool files, and token/session/run state are never read by the bundle builder.

`baseProjectCommit` is recorded when available and explicitly unavailable otherwise. It is provenance, never an export gate.

### D7 — Command messages and completion metadata remain centralized

`rasen knowledge bundle export --project <projectId|root> --to <path> [--json]` is registered in `src/core/completions/command-registry.ts`. All new user-facing messages live in `src/commands/knowledge-messages.ts`, and every key is present in `src/locales/{en,ja,zh-cn}.json`; the command file contains no new inline English messages.

Human and JSON output report the same project, record count, destination, and warnings.

### D8 — Cross-platform paths are data and test concerns

Every path is composed with `path.join()` / `path.resolve()`; tests build expected paths with `path.join()`, never a hardcoded separator. Existing-path comparison uses the repository's canonicalization convention with a `path.resolve` fallback, so drive-letter case or separator differences do not bypass the occupied-destination refusal. The machine-path assertion covers all three absolute forms on every platform.

## Risks / Trade-offs

- **Exporting could be mistaken for backup or synchronization.** → Docs state that project knowledge remains machine-local by default and travels only through an explicit export; import and portable run checkpoints are not part of this child.
- **A permitted managed field could itself contain a machine path.** → The explicit copy list prevents accidental field expansion, and the assertion walks the final serialized bundle before any file is created.
- **Atomic writing can leave a temporary artifact or publish a replaced staging path if pathname ownership is assumed after open.** → Staging is isolated in an exclusive randomized `0700` private directory, its descriptor stays open, and descriptor/path inode identity is re-proved before both publication and cleanup. A mismatch is never published or unlinked. After commit, cleanup failure or mismatch becomes an explicit success warning and the destination path is never revisited.
- **Archiving the first child of a new capability destroys the authored Purpose.** → Rehearse archive in a temporary root, then after real archive restore the Purpose verbatim from the archived delta and require a repository-wide zero-`TBD - created by archiving` check.

## Migration Plan

1. Add the versioned bundle schema, explicit permitted-field lists, all-platform machine-path assertion, and validating non-writing reader with tests.
2. Add export using the reader's closed contract; resolve the project identity, read only the canonical project-owned records, validate fully, then create exactly one new destination file.
3. Add the export-only CLI surface, completions, messages, locales, acceptance coverage, and docs.
4. Validate strictly and rehearse archive in an isolated copied Rasen root before ship.

Rollback removes the command and leaves any already exported bundle files inert. No existing storage shape changes.

## Open Questions

None for this child. Transport, import reconciliation, and preparation integration are deliberately deferred whole.
