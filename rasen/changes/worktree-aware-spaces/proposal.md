## Why

Git worktrees of one repository share a `projectId` (it lives in committed config), but every worktree that runs Rasen registers its own path in the machine project registry. One project produced 8 registry entries, and each `in-repo` entry surfaces as its own row on `/spaces` and in the header switcher — a QA pass found duplicate-selector rows and a row-collapse bug (a UI-side keying defense already landed, but the duplicates are still manufactured at the source). The user has ratified the model: a worktree is a temporary working area of one project, not a separate project — one project identity = one space — while the space must still show its worktrees (how many exist and each one's state).

## What Changes

- **Registration pierces to the main checkout.** Running Rasen in a linked worktree registers/refreshes the MAIN checkout's registry entry (resolved via `git rev-parse --git-common-dir`), never a separate worktree entry. Fallback: when the main checkout is gone (deleted or bare repo), the worktree root registers so work is never homeless. Registry lookups (home probe, doctor, launch ref) pierce the same way.
- **Worktree inventory is derived live from git**, never persisted: `git worktree list --porcelain` at the canonical root, exposed through a new read-only management endpoint (`GET /api/v1/spaces/worktrees`) reporting each worktree's root, branch, main flag, and active-change count.
- **Spaces listing collapses worktree duplicates and carries a worktree count.** `GET /api/v1/spaces` presents one project entry per project identity (legacy same-identity/same-home duplicate entries collapse read-only to the main checkout's row) with a `worktreeCount` field for the badge.
- **Space UI shows worktrees.** The Spaces page project row gets a worktree-count badge; the project board gets a worktrees panel listing each worktree (path tail, branch, active-change count, live sessions attributed by session cwd) with a switch that re-scopes the board's data source to that worktree's root. Default source is the main checkout; **no cross-worktree aggregation** (same-named changes across branches would lie).
- **`project:` space selectors accept a worktree root.** A `project:<absolute path>` selector whose path is a linked worktree of a registered project resolves to that project's identity with data served from the worktree's own planning root — the addressing mechanism behind the board switch.
- **Existing duplicate entries get cleaned.** `rasen doctor` reports worktree-duplicate registry entries; `rasen doctor --gc` collapses them onto the main checkout's entry (shared home untouched). Registration also opportunistically prunes sibling duplicates when it writes.
- **CLI behavior unchanged**: commands run in a worktree still operate on that worktree's branch-local files (changes/specs). Only the space model — registry, listing, UI addressing — unifies.

## Capabilities

### New Capabilities

None — all changes land in existing capabilities.

### Modified Capabilities

- `project-registry`: worktrees now share ONE registry entry (registration/lookup pierce to the main checkout, with a fallback when it is gone), replacing the share-the-home-but-fork-the-entry rule; doctor/gc gain worktree-duplicate reporting and collapse.
- `planning-space-addressing`: `project:` selectors resolve worktree root paths to the owning project's identity with worktree-scoped data; the spaces listing collapses same-identity worktree duplicates and reports a live worktree count; a new live worktree-inventory contract (derived from git, never persisted).
- `management-http-api`: the spaces path gains a GET-only worktree-inventory endpoint under the existing security posture.
- `spaces-ui`: project rows carry a worktree-count badge.
- `board-ui`: a project board shows a worktrees panel and can switch its data source to a specific worktree's root (default: main checkout; never aggregated).

## Impact

- `src/core/project-registry.ts` — registration piercing, shared canonical-root resolution, lookup fallback, gc collapse.
- `src/core/project-home.ts` — `resolveProjectHome` probe and `touchProjectRegistry` pierce to the registration root.
- `src/core/store/git.ts` — new `git worktree list --porcelain` read-only probe.
- `src/core/management-api/spaces.ts`, `wire-types.ts`, `router.ts` — listing collapse + `worktreeCount`, new worktrees handler.
- `src/core/config-api/project-addressing.ts` — `resolveProjectSelector` worktree-path fallback.
- `src/commands/doctor*` (registry section) — duplicate reporting.
- `packages/ui` — `SpacesPage` badge, `BoardPage` worktrees panel + source switch, API client/types.
- Existing registries on disk: legacy duplicate entries stay until gc or a registration write prunes them; the listing collapse hides them immediately. No migration writes happen on read paths.
