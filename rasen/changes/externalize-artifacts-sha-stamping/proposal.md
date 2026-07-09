# Proposal: externalize-artifacts-sha-stamping

## Why

A change's delivery chain currently has one stamped end: ship records the delivered commit (`Commit:`/`Tree:`/`PR:` in the workDir ship-log), but the archive side — the spec-sync/removal commit — records nothing and references nothing, so tracing "which ship delivered the code these specs describe" means git archaeology. Store mode has the sharper gap the design of record calls out: the code PR loses the delta spec entirely (T1/T2 live in the store repo), and its compensating mechanism — ship pulling proposal + delta specs from the store into the PR body, with SHA cross-stamps between the two repos — is the one new mechanism store mode was promised (`rasen/office-hours/externalize-openspec-artifacts.md`, Externalization verdict + implementation-order item 4). This is deliberately the thinnest child: everything it needs is already on disk (workDir ship-log from child 2, recorded-facts discipline from child 3, destination-aware bookkeeping from child 4) and it is template-prose only — zero CLI code.

## What Changes

- **The ship-log becomes the single, two-ended delivery-chain record.** Ship's end already exists (verified: `Commit:`, `Tree:`, `PR:`, and child 3's `Archived in ship:`). Archive's end is added: after bookkeeping, the archive workflow APPENDS an `## Archive` section to the workDir ship-log — the spec-sync/archive commit SHA, the archived location (or pruned state, per child 4's destinations), a timestamp, and the ship commit SHA it corresponds to. The ship-log lives in workDir (child 2), so this record survives the change directory's move or deletion — the chain is readable from one file regardless of destination.
- **Cross-stamp direction 2 rides the commit message, not spec headers.** The archive/spec-sync commit message references the ship SHA (e.g. `chore(rasen): archive <name> (specs synced; ship <short-sha>)`). Decision: synced spec headers are NOT stamped — that would churn every T1 spec file at every archive and embed delivery metadata in contract content; the commit message is where provenance belongs and is greppable via `git log`.
- **Store-mode PR-body embedding (the design doc's "one new mechanism"):** when the resolved planning root is a store (`planningHome.kind` from the status JSON ship already fetches), ship's PR body additionally embeds the proposal's Why/What sections and the change's delta spec content (both read from `changeRoot`, which already resolves store-side) in collapsed sections, stamped with the store repo's HEAD SHA (`git -C <storeRoot> rev-parse HEAD`, agent-side git) and the change's store path; the ship-log records both SHAs (code repo + store repo). A dirty store working tree is recorded honestly (SHA + dirty note), never hidden. Scoped to existing read surfaces only — status JSON paths + plain git; no store-API plumbing (anything deeper is recorded as follow-up).
- **Store-safe fix folded in:** ship's PR-body proposal read still says `rasen/changes/<name>/proposal.md` (repo-relative); it switches to `changeRoot` from status JSON — the same store-safe pattern 2d855e1 applied to archive/sync-specs.
- **Conventions preserved:** all new branches key on recorded ship-log facts; skill and command getters stay in sync; regen + parity per the established flow; deltas on existing capabilities are ADDED-only.
- **Child 4 coordination:** child 4 (archive-dest) is MID-APPLY on the same templates. Apply for this child MUST verify the landed text of `ship.ts`/`archive-change.ts` (and `bulk-archive-change.ts`) against child 4's design before editing — the archive append and commit-message stamp attach to child 4's destination-aware bookkeeping step wherever it actually landed, and per-file `git status` re-checks apply as always.

## Capabilities

### New Capabilities
- `sha-cross-stamping`: the two-ended delivery-chain contract — ship-side stamps (existing, referenced), the archive-side ship-log append, the commit-message cross-reference, and the store-mode PR-body embedding with dual-repo SHA stamps.

### Modified Capabilities
- `opsx-ship-command`: store-mode PR-body embedding + store SHA stamps; store-safe `changeRoot`-based proposal read (ADDED requirement).
- `opsx-archive-skill`: archive appends the chain record to the ship-log and stamps the ship SHA into the archive commit message (ADDED requirement).

## Impact

- **Templates only**: `src/core/templates/workflows/ship.ts`, `archive-change.ts` (both getters), `bulk-archive-change.ts` (commit-message + append parity for its bulk moves). No CLI code, no config, no schema changes.
- **Tests**: parity hashes for exactly the affected templates; no new runtime tests (behavior is prose-driven; verification is generated-skill inspection + a live smoke). `node build.js` + `npx vitest run`.
- **Not in scope**: stamping synced spec headers (rejected above); store-side write-back of code-repo SHAs into the store (needs store write APIs — follow-up); retro/dashboard consumption of the chain record (future readers).
- **Coordination**: child 4 mid-apply on the same files — verify landed reality first; shared-tree discipline (per-file `git status`, pathspec commits) throughout.
