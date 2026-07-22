## Context

Project identity comes from repo-committed config (`projectId` in `rasen/config.yaml`), so every git worktree of one repository carries the same identity. The machine project registry (`src/core/project-registry.ts`) keys entries by canonical absolute path: `registerProject` case 2a ("worktree share") reuses the shared HOME across worktrees but still writes a SEPARATE registry entry per worktree path. `GET /api/v1/spaces` (`src/core/management-api/spaces.ts` `handleSpaces`) lists every live `in-repo` entry, so one project with 8 worktrees produced 8 space rows. QA hit a duplicate-selector row-collapse bug; the UI defense (row keying by root, `SpacesPage.tsx` MAJOR-1 comment) landed, but the duplicates are still manufactured at the source.

### Ratified constraints (user-confirmed 2026-07-23 — binding, do not re-litigate)

1. **One project identity = one space.** Canonical root = the MAIN checkout (`git worktree list` first entry / parent of `git rev-parse --git-common-dir`). Project id already comes from repo-committed identity; selectors and pins are already identity-based; per-worktree registry entries are the pollution source.
2. **Registration pierces to the main root**: running rasen in a linked worktree registers/refreshes the MAIN root's entry, never a separate worktree entry. Fallback: if the main checkout is gone (deleted/bare), register the worktree root so work isn't homeless.
3. **Worktree inventory is DERIVED LIVE from git** (`git worktree list --porcelain` at the canonical root), never persisted in the registry — self-healing, no gc debt. Existing duplicate registry entries get cleaned by gc (`rasen doctor --gc`).
4. **Space UI shows its worktrees**: the space list entry carries a worktree-count badge; inside the space a worktrees panel lists each worktree — path tail, branch, active-change count on that worktree, running sessions attributed to that root.
5. **Board data source is switchable, never aggregated**: default = canonical root; the worktrees panel switches the board to a specific worktree's root (its branch's `rasen/changes` state). NO cross-worktree aggregation — same-named changes across branches would lie.
6. **CLI behavior unchanged**: commands run in a worktree still operate on that worktree's files (changes/specs are branch-local). Unification affects the SPACE MODEL (registry, listing, UI addressing) only.
7. The "board shows main-checkout state by default" trade-off was surfaced to the user and accepted with the switchable-view refinement.

## Goals / Non-Goals

**Goals:**

- One registry entry — and therefore one space row — per project identity, with worktree state visible inside the space.
- Live, never-persisted worktree inventory; legacy duplicate entries cleaned by gc and hidden by the listing immediately.
- A worktree's board state reachable from the UI without making the worktree a space.

**Non-Goals:**

- No change to CLI root resolution or where commands read/write planning files (constraint 6).
- No cross-worktree aggregation of changes (constraint 5).
- No persisted worktree records, recency, or per-worktree pins.
- No store-namespace changes (stores keep their existing model; the inventory endpoint simply answers for whatever root a space resolves to).

## Decisions

### D1. One shared piercing helper: `resolveRegistrationRoot`

Add `resolveRegistrationRoot(canonicalPath)` to `src/core/project-registry.ts`: resolve the main checkout as the parent of `git rev-parse --git-common-dir` (the existing private `resolveMainRepoDir` already does exactly this); return it canonicalized when it exists on disk and differs from the input; otherwise return the input path unchanged. The fallback covers constraint 2's "main gone" case AND non-git / bare / git-unavailable cases in one rule (`resolveMainRepoDir` already returns null for all of them — prefer-not-to-guess, same posture as `isGitWorktreeSibling`).

All four registry touchpoints use it:

- `registerProject` — pierce after canonicalization, before any matching (constraint 2). Case 2a (worktree-share) stays as defense for the fallback path (main gone, two surviving worktrees must still share the home).
- `resolveProjectHome` (`ensure: false` probe, `src/core/project-home.ts`) — path-exact lookup first (a fallback-registered worktree entry is keyed at the worktree path), then retry at the pierced root. The `ensure: true` path pierces via `registerProject`; identity minting (`ensureProjectIdInConfig`) still happens at the CLI's actual root — the config file is branch-local but committed, so the minted id is the shared one.
- `touchProjectRegistry` (self-healing) — compute the entry key, `name`, and `mode` from the pierced root, so a worktree refresh can never rename the entry after the worktree's directory basename or downgrade its mode from a branch that lacks planning shape.
- `findProjectRegistryEntry` (doctor / launch ref) — path-exact first, then pierced fallback, mirroring the probe.

Alternative considered: keep per-worktree entries and dedupe only at the listing. Rejected — the registry would keep accumulating entries (gc debt, exactly what constraint 3 forbids), and `project:<id>` selector resolution would stay non-deterministic (today `resolveProjectSelector` returns the FIRST same-id entry in insertion order).

### D2. Live inventory probe: `gitWorktreeList`

