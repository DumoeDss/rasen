## Why

PR #13 gave rasen a workflow library: `.rasenpkg` packages, transactional install with digest verification, and a full `rasen workflow` verb set (init/validate/import/export/delete). Pipelines — the outer-loop orchestration DAGs — have no equivalent. They resolve from three layers (package/user/project) but there is no way to *package* a pipeline, share it, install it into the user layer, or delete it safely; the `rasen pipeline` group is inspection-only (list/show/agents/classify/resume) and is entirely undocumented. Portfolio decision #4 makes `.rasenpkg` a unified container that carries pipelines too, reusing the PR #13 machinery rather than building a second installer.

The enabling facts (verified in code): the package schema is a discriminated union on `kind` with the digest already domain-separated by kind, and profile packaging already demonstrates the exact "third kind" pattern — reuse `stagePackageWorkflows` + `commitWorkflowInstall` with an `afterInstall` hook that writes the kind-specific artifact under its own lock. So a `pipeline` kind slots in the same way a `profile` kind did.

**Scope decision (see design.md):** decision #4 spans four goals. This change delivers the *container and distribution* half — (a) the pipeline package format + CLI verb symmetry + delete guard, and (b) version gating — plus the previously-deferred child-4 project-root validation fix and the missing pipeline CLI docs. The *execution-safety and trust* half — (c) runtime/codex preflight and (d) the author/review expert extension + trust-boundary docs — is a genuinely separable body of work with its own risk profile and is recommended as a sibling change (`concept-coherence-pipeline-preflight-trust`). This keeps each unit independently reviewable and shippable.

## What Changes

### 1. `.rasenpkg` carries a `pipeline` kind (a)

- Add `PipelinePackageSchema` as a third member of the `RasenPackageSchema` discriminated union (`kind: 'pipeline'`), carrying a `pipelines[]` array of `{ name, digest, files[] }` (mirroring `PackagedWorkflowSchema`), with `roots` naming the packaged pipeline names. `formatVersion` stays `1` (a new kind is a union extension, not a format break). The package digest already domain-separates on `kind`, so no digest-domain change is needed.
- Add `createPipelinePackage(...)`, and a `'pipeline'` branch in `validatePackageDomain` — each `pipelines[]` entry must contain `pipeline.yaml`, parse as a valid `PipelineYaml`, and pass structural validation. Skill references inside stages are NOT required to be present at import (they may be installed separately; execution preflight — the sibling — is where a missing skill blocks a run). Pipeline stage skill refs use both `rasen-<x>` (dir) and `rasen:<x>` (name) forms; validation accepts both.
- `importPipelinePackage` reuses `stagePackageWorkflows` + `commitWorkflowInstall` with an `afterInstall` that atomically writes each pipeline's files into `getUserPipelinesDir()/<name>/pipeline.yaml` under a dedicated `.pipelines.lock` — the profile-package precedent exactly. `exportPipeline` packages a user pipeline. Import is transactional (stage-to-temp, digest re-verify, atomic rename) and displays provenance (source path) and the verified digest.

### 2. Pipeline CLI verb symmetry (a)

Add `init`, `validate`, `import`, `export`, and `delete` to the `rasen pipeline` group, mirroring the `rasen workflow` verbs and UX:
- `pipeline init <name> --output <dir>` scaffolds a minimal `pipeline.yaml` draft.
- `pipeline validate <name-or-path>` runs structural validation (parse + the existing `validate --pipelines` rules).
- `pipeline import <path>` / `pipeline export <name> <path>` for `.rasenpkg` round-trip.
- `pipeline delete <name>` with a refcount guard (below).

### 3. Pipeline delete refcount guard (a)

`pipeline delete` refuses to delete a user pipeline still referenced — by any installed workflow's `requires.pipelines` (child 4's data) or by another pipeline's `decompose` `childPipeline` — naming the referrers, mirroring `deleteWorkflow`'s `workflow_in_use` pattern and returning a `DeletePipelineResult` with `forcedReferrers`. Built-in (package-layer) pipelines are never deletable. A `--force` flag bypasses only the referrer guard (not the built-in prohibition), warning about dangling referrers.

### 4. Package version gating (b)

Add an optional `minRasenVersion` (semver) field to the package. `decodePackage` gains a version preflight that reads `formatVersion` and `minRasenVersion` from the raw JSON *before* strict schema validation: if `formatVersion` exceeds the supported version or `minRasenVersion` is newer than the running CLI (read version-agnostically from `package.json`), it rejects with a clear "this package requires rasen >= X.Y.Z; upgrade" message instead of an opaque schema error. Package creation stamps `minRasenVersion` from the current CLI version at pack time. (Honest limitation, documented: already-shipped older CLIs cannot be retrofitted — they will still reject a `pipeline`-kind package opaquely; the preflight makes THIS and future CLIs good forward-compat citizens.)

### 5. Close the child-4 project-root validation gap

Child 4 deferred a gap: `validator.ts` resolves `requires.pipelines`/`requires.schemas` without a `projectRoot`, so project-layer pipelines are not recognized. Thread an optional `projectRoot` into the workflow directory validation entrypoint and pass `findRepoPlanningRootSync(cwd)` from the import/validate CLI commands, so dependency existence checks see project-layer referents.

### 6. Pipeline CLI docs

Add the missing `### rasen pipeline` section to `docs/cli.md` documenting the full verb set (the pre-existing list/show/agents/classify/resume plus the new init/validate/import/export/delete), with a minimal `docs/zh/cli.md` mirror per the established convention.

## Capabilities

### Modified Capabilities

- `opsx-pipeline-registry`: the pipeline CLI surface gains init/validate/import/export/delete; `.rasenpkg` carries a `pipeline` kind with transactional import, digest verification, provenance display, a delete refcount guard, and package version gating.
- `workflow-library`: workflow dependency validation resolves project-layer pipeline/schema referents (closes the child-4 project-root gap).

## Impact

- `src/core/workflow-package/schema.ts` — `PipelinePackageSchema` union member + optional `minRasenVersion`
- `src/core/workflow-package/codec.ts` — `createPipelinePackage`, `'pipeline'` branches in `validatePackageDomain`, version preflight in `decodePackage`
- `src/core/workflow-package/digest.ts` — `computePackagedPipelineDigest`
- `src/core/pipeline-library.ts` (new) or `src/core/workflow-library.ts` — `importPipelinePackage`/`exportPipeline`/`scaffoldPipeline`/`deletePipeline` + pipeline usage-scan for the guard
- `src/core/workflow-package/transaction.ts` — `afterInstall` writing pipelines into `getUserPipelinesDir()`
- `src/cli/index.ts` — new pipeline verbs; `src/core/workflow-registry/validator.ts` — threaded `projectRoot`
- `src/core/completions/command-registry.ts` + `src/locales/en.json` + `src/locales/ja.json` — new verbs/flags (lockstep with the completion snapshot)
- `docs/cli.md` + `docs/zh/cli.md` — pipeline CLI section
- `rasen/specs/opsx-pipeline-registry/spec.md` + `rasen/specs/workflow-library/spec.md` — deltas
- Tests: pipeline-package codec/round-trip, transactional import + digest mismatch, delete guard + `--force`, version-gate rejection, project-root validation
- Constraints: no version-string bump (minRasenVersion is read from package.json); packages install into the user layer only, project layer stays file-based; completion-registry + locales lockstep.
