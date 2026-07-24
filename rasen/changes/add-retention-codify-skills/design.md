## Context

Rasen currently has two partial retention mechanisms:

1. `rasen-retro` writes change, general, or global retrospective reports, but those reports are not automatically consulted by future agents.
2. Archive quality capture extracts literal `[RULE]` lines and appends them to project `quality-rules`; those strings are injected into future artifact instructions, but they have no evidence gate, applicability, provenance, lifecycle, context budget, or ownership model.

Profiles are strict version-1 snapshots containing only `version` and `workflows`. The profile picker treats workflows and experts as checkboxes and has no mutually exclusive policy dimension. User workflows are canonical in one machine-global registry and are then generated into tool skill homes, which cannot represent project-private learned guidance without exposing it to every project. Most tool skill homes are project-local, but Hermes has only a global skill home.

The full-feature pipeline currently ends `ship → archive → retro`, even though the retro template says archive consumes its result. Pipeline definitions require one concrete `skill` per stage, and the in-progress pipeline-definition API deliberately round-trips that schema. Introducing a mode-dependent stage-skill union would therefore cut across the pipeline registry, execution preflight, API, and UI work already in flight.

A generated skill is persistent instruction, not merely a report. Source artifacts, review text, code comments, logs, and tests must be treated as untrusted data because an instruction copied from them can become a durable prompt-injection path. Generated content also needs a stricter ownership seam than ordinary editing: Rasen must never infer that a similarly named human skill is safe to overwrite.

## Goals / Non-Goals

**Goals:**
- Give each profile one explicit retention policy: `off`, `report`, or `codify`.
- Preserve retrospective reporting while making report and codify mutually exclusive during an automated run.
- Convert only durable, reusable, actionable, evidenced, novel, and bounded lessons into managed skills.
- Default new learned skills to a registered project's machine home; promote globally only from multiple project identities with explicit approval.
- Put validation, locking, ownership, canonical storage, and atomic mutation behind one deep learned-skill module.
- Materialize learned skills through existing tool adapters and exact artifact-ledger identities without placing learned IDs in profiles or workflow closure.
- Bound always-loaded descriptions and invoked content, and make “no lesson accepted” a normal successful result.
- Preserve existing user-authored `quality-rules` while stopping archive from silently adding new ones.
- Keep all paths and path identities portable across Windows, macOS, and Linux.

**Non-Goals:**
- Generating learned skills from general/global commit statistics in v1; codify is change-scoped only.
- Team-shared learned skills committed to the repository. Project learned skills are machine-local in v1; a later explicit export/share flow can address collaboration.
- Executable generated sidecars, scripts, hooks, or arbitrary package content.
- A management-UI learned-skill editor.
- Semantic deduplication without an agent. The core validates and commits a structured decision; the retain skill performs evidence interpretation and semantic comparison.
- Automatically converting or deleting existing `quality-rules`, whose provenance cannot be reconstructed safely.
- A generic workflow conflict-group or pipeline capability-provider system.

## Decisions

### 1. Add one retention policy dimension and one stable runner

`RetentionMode` is the closed machine value `off | report | codify`. Current global profile state and named profiles move to strict definition version 2:

```yaml
version: 2
workflows:
  - apply
  - review
retention: codify
```

The built-in `full` profile resolves to `report`; `core` resolves to `off`. Matching `full` or `core` compares both workflow/expert membership and retention, so a core membership with codify is classified as `custom`.

The profile editor keeps workflow/expert checkboxes and adds a separate retention radio prompt. `rasen profile`, `profile new`, and `profile update` share that prompt. Learned skills never appear in either picker or profile files.

The pipeline uses one stable `rasen-retain` runner. Its small `SKILL.md` reads the effective retention mode (or the mode already frozen in run-state), then conditionally loads only the report or codify reference body; `off` loads neither. `rasen-retain` is an internal workflow dependency rather than an independent profile checkbox. The effective workflow resolver includes it whenever `auto-command`/full-feature requires it, so preflight sees one known enabled skill even when retention is off.

A minimal `rasen-retro` wrapper remains for one compatibility window. It is outside the selectable workflow catalog, sets `disable-model-invocation: true`, and forces the report branch without changing the saved profile. The wrapper is tracked by an exact named artifact identity so it can later be retired without a prefix scan.

