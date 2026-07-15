# Tasks: fix-codex-host-compat

## 1. Host-tolerant run-state parsing (design D1)

- [x] 1.1 Add a normalization pass in `src/core/pipeline-registry/run-state.ts` applied by `parseRunState` before schema validation: on each worker-shaped record (stage `worker` objects and the portfolio `planner` record), strip keys whose value is JSON `null` among the optional string fields (`transcript`, `agentId`, `threadId`, `turnId`, `jobId`, `threadName`, `model`, `effort`, `resumeMode`, `previousThreadId`, `reusedFrom`, `updatedAt`, `role`); when `runtime` is a string outside `claude|codex`, move it to `runtimeRaw` and delete `runtime`
- [x] 1.2 Confirm `writeRunState` remains strict (unchanged `RunStateSchema.parse`) and portfolio-state parsing reuses the same normalization where it embeds worker records
- [x] 1.3 Tests in `test/core/pipeline-registry/run-state.test.ts`: Codex-flavored record (`transcript: null` + `runtime: "codex-host-fallback"`) parses with `runtimeRaw` preserved; canonical record parses byte-identical; `writeRunState` still rejects `transcript: null` and non-enum `runtime`

## 2. Resume invalid-vs-absent distinction (design D3)

- [x] 2.1 Add a detailed read variant in `run-state.ts` (tagged result: parsed state | invalid-with-reason | absent) keeping `readRunState`'s existing null-swallowing signature for other callers
- [x] 2.2 Use it in `PipelineCommand.resume` (`src/commands/pipeline.ts`): when the located file is invalid, keep `hasRunState: false` but add `invalidRunState: true`, the file path, and a note naming the reason (JSON and text output)
- [x] 2.3 Tests: resume against a syntactically broken `auto-run.json` reports `invalidRunState: true` with path+reason; absent file keeps today's output exactly

## 3. Context probe graceful degradation (design D2)

- [x] 3.1 In `src/core/agent-context.ts`, introduce a typed `AgentContextUnavailableError` thrown by `findLatestMainTranscript` for its two environmental-absence cases (directory missing; no main-session transcript), leaving all other throws untouched
- [x] 3.2 In `src/commands/agent.ts`, catch only that error type when `--latest` was used: `--json` prints `{"available": false, "reason": "no-transcript", "detail": <message>}`, text mode prints one `context unavailable: <detail>` line; both exit 0 (do not rethrow to the CLI catch-all). Add `available: true` to the success JSON shape
- [x] 3.3 Verify input errors still exit 1: invalid `--runtime`/`--limit`, no source flag, explicit `--transcript` missing/unreadable/usage-free
- [x] 3.4 Tests in `test/core/agent-context.test.ts` (and command-level test if the suite has one): unavailable-dir and empty-dir cases return the unavailable shape with exit 0; explicit-transcript failures unchanged; success shape carries `available: true`

## 4. workDir-first resume regression coverage (scope item 3 — already implemented at HEAD)

- [x] 4.1 Add an end-to-end-flavored regression test: an `auto-run.json` containing Codex-host values (post-normalization parseable) placed ONLY in the change's external work directory is found and reported by `resume` with `runStateDir` = the workDir (covers the screenshot path: workDir-first resolution + host tolerance together)

## 5. Writer guidance in the auto template (design D4)

- [x] 5.1 In `src/core/templates/workflows/auto.ts` step 0, document the probe's `available: false` shape as the non-blocking "record unavailable and proceed" path for non-Claude hosts
- [x] 5.2 In the run-state recording guidance (`_orchestration.ts` Step F or wherever worker records are specified), add: `runtime` MUST be `claude` or `codex` — omit the field for any other host; never write JSON `null` for an absent optional field, omit the key
- [x] 5.3 Regenerate derived command/skill artifacts through the normal template build so parity hashes stay consistent

## 6. Verification

- [x] 6.1 `pnpm test` green in the worktree (note known Windows-only flake docs do not apply on darwin)
- [x] 6.2 Manual smoke: `rasen agent context --latest --json` from a directory with no Claude projects dir exits 0 with the unavailable shape; `rasen pipeline resume` against a fixture change with a Codex-flavored workDir run-state resolves stages
- [x] 6.3 No version numbers changed anywhere in the diff
