# Proposal: externalize-artifacts-archive-timing

## Why

Archive today is a single monolithic "later" step: ship delivers, then a human (or the pipeline) eventually runs `/rasen:archive`, which syncs delta specs into main specs and moves the change directory — with no awareness of whether the delivery actually landed. In `pr` delivery mode this leaves a drift window (specs synced before the PR merges, or a change archived while its PR is still reviewable — fix-forward loses its working dir) or lingering active changes long after merge. The design of record (`rasen/office-hours/externalize-openspec-artifacts.md`, Decision 1) resolves this: archive decomposes into its two responsibilities — spec sync (content) and directory bookkeeping (workflow state) — and WHEN they run becomes a config axis automating upstream's two documented conventions: archive after the PR merges (recommended) or archive inside the PR. Children 1-2 shipped the prerequisites: run-state, ship-log, and reports are external (workDir), so a change can stay ACTIVE during PR review at zero cost.

## What Changes

- **New config axis `archive.timing`** in `rasen/config.yaml`: `on-merge` (DEFAULT) | `in-ship`, parsed with the config's established resilient field-by-field policy (invalid → warn + drop → default applies). The `archive:` block is extensible (child 4 adds `destination`).
- **`on-merge` semantics (default — automates upstream's recommended convention):**
  - `pr` mode: ship delivers the PR carrying code + the committed change folder (delta spec = intent co-review); the change stays ACTIVE during review — loop, fix-forward, `pipeline resume`, and `rasen status` keep working (run-state is external per child 2). Archive is gated on MERGE CONFIRMATION (open Q1, decided): every archive attempt checks the PR state itself via `gh pr view <url> --json state,mergedAt` (URL from ship-log) — no polling, no daemon; unmerged → refuse by default (explicit named override allowed); `gh` absent/offline → degrade to explicit human confirmation, refusing outright in non-interactive contexts. Orchestrated runs record the archive stage as pending-merge in run-state and end cleanly; the next `pipeline resume` / `/rasen:archive` invocation re-checks (check-on-invocation).
  - `local`/`push` modes: delivery completes at ship → archive (sync + bookkeeping) chains immediately; no confirmation event exists to wait for.
- **`in-ship` semantics (upstream's "archive inside the PR", opt-in):** ship runs spec sync and directory bookkeeping inside the ship stage, before the commit, so the synced specs and archived change directory ride the same delivery (one step; documented tradeoff: noisier PR). The pipeline's archive stage becomes a recorded no-op ("archived in ship").
- **Archive decomposition made explicit:** the archive skill's existing structure (sync via `rasen-sync-specs`, bookkeeping via the move step) is formalized as two separately invocable steps so both timings drive the same pipeline — no second archive implementation.
- **CLI exposure:** `rasen status --change <n> --json` gains a resolved `archive: { timing }` object (default applied), the same surface templates already read `workDir`/`changeRoot` from. The CLI itself never shells to `gh`/git — merge checking stays agent-side, preserving the CLI's no-git contract.
- **Templates updated:** `ship.ts` (timing resolution, in-ship sync+move path, timing-aware post-ship), `archive-change.ts` (timing resolution + merge-confirmation gate + in-ship no-op), `_orchestration.ts` (archive-stage pending-merge semantics for orchestrated runs). Regeneration via `node build.js` → update flow; parity hashes updated for exactly the affected templates.

## Capabilities

### New Capabilities
- `archive-timing`: the archive timing config axis — values and default, resilient parsing, resolved exposure via status JSON, the on-merge behavior matrix per delivery mode, the merge-confirmation mechanism with offline/no-gh degradation, and the in-ship one-step semantics.

### Modified Capabilities
- `config-loading`: `rasen/config.yaml` supports an optional `archive` block with a `timing` field (ADDED requirement; resilient parsing).
- `cli-artifact-workflow`: `status --json` exposes the resolved archive timing (ADDED requirement).
- `opsx-ship-command`: ship honors the archive timing axis — in-ship sync+bookkeeping inside the ship stage, timing-aware post-ship guidance (ADDED requirement).
- `opsx-archive-skill`: archive resolves the timing and gates on-merge `pr`-mode archives on merge confirmation, with degradation rules; in-ship changes report already-archived (ADDED requirements).
- `opsx-orchestration`: the pipeline's archive stage resolves per timing — immediate (on-merge local/push), pending-merge with clean run end and resume re-check (on-merge pr), recorded no-op (in-ship) (ADDED requirement).

All deltas on existing capabilities are ADDED requirements (new concerns) — deliberately no MODIFIED blocks, so this child cannot collide with child 2's spec sync that is still landing.

## Impact

- **CLI code**: `src/core/project-config.ts` (parse `archive.timing` + a small resolution helper with the `on-merge` default), `src/commands/workflow/status.ts` (expose resolved timing beside `workDir`). No new commands; no CLI git/gh calls.
- **Templates**: `src/core/templates/workflows/ship.ts`, `archive-change.ts` (both getters), `_orchestration.ts`. Generated `.claude/skills`/`.codex` regenerated; `skill-templates-parity` hashes updated for exactly these.
- **Tests**: config parsing matrix, status exposure, parity. Build/tests via `node build.js` + `npx vitest run` (pnpm is broken machine-wide — pre-existing, not repo-caused).
- **Synergy note**: child 2's T3 externalization makes both timings cleaner — ship-log/run-state live in workDir keyed by change name, so the in-ship directory move and the active-during-review window cannot orphan them.
- **Not in scope**: archive destination (`in-repo`/`external`/`prune`, child 4), SHA cross-stamping (child 5), any CLI archive command (none exists in this fork; archive stays skill-driven), bulk-archive timing awareness (follow-up if wanted).
- **Coordination**: same shared-working-tree discipline as prior children — re-check `git status` on every template file before editing/committing; pathspec-scoped commits only.
