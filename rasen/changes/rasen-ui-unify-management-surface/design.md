## Context

Batch 1 (`rasen-ui-slice1-readonly-api`, merged d13666d, archived aeaf67a) delivered the read-only management API and board UI behind a hidden `rasen ui` command, deliberately leaving `rasen config ui` untouched because a concurrent session was reworking the config surface (config-page-coherence, now merged as c6c5004). That avoidance produced deliberate duplication: `src/commands/ui.ts` copies `config ui`'s entire launch flow including a private `openInBrowser`, and the UI shell's navigation has a single Config link with no way to reach `/board` (known-open m2).

Constraints carried from batch 1 and the planning context:

- The `/api/v1/config*` wire contracts (paths, auth, error-code semantics) must not break; `src/core/config-api/router.ts` and its test surface are not modified.
- Identity headers (`x-rasen-daemon`/`x-rasen-pid` stamped before routing), read-only semantics, loopback + bearer, and the `getActiveChangeIds` enumeration definition (SHALL NOTs in both `management-http-api` and `board-ui`) must all hold.
- Daemon residency is slice 3; this batch stays a foreground process, Ctrl+C to exit. `packages/daemon` extraction is deferred with it.
- Delivery mode is local (commits stay on `dev/rasen-ui-slice1-b2`).
- The CLI is published as `@atelierai/rasen` 0.1.x; the user owns version bumps, so nothing here may assume a major/minor.

## Goals / Non-Goals

**Goals:**

- One management platform entry point: a public `rasen ui`, with the config page as one of its views.
- Kill the launch-flow duplication between `config.ts` and `ui.ts`.
- A shared Layout with real navigation (closes m2), and a coherent route structure.
- Fold in m4 (double `resolveProjectHome` per board load) and t1 (trailing-slash 404 on management paths).

**Non-Goals:**

- Daemon residency, background schedulers, `rasen daemon *` (slice 3); write paths / task submission (slice 2).
- Retiring `startConfigApiServer` or any config-api module (candidate for the slice-3 packaging pass).
- Changing t2 (`===` token comparison) — parity with the existing config-api; not a new defect.
- Widening change enumeration toward `rasen list` (explicitly forbidden by both main specs; the `list.ts` convergence is a separate recorded follow-up).

## Decisions

### D1: `rasen config ui` becomes a deprecated alias, not retired

`rasen config ui` stays as a working command: it launches the **same unified management server** as `rasen ui`, opens the browser at the config view (`/config#token=...`), and prints a one-line deprecation notice naming `rasen ui`. Flags (`--port`, `--no-open`), the invalid-port error, the EADDRINUSE message shape, and signal-driven shutdown are preserved.

