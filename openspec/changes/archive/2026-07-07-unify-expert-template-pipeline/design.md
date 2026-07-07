## Context

Two skill-authoring pipelines coexist:

- **Workflow skills** (`src/core/templates/workflows/*.ts`) are the modern form: each is a TS function returning a `SkillTemplate` whose `instructions` is an inline template string, and shared prose is a TS constant interpolated with `${…}` (e.g. `STORE_SELECTION_GUIDANCE` in `store-selection.ts`, `ORCHESTRATION_PLAYBOOK` in `_orchestration.ts`). Freshness is pinned by golden-master hashes in `test/core/templates/skill-templates-parity.test.ts`.
- **Expert skills** (the 19 in `getSkillTemplates()`) are the legacy form: prose is authored in `skills/gstack/<name>/SKILL.md.tmpl`; `scripts/gen-skill-docs.ts` (bun) resolves `{{PLACEHOLDER}}` shared blocks and writes committed `skills/gstack/<name>/SKILL.md`; then `src/core/templates/experts/<name>.ts` `readFileSync`s that generated file, strips frontmatter, and appends `STORE_SELECTION_GUIDANCE` (plus `CHANGE_CONTEXT_CAPTURE_GUIDANCE` for `prototype`). Freshness is a separate `skill:check` dry-run.

The expert getters already exist and already produce `SkillTemplate` objects with rebranded metadata (`name: 'gstack:<x>'`, `metadata.author: 'openspec'`) — the only thing they do that workflows don't is read a file. This change removes that file read and the generator behind it.

Key mechanical facts established during research:

- **Placeholder usage** (which shared blocks each surviving template references) is sparse and known: `PREAMBLE` (nearly all), `BROWSE_SETUP` (benchmark, browse, design-review, design-consultation, office-hours, qa, qa-only), `SNAPSHOT_FLAGS` + `COMMAND_REFERENCE` (browse), `BASE_BRANCH_DETECT` (codex, review, qa), `PLAN_FILE_REVIEW_REPORT` (codex), `QA_METHODOLOGY` (qa, qa-only), `DESIGN_METHODOLOGY` (design-review), `DESIGN_REVIEW_LITE` + `TEST_COVERAGE_AUDIT_REVIEW` + `ADVERSARIAL_STEP` (review), `TEST_BOOTSTRAP` (design-review, qa), `DESIGN_SKETCH` + `SPEC_REVIEW_LOOP` (office-hours). Nine experts use only `PREAMBLE` or nothing.
- **`PREAMBLE`** embeds the literal tokens `__OPENSPEC_PROACTIVE__` / `__OPENSPEC_REPO_MODE__`, which are resolved later at *install* time, not at generation time — so a `PREAMBLE` TS constant carries those tokens verbatim, unchanged.
- **`BROWSE_SETUP`** interpolates `ctx.paths` (localSkillRoot `.openspec/skills`, browseDir `~/.openspec/browse/dist`). The TS install pipeline is claude-host only (the getters read the claude-host generated file), so the constant hardcodes the claude-host paths. The codex-host generation path (`--host codex` → `.agents/skills/`) is part of the deleted generator and has no TS consumer today; it is dropped, not reimplemented.
- **`COMMAND_REFERENCE` / `SNAPSHOT_FLAGS`** are the only two blocks *derived from code*: the generator imports `COMMAND_DESCRIPTIONS` (browse `src/commands`) and `SNAPSHOT_FLAGS` (browse `src/snapshot`) and formats tables from them.
- **The root `skills/gstack/SKILL.md.tmpl`** has no expert getter and is not installed by the TS pipeline — it is dead and simply deleted.
- **The `description: '|'` quirk** is present in every expert getter except `navigator`; it produces an effectively empty YAML block-scalar description in the installed frontmatter. It is pre-existing and orthogonal to this change.

## Goals / Non-Goals

**Goals:**
- One source format for all installed skills (inline TS template strings + TS shared constants).
- One freshness gate (`skill-templates-parity.test.ts` golden-master) covering both workflows and experts.
- Remove the `gen-skill-docs` / `skill:check` toolchain and its bun-for-skill-docs dependency.
- Drop the `gstack` brand from the installed expert skill identity (dirName and `name`).
- Byte-for-byte preservation of each expert's installed `instructions` payload (mechanical migration, not a content rewrite).

**Non-Goals:**
- Fixing the `description: '|'` quirk (preserved as-is for a faithful migration; a follow-up may address it).
- Codex-host (`.agents/skills/`) skill generation — no current TS consumer; dropped with the generator.
- Changing what the browse tool itself does, or its top-level `browse/` package build (`build:browse` keeps using bun).
- Refreshing the historical-citation removal specs (see proposal Impact NOTE).
- Rewriting workflow skills or their shared constants (`STORE_SELECTION_GUIDANCE`, `CHANGE_CONTEXT_CAPTURE_GUIDANCE` are reused unchanged).

