# Handoff — implementer-1, canvas-palette-grouping (apply, DONE)

## State at stand-down

- 13/13 apply tasks ticked (`rasen/changes/canvas-palette-grouping/tasks.md`;
  the round-2 brief said "12 tasks" — tasks.md carries 13 lines, 5.4
  traceability being its own line).
- Working tree carries the implementation UNCOMMITTED (shipper's job),
  exactly 11 tracked files + 1 new test file (plus the change dir):
  - `src/core/management-api/wire-types.ts` — optional
    `kind?: 'task' | 'driver' | 'internal' | 'expert'` on
    `PipelineCatalogSkill` (the `capability?` precedent; doc comment states
    the degrade-to-workflows semantics).
  - `src/core/management-api/pipelines.ts` — `handlePipelineCatalog` maps
    `kind: definition.kind` through (pass-through only; zero inference).
  - `packages/ui/src/api/types.ts` — the UI mirror of the optional field.
  - `packages/ui/src/canvas/draft.ts` — `CORE_PALETTE_SKILL_IDS` (the five
    verified template ids, pipeline order), exported `PaletteSectionId`,
    `PaletteSkillSection`, and the pure `groupPaletteSkills(skills)`:
    core (CONSTANT order, not catalog order) / workflows (task+driver+absent
    kind, catalog order) / experts / internal; EMPTY SECTIONS ARE OMITTED
    (an absent core id renders nothing; a kind-less catalog renders no
    experts/internal headings).
  - `packages/ui/src/canvas/PalettePanel.tsx` — both branches render
    `groupPaletteSkills` output via a shared internal `PaletteSection`
    component (headings `palette-section-{core,workflows,experts,internal}`
    testids; per-entry markup byte-equivalent to before: `isBindableSkill`
    gating, state labels, DnD drag start all preserved; v2 non-Stage
    gestures untouched). In v2 the sections nest INSIDE the Stage gesture
    group.
  - `packages/ui/src/style.css` — `.palette-section` / `.palette-section__title`
    (+ `--experts` modifier: accent color + inset underline).
  - Tests: `packages/ui/test/canvas/palette-panel.test.tsx` (NEW, 7 tests,
    both branches), `v2-authoring-model.test.ts` (+7 unit tests beside the
    palette vocabulary tests), `pipelines-api.test.ts` (+1 server test:
    every entry kind-defined + 6 per-kind spot checks),
    fixtures `canvas-v2-authoring.ts` / page-test `catalogFixture` /
    `v2CatalogWithUnplaceableSkills` / composite-export fixture now carry
    `kind`.
- Suites (CI-canonical, never tail-piped; logs in
  `.rasen/changes/canvas-palette-grouping/`):
  - UI: **68 files / 894 tests, exit 0** (baseline 67/880; +1 file +14
    tests). Run 1 had ONE failure — `test/i18n/catalog.test.ts` "all literal
    catalog keys…" timed out at its 5000ms budget under full-suite load
    (duration 57s, environment 388s cumulative); isolated re-run 12/12 in
    107ms → contention flake, not the delta; full-suite re-run then fully
    green.
  - Server (root config): targeted `pipelines-api.test.ts` 1 file / 53
    tests green; broader `test/core/management-api/` **58 files / 754
    passed + 2 skipped (756), exit 0** (both skips are pre-existing
    platform-conditional `skipIf`s — planning-scope-routing:230 win32,
    supervisor-injection:29 off-Windows).
- Real browser (task 4.1): **ALL 11 CHECKS PASSED** against the REAL
  installed skills set (40 skills: 18 task / 2 driver / 13 expert / 7
  internal; one disabled expert). App port 9347, CDP port 9348 (probed
  9345-9348 free; child 2 had released 9345/9346). Throwaway Chrome 151
  headless killed via its profile marker; profile dir removed; server
  stopped; both ports released. Evidence: `evidence/cdp-transcript.md`,
  `cdp-results.json`, 2 screenshots, rerunnable
  `cdp-palette-grouping-check.mjs`. `evidence/gates-5.md` carries 5.1–5.4
  (counts + full scenario→test/CDP traceability table).

## Decisions made during apply (successor must know)

1. **Empty sections are OMITTED by the helper, not hidden by the panel.**
   The design's "absent core ids render nothing" generalizes: a catalog
   with no experts renders no Experts heading at all. Both branches and the
   CDP driver rely on this (section testids exist only for non-empty
   groups).
2. **Core order is the CONSTANT's pipeline order, not catalog order** — the
   spec's "in pipeline order (propose, apply, review, ship, archive)"
   overrides the within-section catalog-order rule for the core five only.
3. **`bin/rasen.js` serves ROOT `dist/`, not `src/`** — the first CDP probe
   showed all kinds NONE because only `packages/ui` had been rebuilt. Any
   future change touching `src/core/management-api/` (or any src/) must
   `pnpm run build` at the ROOT before serving `rasen ui` for browser
   checks. UI-only changes don't hit this.
4. **The CDP "distinct experts heading" check is theme-relative by
   construction**: components consume `var(--accent)`, and this machine's
   active runtime theme overrides `--accent` to #e61a1a (a value that
   appears nowhere in the repo — it came from the theme layer). The check
   asserts experts != workflows under the LIVE theme, which is the honest
   claim; under the stock light theme it resolves to terracotta #c96442.