- **Why not retire**: the CLI is published as `@atelierai/rasen` 0.1.x and `rasen config ui` is the documented, specced way to reach the config editor (`config-ui-command` spec, UI package install hint, users' muscle memory). Removing a working command in a 0.1.x patch stream breaks trust for zero gain, and version discipline here is the user's call, not this change's. The alias costs almost nothing because of D3 — both commands become thin wrappers over one launch module.
- **Why the behavior change inside the alias is safe**: the served surface only grows (management endpoints added; every config endpoint identical, same token model, same static serving). Session URLs carry a per-session token minted at launch, so no durable bookmark or deep link exists that a changed entry path could break — compatibility is by construction.
- **Alternative considered — silent alias (no notice)**: rejected; without a signpost users never migrate, and the eventual removal (a future minor, user's decision) lands cold.

### D2: Two route groups assembled by the unified server (no router absorption)

Keep two router modules and make the **server** the composition point: `startManagementServer` builds the management route group and the config route group (`createRouter` from `config-api/router.js`, unmodified) and dispatches — management paths to the management group, everything else (config endpoints, static assets, 404s) to the config group. The management router stops privately constructing its delegate; it handles only its own paths and the server owns the seam. This confirms the planning context's lean rather than overruling it.

- **Why not absorb config routes into one router**: absorption would mean rewriting or re-homing config-api's routing tests and re-proving the `/api/v1/config*` contracts we are forbidden to break — all risk, no user-visible gain. The two-group shape also matches where slice 3 wants to go (daemon package assembling route groups).
- **Naming note**: this is the "正名" the planning context asked for — config endpoints become a route group the unified server mounts, not a hidden fallback inside the management router. The observable behavior of every config path is unchanged.

### D3: One shared launch module owns `openInBrowser` and the whole launch flow

Extract the duplicated ~60-line sequence — port validation, launch-project resolution, UI-package resolution, token mint, server start with EADDRINUSE handling, URL print, install hint, browser open, SIGINT/SIGTERM shutdown — into one command-layer module (`src/commands/ui-launch.ts`), parameterized by entry path and an optional pre-launch notice line. `openInBrowser` lives there, once. `registerUiCommand` and the `config ui` action become thin wrappers.

- **Why command layer, not `src/core/`**: the flow is CLI-presentation glue (console output, `process.exitCode`, process signals, browser spawn). Core stays free of process-global side effects, which also keeps the slice-3 daemon extraction clean (a daemon wants the server, not the console/signal choreography).
- **Alternative considered — export `openInBrowser` from `config.ts`**: rejected; it deduplicates one function but leaves the other ~50 duplicated lines, and makes `ui.ts` depend on the 1100-line `config.ts` for a utility.

### D4: Information architecture — Board is home; Config keeps its gates inventory

Routes under the shared Layout: `/` → Board (platform home), `/board` → Board (alias, batch 1's printed URL shape stays valid), `/config` → Config page, unknown → Board. Layout navigation gains two entries — Board and Config — with the active view marked. `rasen ui` prints and opens `/#token=...`; `rasen config ui` prints and opens `/config#token=...`. The Layout title changes from "Rasen Config" to a platform title ("Rasen").

- **Why Board is home**: `rasen ui` is the management platform; the board is its overview surface. Config is a view you visit deliberately — and the alias lands you there directly.
- **Why gates inventory stays inside the config page** (not a third top-level view): the user placed it there deliberately days ago via config-page-coherence (c6c5004, "配置页条理化" including the gates inventory panel). Overriding that fresh, explicit layout decision inside a convergence batch would be scope creep against user intent. Promoting `/gates` to a top-level view remains an easy later change (the panel is already a self-contained component fetching `/api/v1/pipelines`) and is recorded as an open question for the user, not decided unilaterally here.
- **m2 closes** by the navigation entries existing at all.

### D5: m4 — resolve the project home once at the server layer

`handleChanges` and `handleRuns` each resolved the machine home per request (two probes per board load). The resolved `ProjectHome | null` moves into server-lifetime state: resolved lazily on first need with the same read-only contract (`ensure: false`, never mints identity or directories), cached when found, and **re-probed on subsequent requests while null** so a project registered mid-session is picked up without a restart. Handlers receive the home instead of resolving it.

- **Why caching doesn't violate "fresh read on every request"**: that spec clause governs change/run *state*; the home is a registry-mapping lookup (root → machine-home dir) that cannot un-register mid-session in any supported flow. The null-retry covers the one real transition (unregistered → registered).

### D6: t1 — trailing-slash tolerance via path normalization

The management route match normalizes exactly one trailing slash (`/api/v1/status/` ≡ `/api/v1/status`) before the exact-match check. No prefix matching — `/api/v1/status/extra` still falls through to the config group's 404, keeping the management surface exactly three endpoints.

## Risks / Trade-offs

- [Alias divergence: `config ui` now serves management endpoints too] → Strictly additive; every config contract is covered by config-api's untouched tests, and the unified server's own tests cover the merged surface. The `config-ui-command` delta spec re-states the preserved contracts explicitly.
- [Un-hiding `rasen ui` freezes its CLI surface early] → The surface is deliberately tiny (`--port`, `--no-open`) and identical to `config ui`'s, already public for months. Daemon flags arrive in slice 3 as additive options.
- [Home caching (D5) could serve a stale home if a project were re-registered to a different machine-home mid-session] → No supported flow does this; the failure mode is a stale runs listing until relaunch, read-only and self-healing on restart. Accepted.
- [`packages/ui/src/api/types.ts` is a hand-maintained mirror of the wire types] → No wire shapes change in this batch; the `satisfies` fixtures keep pinning the mirror. Discipline note stays in place for future batches.
- [Concurrent sessions touching `rasen/specs/config-*` in the main tree] → This batch works in an isolated worktree; the archive-time spec sync must re-check the main tree's spec state (recorded in tasks as an archive-time note).

## Migration Plan

Single-branch, local delivery (`dev/rasen-ui-slice1-b2`); no data or config migration. Users see: `rasen ui` appears in help; `rasen config ui` keeps working and starts printing a deprecation pointer. Rollback is reverting the merge commit — no persistent state is written by any of this.

## Open Questions

- Should the gates inventory become a top-level `/gates` view? Deferred to the user (see D4); trivially promotable later.
- When (which future minor) does `rasen config ui` actually get removed? User's call per version discipline; this change only signposts.
- `startConfigApiServer` is no longer reachable from any command after this change (config-api tests still exercise it). Retire-or-keep belongs to the slice-3 packaging pass.
