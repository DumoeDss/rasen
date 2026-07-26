## Context

This is Phase F child F3. F1 and F2 have landed and archived the strict bundle schema, permitted-field contract, non-writing reader, canonical serialization, export, and Store transport in `src/core/knowledge-bundle/{schema,export}.ts`. F3 consumes those exact bytes and that exact reader; it does not create a second bundle shape, loosen validation, or infer ownership from the path a bundle travelled.

The canonical project catalog has also landed. `resolveProjectSelector(selector)` resolves a project ID or registered root without mutation. `resolveCanonicalStore('project', context)` returns the identity-keyed `ResolvedStore` for `~/.rasen/project-knowledge/<projectId>/learned-skills/`, including the machine-local per-owner lock path. `readCanonicalRecord(directory, 'project', owner)` distinguishes `absent`, valid `managed`, and occupied or unreadable `unmanaged` targets. Learned-skill identifiers already have one cross-platform authority in `checkLearnedSkillId()` and `learnedSkillIdCollisionKey()`.

The central risk is partial application: importing four clean records before discovering that the fifth conflicts would leave a state the user cannot name or repeat. The collapsing invariant is therefore all-or-nothing: either every new record in the bundle is added, or the project's stored knowledge is byte-identical to before.

## Goals / Non-Goals

**Goals:**

- Validate the complete untrusted bundle and target project before any catalog mutation.
- Produce one deterministic new · identical · conflicting plan shared by preview and apply.
- Report every conflict in one pass and make any conflict refuse the whole import.
- Add only absent records under one project-catalog transaction, leaving identical and unrelated records byte-identical.
- Store imported records as project-owned knowledge without Store source, publication, membership, or evidence inflation.
- Keep human and JSON output factually equivalent and localized.

**Non-Goals:**

- Machine-preparation or declared-bundle integration (Phase F child F4 / original group 8).
- Any Phase E4 behavior or ordinary Store-repair message sweep.
- Export, schema-version, canonical-serialization, or Store-transport redesign.
- Interactive conflict reconciliation, automatic synchronization, or portable run checkpoints.
- Rewriting, retiring, or removing any existing local record.

## Decisions

### D1 — Four disjoint ADDED requirements against the existing capability

`portable-project-knowledge` already exists in `rasen/specs/` because F1 and F2 archived. F3 adds the four original requirements *A bundle is validated in full before anything is imported*, *Import never overwrites or removes local knowledge, and a conflict stops the whole import*, *Imported knowledge stays the project's own, whatever route it travelled*, and *Import previews completely and changes nothing* verbatim, with all 23 original scenarios.

No existing requirement is modified. The titles are disjoint from all other Phase F titles, so this change stays in F's collision-safe ADDED class. `validate` cannot prove the merge; the scratch archive rehearsal remains the structural gate.

### D2 — The landed reader is the only bundle-validation authority

Import starts with `readKnowledgeBundle(filePath)`, which already parses the complete JSON document, rejects unknown fields, refuses newer versions explicitly, validates every managed manifest and content digest, and re-runs the all-platform machine-path assertion. Import then performs the target-dependent checks the reader cannot know:

- resolve `--project` with the same `resolveProjectSelector` seam export uses;
- require the bundle's project identity to equal that resolved permanent identity;
- validate every record identifier with `checkLearnedSkillId()`;
- reject duplicate or cross-platform-colliding identifiers with `learnedSkillIdCollisionKey()`.

All records complete these checks before the target catalog is inspected for mutation, and all validation failures carry the bundle record and field when one exists. A hand-edited bundle cannot use `..`, platform aliases, or case-only duplicate identifiers to address outside or twice into the canonical catalog.

Alternatives rejected:

- Parsing records incrementally while writing: the last invalid record could leave earlier ones imported.
- Reimplementing schema or digest checks in `import.ts`: two readers would drift.
- Trusting a bundle because it lives under a Store transport directory: the route is not an authority.

### D3 — One immutable plan drives both `--dry-run` and apply

After validation, import resolves the project catalog through `resolveCanonicalStore('project', context)` and classifies each bundle record by its permanent identifier:

- **new** — the canonical target is absent;
- **identical** — the target is managed, its canonical content is identical, and active/retired status agrees;
- **conflicting** — content or lifecycle status differs, or the identifier is occupied by something that cannot be established as the same managed record.

Identity is the record identifier, not the knowledge key. Same knowledge key under another identifier does not make a record identical. Retired on one side and active on the other is always conflicting. An identical record is never rewritten, even if an alternate serialization could be produced.

The plan lists all new, identical, and conflicting records in deterministic identifier order and carries every conflict rather than the first. `--dry-run` returns that plan with mutation suppressed. Apply consumes the same plan vocabulary and result shape; it does not run a different comparison path. `baseProjectCommit` is reported as provenance and may produce a divergence warning, but never gates import.

### D4 — Apply re-proves the plan under the existing per-project lock

Planning is read-only and unlocked. Apply acquires the exact per-owner lock returned by the landed project `ResolvedStore`, then re-reads every target and recomputes the classification before creating a staging directory. If any record changed between preview/planning and commit, apply returns the refreshed conflict plan and writes nothing.

This composes with existing learned-skill mutation locking rather than inventing a bundle-only lock. A valid pre-lock plan is evidence for the report, not authority to write after concurrent local knowledge changed.

