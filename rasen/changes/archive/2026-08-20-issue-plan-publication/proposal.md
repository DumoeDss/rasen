## Why

Phase 1 gave the Issue layer its records and its read surfaces: a plan can be
authored by hand (`rasen store issue plan --from-file`), projected, launched,
and accepted. But the one structure the product already produces for
multi-change work — an auto-decompose portfolio run (`portfolio-run.json`,
with parent, children, and `dependsOn` edges) — has no path into an Issue. An
operator who decomposed work into three children today has to retype those
children into a YAML file by hand, and the only linkage available is what a
human typed. Phase 2's goal is single Issue / single project / multi Change
execution; the first child of that portfolio is the publication channel that
makes a real decomposition structure an Issue's Execution Plan.

## What Changes

- `rasen store issue plan <issue-id> --from-portfolio <parent>` — a second
  publication source beside `--from-file` that compiles a parent Change's
  portfolio run-state into the next immutable Execution Plan revision:
  - one Change node per portfolio child, naming the child's Change
    **instance** explicitly (never inferred from a name prefix), with the
    project and target line that Change is committed under, and the child's
    `dependsOn` edges carried as node dependencies;
  - every child resolved against the Store's committed evidence before
    anything is written, with honest named refusals (no portfolio record,
    unreadable record, wrong parent, no children, missing Change, local
    worktree only, ambiguous claimants, unreadable Store refs);
  - publication through the existing plan-publication discipline (next
    ordinal, digest, immutable history, one lock) — re-publishing after a
    child transition appends a new revision and changes no earlier bytes;
  - the portfolio run-state itself is read, never written.
- A new core module `src/core/issue-publication/` (compiler, child
  resolution, orchestration), following the `issue-status` /
  `issue-execution` / `issue-acceptance` sibling pattern on top of
  `StoreIssues`.
- CLI three-way sync for the new option: commander wiring, en/ja/zh-cn
  locale keys, completions `COMMAND_REGISTRY` entry.
- Dogfood on a temp store + portfolio-shaped run-state: publish revision
  0001, transition a child, re-publish to revision 0002, receipts under
  `evidence/`.

## Capabilities

### New Capabilities

- `issue-plan-publication`: publishing an Issue Execution Plan revision from
  a real portfolio run — locating the parent's run-state through the resume
  placement chain, resolving every child against committed Store evidence,
  carrying dependency edges into plan nodes, and refusing honestly.

### Modified Capabilities

(None — `store-issue-resources` keeps its five-mutation vocabulary unchanged;
the channel publishes through the existing `publishPlan` mutation. No
existing requirement changes.)

## Impact

- New: `src/core/issue-publication/` (types, compiler, resolution,
  orchestration, index).
- Modified: `src/commands/store-issue.ts` (`plan` subcommand gains
  `--from-portfolio`, source exclusivity), `src/locales/{en,ja,zh-cn}.json`
  (option description keys), `src/core/completions/command-registry.ts`
  (`plan` flags).
- Read-only reuse: `src/core/pipeline-registry/portfolio-state.ts` readers
  (`resolvePortfolioStateLocation`, `readPortfolioStateDetailed`) — the
  registry itself is frozen this slice; `src/core/store/query/` evidence
  readers (`gatherReferenceEvidence`, `RefReader`).
- Tests: new unit suites for compiler/resolution/orchestration; CLI suite
  extension; dogfood script + receipts.
- Docs: `architecture-index` skill (new core module entry).
- Untouched: `packages/ui/**`, pipeline definitions, any shipped pipeline or
  skill template, version numbers.
