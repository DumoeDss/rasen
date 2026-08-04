# Review Report — codex-model-effort-webui

**Reviewer:** role-isolated leaf reviewer (report-only; no implementation/test edits)
**Baseline:** exact prior-green HEAD `4e5942c7d7465bbf031fc41df9414a130b2f8597`
**PR context:** #134, `feat/codex-luna-thread-dispatch` → `dev/0.2.0`
**Scope:** 13 tracked uncommitted files (+733/-23) plus all untracked `rasen/changes/codex-model-effort-webui/**` artifacts
**Verdict:** **DONE_WITH_CONCERNS** — 0 Blocker, 1 Major, 1 Minor.

## Scope check

**CLEAN.** The delta stays within the requested WebUI follow-up: the UI wire mirror, Pipelines controls/styles, model suggestions, three locale catalogs, typed fixtures, focused UI tests, and management Pipelines API coverage. No backend resolver/runtime implementation or pipeline-definition mutation was added.

## Findings

### Major

#### M1 — The new three-column Defaults matrix overflows narrow viewports

**Location:** `packages/ui/src/style.css:1365`, `:1379-1380`, `:1510-1517`
**Axis:** Spec + Standards (responsive layout / View-Frontend)
**Confidence:** High

The added Effort column keeps the table at `width: 100%`, while Model and Effort controls impose 150px and 120px minimum widths and every table cell adds horizontal padding. The only Pipelines narrow-screen rule collapses `.stage-row`; it does not adapt or contain `.defaults-matrix`. At a 390px viewport, the nested app/page/card padding leaves about 230px for the table, while the role + model + effort columns require well over 400px. The result is page/card horizontal overflow on a plausible user path, contrary to the requested responsive/no-overflow behavior and design task 2.4.

**Recommended fix:** add an explicit narrow-layout treatment for the Defaults matrix (responsive row layout or a deliberately contained/scoped horizontal scroller), then verify at phone widths with a browser/layout regression check. Preserve the existing desktop matrix and stage-row breakpoint.

### Minor

#### m1 — Changed-file comments still describe the removed matrix/stage shape

**Location:** `packages/ui/src/components/PipelinesPage.tsx:444,774`; `packages/ui/src/api/types.ts:215`
**Axis:** Standards (Dead Code & Consistency)
**Confidence:** High

The Defaults comment still says the second column is “Handoff threshold,” the stage-section comment still says “gate / model overrides,” and the UI wire-type comment omits effective effort. The rendered/code behavior is correct, but these comments now contradict or incompletely describe the edited surface.

**Recommended fix:** update the comments to Model/Effort and gate/model/effort, and include effort in the effective-stage wire-contract description.

## Required-focus verification

| Focus | Result | Evidence |
|---|---|---|
| Frontend/backend `effectiveEffort` shape | PASS | UI mirror uses `WireEffectiveValue<string \| null>`; backend mirror and both inventory/detail mappers expose the same value/source pair. |
| Six role rows expose Model + Effort | PASS | `MATRIX_ROLES` maps default/planner/implementer/reviewer/fixer/shipper to both exact keys; component test asserts all six rows and headings. |
| Registry-driven effort domains | PASS | Fixed cells read `entry.definition.constraints.enumValues`; stages read the exact `pipelines.<name>.efforts.<stage>` template constraints. No frontend effort constant was added. |
| Active editing vs effective display | PASS | Stage choice uses exact `instanceKey` + `scopeValues[scope]`; displayed value/source comes only from backend `stage.effectiveEffort`. Shadowed Global behavior is tested. |
| Wildcard identity safety | PASS | `updateEntry` matches concrete entries by exact `instanceKey`, fixed/template entries only by definition key, and appends absent returned instances. Sibling-preservation test passes. |
| Inherit semantics and refresh | PASS | Stage Inherit calls `deleteKey(instanceKey, activeScope, selector)`, updates the returned config entry, then refreshes the Pipelines inventory; lower-winner test passes. |
| Luna/Terra suggestions, custom IDs | PASS | Shared datalist adds Luna/Terra without removing Claude suggestions; defaults and stage tests write `vendor/future-model-42` unchanged. |
| en/zh-cn/ja catalogs | PASS | All new labels use catalog keys; parity/non-empty/non-English-fallback assertions pass. Domain values and provenance remain untranslated. |
| Existing gate/model/runtime behavior | PASS | Focused and full UI suites pass; no related production path changed beyond shared instance-writer response typing. |
| Management API effort proof | PASS | Inventory and detail test assert configured `{ value: "max", source: "stage-override-project" }` and absent `{ value: null, source: "default" }`. |
| Responsive behavior | **FAIL — M1** | Stage grid retains its single-column breakpoint, but the new Defaults column has no narrow-screen adaptation or overflow containment. |

## Coverage map

```text
Defaults role effort
  enum domain from serialized fixed entry      TESTED
  project/global write                          TESTED
  active-scope inherit/delete + lower winner    TESTED
  store-inherited read-only treatment           TESTED

Per-stage effort
  exact template enum domain                    TESTED
  exact wildcard instance + scoped choice       TESTED
  backend effective value/source                TESTED
  set → config update → pipeline refresh        TESTED
  inherit deletes only active scope             TESTED
  shadowed Global edit                           TESTED
  sibling identity preservation                  TESTED

Model/i18n/wire
  Luna/Terra on both suggestion surfaces         TESTED
  arbitrary custom model passthrough             TESTED
  three-catalog parity/no fallback                TESTED
  typed collection/detail fixtures               TESTED
  management inventory/detail value+source       TESTED

Responsive user flow
  narrow Defaults matrix                         GAP / FAIL (M1)
```

## Verification evidence

- Focused UI: `pnpm exec vitest run test/components/pipelines-page.test.tsx test/config/controls.test.ts test/i18n/catalog.test.ts test/api/fixtures.test.ts --maxWorkers=2` — **4 files, 75 tests passed**.
- Management API: `pnpm exec vitest run test/core/management-api/pipelines-api.test.ts --maxWorkers=2` — **1 file, 44 tests passed**.
- UI typecheck: `pnpm run typecheck` — **PASS**.
- UI production build: `pnpm run build` — **PASS**, 547 modules transformed.
- Full UI suite: `pnpm exec vitest run --maxWorkers=2` — **56 files, 614 tests passed**. Existing jsdom “navigation/window.scrollTo not implemented” stderr remained non-fatal and outside this delta.
- Change validation: `node bin/rasen.js validate codex-model-effort-webui --strict --json` — **PASS**, 1/1 valid.
- `git diff --check 4e5942c7d7465bbf031fc41df9414a130b2f8597` — **PASS**.
- Greptile: PR #134 currently has **0 active line-level and 0 top-level Greptile comments**.

## Standards axis

**2 findings; worst: Major.** M1 is a concrete responsive overflow regression; m1 is stale changed-file documentation. No SQL/data, concurrency, trust-boundary, enum-completeness, dependency, or bundle-growth issue was found.

## Spec axis

**1 finding; worst: Major.** All behavioral requirements are implemented and independently green except the requested responsive/no-overflow behavior (M1).
