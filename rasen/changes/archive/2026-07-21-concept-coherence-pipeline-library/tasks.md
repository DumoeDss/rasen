## 1. Pipeline package format (a)

- [x] 1.1 Add `PackagedPipelineSchema` (`{ name, digest, files }`) and `PipelinePackageSchema` (`kind: 'pipeline'` + `pipelines[]`) as a third member of `RasenPackageSchema` in `src/core/workflow-package/schema.ts`
- [x] 1.2 Add `computePackagedPipelineDigest(name, files)` in `src/core/workflow-package/digest.ts` (mirror the workflow digest domain)
- [x] 1.3 Add `createPipelinePackage(...)` and a `kind === 'pipeline'` branch to `validatePackageDomain` in `src/core/workflow-package/codec.ts` (each entry has a parseable, structurally-valid `pipeline.yaml`; skill refs accepted in both `rasen-x` and `rasen:x` forms)
- [x] 1.4 Confirm `computePackageDigest` already domain-separates on `kind` — no digest-domain change needed

## 2. Transactional import/export (a)

- [x] 2.1 Add `importPipelinePackage` reusing `stagePackageWorkflows` + `commitWorkflowInstall({ afterInstall })`; `afterInstall` writes each pipeline into `getUserPipelinesDir()/<name>/` under a `.pipelines.lock` (mirror `importProfilePackage`)
- [x] 2.2 Add `exportPipeline(name, dest)` — `createPipelinePackage` + `writeFileAtomically`
- [x] 2.3 Re-verify each pipeline digest after staging (`staged_digest_mismatch`); display provenance + verified digest on import (and in `--json`)
- [x] 2.4 Add `scaffoldPipeline(name, outputDir)` for `init`

## 3. Pipeline CLI verbs (a)

- [x] 3.1 Add `init`, `validate`, `import`, `export`, `delete` to the `rasen pipeline` group in `src/cli/index.ts`, mirroring the workflow verbs' flags/UX
- [x] 3.2 Route each through the shared root-selection layer (as existing pipeline subcommands do)
- [x] 3.3 Register the new verbs/flags in `src/core/completions/command-registry.ts` + `en.json`/`ja.json` flag-description keys (completion snapshot fires otherwise)

## 4. Delete refcount guard (a)

- [x] 4.1 Add `createPipelineUsageContext` scanning installed-workflow `requires.pipelines` and all pipelines' `decompose` `childPipeline` edges
- [x] 4.2 Add `deletePipeline(name, { force })` returning `DeletePipelineResult { deleted, forcedReferrers }`; refuse when referenced (no `--force`); never delete package-layer pipelines; warn + report referrers under `--force`; keep confirmation in non-interactive mode

## 5. Version gating (b)

- [x] 5.1 Add optional `minRasenVersion` (semver) to `PackageFields` in `schema.ts`; stamp it from the current CLI version at pack time (version-agnostic read of package.json)
- [x] 5.2 Add a version preflight in `decodePackage` (before strict `safeParse`) reading `formatVersion` + `minRasenVersion` from raw JSON; reject with a clear "requires rasen >= X.Y.Z; upgrade" message when unsupported
- [x] 5.3 Keep `formatVersion` at `1` (pipeline kind is a union extension within v1); document the old-CLI opaque-rejection limitation

## 6. Close child-4 project-root validation gap (D6)

- [x] 6.1 Thread an optional `projectRoot` through the workflow directory validation entrypoint (`validateWorkflowDirectory` / `validator.ts`); resolve `requires.pipelines`/`requires.schemas` with project context when supplied
- [x] 6.2 Pass `findRepoPlanningRootSync(process.cwd())` from the workflow/pipeline import and validate CLI commands
- [x] 6.3 Confirm no regression when no project context is supplied (package+user resolution unchanged)

## 7. Docs

- [x] 7.1 Add a `### rasen pipeline` section to `docs/cli.md` covering list/show/agents/classify/resume + the new init/validate/import/export/delete
- [x] 7.2 Add a minimal `docs/zh/cli.md` mirror per the established convention

## 8. Tests

- [x] 8.1 Pipeline-package codec round-trip (encode/decode, digest, kind gate); `test/core/workflow-package/codec.test.ts` neighbours
- [x] 8.2 Transactional import: success installs into user layer; digest mismatch installs nothing; wrong-kind rejected
- [x] 8.3 Delete guard: refused when referenced; `--force` deletes + warns + reports; built-in never deleted
- [x] 8.4 Version gate: newer `minRasenVersion` rejected with clear message; supported imports
- [x] 8.5 Project-root validation: project-layer pipeline dependency resolves with context; no regression without context
- [x] 8.6 Run `pnpm test` in the worktree and confirm green (isolate Windows CLI-spawn flake per project convention)

## 9. Validate

- [x] 9.1 Run `rasen validate concept-coherence-pipeline-library --strict` and resolve findings
