# Gates — canvas-palette-grouping (tasks 5.1–5.4)

## 5.1 Full UI suite (CI-canonical)

Command: `pnpm --dir packages/ui exec vitest run` (run in background, never
piped through `tail`).

- RESULT (final run): 68 files / 894 tests, exit 0, zero failures.
- Run 1: 68 files / 894 tests with 1 failure — `test/i18n/catalog.test.ts` >
  "all literal catalog keys referenced in src exist in en.json" timed out at
  its 5000ms budget under full-suite parallel load (duration 57s,
  environment 388s cumulative). Timeout, not assertion — the Windows flake
  signature. Re-run IN ISOLATION: 1 file / 12 tests green in 107ms (the whole
  file: 1.83s), confirming contention, not the delta. Full suite then re-run
  clean (the final-run citation above).
- Baseline 67 files / 880 (child-2 close): +1 file (`palette-panel.test.tsx`,
  +7 tests), +7 tests in `v2-authoring-model.test.ts` (42 → 49). Count only
  grew, as the gate requires.

## 5.2 Server suite (root config)

- Targeted file first: `pnpm exec vitest run
  test/core/management-api/pipelines-api.test.ts` → 1 file / 53 tests, exit 0
  (includes the new "carries each workflow kind from the registry through to
  every skill entry" test).
- Broader management-api group: `pnpm exec vitest run test/core/management-api/`
  → 58 files / 754 passed + 2 skipped (756 total), exit 0, zero failures,
  duration 466s. (The 2 skips are the group's pre-existing platform-conditional
  skips, not this change.) Run log kept at
  `.rasen/changes/canvas-palette-grouping/server-group-run.log` (run-state,
  never staged).
- (Also exercised before either suite: the UI package typecheck — no NEW
  errors; the pre-existing errors at HEAD documented in child-2's handoff
  remain in untouched files: ConsultationBindingEditor.tsx, IssuesDrawer.tsx,
  v2-node-panel-consultation.test.tsx, pipeline-canvas-page.test.tsx:7020/7124.)

## 5.3 Frozen-and-clean asserts (all verified at the working tree)

- `git status --porcelain -- src/core/pipeline-registry/` → EMPTY (clean).
- `git diff fb243e83 -- src/core/pipeline-registry/` → EMPTY (frozen since
  the branch base).
- `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` (`draft.ts:750`).
- No added `legacyRuntimeOwner` anywhere in the diff (grep over added lines).
- No position writes in the diff (no `authorPositions`/`positionRef`/`.x =`
  in any added UI line) — child 2's placement cache is untouched.
- Tracked files touched (narrow set): `src/core/management-api/pipelines.ts`,
  `src/core/management-api/wire-types.ts`, `test/core/management-api/pipelines-api.test.ts`,
  `packages/ui/src/api/types.ts`, `packages/ui/src/canvas/draft.ts`,
  `packages/ui/src/canvas/PalettePanel.tsx`, `packages/ui/src/style.css`,
  `packages/ui/test/canvas/{palette-panel.test.tsx (new), v2-authoring-model.test.ts,
  pipeline-canvas-page.test.tsx, canvas-authored-composite-export.test.tsx}`,
  `packages/ui/test/fixtures/canvas-v2-authoring.ts`. No
  `src/core/pipeline-registry/` file appears.

## 5.4 Traceability — every ADDED scenario → named test / CDP step

Source: `rasen/changes/canvas-palette-grouping/specs/pipelines-ui/spec.md`
("Requirement: The palette groups the stage vocabulary").

| Scenario | Coverage (by name) |
| --- | --- |
| The core stages lead the palette | Unit: `groupPaletteSkills (canvas-palette-grouping design D2)` > "puts the core five first in PIPELINE order even when the catalog delivers them scattered" (`v2-authoring-model.test.ts`); Component: "v2 Stage expansion: the core five lead in pipeline order with every section testid present" and "v1 cards: same sections, core first in pipeline order…" (`palette-panel.test.tsx`); CDP step A (real catalog). |
| Experts render in their own distinct section | Unit: "buckets task and driver into workflows, expert and internal into their own sections…"; Component: "v2: experts section contains exactly the expert-kind skills; internal renders after experts"; CDP step B (membership, after workflows) + step "B (visual)" (computed style distinct on-screen: experts heading rgb(230,25,25)+underline vs workflows rgb(138,138,135)) + screenshot 02. |
| Ordinary and internal workflows keep stable order in their own sections | Unit: "is deterministic under repeated calls, and a reordered catalog keeps every section a same-set bucket with the core order constant-driven" + "buckets…" (catalog-order preservation); Component: "v2: a skill without kind lands in workflows" (order asserted) + "v1 cards…" (same lists); CDP steps C ("internals render in their own TRAILING section, after experts", 7/7) and "the workflows section holds the remaining ordinary workflows in stable catalog order" (15/15). |
| A catalog without kind metadata still groups | Unit: "lands a kind-less skill (older server) in workflows without error, and every kind-less catalog groups without an experts or internal section"; Component: "v2: a skill without kind lands in workflows (driver and kind-less both there)" + the v1 assertion of the same list; fixture entry `rasen-legacy-no-kind`. |
| Both palette branches present the same groups | Component: "v1 and v2 produce the SAME grouped order for the same fixture" (asserts all four section lists equal); plus "v2 non-Stage gestures are untouched by grouping" (the non-Stage branch surface unchanged). |
| Grouping never changes bindability | Unit: "keeps a disabled skill inside its group (grouping never touches bindability)"; Component: "v2: a disabled skill renders disabled INSIDE its group (bindability unchanged by grouping)" + the v1 disabled-card assertions in "v1 cards…"; CDP step E (the REAL disabled skill `rasen-teacher-advisor`, kind expert, greyed + named state inside the experts section). |
| (Requirement prose) "Grouping SHALL rest on the skill's declared workflow kind as delivered by the pipeline catalog … SHALL NOT infer" | Server: "carries each workflow kind from the registry through to every skill entry (canvas-palette-grouping)" (`pipelines-api.test.ts`, every entry kind-defined + 6 per-kind spot checks); CDP live check "the real catalog wire carries kind for every skill (the pass-through, live)" (40/40 on the running server). |

## Notes

- The CDP run additionally proves the wire end-to-end against the REAL
  installed skills set (40 skills: 18 task / 2 driver / 13 expert / 7
  internal; one disabled) — see `evidence/cdp-transcript.md` (app port 9347,
  CDP port 9348; the root `dist` had to be rebuilt for `bin/rasen.js` to
  serve the kind pass-through).
- `packages/ui/test/fixtures/pipelines.ts` (named in task 3.4) contains no
  pipeline-catalog fixture — it holds List/Detail/Config/ThresholdScheme
  fixtures. The actual catalog fixtures the palette consumes are
  `CANVAS_V2_AUTHORING_CATALOG` (`canvas-v2-authoring.ts`) and the
  page-test-local `catalogFixture`/`v2CatalogFixture`/
  `v2CatalogWithUnplaceableSkills` plus the composite-export local fixture;
  all of those now carry `kind`. Grep confirmed NO page test asserted flat
  palette order, so none needed rewriting (per-entry testids are unchanged
  under the new section wrappers — the three fixture-consuming suites re-ran
  green, 144/144).
