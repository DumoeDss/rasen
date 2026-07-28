## Context

Child 1 retired the command delivery surface. Skill bodies still hardcode downstream steering (`apply-change.ts:56/94/125`: "steer to verify + ship, `/rasen:verify` → `/rasen:ship`"), which is both a second source of truth for the chain and wrong under lean profiles (core installs `propose, explore, apply, sync, archive, auto-command, help` — no `verify`, no `ship-command`, no `new`/`continue`). Phase B moves "what comes next" into the CLI runtime so Phase C can delete the hardcoded steering and just transcribe the CLI's answer.

Verified against the current tree (child 1 shipped/archived): canonical workflow ids are `BUILT_IN_WORKFLOW_IDS` in `workflow-registry/builtins.ts` — note the chain nodes are `ship-command`, `office-hours-command`, `verify`, `auto-command`, not `ship`/`verify-change`. Core set is `CORE_WORKFLOW_IDS`. The installed set is computed exactly as `update.ts:140-181` does it: `getGlobalConfig()` → `profile`/`workflows`/`expertSelectionExplicit`, `loadWorkflowCatalog()`, then `resolveDesiredWorkflowSelection(catalog, profile, globalConfig.workflows, expertSelectionExplicit).ids` (`profiles.ts:114`). The workflow artifact ledger's `source === 'user'` filter (`workflow-artifact-ledger.ts:262/310`) makes it unusable as the installed-set source — it never contains built-in chain workflows.

## Goals / Non-Goals

**Goals:**
- One static chain table + one pure resolver with skip-ahead-to-nearest-installed semantics.
- `nextWorkflows` on the apply-instructions and status `--json` surfaces, plus a `Next:` stdout hint.
- Installed-set source = profile/config selection, provably not the ledger.
- Three-locale reason/hint strings. No version bump.
- Fold in the two flagged residual Phase-A delivery spec leftovers (spec-only).

**Non-Goals:**
- Editing skill template bodies (Phase C / child 3) — including the hardcoded `/rasen:verify`→`/rasen:ship` steering in `apply-change.ts` and the delivery wording in `help.ts`.
- Extending the chain to user-authored workflows declaring their own chain position (doc Open Question 3; not this change).
- Touching the pipeline registry / LEAD DAG (that is the automation chain, deliberately separate from this interactive chain).
- A full delivery-word scrub of `cli-update`/`profiles` beyond the two flagged requirements (logged as backlog).

## Decisions

### D1 — New field is `nextWorkflows`, not the doc's `nextSteps`
`ChangeStatus.nextSteps: string[]` already exists (`instruction-loader.ts:159`) as artifact-authoring guidance ("Run rasen instructions proposal…"). Reusing `nextSteps` for the `[{workflow, reason}]` array would overload one field with two shapes and break existing consumers/tests. Decision: emit the workflow chain as a distinct `nextWorkflows: [{ workflow, reason }]` field on both the apply-instructions and status payloads. This is a deliberate, documented deviation from the doc's field name; the semantics are the doc's. Alternative rejected: renaming the existing `nextSteps` — that is a wider breaking change to the status contract for no benefit.

### D2 — Chain table keyed by real registry ids; conditions keyed by a small state vocabulary
`WORKFLOW_CHAIN` maps each canonical id to an ordered list of `{ when: <state>, to: <canonicalId>, reasonKey: <localeKey> }`, plus a separate `MAIN_LINE` order array (`propose, apply, verify, ship-command, archive`) used only for skip-ahead. Side branches (`explore → propose`, `office-hours-command → propose`, `new → apply`, `continue → apply`, `sync` standalone) live in the table as data but are latent — only the change-lifecycle surfaces (apply, status) emit today. State vocabulary is the union of what the surfaces can produce: `blocked`, `ready`, `all_done` (apply), and `artifacts-pending` / `artifacts-complete` (status). Rationale: keeps the table pure data satisfying "use existing constants, don't invent detection"; using real ids means `installedWorkflows.includes(node)` just works.

