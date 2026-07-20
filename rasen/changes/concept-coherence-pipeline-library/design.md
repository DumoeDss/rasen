## Context

Portfolio decision #4 turns `.rasenpkg` into a unified container that also carries pipelines, with CLI verb symmetry, version compatibility gating, runtime preflight, and a documented trust boundary. This is the largest sibling. The design below first records the scope split (why this change is the container half), then the container/versioning decisions, then a sketch of the deferred sibling so its planner has a running start.

Verified enablers (all cited in the research this change is based on):
- `RasenPackageSchema` is `z.discriminatedUnion('kind', [WorkflowPackageSchema, ProfilePackageSchema])` (`schema.ts:44`); `computePackageDigest` already takes `kind` as a digest input (`digest.ts:36`).
- Profile packaging (`named-profiles.ts:519-585`) is the exact "third kind" precedent: `stagePackageWorkflows` + `commitWorkflowInstall({ afterInstall })`, where `afterInstall` writes the kind-specific artifact under a second lock.
- The user pipeline layer is `getUserPipelinesDir() = <globalData>/pipelines` (`resolver.ts:36`); a pipeline is a directory containing `pipeline.yaml` (no manifest/digest today). Precedence is project > user > package (`resolver.ts:63`).
- `decodePackage` (`codec.ts:432`) validates strictly against the union and has an `expectedKind` gate; `formatVersion` is `z.literal(1)` (no `minRasenVersion` anywhere).
- `validatePackageDomain` (`codec.ts:291-430`) is workflow-shaped: every `kind==='profile'` branch (`:208,245,395`) is a site needing a `'pipeline'` sibling.

## Scope split (why this change is the container half)

Decision #4 (a)-(d) is two separable bodies of work:

- **This change (container + distribution)**: (a) pipeline package kind + CLI verbs + delete guard, (b) version gating, plus the child-4 project-root validation fix and the pipeline CLI docs. Cohesive theme: "package, version, install, and remove pipelines." Depends on child 4 (`requires.pipelines` for the delete guard).
- **Recommended sibling `concept-coherence-pipeline-preflight-trust`**: (c) runtime preflight (codex CLI probe) and (d) the author/review expert extension + trust-boundary docs. Different risk profile (execution-time behavior + expert-template changes that regenerate parity hashes), and (d)'s import-provenance display is the only part that touches this change's surface — already folded in here. (c) is largely independent and could even land first; (d)'s expert edits depend on this change's CLI verbs existing.

Proposing the container half as a clean, reviewable unit and recommending the sibling is the honest alternative to a four-feature monster. The LEAD owns whether to spin the sibling now or later.

## Decisions (this change)

### D1. `pipeline` kind reuses the union + digest, adds a `pipelines[]` payload

`PipelinePackageSchema = PackageFields + { kind: z.literal('pipeline'), pipelines: z.array(PackagedPipelineSchema) }`, where `PackagedPipelineSchema = { name, digest, files[] }` mirrors `PackagedWorkflowSchema`. `roots` names the packaged pipeline names. `workflows[]` stays in the shared `PackageFields` and is empty this round (a future enhancement may embed referenced workflow skills for self-contained packages; not needed for the core "share a pipeline" use case). `computePackagedPipelineDigest(name, files)` hashes `{ format:'rasen-pipeline-digest', version:1, name, files:[{path,sha256}] }`, matching the workflow digest shape. Because the pipeline.yaml content lives in `files[]` and is hashed, no pipeline data needs separate serialization — the same "data rides the file, digest covers it" property the workflow packages have.

### D2. Import reuses the transactional machinery via `afterInstall`

`importPipelinePackage(sourcePath)` = `readPackageFile(path, 'pipeline')` (TOCTOU stat-guard + `decodePackage(bytes,'pipeline')`) → `stagePackageWorkflows` (embedded `workflows[]`, empty this round) → `commitWorkflowInstall({ afterInstall })`. The `afterInstall` acquires `.pipelines.lock` and atomically writes each packaged pipeline's files into `getUserPipelinesDir()/<name>/` (temp + rename, restore-on-failure — reuse `writeFileAtomically`). Digest is re-verified after staging (`staged_digest_mismatch`). This is `importProfilePackage` with the artifact target swapped from the named-profiles store to the pipelines dir. Provenance (source path) and the verified digest are printed on success, and surfaced in `--json`.

### D3. CLI verb symmetry mirrors the workflow group

`pipeline init/validate/import/export/delete` mirror `workflow init/validate/import/export/delete` in flags and UX (`--json`, `--force` where applicable, digest display on import). `init` scaffolds a minimal `pipeline.yaml` (analogous to `scaffoldWorkflow`). `validate` runs the existing structural pipeline validation (`validate --pipelines` rules: unique stage ids, requires resolvable, acyclic, known skills, known roles, parallelGroup independence, composed-pipeline floor). All verbs resolve their root through the shared root-selection layer the existing pipeline subcommands use.

### D4. Delete refcount guard reuses child 4's pattern