Alternatives rejected:
- Two selectable `retro`/`codify` workflows plus a conflict rule: this duplicates policy in workflow membership, permits invalid imported profiles, and leaves a fixed pipeline unable to choose the active provider.
- A pipeline `capability:` field: architecturally general but unnecessarily widens the pipeline schema, execution preflight, HTTP definition contract, and UI catalog.
- One monolithic retain body: it loads both long branches and defeats progressive disclosure.

### 2. Run retention before archive

The full-feature tail becomes:

```text
ship → retain → archive
```

The retain stage freezes its selected mode in run-state on first entry. Resume uses that recorded mode even if the active profile changes later. A codify retry is idempotent because canonical mutations use a stable learned-skill identity and evidence references are deduplicated. Run-state remains authoritative; absence of a generated skill is not evidence that retain failed because zero accepted candidates is a valid result.

Report mode writes the existing `retro.md` before archive, allowing ordinary archive movement to preserve it. Codify completes its canonical mutation or successful no-op before archive. Archive itself performs neither reporting nor codification.

Existing in-flight full-feature run-state is migrated by an explicit legacy-stage mapping: an incomplete legacy `retro` stage maps to the new `retain` stage in forced report mode, while a completed legacy retro remains completed. No stage is inferred complete merely from a profile setting.

### 3. Keep learned skills in a separate two-layer registry

Learned skills are not user workflows. Reusing the workflow registry would make project-private guidance globally visible, pollute profile/package membership, and overload workflow dependency semantics.

Canonical stores are resolved by named functions and platform path primitives:

```text
<global data dir>/learned-skills/<id>/
<project machine home>/learned-skills/<id>/
```

A project-scoped write requires a registered project and resolved `machineHome`; there is no in-repository fallback because an automatic fallback would dirty the worktree after shipping. An unregistered project receives `rasen init` guidance.

Each canonical directory contains:

```text
learned-skill.yaml   # strict managed manifest
SKILL.md             # canonical generated skill
```

The version-1 manifest records:
- id, stable knowledge key, scope, and active/retired status;
- `generatedBy` ownership and canonical content digest;
- one or more evidence references (project ID, change identity, artifact kind, digest), never raw artifact bodies;
- applicability predicates;
- created/updated/retired timestamps and retirement reason when applicable.

Evidence arrays are deduplicated by their stable tuple and capped by named limits; overflow is summarized by count and digest rather than copied indefinitely. Retired records keep provenance but are excluded from materialization.

### 4. Put persistence behind a deep learned-skill interface and CLI adapter

The core learned-skill module exposes two caller-facing operations:

```ts
planLearnedSkillMutation(request, context): LearnedSkillPlan
commitLearnedSkillPlan(plan): LearnedSkillResult
```

Resolution for generation is the read side of the same module:

```ts
resolveLearnedSkills(context): ResolvedLearnedSkillSet
```

The module hides schema validation, portable identity checks, canonical path resolution, duplicate evidence handling, locks, collision/ownership checks, context budgets, staging, atomic rename, rollback, and manifest/content digesting. Tests exercise the same interface used by the CLI and init/update; internal filesystem adapters may vary, but callers do not receive those seams.

The agent-facing adapter is a localized `rasen knowledge` CLI group:

- `rasen knowledge apply --from <absolute-json-file> [--approve-global] [--json]`
- `rasen knowledge list [--scope project|global] [--json]`
- `rasen knowledge show <id> [--scope project|global] [--json]`
- `rasen knowledge retire <id> [--scope project|global] [--yes] [--json]`

`apply` accepts a strict versioned candidate containing the intended operation (`upsert`, `promote`, or `retire`), id/knowledge key, synthesized description/instructions, applicability, and evidence references. It computes and displays the actual plan before commit. Global create/promotion requires both cross-project evidence and interactive approval or the explicit `--approve-global` consent in non-interactive execution. `--approve-global` is rejected for a project mutation so consent cannot be accidentally reused.

`rasen-retain` writes a temporary candidate below the resolved work directory and calls this CLI; it never writes canonical or tool skill directories itself. The candidate is removed after the command, while canonical provenance remains. This keeps persistent filesystem authority in deterministic TypeScript rather than stochastic skill instructions.

Alternative rejected: directing the agent to edit every tool's skill directory. That is shallow duplication, cannot be atomic across adapters, cannot distinguish global-only homes safely, and would bypass the ledger.

### 5. Make project the default and global an explicit promotion

An accepted candidate first becomes project-scoped. A global create or promotion requires:

1. equivalent accepted evidence carrying the same bounded knowledge key;
2. at least two distinct stable project IDs (multiple changes or clones sharing an ID count once);
3. applicability that contains no project-private path, name, domain, or policy;
4. explicit user approval at the `knowledge apply` seam.