## Decisions

### D1 — Expert source organization: inline `instructions`, shared blocks in `experts/_shared.ts`

Each `experts/<name>.ts` keeps its existing getter signature and its existing `SkillTemplate` field values, but replaces the `readFileSync` block with an inline template string. The body is the current `.tmpl` body with `{{BLOCK}}` markers rewritten to `${BLOCK}` interpolations of constants imported from a new `src/core/templates/experts/_shared.ts`.

```ts
// experts/prototype.ts (after)
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';
import { CHANGE_CONTEXT_CAPTURE_GUIDANCE } from '../workflows/change-context.js';
import { PREAMBLE } from './_shared.js';

const BODY = `<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

${PREAMBLE}

# Prototype
...`;

export function getPrototypeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec:prototype',
    description: '|',
    instructions: `${BODY}\n\n${CHANGE_CONTEXT_CAPTURE_GUIDANCE}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'openspec', version: '1.0' },
  };
}
```

Rationale: minimal structural change — the getter keeps returning the same object shape; only the instructions source changes. `_shared.ts` mirrors how workflows already keep shared prose (`store-selection.ts`, `_orchestration.ts`), so experts and workflows converge on one pattern. Per-getter idiosyncrasies (`navigator`'s real description + `disableModelInvocation: true`; `prototype`'s extra `CHANGE_CONTEXT_CAPTURE_GUIDANCE`; the `description: '|'` on the rest) are preserved exactly.

Alternative rejected: one giant `experts.ts` with all bodies — loses the one-file-per-skill parallel with `workflows/` that `gstack-skills-integration` already specs.

### D2 — Shared-block constants inventory (`experts/_shared.ts`)

Port exactly the 14 generator functions referenced by surviving templates into exported `const` strings (or, for the two composite/dynamic ones, small pure functions). The composite `PREAMBLE` is assembled from its four sub-parts exactly as `generatePreamble` does today (`PREAMBLE_BASH` + `ASK_USER_FORMAT` + `REPO_MODE_SECTION` + `COMPLETION_STATUS`), so its resolved text is identical.

| Constant | Source generator fn | Used by |
|---|---|---|
| `PREAMBLE` | `generatePreamble` (4 sub-parts) | all except navigator/careful/cso/guard/unfreeze use it; nearly all |
| `BROWSE_SETUP` | `generateBrowseSetup` | benchmark, browse, design-review, design-consultation, office-hours, qa, qa-only |
| `SNAPSHOT_FLAGS` | `generateSnapshotFlags` | browse |
| `COMMAND_REFERENCE` | `generateCommandReference` | browse |
| `BASE_BRANCH_DETECT` | `generateBaseBranchDetect` | codex, review, qa |
| `PLAN_FILE_REVIEW_REPORT` | `generatePlanFileReviewReport` | codex |
| `QA_METHODOLOGY` | `generateQAMethodology` | qa, qa-only |
| `DESIGN_METHODOLOGY` | `generateDesignMethodology` | design-review |
| `DESIGN_REVIEW_LITE` | `generateDesignReviewLite` | review |
| `TEST_BOOTSTRAP` | `generateTestBootstrap` | design-review, qa |
| `TEST_COVERAGE_AUDIT_REVIEW` | `generateTestCoverageAuditReview` | review |
| `ADVERSARIAL_STEP` | `generateAdversarialStep` | review |
| `DESIGN_SKETCH` | `generateDesignSketch` | office-hours |
| `SPEC_REVIEW_LOOP` | `generateSpecReviewLoop` | office-hours |

Dead resolvers dropped (no surviving template references them): `REVIEW_DASHBOARD`, `TEST_FAILURE_TRIAGE`, `TEST_COVERAGE_AUDIT_SHIP`, `BENEFITS_FROM`, `CODEX_REVIEW_STEP` (only its alias `ADVERSARIAL_STEP` is used), `DEPLOY_BOOTSTRAP`. Also dropped: the codex-host helpers (`codexSkillName`, `transformFrontmatter`, `extractHookSafetyProse`), `HOST_PATHS`, frontmatter/placeholder machinery, and the `findTemplates`/`processTemplate` driver — all part of the deleted script.

### D3 — The two code-derived blocks: freeze `COMMAND_REFERENCE` and `SNAPSHOT_FLAGS` as static constants

`generateCommandReference` / `generateSnapshotFlags` build markdown tables from `browse/src/commands` and `browse/src/snapshot`. Recommended: capture their current output once and inline it as static `const` strings in `_shared.ts` (co-located, clearly labeled as a snapshot of browse command metadata). Only the `browse` expert uses them.

Rationale: the goal is to delete the generator and single-source in TS; importing `browse/src/*` into `src/core` would pull the vendored bun tool's source into the main tsc build (risk: Bun-specific APIs, separate tsconfig) for a table that changes rarely. A frozen snapshot is the low-risk mechanical choice.

Trade-off/mitigation: if browse commands change, the browse SKILL table can drift. Mitigation (optional, deferred): a lightweight unit test that re-derives the tables from `browse/src` and asserts equality with the frozen constants — added only if drift becomes real. Alternative (rejected for now): a runtime function in `_shared.ts` importing `browse/src` — keeps single-source but couples the main build to the bun package.

### D4 — Naming scheme: drop `gstack`, keep the two-identifier structure

- `dirName`: `openspec-gstack-<name>` → `openspec-<name>` (e.g. `openspec-review`, `openspec-cso`, `openspec-prototype`). Confirmed no collision with any workflow dirName (`openspec-review` vs `openspec-review-cycle`; `openspec-office-hours` vs `openspec-opsx-office-hours`).
- `SkillTemplate.name`: `gstack:<name>` → `openspec:<name>` (e.g. `openspec:review`). This value is load-bearing: `pipelines/*.yaml` stages reference `skill: gstack:review` / `gstack:cso`, validated by the pipeline registry and its tests.

Both identifiers are renamed in lockstep across: `skill-generation.ts` (registry dirNames), `experts/*.ts` (`name`), `_orchestration.ts` + `review-cycle.ts` (delegation string `openspec-gstack-review`), `pipelines/*.yaml` (`gstack:review`, `gstack:cso`), `test/commands/review-cycle.test.ts`, `test/commands/pipeline.test.ts`, `test/core/pipeline-registry/pipeline.test.ts`, `test/core/shared/skill-sidecar-install.test.ts`, and `skills/experts/docs/AGENTS.md`.

Rationale: a 1:1 rebrand preserves the existing structure (a `name:` namespace form plus a filesystem-safe dirName), minimizing structural risk. `openspec:` parallels the retired `gstack:` namespace exactly.

### D5 — Sidecar source directory: `skills/gstack/` → `skills/experts/`, sidecars only

After inlining, the only remaining purpose of the source skill directories is sidecar reference files (checklists, `LOGIC.md`/`UI.md`, hook scripts, `references/`, `templates/`). Decision:

- Rename `skills/gstack/` → `skills/experts/`.
- In each surviving dir, delete `SKILL.md` and `SKILL.md.tmpl`; keep only sidecar files.
- Delete entirely the dirs of experts that have no sidecars (`careful`, `cso`, `codex`, `guard`, `unfreeze`, `benchmark`, `navigator`, `design-consultation`, `qa-only` — verify per-dir at apply time).
- Keep `skills/experts/docs/` (AGENTS.md, ARCHITECTURE.md, BROWSER.md) and the `browse` tree untouched by the sidecar allowlist (browse is already skipped by `copySkillSidecars`).
- Update `copySkillSidecars` source resolution from `skills/gstack/<workflowId>` to `skills/experts/<workflowId>`.

Rationale: leaving a `gstack/` directory contradicts the change's de-branding thesis, and the path is internal (not user-facing). Every spec that references `skills/gstack/...` already needs a delta for the rename/inline change, so folding the path rename into those same deltas adds little marginal cost.

### D6 — The 19 experts enter the parity golden-master

Extend `test/core/templates/skill-templates-parity.test.ts`:
- Add all 19 expert getters to the `EXPECTED_FUNCTION_HASHES` map and the function-payload `it()` (hashes recomputed once post-migration from the failing-test output).
- Add all 19 to `GENERATED_SKILL_FACTORIES` / `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` so their `generateSkillContent(...)` output is pinned.
- The existing store-selection containment `it()`s already iterate `getSkillTemplates()` and so cover experts automatically once inlined.

`skill:check` is retired; the parity test becomes the single freshness gate.

### D7 — Content-preservation verification (prove the migration is byte-identical)

Because the experts are not currently hashed, "no drift" must be proven against the *pre-migration* output, not a hash. At apply time, before deleting the generator: capture `getSkillTemplates()` expert `instructions` (the current file-reading getters' output) to a scratch file. After inlining, assert the new getters' output equals the captured baseline for all 19. Only then freeze the golden-master hashes. This makes the golden master a *derived* artifact of a verified-equal migration, not an unchecked new baseline.

**Apply-time result (line-ending normalization):** The baseline capture and byte-comparison were performed. 16/19 experts are byte-for-byte identical. 3 experts (`codex`, `design-consultation`, `office-hours`) differ *only* in line endings: their committed `SKILL.md` blobs carried CRLF, so the old `readFileSync` getters emitted CRLF, whereas an inline TS template literal normalizes CRLF→LF at parse time (per the ECMAScript spec). Verified: after normalizing CRLF→LF the three are identical to the baseline, character-for-character. This is not content drift — it makes expert `instructions` deterministic and platform-independent (LF everywhere, matching the other 16 experts and every workflow skill), instead of depending on git `autocrlf` at checkout. The CRLF-carrying `SKILL.md` files are deleted by this change, so the artifact is removed at the source. The frozen parity hashes therefore pin the LF-normalized (canonical) output.

### D8 — Orphan cleanup for renamed installs (via legacy-cleanup)

`openspec init`/`update` do not prune installed skill dirs when a skill is renamed (established fact). Renaming 19 `openspec-gstack-*` → `openspec-*` would leave 19 orphans in `.claude/skills`. Add a `legacy-cleanup` requirement: on init/update, remove any installed skill directory whose name matches the retired `openspec-gstack-*` prefix. Scoped to that exact retired prefix so it cannot touch current `openspec-*` skills or unrelated dirs.

### D9 — Toolchain deletion set (exact)

Delete: `scripts/gen-skill-docs.ts`; `package.json` scripts `gen:skill-docs` and `skill:check`; the `if (existsSync('skills')) { … bun run gen-skill-docs … }` block in `build.js`; all committed `skills/**/SKILL.md`; all `skills/**/SKILL.md.tmpl`; the root `skills/gstack/SKILL.md.tmpl`. Retain: bun (still used by `build:browse`), the `browse/` package, and the `browse` skill's sidecar-excluded src tree.

## Risks / Trade-offs

- **Silent content drift during the 19 mechanical migrations** → D7 baseline-capture-and-compare before freezing hashes; batch the migrations and run the equality check after each batch.
- **A shared-block port that isn't byte-identical (e.g. whitespace, escaped backticks in `PLAN_FILE_REVIEW_REPORT`)** → the D7 comparison catches it per-expert; the templated strings contain nested triple-backtick fences and `\`\`\`` escaping that must be copied verbatim into the TS string.
- **`COMMAND_REFERENCE`/`SNAPSHOT_FLAGS` freeze goes stale** → D3 optional consistency test; low likelihood (browse command set is stable).
- **Missing a rename reference point breaks a pipeline or delegation** → the reference inventory is enumerated in D4; `validate --strict`, the parity test, `pipeline.test.ts`, and `review-cycle.test.ts` collectively fail loudly if any is missed.
- **Zero-requirement specs left as empty files** → apply/archive must hand-delete `gen-skill-docs-path-migration` and `skill-template-generator` spec files (archiver won't); called out in tasks and proposal NOTE.
- **Orphan-prune over-reaches** → D8 matches only the exact retired `openspec-gstack-*` prefix.

## Migration Plan

1. **Ordering gate:** do not start apply until the other session's `ship-delivery-modes` (uncommitted edits to `workflows/{ship,auto,_orchestration,review-cycle}.ts`) has landed. The rename touches `_orchestration.ts` and `review-cycle.ts`; rebase the rename onto their committed content.
2. Build `experts/_shared.ts` (all 14 blocks + frozen browse tables), verifying each block's resolved text against the generator's current output.
3. Capture the D7 baseline of all 19 expert `instructions`.
4. Inline the 19 experts in batches (group by shared-block dependency: PREAMBLE-only first, then browse-family, then review/qa/office-hours), comparing to baseline after each batch.
5. Rename identifiers (D4) across src/tests/pipelines/docs; rename `skills/gstack/` → `skills/experts/` and strip `SKILL.md`/`.tmpl` (D5).
6. Delete the toolchain (D9); drop the `build.js` generator step.
7. Extend the parity test (D6), recompute hashes, add the D8 orphan-prune.
8. Verify: `pnpm build`, targeted tests (parity, review-cycle, pipeline, sidecar-install, skill-generation), full `pnpm test`, `node ./bin/openspec.js validate unify-expert-template-pipeline --strict`.

Rollback: the change is additive-then-subtractive on a branch; revert the branch. No runtime data migration.

## Open Questions

- Exact set of sidecar-less expert dirs to delete under `skills/experts/` — resolve by per-dir inspection at apply time (D5 lists the expected set; confirm before `rm`).
- Whether to land the optional D3 browse-table consistency test now or defer — default defer unless the implementer finds it cheap.