Add `gitWorktreeList(repoRoot)` to `src/core/store/git.ts` (the CLI's sanctioned read-only git surface): run `git worktree list --porcelain` and parse into `{ root, head, branch (null when detached), isMain (first entry), locked, prunable }[]`. Return `null` on any failure (no git, not a repo) — callers degrade to "no inventory", same three-way posture as the existing probes. Nothing is ever persisted (constraint 3).

### D3. Management API surface

- **`GET /api/v1/spaces`** (`handleSpaces`): collapse legacy duplicates read-side and attach the badge count. Group `in-repo` entries by `(projectId, home)` — worktree-shared entries share BOTH by construction of `registerProject`, while independent clones share only `projectId` (distinct homes) and correctly stay separate rows. For a group with duplicates, run the inventory once and present the entry whose root is the live main checkout (first porcelain entry), falling back to the first live entry. Project entries gain optional `worktreeCount` (from the same inventory; omitted when no inventory / single worktree). Inventory calls run concurrently per entry; a failure just omits the count. Read-only throughout — registry pruning stays gc's job. This hides legacy duplicates IMMEDIATELY, before the user ever runs `--gc`.
- **`GET /api/v1/spaces/worktrees?space=<selector>`**: new GET-only path under the existing spaces security posture (loopback + bearer + trailing-slash tolerance). Resolves the space like every other space-parameterized endpoint, runs `gitWorktreeList` at the space root, and returns each worktree with root, branch, `isMain`, and `activeChangeCount` — the count of active changes at that worktree's own `rasen/changes`, using the same active-change definition as the changes listing (`proposal.md` present). Non-git root → `{ worktrees: [] }`. Sessions are NOT in this payload: the UI already fetches sessions per space and every session record carries `cwd`, so per-worktree session attribution is client-side path-prefix matching — the exact session-provenance pattern the store board's member chips already use (`board-ui` "Store space board offers a member chip filter").
- **Space resolution** (`resolveProjectSelector`, `src/core/config-api/project-addressing.ts`): the root-path branch gains a fallback — when the canonical path is not a registry key, pierce it with `resolveRegistrationRoot`; if the pierced root IS a registered entry, resolve to that project's identity (`projectId`, `name`) with `root` = the requested canonical path. This makes `space=project:<worktreeRoot>` the board-switch address with zero new parameters, and it is non-mutating (git rev-parse only), preserving the "resolution has no side effects" contract. A side benefit: `project:<projectId>` now resolves deterministically to the single main-root entry.

Alternative considered for the board switch: a separate `?root=` query parameter on every space-parameterized endpoint. Rejected — it forks the addressing model (two axes to validate on every endpoint) where the selector grammar already admits absolute paths.

### D4. UI

- **`SpacesPage.tsx`**: project rows render a worktree badge ("N worktrees") when `worktreeCount ≥ 2`. The MAJOR-1 row-keying defense stays (harmless, and still correct for genuine clone rows sharing a selector).
- **`BoardPage.tsx`**: for a project space whose inventory has ≥ 2 entries, render a worktrees panel (chip-strip pattern, sibling of the store board's `MemberChips`): per worktree — path tail, branch, active-change count (from the worktrees endpoint), live session count (client-side: sessions whose `cwd` is inside that worktree root). The selected worktree is the board's data source: default is the main checkout; selecting another worktree re-fetches `listChanges`/`listRuns` with `space=project:<worktreeRoot>` (D3's resolution). Selection is carried in a `?wt=<encoded root>` query on the board route so it survives refresh but never leaks into the space identity (`/p/<projectId>/board` is unchanged; pins, switcher, and session attribution stay identity-based). Sessions stay fetched space-wide by id. Exactly one worktree's state is ever shown — no aggregation (constraint 5).
- Store spaces: no panel changes; a store space with a git root gets the endpoint answer for free but the board panel is project-space-only in this change.

### D5. Cleanup of legacy duplicates

- **`rasen doctor`** (read-only): the registry section reports worktree-duplicate entries — entries whose pierced root differs from their key and is itself registered with the same `projectId` — and suggests `--gc`.
- **`rasen doctor --gc`** (`gcProjectRegistry`): under the same single lock hold, collapse each such duplicate: delete the worktree-keyed entry when the main root is registered; REBIND it to the pierced root (same entry data, same home) when the main root exists on disk but is not yet registered. Home reference counting is unaffected — the shared home stays referenced by the surviving entry.
- **`registerProject`**: when it writes, opportunistically prune other same-`projectId` entries whose path is a live worktree sibling of the entry being placed (already under the lock; same-id + sibling ⇒ guaranteed duplicate, shared home). This heals active projects within the self-heal window without waiting for a manual gc.

## Risks / Trade-offs

- [Per-entry `git worktree list` spawns on `/spaces`] → one spawn per project entry, run concurrently; `git worktree list` is a fast local read (~10ms). Failures degrade to an omitted count, never an error row.
- [Board defaults to main-checkout state, which may surprise a user working in a worktree] → ratified trade-off (constraint 7); the panel makes the switch one click, and the `?wt=` query keeps it sticky per tab.
- [`project:<path>` selectors for worktrees put absolute paths in URLs/query strings] → already true today for registered root-path selectors; values are `encodeURIComponent`-guarded and opaque per the existing route-token rule (`use-space.ts` D5).
- [A worktree pruned on disk while selected in a board tab] → the changes fetch fails with `space_not_found`; the board's existing error state plus a panel refresh recovers. The inventory is live, so the stale worktree vanishes on the next panel load.
- [Fallback-registered worktree entry (main gone) later coexists with a restored main checkout] → the next registration write from either path pierces to the main root and the opportunistic prune (D5) collapses the leftover; gc catches the rest.
- [Two sessions racing registration writes] → unchanged: all writes stay under the existing registry file lock.

## Migration Plan

No data migration is written on read paths. Order of protection for existing polluted registries: (1) listing collapse hides duplicates immediately on upgrade; (2) registration writes prune sibling duplicates as projects are used; (3) `rasen doctor --gc` collapses whatever remains. Rollback is code-only — the registry format is unchanged (no new fields), so older builds read the same file.

## Open Questions

- None blocking. One deliberate deferral: surfacing worktree inventory in `rasen doctor`'s human output beyond the duplicate-entry report (e.g. a full worktree table) is left out of scope until someone asks for it.
