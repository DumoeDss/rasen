## Context

Phase 1 shipped the Issue layer's foundation: `StoreIssues`
(`src/core/store/issues/`) with the five-mutation vocabulary — create,
setState, publishPlan, publishAcceptance, accept — immutable ordinally
addressed plan revisions with content digests, reference verification against
committed Store evidence, and one issue lock; the projection
(`src/core/issue-status/`), launch binding (`src/core/issue-execution/`), and
acceptance gate (`src/core/issue-acceptance/`) read surfaces on top. Plans are
authored today through `rasen store issue plan --from-file`, a hand-written
YAML node list.

Auto-decompose already produces the structure Phase 2 needs: a parent
Change's `portfolio-run.json` (`src/core/pipeline-registry/portfolio-state.ts`)
carrying `parent`, `children[]` (each `id` IS the semantic change name — the
directory name — with `pipeline`, `dependsOn`, `status`), and `delivery`. The
record is located through the sticky-legacy chain (`stateFileSearchChain`:
execution-root ephemera dir, legacy work dir, change dir) and has a strict
reader (`readPortfolioStateDetailed`) that keeps invalid distinct from absent.

Constraints inherited from the portfolio plan (`issue-multi-change-execution`):
single issue / single project / multi Change only; `src/core/pipeline-registry/`
is frozen (read-only import of its readers); `packages/ui/**` untouched; no
version bumps; product-behavior spec language; cross-platform paths.

## Goals / Non-Goals

**Goals:**

- One publication source that compiles a real portfolio run into the next
  Execution Plan revision: explicit Change-instance references, committed
  project/target-line identity, dependency edges carried as node dependencies.
- Honest refusals at every step, each named: portfolio absent / unreadable /
  parent mismatch / no children; child missing / uncommitted / ambiguous /
  foreign store / unsearched refs; source exclusivity on the CLI.
- Zero mutation of the run-state; zero new Store mutations; zero changes to
  the plan revision schema. Re-publication appends (ordinal discipline
  inherited from `publishPlan`).
- A dogfooded end-to-end path: temp store, portfolio-shaped run-state,
  revision 0001 → child transition → revision 0002, receipts under `evidence/`.

**Non-Goals:**

- Node lifecycle semantics (required / optional / cancelled / superseded) —
  g-002 `issue-node-lifecycle` owns them; this change publishes plain change
  nodes and carries no child status into any node field.
- Any change to auto-decompose or pipeline behavior — the channel consumes a
  run-state's OUTPUT; the pipeline itself is untouched.
- Cross-project routing, workspace preparation, launching — `start` already
  owns launch binding; publication only makes the plan real.
- Persistent-store baseline in this repository — g-003
  `issue-persistent-baseline` owns it; dogfood here uses temp stores only.
- Deduplicating or refusing identical-content re-publication — a re-publish
  always snapshots the current run-state as a new revision; whether two
  revisions' node sets are byte-equal is not this channel's business.

## Decisions

### D1 — New core module `src/core/issue-publication/`, not a store mutation

Layout: `types.ts` (inputs/results/refusal taxonomy), `compiler.ts` (pure
portfolio-state → node-inputs compile), `resolution.ts` (child name →
committed instance), `orchestration.ts` (locate → read → compile → resolve →
`publishPlan`), `index.ts`.

Alternatives rejected:

