## 1. Catalog wire: pass kind through (design D1)

- [x] 1.1 Add the optional `kind?: 'task' | 'driver' | 'internal' | 'expert'` field to `PipelineCatalogSkill` in `src/core/management-api/wire-types.ts` and mirror it in `packages/ui/src/api/types.ts`; pass `definition.kind` through in the skills mapping of `handlePipelineCatalog` (`src/core/management-api/pipelines.ts:757-776`).
- [x] 1.2 Extend the pipeline-catalog block in `test/core/management-api/pipelines-api.test.ts` (:1431+): assert `kind` is present and correct for at least one known task, driver (`rasen-auto`), internal (`rasen-review-fix` or `rasen-task-loop`), and expert (`rasen-cso` or `rasen-review`) entry.

## 2. Grouping rule in draft.ts (design D2)

- [x] 2.1 Add `CORE_PALETTE_SKILL_IDS` (the five verified ids in pipeline order) and the pure `groupPaletteSkills(skills)` helper in `packages/ui/src/canvas/draft.ts`, returning ordered sections `core` / `workflows` (task + driver) / `experts` / `internal`, original order preserved within each section, absent kind falling into `workflows`, absent core ids rendering nothing.
- [x] 2.2 Unit tests (beside the existing palette vocabulary tests): core section first in pipeline order; task/driver/expert/internal bucket membership; stability under repeated calls and reordered-but-same-set inputs; absent-kind tolerance; a core id missing from the catalog renders nothing; a disabled skill stays inside its group.

## 3. PalettePanel renders the groups (design D3)

- [x] 3.1 Rework `PalettePanel.tsx` to render `groupPaletteSkills` output in BOTH branches: per-section headings with stable testids (`palette-section-core`, `-workflows`, `-experts`, `-internal`), v2 Stage expansion buttons and v1 DnD cards unchanged per entry (`isBindableSkill` gating, disabled state labels, drag start all preserved); the v2 non-Stage gestures untouched.
- [x] 3.2 Section styles in `packages/ui/src/style.css`: distinct heading treatment for the experts section (structure in markup, visual distinctness proven in the real-browser check).
- [x] 3.3 Component tests for both branches: core five lead in pipeline order with section testids present; experts section contains exactly the expert-kind fixture skills; internal section after experts; a fixture skill without `kind` lands in workflows; a disabled skill renders disabled inside its group; v1 branch and v2 branch produce the same grouped order for the same fixture.
- [x] 3.4 Update the UI catalog fixtures (`packages/ui/test/fixtures/pipelines.ts` and the canvas authoring catalog fixture) to carry `kind`, and update any page tests that assert flat palette order.

## 4. Real-browser CDP check (repo-trap protocol)

- [x] 4.1 Build `packages/ui`, serve with `node bin/rasen.js ui --no-open --no-daemon --port <fresh 9345+>`, drive a throwaway Chrome (`--window-size=1600,1000`, fresh `--user-data-dir`, direct CDP): open a pipeline edit session, assert the palette renders against the REAL installed skills set — the five core skills lead in pipeline order, the experts (rasen-cso, rasen-review, etc.) render in a visually distinct section, internals render in their own trailing section, and no skill that the flat list showed has disappeared. Save the transcript under `evidence/` (with the port used).

## 5. Gates

- [x] 5.1 Full UI suite, CI-canonical: `pnpm --dir packages/ui exec vitest run`, never piped through `tail`; cite file and test counts against the 67 files / 880 baseline (count must only grow); failures enumerated in full; Windows flake re-run in isolation before blaming the delta.
- [x] 5.2 Server suite for the touched area under the root config (at minimum `test/core/management-api/pipelines-api.test.ts`, then the broader management-api group), cited counts.
- [x] 5.3 Frozen-and-clean assert: `git status --porcelain -- src/core/pipeline-registry/` empty and `git diff fb243e83 -- src/core/pipeline-registry/` empty; `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`; no `legacyRuntimeOwner`; no position writes anywhere in the diff (child 2's placement cache untouched).
- [x] 5.4 Traceability pass: every scenario in `specs/pipelines-ui/spec.md`'s ADDED requirement maps to at least one task 2.x/3.x test or a 4.1 CDP step by name (list the mapping in the verify notes).
