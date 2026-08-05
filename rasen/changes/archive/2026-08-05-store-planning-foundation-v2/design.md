## Context

The accepted Store v2 model separates a physical Store checkout from the planning home of each member project. The current code instead exposes a flat planning root, stores membership in `.rasen-store/projects/<projectId>.yaml` version 1 records, uses Store metadata schema version 2 for permanent Store identity, derives archive accounting from raw roots, and has no portable planning scope or Change instance identity.

This child is the contract layer at the bottom of a serial portfolio. Later children will route commands through these contracts, migrate existing Stores, create Git worktree pairs, and apply finalization plans. The foundation must therefore be deterministic without filesystem or Git access, retain legacy parsing until migration is explicit, and avoid embedding command-policy or machine locators in portable data.

## Goals / Non-Goals

**Goals:**

- Define Store layout v2 as project-partitioned paths and strict portable catalog records.
- Reuse the repository's existing permanent Store and project identities while defining a canonical grammar for every v2 path segment.
- Provide exact, domain-separated derivation and verification rules for planning, Change, worktree, and workspace-pair identities.
- Extend Change metadata with a backward-compatible v2 identity block and explicit planning-only implementation intent.
- Define pure finalization-outcome validation and a strict, self-consistent Archive v2 record.
- Make every contract testable with Windows and POSIX fixtures and no real Git repository.

**Non-Goals:**

- Selecting `--store`, `--project`, or `--target-line`, opening a `PlanningScope`, or changing any command's root routing.
- Writing catalogs or v2 Change metadata from commands, migrating legacy flat Store content, or changing adopt/eject behavior.
- Resolving Git refs, creating/removing worktrees, maintaining machine associations, or proving commit reachability.
- Planning or applying Archive/finalization mutations, synchronizing specs, changing archive CLI options, or updating direct/bulk/ship/API consumers.
- Management API, UI, Store Issue/Execution Plan, or compatibility cleanup work.

## Decisions

### 1. Expose one pure Store-planning foundation boundary

The implementation will place the new contracts behind one public Store-planning foundation entry point under `src/core/store/`, with internal files for portable names, layout/catalogs, identities, Change metadata integration, and Archive v2. Public functions accept data and an explicit/native path flavor; they do not read the registry, filesystem, cwd, environment, or Git.

Later `StorePlanning` and `ChangeFinalizationModule` implementations consume this boundary instead of copying regexes, hash preimages, or path joins. Existing `foundation.ts`, `project-records.ts`, and archive accounting remain the compatibility surfaces until their owning portfolio children integrate the new contracts.

Alternative considered: extend `ResolvedOpenSpecRoot` and existing archive DTOs in place. That would make command routing and I/O policy prerequisites for validating the data, and would preserve multiple path algorithms, so it is rejected.

### 2. Version layout independently from existing metadata schemas

`StoreMetadataStateV2.version` already means “metadata carries a permanent Store UID.” Layout is therefore declared by a distinct optional `layoutVersion` field in `.rasen-store/store.yaml`:

```yaml
version: 2
uid: 9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0
id: example-store
layoutVersion: 2
```

Absence of `layoutVersion` means legacy layout; directory presence never upgrades a Store implicitly. The existing parser and serializer accept `layoutVersion: 2` but do not inject it when absent. No command writes the field in this child.

Layout v2 has these authoritative relative locations:

| Address | Relative path |
| --- | --- |
| Store metadata | `.rasen-store/store.yaml` |
| Project catalog | `.rasen-store/projects/<projectId>.yaml` |
| Target-line catalog | `.rasen-store/target-lines/<targetLineId>.yaml` |
| Project planning home | `rasen/projects/<projectId>/` |
| Project canonical specs | `rasen/projects/<projectId>/specs/` |
| Project design docs | `rasen/projects/<projectId>/design-docs/` |
| Active Change | `rasen/projects/<projectId>/changes/<changeId>/` |
| Project Archive line | `rasen/projects/<projectId>/changes/archive/<targetLineId>/` |
| Store design docs | `rasen/design-docs/` |

Target lines are not another active-Change directory layer. Unmerged target-line state is isolated by Store Git branches/worktrees; only Archive uses a stable target-line directory.

The existing version 1 project membership record stays readable. A version 2 project catalog uses the same per-project file location but removes adoption ownership lists from the durable member contract and separates membership from planning binding:

```yaml
version: 2
projectId: 8a0c76e8-faa9-49dc-b0d1-c35df3ad797f
id: example-project
remote: https://example.invalid/example-project.git
roles:
  planning: true
  knowledge: false
planningBinding:
  state: bound
  boundAt: 2026-08-04T00:00:00.000Z
```

`planningBinding.state` is `unbound` or `bound`; only `bound` carries `boundAt`, and a bound record must have `roles.planning: true`. Machine paths are not fields. Version 1 `adoption` remains read-compatible evidence and will be moved to migration receipts by the migration child rather than silently rewritten here.