### D5 — A private staged set publishes add-only and rolls back only what it owns

For a conflict-free locked plan, import creates one named, private transaction staging directory beside the canonical catalog, writes the explicit managed files for every new record, and reads each staged record back before publication. No target path is touched until the entire staged set verifies.

Publication first reserves each absent destination with an exclusive directory creation, records that directory's identity, and then publishes only the two named managed files from the verified staging set with exclusive destination-file creation. The exclusive directory reservation is the no-replace boundary on both Windows and POSIX; unlike a directory rename, it cannot replace an empty directory that appeared in the final window. If any publish step fails, rollback removes only destination directories and files whose recorded identity and expected contents still verify. A fully verified rollback restores the pre-import snapshot and reports `changed: false`; an unverifiable identity or content is retained at its named path, reports `changed: "unknown"`, and does not claim that the snapshot was restored or that nothing landed. Staging and rollback names are generated from named constants so the catalog reader ignores known transaction debris rather than pattern-inventing at each call site.

This is a multi-record import transaction, not a sequence of ordinary upserts: the existing one-record `commitLearnedSkillPlan()` can safely commit one mutation but cannot make five independent commits all-or-nothing. The import transaction reuses the same lock, canonical-record reader, manifest serializer, digest verification, private staging, and ownership rules without calling a rewrite-capable operation.

### D6 — The destination manifest names the project and carries no transport source

Every newly stored record is projected explicitly into the current durable manifest shape with:

- `scope: 'project'`;
- `owner: { type: 'project', projectId: <resolved identity> }`;
- the bundle's identifier, knowledge key, canonical content digest, lifecycle status, descriptive fields, timestamps, retirement fields, and evidence;
- no Store owner and no Store transport source;
- no receiving-machine evidence and no newly inferred promotion source.

Version-1 evidence is normalized through the landed `normalizeEvidence()` projection; version-2 evidence is copied exactly. The destination `sources` list is empty because transport is not publication and no source catalog was resolved or verified by import. Evidence facts keep their original owners and counts; the receiving machine is not appended as an independent contributor.

The projected manifest is schema-validated and the resulting target is read back with the resolved project owner. Tests assert the on-disk manifest, not the success message. Store catalogs, Store project records, membership, metadata, Git state, and publication evidence remain byte-identical.

### D7 — Command output exposes a stable plan, not persistence mechanics

The landed `knowledge bundle` command gains:

`rasen knowledge bundle import <bundle> --project <projectId|root> [--dry-run] [--json]`

Core success data includes state (`previewed` or `imported`), project identity, bundle identity and path, deterministic `added`, `alreadyPresent`, and `conflicts` arrays, warnings, and whether anything changed. A refusal uses stable error codes and names all known conflicts. Human output presents the same facts; all descriptions, states, failure reasons, and repairs go through `src/commands/knowledge-messages.ts` and all three locale catalogs.

The core import function is reusable by F4 directly. Machine preparation will call the same validate/plan/apply seam rather than invoking the CLI or duplicating conflict policy.

### D8 — Cross-platform and route-independent

Every bundle and catalog path is composed with `path.join()` / `path.resolve()`. Expected paths in tests use the same APIs. Identifier collision uses the landed platform-stable collision key, so a bundle cannot import two names that occupy one Windows target. The reader's machine-path assertion recognizes Windows drive-letter, Windows network-share, and POSIX absolute forms on every host.

Line-ending normalization stays where F1 and the learned catalog already put it: `digestContent()` determines canonical content identity, so equivalent content checked out with different line endings does not become a conflict. The importer receives only a file path and project selector; it never receives or infers a Store owner from that path.

## Risks / Trade-offs

- **All-or-nothing import could feel obstructive.** → `--dry-run` reports every conflict at once, so the user resolves once and imports once.
- **A valid plan can go stale before apply.** → Re-resolve the canonical project catalog and recompute every classification under its existing owner lock.
- **A multi-record filesystem commit has several publication points.** → Stage and verify the complete set first, publish absent-only, inject failures at each point in tests, and rollback only transaction-owned additions to the verified pre-import snapshot.
- **Project records from older manifests do not carry an explicit durable owner.** → Normalize into the current project-owned manifest at the import boundary while preserving content, lifecycle, timestamps, and evidence facts.
- **A Store path could be mistaken for Store provenance.** → The core importer has no Store selector or Store-resolution dependency and writes an empty transport-source list.
- **A bundle can name platform-colliding identifiers.** → Validate every ID and reject duplicate collision keys before target reads or staging.

## Migration Plan

1. Reverify and compose the landed reader, project resolver, canonical catalog resolver, record reader, lock, and serializer signatures.
2. Add complete validation and a deterministic read-only import plan.
3. Add `--dry-run` over that plan and prove it leaves whole-tree snapshots unchanged.
4. Add the locked, staged, add-only transaction with drift recheck, failure injection, rollback, and on-disk ownership assertions.
5. Add the command, completion metadata, messages, locales, focused acceptance coverage, and documentation.
6. Strictly validate and rehearse the four-requirement spec merge in a scratch Rasen root before ship.

Rollback removes the command and import implementation. Records already imported remain ordinary valid project-owned catalog records; no existing on-disk format changed.

## Open Questions

None. Interactive reconciliation and doctor/preparation integration remain deliberately deferred; F4 consumes the stable core import seam without changing F3's validation or conflict policy.
