## Why

The completed Teacher consultation runtime was built from the ECP commit that also anchors current `origin/dev/0.2.0`, but later Codex dispatch, task-loop, reusable-session, and cross-platform lifecycle work now overlaps its integration seams. A dedicated integration change is needed so the shipped consultation authority and history can land without weakening either side or treating the earlier branch-local evidence as proof of the combined runtime.

## What Changes

- On the existing `feat/teacher-advisor-workflow` branch, retain a backup reference at pre-merge `914c836a`, then merge pinned `origin/dev/0.2.0@96452f5c` with `--no-ff --no-commit`. The final merge keeps Teacher as its first parent and dev as its second parent while preserving the original `3c595019`, `f6d6854c`, and `914c836a` commit identities and composing both branches' semantics across the eight textual conflicts.
- Keep `consultable-leaf` on the exact continuable hosted path and reject Codex consultation dispatch before agent work instead of exposing an unsupported replacement-session or schema path.
- Make daemon restart of a task-loop consultation reopen the canonical workspace through a daemon-owned trusted observer, preserving task-loop workspace and report guards without trusting request-supplied cwd.
- Compose reusable-session, ordinary hosted SessionHost, and exact-Teacher SessionHost ownership so clean server shutdown drains every owned process tree and reports a failed drain.
- Preserve the archived runtime review, platform, and ship evidence as historical evidence for its original tree, and require fresh integration, cross-platform, and independent review evidence for the combined integration result.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ecp-consultation-runtime`: Preserve exactly-once consultation and exact source continuation when a task-loop Run is reopened after daemon restart, using canonical trusted workspace observation.
- `frozen-action-session-executor`: Constrain consultable non-terminal turns to the declared continuable hosted execution path and fail unsupported Codex consultation dispatch before work.
- `session-supervision`: Require clean server shutdown to drain reusable, ordinary hosted, and exact-Teacher session owners together without losing any lane's authority result.

## Impact

- Merge-history integration of pinned `origin/dev/0.2.0@96452f5c` into the existing Teacher branch, with a retained pre-merge Teacher backup reference.
- ECP facade/reconciler/runtime-context composition with task-loop behavior and consultation state.
- Management router/server construction and shutdown across reusable-session, ordinary SessionHost, and exact-Teacher SessionHost lanes.
- Runtime-neutral worker contract dispatch at the Claude/Codex boundary and cross-platform SessionHost argv/path behavior.
- Focused consultation, task-loop restart, Codex rejection, session-owner shutdown, provider-conformance, Windows native, Linux CI, TypeScript, lint, build, strict Rasen, diff, and independent review evidence.
