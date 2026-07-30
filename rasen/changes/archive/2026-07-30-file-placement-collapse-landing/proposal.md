# file-placement-collapse-landing

## Why

Rasen currently scatters a change's files across three roots, with a configuration axis deciding part of it: review/QA/CSO/verification reports, handoff documents, and run-state land in a machine-home work directory (`~/.rasen/projects/<id>/changes/<c>/work/`) that never enters code history and cannot be delivered, reviewed, or re-run from a checkout; design docs land at `machineHome/design-docs`; and `archive.destination` lets archive bookkeeping leave the planning root (`external`) or delete the change outright (`prune`). The user-approved design document `docs/zh/file-placement-and-planning-roots.md` (2026-07-30) replaces all of this with one invariant — paths an agent reads/writes with its own file tools live inside the planning root or the execution root; the machine root holds CLI-owned state only (「核心不变量」) — and a fixed seven-class landing model with **zero placement configuration** (「配置和命令」).

This change is **child A of the two-change `file-placement-collapse` portfolio: the write side** — where files land, and collapsing the configuration surface to zero. Child B (`file-placement-collapse-archive`, depends on this change) owns archive-time dispositions, the ephemera cleaner, and the one-shot legacy migrator.

The shared machine home is not merely a wrong default — it is a live defect with a reproducible trigger, hit while creating this very portfolio (recorded in `rasen/changes/file-placement-collapse/planning-context.md`): a linked worktree resolves its own `root` but the **same** `machineHome` as the main worktree, so `rasen new change --pipeline` failed with `Run-state already exists at C:\Users\Sayo\.rasen\projects\openspec-code-1e42477e\...`. Same-named changes in different worktrees collide on run-state — exactly what the design's 原则 7 and its「machine root 路径」workspace-identity requirements exist to eliminate.

## What Changes

- **Zero placement configuration** (「配置和命令」) — **BREAKING** for projects configured with `archive.destination: external` or `prune`:
  - `archive.destination` stops being a write policy. New archive bookkeeping always lands at `<planningRoot>/rasen/changes/archive/`.
  - The `external` and `prune` write branches are removed, including the prune deletion path and its machine-home tombstone.
  - `rasen config set archive.destination` no longer accepts the key; `rasen archive relocate --to external` is retired (relocate keeps its migrate-into-planning-root direction).
  - A compatibility READ path remains (「兼容与迁移」): a config still carrying `archive.destination` parses with a deprecation warning instead of an error, and existing machine-home archives stay discoverable (union read) until child B migrates them.
