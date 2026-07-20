# Tasks — platform-slice2-task-submission

## 1. CLI: `--proposal` flag on `rasen new change`

- [x] 1.1 Add `--proposal <text>` to the `new change` command (`src/cli/index.ts` option + `NewChangeOptions`) and implement proposal.md seeding in `src/commands/workflow/new-change.ts` (title + text under `## Why`, marked as a submission seed; independent of `--description`/README.md)
- [x] 1.2 Add the `--proposal` flag to the completions command registry (`src/core/completions/command-registry.ts` under `new` → `change`) — seam that bit slice 1
- [x] 1.3 Add the flag description to `src/locales/en.json` and `src/locales/ja.json` (PR #10 parity tests enforce both) — second seam that bit slice 1
- [x] 1.4 Unit tests: `--proposal` creates proposal.md with the text and the change is enumerated by `getActiveChangeIds`; without the flag no proposal.md (unchanged behavior); registry/locale parity tests pass

## 2. Server: submission bridge (subprocess model)

- [x] 2.1 Create `src/core/management-api/submit.ts`: data-driven operation whitelist (exactly one entry, create-change), pre-spawn validation (kebab-case name via the same rule as `validateChangeName`, description non-empty/length-capped/no control chars), argv builder producing `[process.execPath, <cli-entry>, 'new', 'change', <name>, '--proposal=<text>', '--json']` with cli-entry resolved from the server's own module location (ui-launch.ts `createRequire` pattern), never PATH
- [x] 2.2 Implement subprocess confinement in submit.ts: `shell: false`, cwd = `context.launchProjectRoot` (409 `no_project` before spawn when absent), 30s timeout with SIGTERM→SIGKILL and 504 `cli_timeout`, cap-1 in-flight with immediate 409 `busy`, full stdout/stderr capture
- [x] 2.3 Implement outcome mapping: zero exit → parse CLI `--json` payload → 201 `{ change: { id, path, schema } }`; non-zero exit → 422 `cli_error` with CLI message (parsed JSON error or raw stderr), `cliExitCode`, and `stderr` verbatim; zero-exit unparseable output → 500 `cli_protocol_error` with raw output; add wire types to `wire-types.ts`
- [x] 2.4 Route POST in `src/core/management-api/router.ts`: replace the blanket non-GET 405 with per-path method routing (GET+POST on `/changes`, GET-only elsewhere, auth still checked first so 401 precedes 405); keep `isManagementPath` unchanged
- [x] 2.5 Unit tests for the bridge: injection posture (shell metachars inert as one argv token, option-like name → 400 without spawn, description bound in `--proposal=` token), no-project 409, timeout 504, busy 409, error passthrough (duplicate change name surfaces the CLI's already-exists message + exit code), protocol error, 405 matrix (PUT/DELETE anywhere, POST on status/runs), 401 without token, no `Access-Control-Allow-Origin` header on POST responses

## 3. Server integration tests

- [x] 3.1 End-to-end server test: start the management server against a temp project, authorized `POST /api/v1/changes` spawns the real CLI, a change directory with seeded proposal.md exists on disk, response is 201, and a follow-up `GET /api/v1/changes` lists the new change (fresh-read requirement)
- [x] 3.2 Verify slice-1 non-regression in the same suite: identity headers on POST responses, trailing-slash tolerance intact, config route group delegation untouched, `getActiveChangeIds` scope unwidened (planning-only dir still absent)

## 4. UI: board submission form

- [x] 4.1 Add `createChange({ name, description })` to `packages/ui/src/api/client.ts` (POST + json through the single seam) and the request/response/error types to `packages/ui/src/api/types.ts`
- [x] 4.2 Build the board-embedded "New change" affordance: button on the board page opening an inline dialog with name + description fields; submit disabled while in flight; on failure keep the dialog open with input intact and show the CLI error message verbatim from the envelope
- [x] 4.3 On 201: close the dialog, refetch changes+runs via the existing store refresh, and highlight the card matching the returned change id — no optimistic/fabricated card injection
- [x] 4.4 UI tests: successful submit path (form → refetch → real card), error path renders the envelope message, 401 during submit triggers the shared re-launch notice, double-submit prevented while in flight

## 5. Spec sync + runtime verification (acceptance gate)

- [x] 5.1 Update main specs from the deltas at archive/sync time (management-http-api REMOVED+ADDED, board-ui, change-creation, new change-submission spec)
- [x] 5.2 Runtime end-to-end verification, the slice's acceptance bar: `pnpm build` + `vite build` the UI package, create the sibling symlink (`<parent>/@atelierai/rasen-ui` → `packages/ui` — the bare-tree resolution trick from slice 1), run `rasen ui` against a real project, submit a change from the browser form, confirm a real CLI subprocess ran, the change directory + proposal.md exist on disk, and the board shows the new card after refresh; also exercise one failure (duplicate name) and see the CLI error in the form; remove the symlink afterwards
- [x] 5.3 Full test suite green (`pnpm test`); confirm completions/locale parity tests pass with the new flag