A target-line catalog is new and starts at record version 1:

```yaml
version: 1
id: line-0.2
storeRef: refs/heads/release/0.2
projects:
  8a0c76e8-faa9-49dc-b0d1-c35df3ad797f:
    codeRef: refs/heads/release/0.2
```

The file stem must equal `id`; each project-map key must be a canonical v2 project identity. Refs are portable, credential-free full Git refs and may move without changing the target-line id. Pure validation checks conservative Git ref syntax; reachability and existence belong to the worktree/finalization children.

Alternative considered: reuse metadata `version: 2` as the layout flag and infer project ownership from current membership/adoption records. The former collides with an existing schema meaning; the latter repeats the flat-layout ownership ambiguity. Both are rejected.

### 3. Canonical path-segment grammars fail closed

V2 project ids accept the two existing permanent project identity forms: a lowercase RFC 4122 textual UUID or the shared lowercase kebab id grammar. Unlike legacy version 1 record parsing, v2 portable records require the already-canonical lowercase spelling and do not silently fold aliases. Target-line ids use:

```text
^[a-z0-9]+(?:[.-][a-z0-9]+)*$
```

This admits stable names such as `main`, `line-0.1`, and `release-2026.08`, while excluding empty segments, leading/trailing punctuation, and repeated punctuation. Project and target-line ids also reject `.`, `..`, either path separator, NUL/control characters, trailing dot/space, and every name in the repository's existing Windows reserved-device list. The shared list will have one definition rather than a copied detector. Change ids continue to use the existing kebab grammar.

All v2 path constructors validate before joining, use `node:path` (`native`, `win32`, or `posix`) selected explicitly, resolve the result, and prove it is contained by the intended root with `path.relative`. They return an immutable value; they never create or inspect a path. Archive entry names are `YYYY-MM-DD-<changeId>--<instanceShort>`, where `instanceShort` is the first 12 digest characters of a verified `ChangeInstanceId`; final publish still uses no-clobber semantics in the later finalization child.

Alternative considered: sanitize user input or compare only after filesystem creation. Sanitization is non-injective and can overwrite another project on case-insensitive filesystems; post-creation checks are too late. Both are rejected.

### 4. Identities use canonical JSON, SHA-256, versioned domains, and branded outputs

The foundation reuses the repository's RFC 8785 canonical JSON helper and hashes UTF-8 bytes with SHA-256. Each preimage is a strict object with a versioned `domain`; outputs are lowercase hex with a type prefix:

```text
ps_<64 hex> = H({ domain: "planning-scope/v2", storeUid, projectId, targetLineId })

ci_<64 hex> = H({ domain: "change-instance/v2", planningScopeId, instanceSeed })

wt_<64 hex> = H({ domain: "worktree-instance/v2", repositoryIdentity, worktreeIdentity })

wp_<64 hex> = H({ domain: "workspace-pair/v2", changeInstanceId,
                  planningWorktreeInstanceId, executionWorktreeInstanceId })
```

`storeUid` uses the existing trim/lowercase normalization; project and target-line ids must already be canonical. `instanceSeed` is exactly 16 random bytes encoded as 32 lowercase hex characters and is created once. Neither `changeId`, a path, a branch, nor a Git ref enters `PlanningScopeId` or `ChangeInstanceId`.

Worktree identities are intentionally machine-local. The later Git adapter supplies canonical repository and physical worktree identity strings; the pure foundation verifies only their canonical non-empty/control-free shape and hashes them without interpreting paths. Workspace-pair input is ordered, so swapping planning and execution worktrees changes the id.

Every id type has `parse`, `is`, `derive`, and (where appropriate) `mint`/`verify` functions, with branded TypeScript output so arbitrary strings do not satisfy downstream APIs accidentally.

Alternative considered: concatenate fields, hash absolute Change paths, or include `changeId`. Concatenation is ambiguous without an escaping protocol; path identity is not portable; `changeId` is a mutable human alias. Canonical, domain-separated objects avoid all three problems.

### 5. Change metadata carries portable v2 identity without invalidating legacy Changes

The strict Change metadata schema gains optional fields:

```yaml
implementation: none # absent or "code" means code-backed; "none" is explicit
identity:
  version: 2
  instanceSeed: 7fd5d6a7f70b0ad60f05d5f22f18de46
  instanceId: ci_...
  storeUid: 9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0
  projectId: 8a0c76e8-faa9-49dc-b0d1-c35df3ad797f
  targetLineId: line-0.2
```

Parsing an identity block recomputes the planning scope and Change instance ids and rejects any mismatch. A metadata file without these fields remains valid and serializes without injected fields. This child does not mint or write v2 identity from `new change`; the scope-routing child owns that mutation. `implementation: none` is the only way a later landed finalization may omit code-merge proof; absence retains legacy/code-backed semantics.

