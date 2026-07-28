## Context

Today the machinery for stores already exists but migration between modes is manual:

- Mode is DERIVED, not stored: `deriveProjectMode` (core/project-home) classifies a root as `store` when its `rasen/` has no planning shape (no `specs/` or `changes/` directory) AND `config.yaml` declares a string `store:` pointer (`readStorePointer` in core/project-config). Everything else is `in-repo`. The registry self-heals mode on every root-resolving command (`touchProjectRegistry`).
- `archive.destination` (`in-repo | external | prune`) governs where FUTURE archives land (`resolveArchivePlan` in core/change-work); `external` resolves through the machine home (`~/.rasen/projects/<home>/archive`). Readers already see the union of locations (archive-destination spec), so relocation cannot orphan reads — but nothing moves existing content.
- `store add-project` records references in the store; `store doctor` checks registration metadata but not pointer/shape drift.
- The machine registry (`~/.rasen/projects/registry.json`) accumulates entries for deleted or throwaway paths (observed in the wild: scratchpad test projects, `.codex` session dirs); nothing cleans them.

Migrating a real project (elftia case study) means: create store, move `rasen/specs` + `rasen/changes` across repos, write the pointer, verify, and craft git commits in two repos — all by hand.

## Goals / Non-Goals

**Goals:**
- One command each for: in-repo → store (`store adopt`), store → in-repo (`store eject`), moving an existing archive between destinations (`archive relocate`), and cleaning orphaned machine-home state (`home prune`).
- Reversibility: adopt records enough provenance that eject can restore exactly what was adopted.
- Git safety: never stage, commit, or delete-without-copy; print suggested commit commands per affected repo.
- Config/data atomicity for archives: `archive relocate` flips config and moves content as one user-visible operation.

**Non-Goals:**
- Per-project namespacing of the store's directory layout (specs stay flat; collisions are rejected, not namespaced). Changing `--store` addressing or root resolution is out of scope.
- Automatic git commits (violates the tool's no-git-writes posture for user repos).
- Merging two projects' overlapping specs (adopt fails on collision; resolution is manual).
- Multi-machine sync of the manifest (it lives in the store repo, so git carries it).

## Decisions

### D1: Flat store layout + ownership manifest (rejected: per-project namespacing)

Adopt moves `specs/*` and `changes/*` into the store's existing flat `rasen/` layout and records ownership in a manifest file at the store root metadata dir: `adoptions.yaml`, keyed by `projectId`, listing adopted spec names, change names, and the source repo path + timestamp. Name collisions (spec or change already present in the store) FAIL the whole adopt before any file moves — atomic precheck.

Rationale: namespacing (`specs/<project>/...`) would ripple through root resolution, `--store` addressing, list/show, and sync-specs; flat + manifest gets reversibility at near-zero blast radius. Collisions are expected to be rare (stores group related projects); when they happen, failing loudly beats silent merging.

### D2: Adopt sequence is copy → verify → delete → pointer write, in that order

1. Precheck: target store registered and healthy (`store doctor` pass), no name collisions, source repo has planning shape, store pointer not already set.
2. Copy specs/changes (and archive per `--archive` option) into the store; verify file-count + per-file size match (no hashing by default; `--verify-hash` opt-in).
3. Delete source copies only after verify passes.
4. Write `store: <id>` into `rasen/config.yaml` (preserving comments via targeted YAML edit, same approach as `ensureProjectIdInConfig`), remove now-empty planning dirs.
5. Register: `add-project` semantics (project namespace + store references) if not already registered; `registerProject` refresh so mode flips to `store` immediately rather than waiting for self-heal.
6. Print suggested git commands for both repos (pathspec-scoped), never execute them.

A crash between 2 and 3 leaves duplicated-but-consistent state; rerunning adopt detects the manifest entry and offers resume (idempotent completion). Cross-device moves are inherent (repo and store may be on different drives), so copy+delete, never `fs.rename`.

### D3: `--archive move|leave|external` on adopt (default `move`)

`move` takes `changes/archive` into the store with everything else; `leave` keeps it in the source repo (still readable via union semantics only if destination stays in-repo — doctor will flag it as residual); `external` relocates it to the machine home and sets `archive.destination external` in the project scope. Default `move` because the store has git and archives are decision history.

### D4: Eject requires the manifest; `--all` is the explicit fallback

`store eject <project-id>` restores exactly the manifest-listed specs/changes back to the repo, removes the pointer, refreshes the registry (mode → `in-repo`), and removes the manifest entry. For stores predating manifests, `--all` copies the store's entire planning content back with an interactive confirmation listing what will move. Specs modified in the store AFTER adoption move as-is (the manifest tracks names, not content — content history is the store's git).

