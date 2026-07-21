## 1. Kind type and built-in assignment

- [x] 1.1 Add `export type WorkflowKind = 'task' | 'driver' | 'internal'` and a `kind: WorkflowKind` field to `WorkflowDefinition` in `src/core/workflow-registry/types.ts`
- [x] 1.2 Add optional `kind?: WorkflowKind` to `BuiltInWorkflowAdapter` in `src/core/workflow-registry/builtins.ts`
- [x] 1.3 Set `driver` on `auto-command` and `goal-command`; `internal` on `goal-plan`/`goal-iterate`/`goal-report`; leave others default
- [x] 1.4 Write `kind: adapter.kind ?? 'task'` in `getBuiltInWorkflowDefinitions`; do NOT add `kind` to the `digestBuiltIn` preimage
- [x] 1.5 Confirm no exhaustive `never`-defaulted switch over `kind` is introduced (keep the union open for a future `expert`)

## 2. User workflow default and manifest declaration

- [x] 2.1 Add optional `kind: z.enum(['task','internal']).default('task')` to `WorkflowManifestSchema` in `src/core/workflow-registry/manifest.ts`
- [x] 2.2 Set `kind: manifest.kind` on the user `WorkflowDefinition` in `src/core/workflow-registry/validator.ts`
- [x] 2.3 Confirm `computeWorkflowDigest` (`digest.ts`) is unchanged and the package codec still serializes `{id, files, digest}` per workflow (no new field, no `manifestVersion` bump)

## 3. workflow list grouping and JSON

- [x] 3.1 Add a `--all` flag to `workflow list` in `src/commands/workflow-library.ts`
- [x] 3.2 Add `kind` to each list entry object and to the `--json` payload; ensure JSON always includes internal workflows regardless of `--all`
- [x] 3.3 Group the human table by kind (task, driver) under localized headings; emit the internal group only when `--all` is set; compose with existing `--unused` filtering
- [x] 3.4 Add `kind` to `workflowDefinitionForJson` in `src/core/workflow-library.ts` (covers `workflow show --json`)

## 4. Localized headings (lockstep)

- [x] 4.1 Add section-heading message keys to `WorkflowUiMessages` in `src/commands/workflow-messages.ts`
- [x] 4.2 Populate the new keys in BOTH `src/locales/en.json` and `src/locales/ja.json` (locale catalogs must stay in parity)

## 5. Docs

- [x] 5.1 Add a short kind-taxonomy subsection (three kinds + `list` grouping/`--all`) to the workflow-library doc in `docs/` (added to `docs/cli.md` `rasen workflow` section + `docs/workflow-packages.md` manifest field docs)
- [x] 5.2 Mirror the subsection in `docs/zh/` (locale parity) — REROUTED by LEAD to change `concept-coherence-concept-docs` (child 3 owns the docs/zh writeup; these two files have no pre-existing zh mirror to extend). Original blocker note: neither `docs/cli.md` nor `docs/workflow-packages.md` has ever had a `docs/zh/` counterpart (confirmed via git history of the docs-sweep commit, which touched `docs/zh/{commands,concepts,workflows,...}.md` but never these two files); there is no existing zh mirror to extend. See durable finding below.

## 6. Tests

- [x] 6.1 Update `test/core/workflow-registry/validator.test.ts` and `test/core/workflow-package/codec.test.ts` expected definitions to include `kind: 'task'`
- [x] 6.2 Confirm `test/fixtures/workflow-registry/builtins-v1.json` and `skill-templates-parity.test.ts` require NO change (kind excluded from digests and from the fixture projection); run them to verify
- [x] 6.3 Add coverage: built-in kinds are assigned correctly (driver/internal/task)
- [x] 6.4 Add coverage in `test/commands/workflow-library.test.ts`: default `list` hides internal; `--all` reveals them; `--json` always includes internal with `kind`
- [x] 6.5 Add coverage: manifest declaring `kind: internal` loads as internal; disallowed kind fails validation; omitted kind defaults to task
- [x] 6.6 Run `pnpm test` in the worktree and confirm green (isolate any Windows CLI-spawn flake per project convention) — 32 failed / 3330 passed / 28 skipped, exactly the known pre-existing baseline (management-api/{supervisor,sessions-api,submit,server-shutdown}, commands/{daemon-lifecycle,ui-launch-stale-replace}, utils/file-system); zero overlap with this change's surface

## 7. Validate

- [x] 7.1 Run `rasen validate concept-coherence-kind-taxonomy --strict` and resolve any findings — passes clean
