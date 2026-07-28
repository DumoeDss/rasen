## Why

Store-mode supervised sessions currently use the Store planning root as the agent's working directory, so code, Git, dependencies, and tests run in the wrong place. The 0.1.5 launch path needs to keep the Store as planning attribution while making the actual member project or selected worktree an explicit, validated execution choice.

## What Changes

- Separate a session's planning-space selector from its execution selector: `space` continues to identify planning attribution, while an explicit execution choice identifies the subprocess working directory.
- Preserve compatible launch behavior for project spaces when no execution selector is supplied, including a selected project worktree resolved through the existing project selector.
- **BREAKING**: require an explicit member-project execution choice for Store launches; a Store with one member may preselect it in the UI, but the request still names it, and a multi-member Store never falls back to the Store root or first member.
- Offer an explicit planning-only Store choice for sessions that intentionally need the Store root as their working directory.
- Resolve and validate Store members, worktrees, pointers, and canonical paths on the server without accepting an arbitrary client working directory or client-provided agent argv.
- Attach the Store planning root to headless Claude when it differs from the execution working directory, so the agent can use Store-resident Change, spec, and run-state artifacts while commands execute in the selected project.
- Keep session records process-only: `session.space` remains the Store planning attribution and `session.cwd` records the actual project/worktree used by that run.
- Add cross-platform API, resolver, Supervisor, and UI coverage, including Windows path/argv safety, plus a real two-member Store dogfood run.

## Capabilities

### New Capabilities

<!-- None. The launch-context resolver is an internal seam within existing capabilities. -->

### Modified Capabilities

- `session-supervision`: Separate planning attribution from the validated execution working directory, require an explicit execution choice for Store launches, attach a distinct planning root to the agent, and preserve project-space compatibility.
- `task-detail-ui`: Let users choose a current Store member or explicit planning-only execution before launching, preselect a sole member without silently inferring it in the request, and surface server validation errors verbatim.

## Impact

- **Management API and wire types:** `POST /api/v1/sessions`, server/UI request mirrors, launch-context resolution, and error envelopes.
- **Runtime:** Headless Claude Supervisor input and server-built argv gain resolved attached planning roots; no Codex browser-supervision support is added.
- **UI:** The Task Detail launch dialog consumes the current Store member listing and requires an execution choice where applicable; project-space launch remains compatible.
- **Tests and fixtures:** Management API, launch-context resolver, Supervisor, Windows `.cmd` injection coverage, UI client/dialog tests, and Store session filtering/run-state joins.
- **Operational verification:** A two-member Store dogfood proves member isolation, Store artifact access, execution-local Git/dependency/test commands, and Store/member activity visibility.
- **Explicitly out of scope for 0.1.5:** Issue or Execution Plan schemas, durable Change ownership/target binding, Board redesign, automatic cross-project routing, Workset CLI-agent opener re-enablement, and Codex browser supervision.
