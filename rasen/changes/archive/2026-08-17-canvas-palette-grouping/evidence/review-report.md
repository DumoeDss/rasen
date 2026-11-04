# Review report — canvas-palette-grouping (verify, round 0)

- Stage: verify (verifyPolicy standard — one pass, no fix loop). Reviewer: reviewer-2
  (independent, non-author; fresh for this change's diff).
- Date: 2026-08-17. Branch `feat/canvas-authoring-followups`, HEAD 04ebc38b.
- Target: uncommitted working-tree delta vs 04ebc38b — 11 tracked files
  (+404/-76) plus one new untracked test file (`palette-panel.test.tsx`).
- Scope check: CLEAN — exactly the expected touch set (UI: api/types.ts,
  PalettePanel.tsx, draft.ts, style.css, 3 test files + 1 new test file +
  2 fixtures; server: management-api/pipelines.ts, wire-types.ts,
  test/core/management-api/pipelines-api.test.ts). `src/core/workflow-registry/`
  is read, not edited. `bin/rasen.js` remains the known zero-content CRLF
  phantom M (ship-time pathspec note, unchanged from child 2).

## Verdict

**CLEAN — 0 Blocker / 0 Major / 0 Minor / 0 Trivial.** The implementation is a
faithful, minimal build of the planner-digest contract: optional pass-through wire
field, one pure grouping helper + one named constant in `draft.ts`, both palette
branches rendering the same model, bindability untouched, frozen areas untouched.
Independent gates: UI 68 files / 894 tests exit 0; server focused file 53/53 exit 0.

## Gate results

### Gate 1 — Wire change is pass-through only; older-server degrade lands and is pinned: PASS

- `src/core/management-api/pipelines.ts:764` — `kind: definition.kind`, verbatim
  from `WorkflowDefinition.kind` (required at `workflow-registry/types.ts:49`;
  built-ins default `task`). No invention, no renames of existing fields.
- Optional `kind?: 'task' | 'driver' | 'internal' | 'expert'` mirrored on
  `wire-types.ts:299-305` and `packages/ui/src/api/types.ts:1588-1593` (the
  `capability?` precedent), so an old UI ignores it and a new UI on an old server
  degrades uniformly.
- Degrade pins (the LEAD's specific question): unit "lands a kind-less skill (older
  server) in workflows without error, and every kind-less catalog groups without an
  experts or internal section" (`v2-authoring-model.test.ts`); component "v2: a
  skill without kind lands in workflows (driver and kind-less both there)" +
  `rasen-legacy-no-kind` fixture entry (`palette-panel.test.tsx`); server-side the
  new test asserts EVERY entry carries a kind from THIS server (so degrade is
  strictly an older-server phenomenon, spec-stated).

### Gate 2 — One home; predicate untouched; body palette unchanged: PASS

- The rule (`groupPaletteSkills`) and constant (`CORE_PALETTE_SKILL_IDS`) live in
  `draft.ts:805-884` — the draft.ts diff has ZERO deletions (purely additive;
  `isBindableSkill` and every existing export are byte-identical).
- `PalettePanel.tsx` calls the helper in both branches and renders; per-entry markup
  (testids, `isBindableSkill` gating, disabled labels, drag start) is re-indentation
  only, semantically identical.
- `V2_BODY_PALETTE_KINDS` still exactly `['AtomicStage']` (draft.ts:750).
- Core membership is exact-id set membership (explicit list, not a pattern) —
  complies with the repo's explicit-list-over-pattern-matching rule.

### Gate 3 — Frozen set: PASS

- `git status --porcelain -- src/core/pipeline-registry/` empty AND
  `git diff 04ebc38b -- src/core/pipeline-registry/` empty. The
  `src/core/management-api/` edits are expected and legitimate per the planner
  digest (only pipeline-registry is frozen).

### Gate 4 — Determinism; no name sniffing: PASS

- Single pass preserves catalog order within each bucket; core is re-ordered to the
  constant's pipeline order; repeated calls byte-identical. Pinned by "is
  deterministic under repeated calls, and a reordered catalog keeps every section a
  same-set bucket with the core order constant-driven" (membership as sets,
  catalog-order within sections for both orderings).
