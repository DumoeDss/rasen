# Design — platform-slice2-task-submission

## Context

Slice 1 (PR #11, merged at origin/dev/0.1.5 = 77dd9a6) established the management server: `startManagementServer` composes two route groups — the management group (`createManagementRouter`, GET-only `/api/v1/status|changes|runs`) and the untouched config group — with dispatch owned by `server.ts` via `isManagementPath`. The UI is a Preact SPA (packages/ui) whose only fetch seam is `src/api/client.ts`; the board is the home view. The management-http-api spec currently mandates read-only ("SHALL expose no endpoint that mutates project state"; "Write methods rejected" scenario) — this slice deliberately replaces that posture.

Hard constraint (roadmap discipline): the CLI is the ONLY write entry. The server never writes workspace files and never duplicates CLI business logic; it spawns the existing `rasen` CLI with argv arrays (`shell: false`), passes stderr/exit codes through verbatim, and stops there.

Integration fact that shapes this design: `rasen new change <name>` creates only `.openspec.yaml` (plus `README.md` under `--description`) — **no `proposal.md`**. But the board and `GET /api/v1/changes` enumerate via `getActiveChangeIds`, which requires `proposal.md`, and both carry SHALL NOT clauses forbidding a wider scan (the `rasen list` bare-scan is the recorded outlier). A bare `new change` submission would therefore be invisible on the board, failing the slice's end-to-end acceptance. The gap is closed **through the CLI**: a new `--proposal <text>` flag on `rasen new change` seeds a minimal, human-authored `proposal.md`.

## Goals / Non-Goals

**Goals:**
- First write path: web form → `POST /api/v1/changes` → CLI subprocess → real change on disk → visible on the board.
- A subprocess security model strict enough to survive slice 3's expansion (whitelist, cwd lock, timeout, concurrency cap, no shell).
- CLI errors surfaced verbatim in the UI (harness-demo lesson: never swallow stderr).

**Non-Goals:**
- Long-running command execution, job records, polling endpoints, process supervision, kill/adopt, daemon residency — all slice 3.
- Any UI-direct file write, or any server-side reimplementation of change creation.
- Widening the active-change definition (the two SHALL NOT clauses stand).

## Decisions

### D1 — Resource model: `POST /api/v1/changes`, synchronous acceptance

The write endpoint is `POST /api/v1/changes` with body `{ name, description }` → 201 `{ change: { id, path, schema } }`.

- **Why not `POST /api/v1/tasks`**: a "tasks" resource implies a job-queue abstraction (task ids, states, polling) that slice 2 does not build and slice 3 may build differently (around sessions, not generic tasks). The thing being created IS a change; `GET /api/v1/changes` already lists that resource. Symmetric REST, zero new nouns.
- **Synchronous, not accept-then-poll**: `rasen new change` is a bounded filesystem operation (sub-second). The server waits for subprocess exit and answers with the outcome. Accept-then-poll requires durable task records and a status endpoint — machinery whose real customer is slice 3's session supervision; building it now for a sub-second command is speculative. The hard timeout (D3) bounds the wait; if slice 3 introduces long-running submissions, IT introduces the async envelope (e.g. 202 + run resource), and `/api/v1/runs` already exists as the natural read side.
- **Method dispatch**: `isManagementPath` is unchanged (`/api/v1/changes` is already a management path); the router's blanket `405 non-GET` guard becomes per-path method routing — GET and POST on `/changes`, GET-only elsewhere, 405 otherwise. Auth check stays first (401 before 405, as today).

### D2 — Command whitelist: exactly one operation (create-change); auto/goal are slice 3

The whitelist for slice 2 is a single named operation, `create-change`, realized as the argv template:

```
[node, <cli-entry>, 'new', 'change', <name>, '--proposal', <description>, '--json']
```

Admission rule for the whitelist (this is the slice 2/3 boundary, stated so slice 3 must argue against it explicitly): a command is eligible only if it (a) terminates deterministically in bounded time with no LLM or network dependency, (b) leaves no resident process or session behind, and (c) has its result observable through the existing read endpoints. 

- `rasen new change` — passes all three; it IS the minimal loop.
- `auto`/`goal` runs — fail (a) and (b): they spawn LLM agent sessions that run for minutes-to-hours and need monitoring, kill, and adopt-or-spawn semantics. That lifecycle is the definition of slice 3's session supervision; admitting them here would ship unsupervised long-running processes with no way to observe or stop them — worse than not shipping them.
- `rasen validate` — passes the rule but is read-only, so it belongs (if ever) on the GET side, and adds nothing to the minimal write loop. Excluded to keep the whitelist at one entry.

The whitelist is data (an operation table mapping operation → argv builder + input validators), not scattered `if`s, so slice 3 extends a table rather than rewriting the bridge.

**`--proposal <text>`** writes `proposal.md` containing the submitted description under a minimal scaffold (title + the text under `## Why`, with an explicit marker that it is a submission seed to be developed). This is real human-authored content entering through the CLI — not fabricated data — and it is what makes the change active by the workflow's own definition. Trade-off accepted: the workflow will count the proposal artifact as present; that is honest (the file exists and carries the user's intent) and the change lands in the board's Planning column with specs/design/tasks still pending. New visible flag ⇒ completions command-registry entry + en/ja locale catalog entries (PR #10 parity tests enforce both).