The manifest's `path-exists` applicability predicate uses validated portable root-relative marker paths and explicit `all`/`any` composition. No glob, regular expression, shell expansion, or arbitrary detector runs. The adapter resolves each path segment with `path.join` and rejects absolute paths, `.`/`..`, backslashes in logical paths, device names, and portable case/NFC collisions using the existing portable-path helpers.

Project-scoped learned skills materialize only for their owning project. Approved global skills materialize into a project-local tool home only when that project satisfies the predicates.

A global-only tool home cannot enforce project applicability at installation time. Therefore:
- project-scoped learned skills are skipped with a warning;
- all active approved global learned skills are reconciled through a machine-global learned-skill ledger, independent of the current project marker result;
- their description remains responsible for model-time applicability.

This explicitly accepts some global description load for global-only tools instead of leaking project guidance or allowing one project's update to remove another project's global copy.

### 6. Use context-first names and stable keys

A learned-skill id is 3–6 lowercase ASCII kebab-case semantic tokens and at most 64 characters. The first token(s) identify applicability; later tokens identify the operation, seam, constraint, or failure mode. Dates, change IDs, user/project IDs, and generic provenance words (`memory`, `lesson`, `learning`, `notes`) are rejected. `SKILL.md` frontmatter `name` equals the canonical and materialized directory name.

Examples:

```text
typescript-cli-i18n-diagnostic-routing
profile-package-retention-validation
go-sql-transaction-locking
```

Ownership is not encoded in a `rasen-` or `generated-` prefix; it lives in the canonical manifest and ledger. A separate stable knowledge key lets materially identical guidance rewrite the same record even when wording changes. A rename is an explicit plan containing the old and new exact identities, so cleanup never scans by prefix.

The retain skill performs semantic novelty checks against active/retired learned skills, existing `quality-rules`, relevant repository documentation, and installed/repository skills. The core rechecks exact identity, ownership, evidence tuples, and content digests. Human-authored guidance is never rewritten during deduplication.

### 7. Rewrite managed skills; never append lessons

An update replaces the complete canonical `SKILL.md` and manifest atomically. The generated body contains one invocation branch, a bounded procedure, failure modes, and checkable completion criteria. Raw retrospective prose, people, metrics, source logs, temporary commands, and duplicated documentation stay out of the body.

Only a canonical manifest carrying the expected `generatedBy` value and matching ledger identity may be rewritten or retired. If an unmanaged canonical or materialized directory occupies the id, the plan fails and reports the exact collision. Retirement changes canonical status and removes only exact ledger-tracked materializations; provenance remains available through `knowledge show`.

V1 learned skills contain no generated scripts or executable sidecars. Their installed frontmatter is restricted to the Agent Skills fields already emitted by Rasen plus string metadata naming generated ownership, scope, learned-skill id, and canonical digest.

Named limits are centralized constants, not scattered literals:
- evidence/candidate input budget;
- one skill's description and instruction-content budget;
- active learned-skill description budget per project-local materialization set;
- canonical evidence-entry budget.

Planning fails before mutation when a limit would be exceeded. Nothing is silently truncated. The error names the limit and recommends narrowing, splitting, merging, or retiring guidance.

### 8. Treat every source as untrusted data

The codify reference body explicitly places planning artifacts, reports, logs, tests, source comments, and linked content below the instruction trust boundary. It synthesizes the candidate instead of copying source instructions. Prompt-like source text cannot select global scope, claim ownership, alter budgets, request command execution, or override profile/user/system policy.

The deterministic core cannot prove semantic safety, but it limits blast radius by validating a closed candidate schema, disallowing executable files, enforcing size and identity limits, requiring global approval, preserving provenance, and showing the planned diff. Project auto-apply is authorized only by an active codify profile; `report` and `off` never mutate learned-skill state.

### 9. Materialize through exact ledgers and existing adapters

`resolveLearnedSkills` returns canonical active skills separately from workflow definitions. Init/update compose that set after ordinary profile/dependency resolution and generate it into tools already being configured or updated.

Project-local tool homes use the existing tool resolver and project artifact ledger extended with an explicit learned-skill section keyed by canonical scope/id/digest. Update may replace or remove only the exact recorded path. An untracked or differently owned target blocks materialization and remains byte-for-byte unchanged.

For global-only tool homes, approved global learned skills use a machine-global learned-skill ledger because a project ledger cannot own a shared path. Project-scoped skills are never written there. Update continues to avoid onboarding new tools.