### D5: `archive relocate --to <dest>` is move + config flip, union semantics keep it safe

Enumerate archive entries at the CURRENT effective location(s), move them to the target location (in-repo dir / machine-home dir / store's `changes/archive` when the project is store-mode), then set `archive.destination` accordingly (`store` target requires store mode; in-repo/external map to the existing enum). Name collisions at the target get a timestamp suffix (matching existing archive dedup convention). Because readers already union all locations, a partial failure mid-move degrades to "split across locations but fully readable" — rerunning completes it. `prune` is NOT a relocate target (it is destructive and stays on the config-only path with its existing tombstone/confirmation contract).

### D6: `home prune` is dry-run by default, deletes only provably orphaned state

Two orphan classes: (a) registry entries whose key path no longer exists on disk; (b) home directories under `~/.rasen/projects/` not referenced by any registry entry. Default invocation lists both classes with sizes; `--apply` deletes. Never touches a home referenced by a live registry entry even if `lastSeen` is old (age is not evidence of death). Registry writes go under the existing registry lock.

### D7: Doctor drift checks are additive diagnostics, not errors

Three new checks on `store doctor` (and surfaced by top-level `rasen doctor` where it already aggregates): pointer → unregistered store id (error-level: work lands nowhere addressable); planning shape + pointer both present (warning: mode derivation picks `in-repo`, which may surprise — cite `deriveProjectMode`'s rule); manifest entries referencing files absent from the store (warning with the missing list). Each carries a `fix:` line naming the command that repairs it (`store register`, `store adopt --resume`, `store eject`).

## Risks / Trade-offs

- [Adopt interrupted mid-delete leaves partial source dirs] → Manifest written before delete phase; rerun detects and resumes; doctor flags residual planning shape alongside a pointer (D7 check 2 catches exactly this state).
- [Flat layout makes multi-project stores collision-prone] → Fail-fast precheck with an explicit list of colliding names; per-project namespacing remains a future change if real usage demands it.
- [User's uncommitted work inside `changes/` moves repos and becomes untracked in the store] → Adopt prints a git-status warning for the moved paths in both repos and lists uncommitted files in the precheck summary; `--dry-run` shows the full move plan first.
- [Windows case-insensitive filesystems can alias two spec names] → Collision precheck compares case-insensitively on all platforms (a case-only "non-collision" would corrupt on Windows).
- [`home prune` deleting a home that a not-yet-seen worktree still points at] → Only class (a)+(b) orphans are eligible; a home is referenced by projectId in the registry regardless of worktree paths, and piercing (`resolveRegistrationRoot`) keys worktrees to the main checkout.
- [Manifest drifts from store reality via manual edits] → Doctor check 3 reports it; eject refuses to proceed past missing files without `--force`.

## Open Questions

- Should `store adopt` offer `--copy` (leave source intact, store becomes authoritative only after user deletes manually)? Deferred unless review wants it — copy-mode breaks the "one source of truth" invariant that mode derivation depends on.
- Exact `adoptions.yaml` schema versioning (start at `version: 1`; forward-compat policy inherits store metadata conventions).