## Eliminated hypotheses (the one debugging arc)

- Full-suite run-1 failure (i18n used-key scan timeout): suspected my
  new files first — but the failing test only READS src for t()/tNow()
  literals and my code calls neither; isolated re-run green in 107ms;
  second full run green. Contention under 68-file parallel load, not the
  delta. (Same signature as the known Windows flake class.)
- CDP run-1's single FAIL was a DRIVER bug (selector `palette-section-expert`
  singular vs the plural `experts` testid) — product behavior (greyed +
  named state inside the group) was already correct in the returned JSON.

## Durable notes / residue

- Task 3.4 names `packages/ui/test/fixtures/pipelines.ts` as a catalog
  fixture — that file holds List/Detail/Config/ThresholdScheme fixtures
  only, NO catalog. The real catalog fixtures are
  `CANVAS_V2_AUTHORING_CATALOG` (fixtures/canvas-v2-authoring.ts) and the
  page-test-local catalog fixtures (all updated with `kind`). Grep proved
  NO page test asserts flat palette order, so none needed rewriting.
- The consultation suites' `makeCatalog` helpers
  (v2-node-panel-consultation, consultation-binding-editor) do NOT feed the
  palette and were deliberately left kind-less — the field is optional.
- Untracked residue NOT to stage: `.rasen/changes/canvas-palette-grouping/*`
  run-state (suite logs), sibling `.rasen/changes/*` mirrors, the
  content-empty CRLF phantom `bin/rasen.js`, and the stray
  `test-pipeline-e2e-ackloss-tmp/` + `.rasen-*` dirs that predate this
  worktree session.
- Pre-existing `pnpm --dir packages/ui run typecheck` errors at HEAD remain
  in untouched files (ConsultationBindingEditor.tsx, IssuesDrawer.tsx,
  v2-node-panel-consultation.test.tsx, pipeline-canvas-page.test.tsx:7020/
  7124) — verified unchanged by this delta; all five of my src files
  typecheck clean.

## Next action

Verify (rasen-verify-change): artifacts vs implementation,
`evidence/gates-5.md` + `evidence/cdp-transcript.md` (scenario table at the
bottom of gates-5.md is the 5.4 mapping). Then ship with a narrow pathspec:
the 12 code/test files + `rasen/changes/canvas-palette-grouping/` (LF
discipline; `git diff --check` clean on evidence; never `git add -A`;
exclude `signals/` dirs at archive time per the repo trap).