- *Inside `src/core/store/issues/`* — the five-mutation vocabulary is a
  closed, specified contract (`store-issue-resources`: "An Issue changes only
  through its five declared mutations"). The channel is a composition over
  that vocabulary, exactly like `issue-status`/`issue-execution`/
  `issue-acceptance`, which all live as siblings.
- *Inside `src/core/pipeline-registry/`* — frozen this slice; also the wrong
  direction of dependency (pipeline-registry knows nothing of Issues).

### D2 — The child name is the resolution key; committed evidence is the only authority

Per the orchestration playbook (Step G.7), a portfolio child's `id` IS the
semantic change name and IS the change directory name; scheduling ids
(`g-001`-style `node` metadata) never enter it. The channel therefore resolves
each child by searching the Store's committed evidence
(`gatherReferenceEvidence` over the target-line refs, same as
`verifyExecutionPlanReferences`) for committed Changes whose `changeId`
equals the child id:

- exactly one distinct instance → node carries its `changeInstanceId`,
  `projectId`, `targetLineId`, and `changeAlias` = child id;
- two or more committed instances with that name → `issue_reference_ambiguous`,
  every claimant listed (project/line/ref), none chosen;
- zero committed, but a workspace-index entry with that change id →
  `issue_reference_uncommitted` (machine-local locator named; the index is a
  locator and authority for nothing — same rule as manual publication);
- zero anywhere → `issue_reference_unresolved` naming the child;
- committed identity carrying a foreign `storeUid` →
  `issue_reference_foreign_store`;
- any unsearched ref → `store_query_ref_unreadable`, refused rather than
  concluded-missing.

Refusal codes reuse the existing `issue_reference_*` family so the diagnostic
taxonomy stays one family across both publication sources; the messages name
the CHILD and the name-keyed search (the manual path names the instance id).
Archived committed Changes count as evidence — re-publication after children
complete (the core dogfood) must still resolve them, and the projection
already reads archived+outcome as finalized.

`changeAlias` = child id is set deliberately: the projection's run-state
locator keys on the alias when a reference later stops resolving, so the
human-meaningful name survives into the read surface.

### D3 — Publication goes through `StoreIssues.publishPlan` unchanged

The orchestration compiles node INPUTS and hands them to the existing
mutation. Ordinal allocation, `supersedes` chaining, digest computation,
canonical node ordering, graph checking (duplicate nodes, dangling deps,
cycles), the issue lock, and the commit suggestion are all inherited — this
change adds no write path and no schema field. A duplicate child id in the
run-state is refused by the graph checker (duplicate node), and a `dependsOn`
naming a non-child is refused as a dangling dependency; both arrive with the
checker's own named diagnostic, which is honest and needs no parallel
portfolio-level re-implementation.

### D4 — The portfolio locator is the resume seam, read strictly

Same derivation `rasen pipeline resume` uses: resolve the planning root from
the working directory (`resolveOpenSpecRoot`), `changeDir = join(changesDir,
parent)`, `workDir = resolveChangeWorkDir(projectRoot, parent, { ensure:
false })` (probe-only — publication never mints a work dir), `ephemeraDir =
ephemeraDir(resolvedExecutionProjectRoot(root), parent)` when the root
resolves an execution root, then
`resolvePortfolioStateLocation(changeDir, { ephemeraDir, workDir })` and
`readPortfolioStateDetailed`. Consequences:

- absent vs invalid stay distinct (`portfolio-state.ts` discipline; resume
  refuses to fall back and so does publication);
- `state.parent` must equal the requested parent, else
  `issue_plan_portfolio_parent_mismatch` (a copied/moved record never
  publishes under the wrong name);
- empty `children` → `issue_plan_portfolio_children_empty` (nothing to
  publish; an empty revision would read as a plan);
- a working directory that resolves no planning root refuses
  (`issue_plan_portfolio_root_unresolvable`) naming that `--from-portfolio`
  resolves the parent from the working directory, like `resume`.

The change directory's own existence is NOT required — the run-state file is
the authority, and the absent-refusal lists every location searched.

### D5 — CLI: one new option on the existing `plan` subcommand

`rasen store issue plan <issue-id> --from-portfolio <parent>` beside
`--from-file`. Exclusivity: both → `issue_plan_source_conflict`; neither →
`issue_plan_source_required` (replacing the from-file-specific refusal — the
diagnostic names both sources; no test or spec pins the old code). Output
extends the existing write report with a `source` block (`kind: 'portfolio'`,
parent, located state path, child count) in `--json`, and one human line
naming the same facts; the commit suggestion render is unchanged. Three-way
sync: `src/commands/store-issue.ts` wiring, locale keys
`cli.root.commands.store.commands.issue.commands.plan.options.from-portfolio`
in en/ja/zh-cn (the presentation layer structurally enforces presence), and
the `plan` flags in `src/core/completions/command-registry.ts`.

### D6 — Derived-at-read purity: the channel writes exactly one thing

The orchestration's only write is the revision file `publishPlan` creates.
The portfolio run-state, the parent change directory, the workspace index,
and every child change directory are read-only inputs (dogfood asserts
byte-identity of the run-state across publication). Nothing is guessed: no
status→node mapping, no pipeline recording, no `delivery`/`planner`/`tier`
carry-over (the plan node schema has no fields for them, and g-002 decides
what lifecycle facts a revision should carry).

## Risks / Trade-offs

- [Same-named committed Change in two projects/lines → publication refused as
  ambiguous] → Intended, not mitigated: the child id genuinely underdetermines
  the reference, and the refusal lists every claimant so the operator can
  resolve the duplication in the Store. The manual `--from-file` path remains
  the escape hatch (it names instances directly).
- [Re-publishing an unchanged portfolio mints an identical-content revision]
  → Accepted: revisions are snapshots; diffing against the previous revision
  to refuse would couple the channel to revision internals for no specified
  benefit. Ordinal growth is bounded by operator action.
- [Run-state and Store evidence drift between the locate-read and the
  publish] → Same window every mutation has; the issue lock serializes the
  write, and reference verification runs under it inside `publishPlan`. The
  portfolio read itself is a snapshot at command time, like resume.
- [Windows path handling in the searched-chain refusal text] → All locations
  joined via `path.join`; tests assert with `path.join`, never hardcoded
  separators (project rule).
- [Locale files miss one language → structural mismatch breaks CLI startup]
  → Task explicitly adds the key to all three locale files and runs the
  locale structure check (`pnpm test` covers `commander-presentation`).

## Migration Plan

Purely additive: a new option, a new module, no data or schema changes. No
migration; rollback is reverting the commit. Existing `--from-file`
publications are unaffected (one diagnostic code changes from
`issue_plan_from_file_required` to `issue_plan_source_required`; nothing pins
the old code).

## Open Questions

- None blocking. (g-002 will decide whether revisions should carry node
  lifecycle facts; D3's schema freeze leaves that room without migration.)
