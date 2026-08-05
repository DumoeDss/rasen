## 1. Run-state contract (D1, D5)

- [x] 1.1 Make `RunStateSchema.pipeline` optional in `src/core/pipeline-registry/run-state.ts` so a run may hold frozen knowledge identity without claiming a pipeline; keep every other field and `passthrough()` behavior untouched.
- [x] 1.2 Make `writeRunState` crash-safe: write a temp file in the SAME directory and `fs.renameSync` it over the destination (the `writeSessionRuntimeContext` precedent), keeping the function synchronous and its signature unchanged. Cross-platform: build the temp path with `path.join`, never a literal separator.
- [x] 1.3 Add a raw-preserving atomic run-state update seam (`updateRunStateKnowledgeContext`) that reads the file's raw JSON, refuses when a knowledge context is already recorded, injects only `knowledgeContext`, and writes atomically — so another writer's records (hand-written progress, `runtimeRaw`-normalized worker fields) are never rewritten by a parse/serialize round-trip.

## 2. Resume reports three run-state states (D1, D2)

- [x] 2.1 Split resume's `!runState || runState.pipeline.length === 0` guard in `src/commands/pipeline.ts` into "no state file", "invalid state file", and "state without a pipeline"; run `loadPipelineByName` and stage-graph derivation only when a pipeline is present.
- [x] 2.2 Report a pipeline-less run-state as present: `hasRunState: true`, `pipeline: null`, `next: null`, empty `ready`/`remaining`, plus `runStateDir` and any `knowledgeContext`, with a distinct note. Keep the human surface consistent with the JSON surface.
- [x] 2.3 Add the deterministic `runStateDir` (the already-computed ephemera location) to the absent-run-state payload without changing `hasRunState: false` or its existing note.
- [x] 2.4 Add the `noPipelineRunStateNote` message to `src/locales/en.json`, `ja.json`, and `zh-cn.json` under `pipeline.messages`.
- [x] 2.5 Fix `sessionStage` in `packages/ui/src/board/columns.ts` so a run-state with no pipeline falls back to the session task text instead of rendering `undefined`.

## 3. Preparation command (D3, D4, D7, D8)

- [x] 3.1 Add `src/commands/retain.ts` exposing `rasen retain prepare <change>`: resolve the planning root with `resolveRootForCommand` (honoring `--store`/`--project`), validate the change exists, and resolve the run-state location along the sticky-legacy chain, falling back to the deterministic ephemera directory.
- [x] 3.2 Resolve the effective retention mode with `resolveCurrentProfileState(getGlobalConfig()).retention` — the same resolution the project-scope apply gate uses — and report it. Report a run-state-frozen `retention` alongside it as a separate field when one is recorded; never write the `retention` field.
- [x] 3.3 Resolve live knowledge identity with `resolveLearnedSkillExecutionContext` (`requestedScope: 'mixed'`, launch directory = the resolved planning root, `--store`/`--project` threaded as the knowledge-owner selector, existing frozen context passed as `frozen`) and freeze it with `freezeKnowledgeContext`, passing the session's execution ref when one exists.
- [x] 3.4 Fail closed before any write when the resolved planning root is not the root the change was located in, reporting both roots.
- [x] 3.5 Reuse an already-recorded `knowledgeContext` of ANY version verbatim — report it, write nothing, and never upgrade it in place; mint one only when the field is absent. Refuse a located-but-invalid run-state instead of overwriting it.
- [x] 3.6 Emit the JSON payload (`change`, `retention`, `runStateDir`, `runStatePath`, `knowledgeContext`, `contextSource`, `pipeline`) and a localized human surface; map `KnowledgeContextError` to a machine-readable error payload with its diagnostic code.
- [x] 3.7 Add `src/commands/retain-messages.ts` plus the `retain` message namespace in all three locale files.
- [x] 3.8 Register the command in `src/cli/index.ts` and `src/core/completions/command-registry.ts`, and add its `cli.root.commands.retain` presentation copy (description, positional, `--store`, `--project`, `--json`) to all three locale files.

## 4. Retention workflow templates (D3)

- [x] 4.1 Rewrite step 1 and step 2 of `RETAIN_INSTRUCTIONS` in `src/core/templates/workflows/retain.ts`: direct a standalone invocation at `rasen retain prepare <change> --json` for both the effective mode and the frozen identity, and remove the `rasen config get retention` dependency.
- [x] 4.2 Update `skills/workflows/rasen-retain/codify.md` step 1 so the no-`knowledgeContext` case is resolved by `rasen retain prepare`, not by hand-written run-state.
- [x] 4.3 Bump the retain skill template `metadata.version` so installed copies are refreshed.

## 5. Tests

- [x] 5.1 `test/core/pipeline-registry/run-state.test.ts`: a pipeline-less state parses and round-trips; every currently-valid file still parses unchanged; `writeRunState` leaves no temp file behind and still rejects non-canonical worker values.
- [x] 5.2 `test/core/pipeline-registry/run-state.test.ts`: the raw-preserving update seam injects only `knowledgeContext`, preserves unknown and hand-written keys byte-for-byte, and refuses when a context is already present.
- [x] 5.3 `test/commands/pipeline.test.ts`: absent run-state reports `runStateDir`; a pipeline-less run-state reports `hasRunState: true` with no pipeline/next and surfaces `knowledgeContext`; replace the schema-invalid fixture that relied on `pipeline` being required with one that is still invalid.
- [x] 5.4 New `test/commands/retain-prepare.test.ts`: no run-state + unique project owner freezes a v3 context and reports the directory; the reported mode is the effective profile mode with no stored `retention` key; repeated preparation is idempotent and creates no duplicate record.
- [x] 5.5 `test/commands/retain-prepare.test.ts`: an existing pipeline run-state with a v3 context is reported unchanged and its file is byte-identical; a v1/v2 context is reused, not upgraded.
- [x] 5.6 `test/commands/retain-prepare.test.ts`: ambiguous and stale ownership fail before any write; an explicit selector disagreeing with a recorded identity fails as a conflict; two stores sharing a display name resolve through durable identity; the persisted record contains no absolute planning or owner root.
- [x] 5.7 `test/commands/retain-prepare.test.ts`: an accepted project candidate applies with the reported `runStateDir`, and a zero-candidate run writes no learned skill.
- [x] 5.8 Cross-platform: assert reported directories with `path.join`/`path.resolve` (never literal separators) so the suite passes on Windows CI, and confirm the Windows job covers the new test file.

## 6. Documentation

- [x] 6.1 Document `rasen retain prepare` in `docs/cli.md` and the standalone retention path in `docs/retention-and-learned-skills.md`.
- [x] 6.2 Add the CHANGELOG entry under Unreleased.
- [x] 6.3 Record any design deviation proven during implementation as an ADR note in `design.md`.