### D3 — Subprocess security model

- **No shell, ever**: `spawn(process.execPath, [cliEntry, ...argv], { shell: false })`. `cliEntry` is resolved from the running server's own module location (the same `dist/cli/index.js` tree serving the request — via `createRequire`/`import.meta.url` resolution, the `ui-launch.ts` pattern), so the server always invokes the same version of itself, not whatever `rasen` is on PATH.
- **Input validation before spawn**: `name` must pass the same kebab-case rule as `validateChangeName` (server-side pre-check for a clean 400; the CLI still re-validates as the authority). `description` required, length-capped (10k chars), control characters rejected. Flag-injection guard: values are passed as separate argv elements and the name pattern already excludes leading `-`; the description is passed as `--proposal=<text>` (single token) so a leading `-` can never be parsed as an option.
- **cwd lock**: subprocess cwd is `context.launchProjectRoot`, resolved at server start. No project ⇒ 409 `no_project` without spawning. No client-supplied paths anywhere near the subprocess.
- **Timeout cap**: 30s hard limit; on expiry SIGTERM then SIGKILL after 2s grace, respond 504 `cli_timeout`. (Generous for a filesystem command; exists to bound D1's synchronous wait.)
- **Concurrency cap**: one in-flight write subprocess per server; overlapping POST gets 409 `busy` immediately. Serializing writes at cap 1 is honest for a single-user loopback tool and removes same-name race handling.
- **Error/exit-code passthrough**: stdout and stderr are captured fully. Non-zero exit ⇒ 422 with `{ error: { code: "cli_error", message: <parsed CLI --json error or raw stderr>, cliExitCode, stderr } }` — never swallowed, never paraphrased. Zero exit ⇒ parse the CLI's `--json` payload; unparseable-but-zero is a 500 `cli_protocol_error` including the raw output.
- **CSRF posture (argued, not hand-waved)**: authentication is a bearer token in the `Authorization` header, never a cookie. A cross-site form POST cannot set that header; a cross-origin `fetch` with it triggers a CORS preflight, and the server sets no CORS headers, so the browser blocks it. Loopback bind + token-in-fragment launch flow are unchanged. Therefore no CSRF token machinery is needed; this reasoning is recorded in the spec as the security requirement's rationale.

### D4 — UI form: board-embedded, refresh-to-real-card feedback

The form lives on the board page — a "New change" button opening an inline dialog (fields: name, description) — not a `/new` route.

- **Why board-embedded**: the board is the home and the only surface where the result is visible; a separate route disconnects submission from feedback and adds navigation for a two-field form. The dialog is a board component; no router change.
- **Post-submit feedback**: on 201, close the dialog, refetch changes+runs through the existing store refresh, and highlight the card whose name matches the response id — the user sees the real change, fetched from disk, not an optimistically injected fake. On failure, the dialog stays open showing the CLI's error text verbatim (from the error envelope) with the form still editable. While in flight, the submit control is disabled (mirrors the server's cap-1 concurrency).
- **Client seam**: one new `createChange(body)` function in `api/client.ts` (POST + json), reusing bearer injection and 401 → relaunch-notice handling unchanged.

## Risks / Trade-offs

- [Seeded proposal.md marks the proposal artifact present with thin content] → the scaffold labels itself as a submission seed; the board shows the change in Planning with everything else pending, which is truthful. Alternative (invisible change) fails the slice's acceptance outright.
- [Synchronous POST blocks on subprocess] → 30s timeout + cap-1 concurrency bound the exposure; loopback single-user traffic makes queuing irrelevant.
- [Spec relaxation of read-only posture could invite endpoint sprawl] → the replacement requirement names the single admitted endpoint and keeps 405 for everything else; slice 3 must modify the spec again, deliberately, to widen it.
- [`--proposal` overlaps conceptually with `--description` (README.md)] → documented distinctly: `--description` seeds README.md (unchanged), `--proposal` seeds proposal.md (activates the change). No behavior change to existing flags.
- [Windows argv/quoting differences] → no shell means no quoting layer; argv arrays go through `spawn` verbatim on all platforms. CLI-spawning tests inherit the known EBUSY-flake caution.

## Migration Plan

Purely additive at runtime (new flag, new method on an existing path). Spec-wise the management-http-api read-only requirement is REMOVED+ADDED (name changes; the memory-recorded validate blind spot for renames makes MODIFIED unsafe). No data migration; rollback = revert the commits.

## Open Questions

- None blocking. Slice 3 will revisit: async acceptance envelope, whitelist expansion (auto/goal), and whether the operation table should become a registry shared with daemon supervision.
