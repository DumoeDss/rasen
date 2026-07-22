## Why

The management platform can show changes and run state (slice 1) and create changes (slice 2), but running a pipeline still requires a human to open a terminal and drive a `claude` session by hand. Roadmap slice 3's acceptance rule is a real runtime test — "kill a live session and the board reflects it" — and that needs a supervised process runtime first: the platform must be able to launch a headless agent session that drives a Rasen pipeline, observe it while it runs, and terminate it reliably. This change builds that runtime core and its HTTP surface; daemon residency and the sessions UI are sibling changes that both depend on it.

## What Changes

- New process supervisor core in the management server: spawns a headless `claude` CLI run (`claude -p "/rasen:auto <task>" --dangerously-skip-permissions --output-format stream-json --verbose`, shape live-verified on this machine) as a long-running supervised child, with an in-memory run registry, dual timeouts (overall cap + no-output watchdog fed by the stream-json event flow), and cross-platform process-tree kill (POSIX process-group signalling via `detached: true`, Windows `taskkill /T`).
- Whitelist extension (slice 2's admission table): a new **supervised long-runner** tier admitting exactly two operations — `auto` (`/rasen:auto`) and `goal` (`/rasen:goal`). The bounded-deterministic-termination requirement is replaced, for this tier, by supervision: registry tracking, dual timeouts, and guaranteed tree-kill.
- New sessions API on the existing management server: `POST /api/v1/sessions` (launch), `GET /api/v1/sessions` (list: live registry state, optionally joined with on-disk run-state), `GET /api/v1/sessions/:id` (detail with bounded output tail), `DELETE /api/v1/sessions/:id` (kill: SIGTERM grace then SIGKILL, escalation and registry finalization keyed off the child's close event).
- Server-exit posture for this child-only world: a foreground `rasen ui` server tree-kills its live supervised sessions on clean shutdown (an in-memory registry has no adopter yet); a hard-killed server orphans them — documented limitation that the daemon-residency sibling resolves.
- Red lines preserved: the server stays a reader + launcher. All durable run state is written by the spawned agent side (auto-run.json / goal-run.json / workspace files); the registry holds only live process facts and never becomes a second source of truth.

## Capabilities

### New Capabilities
- `session-supervision`: supervised launch, observation, and termination of long-running headless agent sessions — the supervisor's lifecycle guarantees (registry, dual timeouts, tree-kill, exit cleanup), the sessions HTTP API and its wire contract, and the foreground-server shutdown posture.

### Modified Capabilities
- `change-submission`: the "Whitelisted operations only" requirement currently forbids long-running agent operations outright and names slice 3 as the only path to admit them — this change adds the supervised long-runner tier (auto, goal) under supervision guarantees, exactly as that requirement anticipated.
- `management-http-api`: the endpoint surface grows the `/api/v1/sessions` route group; the "single CLI-backed write endpoint" security requirement is restated to cover the two write surfaces (change submission + session lifecycle) under the same loopback/bearer/no-CORS posture, and method admission per path is updated (DELETE becomes legal on sessions paths only).

## Impact

- Affected code: `src/core/management-api/` (new `supervisor.ts`, `session-registry.ts`, `kill-tree.ts`, `sessions.ts`; `router.ts` route admission; `wire-types.ts` session shapes; `server.ts` shutdown hook), tests alongside.
- No new CLI commands or flags in this change (the completions/locale double-seam applies to the daemon-residency sibling, not here).
- Depends on slice 2's submission bridge patterns (in the tree already, PR #12 stacked); siblings `slice3-daemon-residency` and `slice3-sessions-ui` build on the registry interface and wire types this change defines.
- Runtime dependency: a `claude` CLI on the machine (resolved via env override then PATH, never client input); its absence degrades to a clear launch-time error, read endpoints unaffected.