### D3 — `resolveNextSteps(workflowId, state, installedWorkflows)` skip-ahead
Look up the node's `when === state` targets. For each target: if installed, keep it; if not, walk `MAIN_LINE` forward from the target's position to the first installed node and substitute it (adjusting the reason to note the skip). If nothing downstream is installed, drop it. Return `[{ workflow, reason }]`, deduped, order-preserving. Core-profile example: `resolveNextSteps('apply', 'all_done', coreSet)` → target `verify` (absent) → walk → `ship-command` (absent) → `archive` (present) → `[{ workflow: 'archive', reason: <verify/ship not installed; archive is next> }]`. Satisfies acceptance criterion 4.

### D4 — Surface → (workflowId, state) mapping
- **apply-instructions** (`generateApplyInstructions`, has `state`): `resolveNextSteps('apply', state, installed)`. `blocked` → continue (skip-ahead if absent); `all_done` → verify→…; `ready` → no forward step (mid-implementation) → `[]`.
- **status** (`formatChangeStatus`, has `isComplete`): `resolveNextSteps('propose', isComplete ? 'artifacts-complete' : 'artifacts-pending', installed)`. `artifacts-complete` → `apply`; `artifacts-pending` → `[]` (the existing `nextSteps` string array already guides authoring). Honest to what status can observe (artifact completion, not task state).

Rationale: both surfaces share the one resolver; each maps only its own observable state. Alternative rejected: giving status a full lifecycle position — it cannot observe task/apply state, so any richer claim would be fabricated.

### D5 — Installed set built like update.ts, guarded against the ledger
A small helper (e.g. `resolveInstalledWorkflowIds()`) wraps `getGlobalConfig()` + `loadWorkflowCatalog()` + `resolveDesiredWorkflowSelection(...).ids`. The `.ids` array carries workflow + expert ids in one space; the chain contains only workflow ids, so experts are inert on filtering. A unit test asserts a core-profile installed set contains `apply`/`archive` and NOT `verify`/`ship-command`, and (regression guard for the review Blocker) that the resolver is fed from this helper, never from `readWorkflowArtifactLedger`.

### D6 — Display: strip `-command`, thread store/project flag
The `nextWorkflows[].workflow` field carries the raw canonical id (`ship-command`). Human output strips the `-command` suffix (precedent: profiles picker "internal `-command` suffixes SHALL be removed from the displayed id"). The `Next:` hint threads the active `--store`/`--project` flag onto any follow-up command it prints, per the existing hint convention.

### D7 — Residual Phase-A cleanup ownership (folded-in, bounded)
The shipper-flagged `cli-update` "Update respects delivery setting" is WHOLLY about a retired setting → REMOVE. The flagged `profiles` "Named profile management" family stores `delivery` structurally (`named-profiles.ts:46` keeps it only as `z.unknown().optional()` — tolerated-but-ignored for legacy YAML) → MODIFY to drop delivery as a meaningful field. These are pure Phase-A leftovers, not skill-body (child 3). The many *incidental* `delivery`-word mentions elsewhere in both specs (update gate conditions, migration writing `delivery:"both"`, deselection "delivery mode", import/export, drift-detection title, profiles Purpose prose) are logged as a residual-scrub backlog in planning-context rather than expanded here — cleaning them fully would balloon a Phase-B change well past the LEAD's "small cleanup delta."

## Risks / Trade-offs

- **Using the ledger by mistake** (every built-in reported uninstalled) → D5 helper + explicit regression test asserting core set excludes verify/ship and inclusion is profile-derived.
- **Field-name collision with existing `nextSteps`** → D1 uses `nextWorkflows`; existing string array untouched.
- **Chain node id drift** (table uses `ship` not `ship-command`) → table references `BUILT_IN_WORKFLOW_IDS` members; a test asserts every chain node id is a member of `BUILT_IN_WORKFLOW_IDS`, so a typo fails CI.
- **Skip-ahead into an empty tail** (nothing installed downstream) → resolver drops the step and the surface simply emits no `nextWorkflows` entry; hint omitted.
- **Locale drift** → reasons/hints added to all three catalogs in one task; existing locale-parity test guards.
- **Scope creep from residual cleanup** → D7 bounds it to the two flagged requirements; the rest is a logged backlog.

## Open Questions

- Whether `rasen instructions <non-apply artifact>` (proposal/design/…) should also carry `nextWorkflows`. Not in the doc's acceptance criteria; left out (the artifact graph's own `unlocks`/`nextSteps` already guides intra-change authoring). Revisit only if child 3's skill bodies need it.