- **Landing points rewired to each class's owner root** (「"内置"的含义」,「文件类型」):
  - **evidence** — expert reports (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`), `verification-report.md`, and `ship-log.md` → `<changeRoot>/evidence/`.
  - **handoff** — worker/session handoff documents and relay prompts → `<changeRoot>/handoff/`.
  - **ephemera** — run-state (`auto-run.json`, `portfolio-run.json`, goal-loop run artifacts) → `<executionRoot>/.rasen/changes/<change>/ephemera/`.
  - **design-docs** — office-hours/design-consultation/design-review/qa test plans and design docs → `<planningRoot>/rasen/design-docs/`, and the resolution's fallback becomes root-relative, fixing the current cwd-relative fallback bug in `PROJECT_DOCS_DIR_RESOLUTION`.
  - **probes** — project conventions first (`experiments/`, `prototypes/`, `tools/`, `fixtures/`, or module-adjacent), documented fallback `<executionRoot>/.rasen/probes/<change>/<probe>/`.
  - **coordination** — stays at machine root, CLI-owned; agents never reference its paths directly. The office-hours template's direct `~/.rasen/analytics/spec-review.jsonl` append is removed (an invariant violation with low value).
- **Read-path coherence so the repo stays working mid-portfolio**: every existing reader — `rasen pipeline resume`, the archive command's ship-log/verification evidence checks, ship pre-flight, retro, verify-enhanced, the management API run listing — reads the terminal location first with the sticky-legacy fallback chain (existing files keep living where they are; one file's state is never split across locations).
- **Per-class pure resolvers** (root + change name → path, no config branch, no I/O) become the only landing authority; `resolveChangeWorkDir` and the machine-home work directory demote to legacy-read (probe-only — the CLI stops minting machine-home work directories).
- **The worktree collision is fixed at the landing layer**: run-state moves into the execution root, which is per-worktree by construction; the workspace-identity contract (原则 7: one Git worktree = one workspace identity, semantic name + short anti-collision id, scheduling ids never in directory names) is specified and exposed read-only, with on-disk `workspaces/` state deferred until a real coordination writer exists (none does today — verified).
- **Scheduling IDs are separated from semantic names** (「调度 ID 与语义名称分离」): orchestration creates child changes under semantic kebab-case names only; DAG/scheduling ids (`g-003`-style) live in run-state metadata and never reach a directory name.

## Capabilities

### New Capabilities

- `file-placement`: the seven-class landing model — the core invariant, per-class owner roots and landing paths, the classification order (use-and-lifecycle first), probes convention detection with fallback, design-docs root-level landing with root-relative fallback, scheduling-id/semantic-name separation, and the workspace-identity contract for machine-root state. (Child B adds the archive-time dispositions to this capability.)

### Modified Capabilities

- `change-work-dir`: the machine-home work directory stops being the landing point for new ephemera/reports/handoff; it becomes a legacy-read location. Payloads report per-class directories; sticky-legacy keeps existing files working.
- `archive-destination`: the destination axis is removed as a write policy (always in-repo); compat read + deprecation warning; external/prune write requirements removed; readers keep the union view.
- `cli-archive`: `rasen archive` stops resolving a destination — bookkeeping is unconditionally in-repo, the `external`/`prune` paths and the `--confirm-prune` second consent are removed.
- `config-loading`: the `archive.destination` field parses as deprecated (warning, no behavior) instead of selecting a destination.
- `config-key-registry`: `archive.destination` is removed from the settable-key registry.
- `cli-artifact-workflow`: the status, artifact-instructions, and apply-instructions payloads carry the per-class directories (`evidenceDir`, `handoffDir`, `ephemeraDir`) — `new change`'s own payload is unchanged; `new change --pipeline` initializes run-state in the execution root; the status archive block reports the fixed in-repo archive directory plus legacy discovery.
- `opsx-pipeline-registry`: `pipeline resume` locates run-state ephemera-first, then the legacy work directory, then the change directory.
- `opsx-orchestration`: the two-location blackboard becomes the planning-root/execution-root contract (review material and evidence/handoff under `changeRoot`; ephemera under the execution root); portfolio run-state follows; decompose children get semantic names only.
- `expert-dispatch-contract`: dispatched-mode reports land in `<changeRoot>/evidence/` (sticky-legacy read of pre-existing work-directory reports).
- `opsx-ship-command`: ship-log lands in `<changeRoot>/evidence/`; the "in-ship bookkeeping honors the destination axis" requirement is removed (bookkeeping is always in-repo).
- `workflow-handoff-command`: handoff documents and relay prompts land in `<changeRoot>/handoff/`.
- `verify-ship-evidence`: `verification-report.md` lands in `<changeRoot>/evidence/`; ship's evidence check resolves evidence-first.
- `opsx-verify-enhanced-command`: enhanced-verification reports land in `<changeRoot>/evidence/`.
- `opsx-retro-command`: change-scoped retro reads process artifacts evidence-first with legacy fallbacks.
- `goal-loop-workflow`: the goal-loop run artifact lands in the execution-root ephemera directory.
- `sha-cross-stamping`: the delivery-chain record's home is the ship log in `<changeRoot>/evidence/`.
- `session-relay`: relay prompts and session handoff documents land under `<changeRoot>/handoff/`.
- `session-supervision`: run-state for a space's changes is read from the execution-root ephemera location first.
- `management-http-api`: `GET /api/v1/runs` locates `auto-run.json` via the same ephemera-first chain.
- `opsx-archive-skill`: the skill's ship-log/verification-report reads resolve `<changeRoot>/evidence/` first; its bookkeeping routing no longer branches on a destination axis. (Disposition behavior is child B.)
- `archive-relocate`: `--to external` is retired; relocation into the planning root (and store) remains as the migration surface.
- `store-adopt`: `--archive external` is retired the same way — adopt keeps `move|leave`, never relocates an archive to the machine home, and writes no `archive.destination` value.
- `work-migration`: `<changeRoot>/handoff/` stops being a migration candidate — it is the terminal handoff landing now, so sweeping it would reverse this change for that change directory and pin its future handoff documents to the machine home. The rest of the legacy sweep (run-state, reports) is unchanged; child B still depends on it.
- `opsx-office-hours-command`: the "Dual-Write Output" requirement drops its machine-root half — both office-hours landings are in the planning root, resolved from status JSON.

## Impact

- **Code**: `src/core/change-work.ts` (resolver collapse + new per-class resolvers), `src/core/project-home.ts` consumers (no new minting), `src/core/project-config.ts` + `src/core/config-keys.ts` (deprecation), `src/core/pipeline-registry/run-state.ts` (init + location chain), `src/commands/workflow/{new-change,status,instructions}.ts`, `src/commands/pipeline.ts`, `src/core/archive.ts` (read paths, prune/external write removal), `src/commands/store-migration.ts` + `src/core/store/migration-ops.ts` (relocate and adopt surfaces), management API run listing, `rasen context --json` (workspace identity exposure).
- **Templates (agent-facing prompt text — needs golden-master and locale consistency checks)**: `src/core/templates/experts/_shared.ts` (dispatch contract, `PROJECT_DOCS_DIR_RESOLUTION`, analytics append), the six dispatched experts (review, cso, qa, qa-only, benchmark, design-review) plus office-hours/design-consultation docs-dir consumers, `src/core/templates/workflows/_orchestration.ts` (blackboard, portfolio, goal loop, handoff paths), `ship.ts`, `handoff.ts`, `verify-change.ts`, retro/verify-enhanced templates.
- **Config-carrying users** (**BREAKING**): projects with `archive.destination: external|prune` fall back to in-repo archiving with a deprecation warning; their existing machine-home archives remain discoverable and are migrated by child B.
- **Interim state after this change ships alone** (accepted in the decomposition plan): all new files land in their terminal locations; the existing archive flow carries `<changeRoot>/evidence/` and `<changeRoot>/handoff/` for free (they are inside the change directory); ephemera accumulates under `<executionRoot>/.rasen/` until child B's cleaner lands. Nothing is broken in between.
- **Explicitly not in this change (child B)**: the four archive dispositions, the ephemera cleaner (whitelist/accounting/dry-run/`--keep-ephemera`), the handoff absorption judgment, `archive.json` field changes, and the one-shot legacy migrator.
