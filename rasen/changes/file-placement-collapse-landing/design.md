# Design — file-placement-collapse-landing

## Context

The authoritative spec for this portfolio is `docs/zh/file-placement-and-planning-roots.md` (user-approved, 2026-07-30). This change implements its **write side**: every landing point moves to the class's owner root and the placement configuration surface collapses to zero. Archive-time dispositions and legacy migration are child B (`file-placement-collapse-archive`).

Current state, verified in this worktree (branch `feat/file-placement-collapse-0.1.6`):

- **Resolvers.** `src/core/change-work.ts` — `resolveChangeWorkDir` (probe-first, `ensure` mints a machine home; swallows all errors → null) and `resolveArchiveDestination` (reads `archive.destination`: `in-repo` / `external` / `prune`). `src/core/project-home.ts:77-80` — `workDir(changeName)` = `<machineHome>/changes/<c>/work`, `archiveDir` = `<machineHome>/archive`, `archivedWorkDir`.
- **Run-state.** `src/core/pipeline-registry/run-state.ts:565-581` `initializeRunState`; `:529-546` `resolveRunStateLocation` (workDir-first, changeDir fallback). `src/commands/workflow/new-change.ts:183-186` initializes run-state at `resolveChangeWorkDir(..., { ensure: true })` — the **reproduced worktree collision site**: two worktrees resolve distinct `root`s but one shared `machineHome`, so same-named changes collide (`Run-state already exists at C:\Users\Sayo\.rasen\projects\openspec-code-1e42477e\...`, recorded in the portfolio's planning-context.md).
- **Config.** `src/core/project-config.ts:141-153` (schema), `:1114-1148` (parse), `:1808-1812` (`resolveArchiveDestinationValue`); `src/core/config-keys.ts:351` (`archive.destination` settable key). **Verified: no `placement:` config key and no `rasen placement` command exist on this line** — the design doc's「配置和命令」section is a prohibition on the whole family; `archive.destination` is the only live placement configuration.
- **Templates.** `src/core/templates/experts/_shared.ts:63` — the dispatched-mode report contract (reports → `workDir`); per-skill echoes at `cso.ts:327`, `design-review.ts:210`, `qa.ts:267`, `qa-only.ts:59`, `benchmark.ts:211`, `review.ts:144`. `_shared.ts:214-218` — `PROJECT_DOCS_DIR_RESOLUTION` (`machineHome/design-docs`, **cwd-relative fallback `.rasen/design-docs` — a second bug**); consumers: office-hours, design-consultation, design-review, qa, qa-only. `_shared.ts:1642-1643` — direct `~/.rasen/analytics/spec-review.jsonl` append from agent prompt text. `_orchestration.ts:203-236` — Step F two-location blackboard; `:249-286` — Step G portfolio (`<workDir>/portfolio-run.json`); Step L goal records; Step H handoff paths (`<workDir>/handoff/`). `ship.ts:24/46`, `handoff.ts:28-64`, verify/retro templates.
- **Archive command.** `src/core/archive.ts:369` (destination probe), `:728-744` (prune tombstone — the last `ensure: true` mint in archive), `:780` (external write-path ensure).
- **Coordination.** **Verified: zero coordination writers exist** — no `workspaces/` path and no lease/reservation machinery anywhere in `src/`. The doc's `~/.rasen/workspaces/<workspace-identity>/coordination/` is target-model with no current producer.

Constraints: repo hazards in planning-context.md (CRLF discipline on historical CRLF blobs; shared index — LEAD owns commits; spec-scenario rename = implicit deletion; stale `dist/`). Delivery is both lines: land on `dev/0.1.6`, then hand-reconciled forward-port to `dev/0.2.0` where PR #110 moved all CLI copy into the locale tree — **keep copy changes separable from structural changes**.

## Goals / Non-Goals

**Goals:**

- Every class of file an agent writes lands in its owner root: evidence and handoff in the planning root's change directory, ephemera in the execution root, design-docs at the planning root's `rasen/design-docs/`, probes in project-convention locations, coordination CLI-owned at machine root.
- Zero placement configuration: `archive.destination` retired as a write policy with a warning compat read.
- Read-path coherence: all existing readers find files at the terminal location first and at legacy locations second, so the repo works with A shipped alone.
- The worktree run-state collision is structurally eliminated.
- Scheduling ids never reach directory names.

**Non-Goals:**

- Archive-time dispositions (归档/清理/静置), the ephemera cleaner, handoff absorption, `archive.json` field changes, and the legacy migrator — child B.
- English documentation (explicit user instruction: Chinese only for now).
- Automatic GC for never-archived changes (doc「负担转移」: user's `.gitignore` + manual deletion).
- Any version bump.

## Decisions

### D1 — Per-class pure resolvers in a new `src/core/file-placement.ts`

One module exports pure path derivations (no config branch, no I/O, consumers create what they use — the existing resolver contract):

- `evidenceDir(changeRoot)` → `<changeRoot>/evidence`
- `handoffDir(changeRoot)` → `<changeRoot>/handoff`
- `ephemeraDir(executionRoot, changeName)` → `<executionRoot>/.rasen/changes/<changeName>/ephemera`
- `probesFallbackDir(executionRoot, changeName, probeName)` → `<executionRoot>/.rasen/probes/<changeName>/<probeName>`
- `designDocsDir(planningRoot)` → `<planningRoot>/rasen/design-docs`
- archive bookkeeping stays `<planningRoot>/rasen/changes/archive` (existing `root.archiveDir` semantics — already sync and in-repo).

*Why a new module over extending `change-work.ts`:* `change-work.ts` exists to bridge to the frozen machine-home API; the terminal model's resolvers must not depend on `resolveProjectHome` at all. `change-work.ts` remains as the legacy-read bridge only. *Alternative rejected:* per-consumer inline joins — that is exactly the scattering this portfolio removes.

Path derivations use `path.join` (cross-platform; no hardcoded separators).

### D2 — `archive.destination` collapse with a warning compat read

- `resolveArchiveDestination` loses the config branch: it returns the in-repo archive directory unconditionally. Its `destination` field and the `ArchiveDestination` type narrow accordingly; callers stop branching. The `prune` deletion path and its tombstone (`archive.ts:728-744`) and the `external` write path (`:780`) are deleted.
- **Compat read** (doc「兼容与迁移」): `project-config.ts` keeps parsing `archive.destination` but routes it to a deprecation warning (new `warnConfig` key, localized in `en`/`zh-cn`/`ja` — **locale consistency check required**). The parsed value is retained on the config object solely for legacy discovery (union read + child B's migrator), never for write routing.
- A `legacyExternalArchiveDir(projectRoot)` probe (in `change-work.ts`, the legacy bridge) preserves the "readers see the union of archive locations" behavior for `list`/`show`/`view` until child B migrates and retires it.
- `config-keys.ts:351` entry removed → `rasen config set archive.destination` rejects with the standard unknown-key error; `rasen archive relocate --to external` is rejected with guidance (relocate keeps `--to in-repo|store` — the migration direction).

*Alternative rejected:* keeping the axis parsed-but-ignored without a warning — silent behavior change for `external`/`prune` users is worse than a loud deprecation.

### D3 — Run-state lands in the execution root; three-location sticky-legacy read

- `new-change.ts` initializes run-state at `ephemeraDir(executionRoot, name)`; `initializeRunState` is unchanged (it takes a directory).
- `resolveRunStateLocation` search order becomes: **ephemera dir → legacy machine-home workDir → change dir**. The sticky rule is unchanged and stated once: a file that exists at a legacy location keeps living there; one file's state is never split across locations. New run-state always starts at the ephemera dir.
- All run-state readers thread the new location: `pipeline resume` (`commands/pipeline.ts:610`), the management API run listing, session supervision.
- **Execution root resolution:** the resolved code project root for the run. For in-repo projects this equals the planning root. For a `--store`/`--project`-selected run, it is the cwd's code project root; running inside a store checkout itself, the store checkout is the execution root. (Store mode's planning artifacts stay store-side; ephemera stays with the code checkout — doc「Store 路径」.)
- **This is the collision fix**: each worktree is its own execution root, so same-named changes in different worktrees get disjoint run-state paths by construction. A regression test creates the same change name in two worktrees of one project and asserts both `new change --pipeline` calls succeed (the reproduced defect, inverted into a test).

### D4 — Design-docs resolve from the planning root; fallback is root-relative

`PROJECT_DOCS_DIR_RESOLUTION` (single shared constant — one edit covers all five consumer skills) becomes: primary = the planning root from `rasen context --json` + `/rasen/design-docs`; fallback = the Git toplevel (`git rev-parse --show-toplevel`) + `/rasen/design-docs`; never a bare cwd-relative path. This fixes both findings: the machine-home landing (docs invisible to the store/repo and vulnerable to `doctor --gc` semantics) and the cwd-relative fallback that strands docs when run from a subdirectory or worktree. Migration of existing `machineHome/design-docs` content is child B.

### D5 — Workspace identity: this change owns the collision fix (the LEAD's open assignment)

**Ruling: child A.** Reasoning:

1. The reproduced collision is a **landing/identity defect at change creation** — nothing about it is archive-disposition work. Its trigger site (`new-change.ts:183-186`) is a landing point this change already rewires; D3 eliminates the collision by construction for run-state, and the evidence/handoff moves do the same for every other per-change agent-visible file (planning root is per-worktree here too).
2. Child B's migrator moves **old** state; it cannot change where **new** state lands. Assigning the fix to B would ship child A with the live defect still armed — creating a child change in a second worktree would still fail.
3. What 原则 7 requires beyond the relocation — machine-root workspace-scoped state keyed by workspace identity (`<project-name>--<short-id>`, `workspace.json`, `coordination/`) — currently has **zero writers** (verified above). Child A therefore specs the identity contract and exposes the derived identity read-only in `rasen context --json` (project semantic name + short hash of the canonicalized worktree path — observable and testable), but creates **no on-disk `workspaces/` state**: minting empty machinery with no producer is speculative scaffolding. The first real coordination writer (child B's migrator if it needs one, or a future feature) creates the directory through the specced identity.

If the LEAD re-scopes this, the seam is clean: D3 stands on its own; the identity exposure is one additive payload field plus spec text.

### D6 — Scheduling ids never reach directory names

Orchestration template contract (Step G): child changes are created with **semantic kebab-case names** (`rasen new change <semantic-name>`); portfolio run-state children keep `id` = the semantic change name (directories already use it) and MAY carry an optional `node` field for a scheduling id (`g-003`-style); scheduling ids are forbidden in change names, probe directory names, and archive names. *No CLI hard block* on name shape — a validator guessing "looks like a scheduling id" would false-positive on legitimate names; the rule lives in the spec + template contract, enforceable at review.

### D7 — The work directory demotes to legacy-read; payloads carry per-class directories

- `instructions.ts:171/493` flip `ensure: true` → `ensure: false`: the CLI stops minting machine-home work directories (nothing new lands there). Probe-only resolution keeps `workDir` in payloads **when the project already has a machine identity**, for sticky-legacy readers.
- `status`/`instructions`/apply-instructions payloads add `evidenceDir`, `handoffDir`, `ephemeraDir` (absolute, from D1). Templates reference the payload fields, not derived paths ("the CLI reports, agents never derive" — unchanged principle).
- Template rewires (all agent-facing prompt text; golden-master parity + docs `skills/experts/docs/AGENTS.md` consistency): dispatch contract report location → `evidenceDir` (sticky-legacy: a report already in `workDir` stays there for that change); ship-log → `evidenceDir`; handoff documents/relay prompts → `handoffDir`; Step F blackboard → review material and evidence/handoff under `changeRoot`, ephemera under the execution root; Step G portfolio-run.json and Step L goal artifact → `ephemeraDir`.
- `archive.ts:381` ship-log read and the archive skill's evidence checks resolve `evidenceDir` first, then legacy locations — archive behavior is otherwise untouched (dispositions are child B).

### D8 — Remove the office-hours analytics append

`_shared.ts:1642-1643` has agent prompt text `mkdir -p ~/.rasen/analytics && echo ... >> spec-review.jsonl`. That is an agent writing machine root directly — the exact invariant violation this portfolio exists to remove — and its value is low (append-only JSONL nobody reads). Deleted outright. `rasen feedback` remains the sanctioned CLI-owned channel if quality telemetry is ever wanted.

### D9 — Considered and left unchanged

- `touchProjectRegistry` (a machine-root write on every root resolution): **CLI-owned** registry state — the invariant restricts agent-direct writes, not the CLI. Stays.
- `machineHome` in the `rasen context --json` root object: stays (CLI-owned state introspection; doctor/gc need it). Agents just stop deriving landing paths from it.
- `ProjectHome.archivedWorkDir` and `archiveDir`: retained as legacy-read accessors for the union read and child B's migrator.

## Risks / Trade-offs

- **[Ephemera accumulates in `.rasen/` until child B lands]** → Accepted interim state per the decomposition plan and doc「负担转移」; covered by the user's `.gitignore`; B's cleaner is the remedy.
- **[BREAKING for `external`/`prune` configs]** → Deprecation warning at parse; union read keeps old archives visible; child B migrates. No silent data movement in A.
- **[Template churn vs the 0.2.0 forward-port (PR #110 locale mechanism)]** → Keep copy edits separable from structural edits (single shared constants like `PROJECT_DOCS_DIR_RESOLUTION` and the dispatch contract block); planning-context records the hand-reconciliation expectation.
- **[Three-location run-state chain complexity]** → The sticky rule is stated once and tested per location; the chain is ordered newest-first so steady state (post-B migration) touches one location.
- **[Rollback caveat]** → Reverting A after files landed terminally leaves those files where old readers do not look. Mitigation: sticky-legacy readers land in the SAME commit as the landing rewires (task ordering), so any deployed A reads both; rollback to pre-A requires moving in-flight files back, which the ship/archive evidence checks surface loudly rather than silently.
- **[CRLF churn on historical CRLF template files]** → Implementation edits restore per-line endings and stage with `git -c core.autocrlf=false add` (LEAD owns commits); never measure endings with `grep -c $'\r'`.

## Migration Plan

- No data migration in this change (child B owns the migrator). Compat reads (legacy run-state locations, legacy workDir reports, machine-home archives union view, deprecated config key) keep every pre-existing file readable in place.
- Deploy = ship child A; in-flight changes keep their files where they are (sticky-legacy); new writes land terminally.
- Rollback = revert the change; see the rollback caveat above.

## Open Questions

- None blocking. The one open assignment (workspace identity) is decided in D5 with an explicit re-scope seam for the LEAD.
