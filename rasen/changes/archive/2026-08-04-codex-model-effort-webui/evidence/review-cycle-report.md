# Review Cycle: codex-model-effort-webui

Rounds: 1/3
Tier: A (role-isolated fixer plus fresh non-author reviewer)
Status: CLEAN

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Disposition |
|---|---:|---|---|---|---|
| 1 | 0/1/1/0 | M1: non-trivial responsive containment; m1: mechanical stale-comment correction | `fixer-1` | `reviewer-2` (fresh delta re-review) | 2/2 resolved; no open findings |

## Independent finding confirmation

### M1 — Defaults matrix narrow-viewport overflow — RESOLVED

- The three-column table is now the direct child of the scoped `.defaults-matrix-scroll` wrapper.
- The wrapper's `min-width: 0`, `max-width: 100%`, and `overflow-x: auto` clamp it to the Defaults card's content box and make the table's excess width scroll inside that box instead of contributing page/card width.
- The table deliberately retains `width: 100%` plus `min-width: 480px`: at ordinary desktop widths it fills the available card width exactly as before, while below 480px it preserves viable space for the role column, the 150px model control, the 120px effort control, cell padding, and wrapped evidence badges rather than crushing the controls.
- The existing `@media (max-width: 720px)` stage behavior remains unchanged: `.stage-row { grid-template-columns: 1fr; }`. The Defaults scroller is scoped and does not alter the stage grid or its breakpoint.
- The regression coverage is meaningful as a two-part contract: the component test pins the table-to-wrapper DOM relationship, and `pipelines-defaults-containment.test.ts` independently pins every CSS declaration required for containment plus the 480px table floor. Removing the wrapper, scroll containment, width clamp, or table minimum makes a focused test fail.

### m1 — Stale Model/Effort comments — RESOLVED

- The Defaults matrix comment now describes Model and Effort.
- The per-stage control comment now describes gate/model/effort overrides.
- The standalone UI `WirePipelineStage` contract comment now includes effective reasoning effort with gate, model, handoff, and runtime.

## Feature-wide re-review

| Requirement focus | Independent result | Evidence |
|---|---|---|
| Scope-aware default effort editing | PASS | Each fixed effort select derives its editing choice from `scopeValues[writeScope]`; writes/deletes use the active Global/Local scope and re-render from the returned entry. |
| Scope-aware stage effort editing | PASS | The stage select reads the exact instance's `scopeValues[scope]`, separately renders backend `effectiveEffort`, deletes only the active scope on Inherit, and refreshes the pipeline inventory after writes. |
| Wildcard identity | PASS | `updateEntry` matches concrete wildcard entries by exact `instanceKey`, fixed/template entries by definition key only, and appends a newly returned absent/configured instance without replacing siblings. |
| Registry effort domain | PASS | Fixed cells consume their serialized enum constraints; stage cells consume the exact `pipelines.<name>.efforts.<stage>` template constraints. Both originate from backend `LEAF_EFFORTS`; there is no UI-owned effort enum. |
| Luna/Terra and arbitrary ids | PASS | `gpt-5.6-luna` and `gpt-5.6-terra` are additive shared datalist suggestions, resolve through the existing `gpt-5` preset, and text inputs still send arbitrary non-empty ids unchanged on both Defaults and stage surfaces. |
| i18n | PASS | Effort label/effective/runtime-default copy is catalog-backed in en/zh-cn/ja; Inherit reuses an existing translated key; effort values, model ids, config paths, and provenance stay untranslated. |
| API wire values | PASS | The UI mirror requires `effectiveEffort`; typed collection/detail fixtures carry value/source pairs; the real management inventory and detail test proves configured `max` and absent `null` wire values with their independent sources. |
| Existing Configure behavior | PASS | Gate/model/runtime controls and the handoff-free Configure surface remain intact; the stage layout still collapses at the existing 720px breakpoint. |

## Test evidence

Required scope: focused Pipelines DOM/CSS and behavior regressions, config/model suggestion and i18n coverage, typed wire fixtures, real management inventory/detail coverage, UI static type safety, strict change validation, and diff hygiene.

Rationale: M1 was a DOM-plus-CSS containment defect, so the focused pair pins both sides of that exact contract. The broader focused UI tests exercise the feature's write/delete/refresh and wildcard identity paths; the management test exercises actual API wire output rather than fixture-only assumptions; typecheck covers the hand-maintained UI mirror. The fresh author-side full UI suite/build evidence was inspected as a surrounding-regression check and was not trusted as the sole gate.

| Command | Result |
|---|---|
| `pnpm exec vitest run test/components/pipelines-page.test.tsx test/style/pipelines-defaults-containment.test.ts test/config/controls.test.ts test/i18n/catalog.test.ts test/api/fixtures.test.ts --maxWorkers=2` (from `packages/ui`) | PASS — 5 files, 76 tests |
| `pnpm exec vitest run test/core/management-api/pipelines-api.test.ts --maxWorkers=2` | PASS — 1 file, 44 tests |
| `pnpm run typecheck` (from `packages/ui`) | PASS |
| `node bin/rasen.js validate codex-model-effort-webui --strict --json` | PASS — 1/1 valid, no issues |
| `git diff --check 4e5942c7d7465bbf031fc41df9414a130b2f8597` | PASS |
| Fresh author-side `pnpm exec vitest run --maxWorkers=2` (from `packages/ui`) | PASS — 57 files, 615 tests |
| Fresh author-side `pnpm run build` (from `packages/ui`) | PASS — 547 modules transformed |

Reviewed baseline/current HEAD: `4e5942c7d7465bbf031fc41df9414a130b2f8597` (the feature and fixes are the uncommitted working delta).
Required content tree fingerprint from `git rev-parse HEAD^{tree}`: `eb8f8b591cc199a9f4242b2929c40e5248fc699b`.
Untracked containment-test blob fingerprint: `55596e55f1e0822626a8ffd8337fd1cd2bef0c84`.

## Open findings

None. Author != verifier is satisfied: `fixer-1` authored the resolutions and the fresh `reviewer-2` independently diff-read and gate-ran them.
