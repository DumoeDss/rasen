# Proposal: issue-execution-binding

## Why

C1 (`issue-status-projection`) answers "where is this Issue" by reading whatever run-state the
current working directory can see. The golden path's next step is missing on both sides of that
read: nothing helps an operator START a plan node's child Change in the right place (member-project
cwd, Store as attached planning context, membership-vouched), and once a child runs in a member
project's execution root, an Issue read from anywhere else still says "not-started" because no
locator knows where that run-state lives. The binding machinery exists in pieces — the L6
`resolveSessionLaunchContext` composition, the workspace-pair index, the plan revision's
instance references — but nothing composes them from an Issue, and no attribution joins a node's
run back to the Issue from an unrelated directory.

## What Changes

- Add `rasen store issue start <issue-id> [--node <nodeId>] [--pipeline <name>]`: resolves the
  Issue's runnable frontier node from the C1 projection, resolves its bound execution context —
  the workspace pair's execution root for that Change instance, else the member project's
  registered checkout via the session-launch-context composition (member-project cwd + Store
  planning root attached, membership-vouched) — and emits the launch contract for the operator or
  LEAD to execute. Starting is resolution and verification, not spawning: the pipeline itself is
  driven by an agent session from the emitted cwd.
- Honest refusals instead of guesses: no plan, an ambiguous frontier (candidates named), a blocked
  node (its blockers named), an unprepared Change (the exact
  `store workspace plan --existing-change …` preparation named), or a launch-context failure
  (the L6 diagnostic passed through). A node that is already running reports its state with a
  resume-oriented binding rather than a fresh-launch contract.
- Widen C1's run-state locator with the workspace index: per change node, run-state is also
  located through the execution root recorded for that node's Change instance in the Store's
  workspace index (current execution root still searched first), and each node's status labels
  which locator found it — so an Issue read from the Store root or any unrelated directory
  reflects real recorded activity.
- Attribute Run and Session facts per node on the Issue read surface: the pipeline recorded in
  the located run-state, the durable session pointers its stages carry (role, runtime, sessionId /
  threadId, transcript — live agent handles excluded), and the locator of the Change's evidence
  directory when its planning address resolves.
- No second truth anywhere: the binding is derived at read time from the plan revision, Store
  membership, and the workspace index; `start` and the attribution reads write nothing into Issue
  records, plan revisions, run-state files, or the index.
- Dogfood: rebuild the C1 dogfood store, create a real workspace binding whose execution root is
  this portfolio worktree, and prove the closed loop — `issue start` emits a binding whose cwd is
  where this very change runs, and `issue show` from the unrelated Store root observes the live
  run through the index locator. Receipts captured; the reserved `blocked` health value stays
  reserved (no signal is fabricated).

## Capabilities

### New Capabilities

- `issue-execution-binding`: Resolving an Issue plan node's bound execution context (member-project
  cwd, Store attached, membership-vouched), emitting the launch contract, and attributing each
  node's Run, Session, and verification facts back to the Issue from any working directory.

### Modified Capabilities

- `issue-status-projection`: the run-state-visibility requirement widens — a node's run-state is
  also located through the workspace index entry recorded for its Change instance, each node
  labels which locator found it, and the not-started/no-local-run-state answer applies only when
  neither locator provides run-state.

## Impact

- New core module `src/core/issue-execution/` (frontier resolution + launch-binding composition;
  imports the L6 `resolveSessionLaunchContext` and the workspace index readers — composes, never
  rebuilds).
- `src/core/issue-status/` extended in place (the one status seam): optional `workspaceEntries` /
  `storeRoot` inputs, per-node `locatedBy` labelling, and per-node attribution facts. Backward
  compatible — omitted inputs reproduce C1 behavior exactly.
- `src/commands/store-issue.ts`: new `start` subcommand (writes nothing), `show` attribution
  lines; locale entries for `start` and its options in en/ja/zh-cn.
- Tests: binding units (frontier, routes, refusals), locator-widening and attribution units,
  read-only-guard extension covering `start`, CLI parity tests.
- `architecture-index` skill: new module + new subcommand entries.
- No web UI, no management-api routes, no version bumps; `src/core/pipeline-registry/` and
  `packages/ui/**` imported-or-untouched, never modified.