Human summaries keep workflow changes and learned-skill changes separate (`created`, `updated`, `removed`, `skipped`). JSON adds typed learned-skill fields without changing stable workflow fields. Rasen-owned messages and command descriptions are added to all three locale catalogs.

### 10. Retire archive rule extraction without rewriting existing rules

Archive keeps quality-artifact scanning, quality metric extraction, archive metadata, and normal movement. It stops parsing `[RULE]` and stops mutating `quality-rules`; the extracted-rule count disappears from archive output.

Existing `quality-rules` remain accepted by project config and injected in their established order. They are not auto-migrated because Rasen cannot distinguish generated entries from user-authored entries. Codify reads them only for novelty checks and never changes them.

This is a behavior break, but it removes a weaker competing memory path rather than maintaining two sources of procedural guidance.

## Risks / Trade-offs

- [Persistent prompt injection from evidence] → Treat all evidence as data, synthesize rather than copy, use a closed candidate schema, forbid executable generated files, show plans, retain provenance, and approval-gate global mutations.
- [Semantic deduplication varies by model] → Keep semantic comparison in one codify instruction branch, make deterministic exact checks a second line of defense, and treat uncertainty as rejection/no-op rather than forced creation.
- [Profile version 2 is unreadable by older CLIs] → Accept v1 indefinitely, write v2 only on explicit profile writes/exports, stamp self-contained packages with the minimum supporting Rasen version, and document thin YAML/JSON downgrade limits.
- [Project knowledge is not team-shared] → Deliberate v1 choice to avoid automatic repository churn; manifests preserve enough provenance for a later reviewed export/share feature.
- [Global-only tools cannot enforce project applicability] → Never install project skills globally; reconcile only explicitly approved global skills through a global ledger and rely on context-first descriptions for invocation.
- [Context still grows as learned skills accumulate] → Enforce total description budgets, rewrite/retire instead of append, and make budget exhaustion an explicit merge/retire decision.
- [Full-feature pipeline changes under in-flight runs] → Add explicit legacy retro-to-retain run-state mapping and keep codify application idempotent.
- [Archive no longer appends `[RULE]`] → Preserve all existing `quality-rules`, state the replacement command in migration output/docs, and keep archive quality metrics unchanged.
- [Machine-home unavailable or unwritable] → Refuse project codification with init/permission guidance before candidate persistence; no repo-local fallback.
- [Crash during canonical mutation or materialization] → Lock, stage, digest-check, and atomically rename canonical records; materialization remains repairable by idempotent init/update reconciliation.
- [Name collision on case-insensitive filesystems] → Reuse portable path collision keys and exact ledger ownership across canonical and target roots.

## Migration Plan

1. Add profile-definition v2 readers/writers and `RetentionMode`; keep v1 parsing. On normalization, remove exact `retro-command`, set `report` when it was present, otherwise `off`, and preserve every other valid id. Do not persist solely because a read occurred.
2. Add `rasen-retain`, its report/codify sidecars, and the user-invoked retro compatibility wrapper. Register retain as an internal dependency and add exact retired/current identity constants.
3. Add the learned-skill core, strict candidate/manifest schemas, locks, canonical resolvers, `rasen knowledge` adapters, and focused unit tests before enabling codify writes.
4. Extend init/update ledgers and reconciliation, including the separate global-only-tool ledger and collision-safe dry-run tests.
5. Switch the full-feature tail to retain-before-archive and add legacy run-state mapping/resume tests.
6. Remove archive `[RULE]` extraction and append behavior while leaving config parsing/injection untouched.
7. Update navigator/help/docs/locales and profile/package examples. Self-contained v2 profile exports declare the minimum supporting Rasen version.
8. On the next explicit profile/update operation, remove legacy selectable retro ids and obsolete generated retro artifacts by exact identity while retaining the compatibility wrapper for its announced window.
9. In the release after the compatibility window, remove the wrapper and add its exact directory/identity to the retirement set.

Rollback before a profile is explicitly rewritten restores the previous binary/templates without data conversion. After v2 profiles exist, rollback requires exporting or editing them to version 1 by removing `retention` and, for report semantics, restoring `retro-command`; learned-skill canonical stores are additive machine data and may remain dormant under an older CLI. Existing `quality-rules` require no rollback.

## Open Questions

None for v1. Team sharing, signed/global package exchange, richer applicability predicates, and general/global codification remain explicit follow-up capabilities rather than hidden extension points in this implementation.