- Grep over added src lines for `test(`/`match(`/`startsWith`/`endsWith`/`includes(`
  beyond testids: none. Grouping reads only the delivered `kind` field and the
  core-id set.

### Gate 5 — Both branches render the same model: PASS

- Both branches consume the same `groupPaletteSkills` output through the shared
  `PaletteSection` component (one implementation, `palette-section-<id>` testids).
  The drift class round one paid for is pinned head-on: "v1 and v2 produce the SAME
  grouped order for the same fixture" asserts all four section lists equal, and
  "v2 non-Stage gestures are untouched by grouping" pins the untouched surface.
- The CDP run exercises the v2 branch against the real catalog; the v1 branch is
  jsdom-pinned via the equality test (v1 is maintenance-mode; acceptable split —
  noted, not a gap).

### Gate 6 — Test quality and traceability: PASS

- +14 UI tests (7 helper unit in `v2-authoring-model.test.ts`, 7 component in the
  new `palette-panel.test.tsx`) + 1 server test. I read every named test in the
  gates-5.md traceability table: all six scenarios AND the requirement's
  no-inference clause map to tests that exist and assert what the table claims
  (core order, bucket membership + order, determinism/reorder, kind-less degrade,
  missing core id renders nothing, disabled-in-group for both branches and both
  encodings, v1/v2 equality, server per-kind spot checks).
- Mutation discrimination (judged statically): deleting/degenerating
  `groupPaletteSkills` fails the unit order assertions, the component section
  order/membership assertions, and the CDP oracle; deleting the server
  pass-through fails the server kind assertions and the CDP live check
  ("the real catalog wire carries kind for every skill", 40/40).

### Gate 7 — Independent gates: PASS

- UI suite (fresh run, never piped): **68 files / 894 tests, exit 0, zero
  failures** — matches the claim exactly; no flake in this run. +1 file/+14 tests
  over the child-2 close (67/880), count only grew.
- Server focused file (my run): `pnpm exec vitest run
  test/core/management-api/pipelines-api.test.ts` → **1 file / 53 tests, exit 0**
  (includes the new kind test). The broader group claim (58 files / 754 pass +
  2 platform-conditional skips) was not re-run in full by this reviewer (466s);
  the focused file plus the evidence log cover the touched area.
- Evidence cross-checked: `cdp-transcript.md` (fixture-free oracle — fetches the
  real catalog, computes the expected grouping, compares the rendered DOM;
  computed-style proof of the experts' visual distinctness; the real disabled
  expert stays listed/greyed in-group; ports 9347/9348 probed free first; the
  root-`dist` rebuild requirement for `bin/rasen.js` documented), `cdp-results.json`,
  2 screenshots, `gates-5.md` with the full traceability table.

### Gate 8 — Sibling-child regressions and cleanliness: PASS

- No `legacyRuntimeOwner` in added lines; no position writes anywhere in the diff
  (child 2's placement cache untouched — the draft.ts change is purely additive
  palette vocabulary).
- Child-1 and child-2 tests all green in the 894-test run; the page-test changes
  are fixture `kind` additions only (no assertion rewrites; gates note confirms no
  page test asserted flat palette order).

## Notes (no findings; recorded for completeness)

- `gates-5.md` 5.2 lists "pre-existing errors at HEAD ... in untouched files"
  including `pipeline-canvas-page.test.tsx:7020/7124` — that FILE is touched by
  this change (fixture lines ~505-560), though those error LINES are untouched and
  no new typecheck errors were introduced. Wording nit in the evidence doc only;
  the underlying claim is accurate.
- Pre-existing UI typecheck errors at HEAD (4 files, documented in child-2's
  handoff and unchanged here) remain repo state the ship step should keep in mind;
  CI evidently does not gate on them.
- `SECTION_TITLE` labels ("Core"/"Workflows"/"Experts"/"Internal") are hardcoded
  English, matching the panel's existing hardcoded-label idiom (GESTURE_LABEL et
  al); the i18n used-key suite passes. Consistent, not a violation.