`deletePipeline(name, { force })` refuses when the pipeline is referenced by (1) any installed workflow's `requires.pipelines`, or (2) another pipeline's `decompose` `childPipeline`. It returns a `DeletePipelineResult { deleted, forcedReferrers }` mirroring child 4's `DeleteWorkflowResult`. Package-layer (built-in) pipelines are never deletable. `--force` bypasses only the referrer guard and warns, naming dangling referrers; confirmation is still required non-interactively. A `createPipelineUsageContext` scans installed-workflow `requires.pipelines` and all pipelines' `childPipeline` edges, analogous to `createWorkflowUsageContext`.

### D5. Version gating = optional `minRasenVersion` + pre-schema preflight

Add `minRasenVersion: z.string().optional()` (semver) to `PackageFields`. `decodePackage` gains a preflight that, before the strict `RasenPackageSchema.safeParse`, extracts `formatVersion` and `minRasenVersion` from the parsed-but-unvalidated JSON: if `formatVersion` > the supported constant, or `minRasenVersion` > the running CLI version (read version-agnostically from `package.json`), it fails with a clear, actionable message ("This package requires rasen >= X.Y.Z; you have A.B.C — upgrade with ..."). `formatVersion` stays `1` this round (the pipeline kind is a union extension within v1). Package creation stamps `minRasenVersion` from the current CLI version at pack time — version-agnostic, honoring the no-bump constraint.

**Exact old-CLI failure mode (spec'd honestly):** a CLI predating this change, handed a `kind: 'pipeline'` package, rejects it at `discriminatedUnion` parse with an opaque `package_schema_invalid` — it has no version preflight and cannot be retrofitted. The preflight this change adds only helps THIS and future CLIs give clear messages for packages that are newer than them. This asymmetry is documented, not hidden.

### D6. Close the child-4 project-root validation gap

Child 4's `requires.pipelines`/`requires.schemas` existence checks run in `validator.ts` without a `projectRoot`, so project-layer pipelines are invisible to them. Thread an optional `projectRoot` through the workflow directory validation entrypoint and pass `findRepoPlanningRootSync(process.cwd())` from the `workflow`/`pipeline` import/validate CLI commands. Directory-time validation without a project context keeps today's built-in+user resolution (no regression); with a context it also resolves project-layer referents. Chosen over moving the check to catalog-time because the CLI already knows the repo root and threading a parameter is the smaller, more local change.

### D7. Skill-identity dual-form acceptance

Per the child-4 finding, pipeline stage `skill:` fields appear in both `rasen-<x>` (dir) and `rasen:<x>` (name) forms across the built-in pipelines. Pipeline `validate` and any package-domain skill check MUST accept both forms (resolve through the registry's dual index), not just the colon form, or valid pipelines will spuriously fail validation.

## Deferred sibling sketch — `concept-coherence-pipeline-preflight-trust`

For the next planner:
- **(c) Runtime preflight**: extend `validatePipelineForExecution` (`execution-validation.ts:47`) — after the existing skill loop and decompose-child recursion — to resolve each stage's effective runtime via `resolveStageRuntimeConfig` (stage.runtime → pipeline `agents.<role>` → `claude`), including decompose children. If any effective runtime is `codex`, probe CLI availability once per run (a `codex --version`-level check, cached), and on absence fail *before* dispatch with a message naming the two exits: override the role to `claude`, or install codex. No codex-availability probe exists in code today (only shell snippets in templates) — this is net-new. Fits under `opsx-pipeline-registry` "Pipeline Validation" or a new runtime-preflight requirement.
- **(d) Trust**: extend the `workflow-author`/`workflow-review` expert templates (`experts/workflow-author.ts`, `workflow-review.ts` — currently workflow-only) to cover pipeline authoring/review (stage DAG, decompose recursion, per-role runtime/model, skill enablement). Note: editing expert templates regenerates their parity/content hashes (a change-detector). Add docs stating the trust boundary — community packages are executable prompts, mitigated by transactional install + digest + validate + author/review experts, with no signature system and no marketplace.

## Risks / Trade-offs

- **`validatePackageDomain` is workflow-shaped**: the `'pipeline'` branch is the main integration risk. Mitigated by following each existing `kind==='profile'` branch site as a template.
- **Two `.rasenpkg` kinds now install different artifacts**: keep the `afterInstall` seams clearly commented so the three-kind pattern stays legible.
- **Old-CLI opaque rejection**: accepted and documented (D5); unavoidable for already-shipped binaries.

## Migration Plan

Additive. Existing workflow/profile packages are unaffected (new union member, optional new field). No config or artifact rewrite. `pipeline` gains verbs; inspection verbs are unchanged.

## Open Questions

None blocking. The one judgment call — embed referenced workflow skills in a pipeline package for self-containment vs keep pipeline packages pipeline-only this round — is resolved as pipeline-only (simpler, covers the core use case; embedding can be added later without a format break since `workflows[]` already exists in the shape).
