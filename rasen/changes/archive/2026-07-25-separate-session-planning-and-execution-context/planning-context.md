# Planning Context

## User intent

Implement `separate-session-planning-and-execution-context` end to end in an
isolated worktree.

The immediate goal is to repair Store-mode supervised Session launch without
prematurely implementing the future Issue / Execution Plan model:

- Codex / Claude Code should normally start from the actual member project or
  selected worktree that will be modified.
- Store remains the planning space and contains Change/spec/run-state
  artifacts.
- Store planning root is attached to the Agent when it differs from cwd.
- Store-root cwd is allowed only as an explicit planning-only choice.
- A multi-member Store must not silently choose the Store root or the first
  member.

The durable product direction and near-term scope are documented in:

- `rasen/work/issue-centered-automation-platform/north-star.md`
- `rasen/work/issue-centered-automation-platform/current-capabilities-0.1.5.md`
- `rasen/work/issue-centered-automation-platform/store-session-execution-context.md`

## Verified current behavior

- `LaunchSessionRequest` currently carries only `space`; there is no execution
  selector.
- `src/core/management-api/sessions.ts` resolves `space` and uses the same
  root for subprocess cwd and frozen planning attribution.
- `src/core/management-api/supervisor.ts` builds a fixed headless Claude argv
  and has no additional-directory input.
- The Store Board member chips are a Session-provenance filter based on
  `session.cwd`, not durable Task ownership.
- `src/core/openers.ts` keeps CLI Agent workset openers disabled because a
  multi-root set has no explicit primary execution root.
- The current browser supervision path supports headless Claude only.

## Design constraints

1. Preserve project-space launch compatibility.
2. Keep `space` as planning attribution and introduce an explicit,
   server-resolved execution choice.
3. Never accept an arbitrary client cwd or client-provided CLI argv.
4. Validate a Store execution project against current registry and pointer
   facts.
5. Keep Session registry process-only; do not add durable Issue or Change
   ownership state.
6. Keep the management server a reader and launcher.
7. Use Node path utilities and canonical paths on Windows, macOS, and Linux.
8. Keep server and UI wire types mirrored.
9. Do not redesign the Board, enable Workset CLI Agent openers, or add Codex
   browser supervision in this Change.
10. The implementation needs a real two-member Store dogfood path in addition
    to automated tests.

## Deep-module direction

Use one launch-context module/seam whose small interface accepts planning-space
and execution selectors and returns the fully resolved launch facts:

```text
planningSpace
cwd
attachedRoots
optional executionProject observation
```

The implementation behind that seam owns space resolution, project/worktree
resolution, Store membership validation, pointer freshness, canonicalization,
planning-only behavior, and additional-root calculation.

HTTP handlers, UI code, and Supervisor must not independently reimplement
Store membership rules.

## Scope decision

This is one coherent Change and does not need portfolio decomposition. It
modifies one vertical launch path across management API, Supervisor, UI dialog,
specs, and tests. All pieces are required for one user-visible behavior and
should be reviewed together.

## Locked proposal decisions

- The 0.1.5 wire selector is a runtime-only scalar:
  `execution: planning | project:<registered-project-or-worktree-selector>`.
  The server resolves it; the suffix is never used directly as cwd.
- `resolveSessionLaunchContext` is the single selector-in / facts-out seam. It
  returns `planningSpace`, canonical `cwd`, `attachedRoots`, and an optional
  in-process execution-project observation.
- An explicitly selected Store with no `execution` returns
  `execution_required`. An omitted `space` preserves the trusted launch-project
  fallback, including a pointer repo running from its own cwd while attaching
  its derived Store planning root.
- The execution selector and optional execution-project observation are not
  persisted on Session, Change, or any new durable artifact in 0.1.5.

## Review round 1 corrections

- A project id is not a unique machine registry address: independent live
  clones may share it. Store member choices therefore submit the exact
  server-listed registered root as the existing `project:<selector>` suffix.
  The server still resolves that root through the registry and treats it as no
  more authoritative than an id selector.
- Store member inventory transport state is separate from domain emptiness.
  Poll failures preserve the last successful choices and expose a localized
  retry action; only a successful spaces response may establish a zero-member
  Store.

## Dogfood acceptance and follow-up

- A dedicated registered Store with two live members was exercised through the
  changed management UI. The explicit project-A launch completed a real Auto
  pipeline through archive with `session.cwd` in project A and
  `session.space` in the Store. Project B's HEAD, tree, and porcelain remained
  unchanged. Full evidence is in
  `work/research/dogfood-session-evidence.md`.
- The run exposed a separate future boundary: Store-scoped orchestration
  currently reports only the Store in `actionContext.allowedEditRoots`, while
  apply instructions can enumerate every registered member. A future
  Issue/Execution Plan must distinguish selected implementation roots from
  planning-artifact roots and must not imply that every Store member is an
  execution target.
- This finding does not add persistent target state or broaden the current
  Session repair. It is an input to the next execution-plan design.