### 6. Finalization outcome and Archive v2 are strict discriminated contracts

The pure finalization input contract has four discriminants:

- `landed`: no reason or successor; code-backed Changes require a confirmed merge fact, while `implementation: none` requires no fabricated code commit.
- `superseded`: non-empty reason and successor `ChangeInstanceId`.
- `cancelled`: non-empty reason and no successor.
- `abandoned`: non-empty reason and no successor.

A pure semantic validator accepts the current and, for supersession, resolved successor scope records. It enforces same Store and project while allowing another target line. Lookup and Git proof are external inputs rather than hidden I/O.

Archive v2 remains a JSON ledger and includes `schemaVersion: 2`, implementation intent, Store/project/target-line/Change/workspace identities, outcome fields, planning worktree/ref/OID facts, optional code-merge facts, spec-sync accounting, evidence hashes, missing evidence, and `archivedAt`. Its Zod schema is a discriminated union/refinement with these cross-field rules:

- `landed` + `implementation: code` has non-null code merge, a verified `WorktreeInstanceId`, a Git OID, and `reachable: true`.
- `landed` + `implementation: none` has `codeMerge: null`.
- Every `landed` record has `specSync.applied: true`; its actions may be empty.
- Every non-landed record has `codeMerge: null`, a non-empty reason, `specSync.applied: false`, and an empty action list.
- Only `superseded` has a non-null `supersededBy`.
- Spec actions are a strict create/update/delete union with capability id plus before/after SHA-256 digests appropriate to the operation.
- Evidence uses portable relative paths and lowercase SHA-256 digests; absolute, escaping, or duplicate paths are rejected.

Serialization writes a stable field order, two-space JSON, a trailing newline, UTF-8 without BOM, and verifies by parsing the result. It does not replace `archive-engine.ts` or perform an archive transaction in this child.

Alternative considered: add optional fields to the existing archive accounting interface without an explicit version or outcome union. That allows impossible combinations such as `abandoned` with applied specs, so it is rejected.

### 7. Validation errors and compatibility are explicit

Pure contract failures use typed errors with stable families such as `invalid_store_layout_v2`, `invalid_project_catalog`, `invalid_target_line_catalog`, `invalid_planning_identity`, `invalid_archive_v2`, and `planning_path_escape`. Errors identify the field/path but never coerce a record into another owner or scope.

Legacy Store metadata without `layoutVersion`, version 1 project records, Change metadata without identity, and Archive v1 accounting continue to parse through their existing entry points. New v2 parsers accept only v2. There is no dual write and no automatic upgrade in this child.

### 8. Tests exercise contracts across platforms without Git

Unit tests use `path.win32` and `path.posix` fixtures, `path.join`/`path.resolve` expectations, existing canonicalization helpers, and table-driven invalid identifiers. Required cases include same Change alias in multiple projects/lines, Windows device names and case aliases, dotted target lines, containment attempts, branch/ref changes not affecting stable ids, Change metadata tampering, pair ordering, Archive outcome/spec-sync mismatches, planning-only landed records, and stable parse/serialize round trips.

## Risks / Trade-offs

- [Risk] Adding `layoutVersion` to an already strict metadata schema could rewrite legacy files. → Keep it optional, preserve absence on serialization, and do not activate a writer in this child.
- [Risk] Project record v1 and catalog v2 share one directory and could be confused. → Use a discriminated record version, retain explicit v1 parsing, and never infer the version from fields or filenames.
- [Risk] A 12-hex Archive suffix is not a global uniqueness proof. → Derive it only from a verified full id and require no-clobber publication; the full `changeInstanceId` remains in `archive.json`.
- [Risk] Git ref syntax implemented in pure code can drift from Git. → Validate a conservative portable subset here; the worktree/finalization adapters still ask Git to prove existence and reachability.
- [Risk] Adding outcome rules before command integration may create two archive types temporarily. → Keep Archive v2 additive and unreferenced by mutation commands until the finalization child switches all consumers together.
- [Risk] Reusing canonical JSON from workflow packaging creates an odd dependency direction. → Move/re-export the helper from a neutral core utility only if needed; keep one canonical implementation and add compatibility tests.

## Migration Plan

1. Add the pure portable-name, catalog/layout, identity, outcome, and Archive v2 contracts and tests.
2. Extend existing Store metadata, project-record, and Change metadata parsers additively; prove legacy fixtures remain byte-stable when serialized.
3. Export the new boundary without changing any command or mutation caller.
4. Let dependent children activate it in order: scope routing, Store migration, worktree binding, then finalization.

Rollback for this child is removal of unused additive modules and optional schema fields. Because this slice writes no v2 data from commands, rollback does not require filesystem or Git migration.

## Open Questions

None for this slice. Catalog mutation timing, machine worktree identity sources, and Archive transaction integration are intentionally decided by their owning dependent children against these frozen data contracts.
