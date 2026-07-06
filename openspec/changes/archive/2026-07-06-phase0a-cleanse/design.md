# Design — phase0a-cleanse

## Context

`gen-skill-docs.ts` renders `skills/gstack/<name>/SKILL.md` from `<name>/SKILL.md.tmpl` by substituting `{{PLACEHOLDER}}` tokens. Some polluted content lives in the `.tmpl` files; some lives in the TypeScript generator functions that resolve placeholders. A third class (`skills/gstack/review/*.md`) is static and copied verbatim — not generated. Every edit must target the correct source, then the build products are re-rendered.

`bun` 1.2.2 is available on this machine, so re-rendering is `bun run gen:skill-docs` and the freshness gate is `bun run skill:check`. No manual dual-editing of `.tmpl` + `SKILL.md` is required.

## Key decisions

### D1. Source of truth per pollution class

| Pollution | Source to edit | Re-render? |
|---|---|---|
| Founder cards, ycombinator, Powered-by-gstack, garrytan example data | the specific `.tmpl` files | yes |
| Rails/Vitest `ship` steps, co-author trailer | `ship`/`document-release` `.tmpl` | yes |
| eureka jsonl writer, review-dashboard / design-review-lite stubs | `gen-skill-docs.ts` generator functions | yes |
| eureka reader, global-mode section, per-skill pending stubs | the specific `.tmpl` files | yes |
| stray CC+gstack, GStack-reply prose, `garrytan/myapp` rows, `~/.gstack` | `skills/gstack/review/*.md` (static) | no (edit in place) |

The static `review/*.md` files are the reason the prior `branding-migration` (which asserted freshly-generated files carry no `CC+gstack`) still leaves residue: those files are never regenerated. This change edits them directly.

### D2. Preamble boundary with phase0b

The eureka jsonl **writer** sits inside `generateSearchBeforeBuildingSection`, which is part of the preamble bundle that phase0b deletes wholesale. To keep phase0a's telemetry mandate self-contained (each phase commits independently) yet avoid churning code phase0b will remove:

- phase0a removes **only** the jq-append block (the `Log eureka moments … >> ~/.openspec/analytics/eureka.jsonl` lines) from that function. The surrounding "Search Before Building" methodology prose and the EUREKA-naming sentence are left intact for phase0b's full-preamble removal.
- `generateReviewDashboard` and `generateDesignReviewLite` are **not** in the preamble bundle (they are standalone `{{REVIEW_DASHBOARD}}` / `{{DESIGN_REVIEW_LITE}}` placeholders), so their stubs survive preamble removal and are phase0a's responsibility.
- `generateCompletionStatus`'s Plan Status Footer stub (also preamble-internal) was **originally** slated to be left for phase0b's wholesale preamble removal. **LEAD ruling (2026-07-06): pulled forward into phase0a.** Leaving it propagated a `pending OpenSpec integration` stub into every generated skill via `{{PREAMBLE}}`, which made the §9.3 residue gate and the `dead-stub-removal` scenario "no pending stubs in any generated skill" unsatisfiable within phase0a. phase0a now surgically removes only the dead bash block (and the unreachable "if output contains review entries" branch), keeping the rest of the function for phase0b. This mirrors the eureka-jsonl surgical precedent and does not conflict with phase0b (which still deletes the whole — now stub-free — function).

The eureka-jsonl split means the two phases edit `generateSearchBeforeBuildingSection` in sequence without overlapping line ranges — no conflict, since commits are sequential.

### D3. EUREKA technique retained, file-logging removed

The EUREKA concept (naming a first-principles insight in prose) is a reasoning technique, not telemetry. Only the persistence to `eureka.jsonl` is removed. In `office-hours` and `design-consultation`, the "name the insight" sentence stays; the trailing "Log the eureka moment (see preamble)" clause is stripped. In `retro`, the entire "Eureka Moments" metrics row is removed because it exists solely to read the now-deleted file.

### D4. Dead-stub removal, not stubbing-with-a-note

The `pending OpenSpec integration` blocks front a backend (review-log store / dashboard / diff-scope tool) that does not exist in this fork. Where the block is the whole point of a passage (e.g. `autoplan`'s "Write Review Logs", the plan-review "Review Log" sections, `codex` step 7 "Persist the review result"), the passage is removed. Where a block sits above still-working code (e.g. `generateDesignReviewLite`'s diff-scope comment above a real `git diff … grep` fallback), only the dead comment/log line is removed and the working logic is kept. The `retro` global-mode branch already tells the user "not yet available … stop", so the whole Global Step 1–N block is removed rather than left as a dead path.

**Addendum (implementation, 2026-07-06):** implementation found three additional `pending OpenSpec integration` stubs the planner sweep did not enumerate, all inside `generateAdversarialStep` (a dead `OLD_CFG` opt-out check plus two "persist the review result" blocks). This is a standalone `{{ADVERSARIAL_STEP}}`/`{{CODEX_REVIEW_STEP}}` placeholder (non-preamble), so its stubs reach generated `codex`/`ship`/`qa`/etc. skills and are phase0a's responsibility, not phase0b's. They were removed under this same D4 policy (whole-passage removal for the persist blocks; opt-out feature removal for the dead `OLD_CFG` branch, keeping the working diff-size detection).

### D5. greptile-triage GStack-reply prose

`review/greptile-triage.md` describes replies the skill posts and detects on PR threads, marked as "prior GStack reply". Since this fork stays branded "OpenSpec" (not renamed), these are genericized to "prior automated review reply" and the `**Fixed**` / `**Not a bug.**` markers are kept (they are functional detection tokens, not brand). The `~/.gstack` state dir is normalized to `~/.openspec` (consistent with the existing `gstack-skills-integration` path-reference requirement), and `garrytan/myapp` example rows become `owner/myapp`. `browse/bin/remote-slug` and `gstack-diff-scope` bin references are structural tool names — left as-is (out of scope, and browse is a productization rewrite).

## Verification strategy

1. `bun run gen:skill-docs` — re-render all SKILL.md.
2. `bun run skill:check` — dry-run freshness; must exit 0 (proves committed SKILL.md matches cleansed sources).
3. Residue greps must return nothing in `.tmpl` + generator + generated `.md`: `Garry Tan`, `ycombinator.com/apply`, `Powered by gstack`, `garrytan/gstack`, `eureka.jsonl`, `pending OpenSpec integration`, `RAILS_ENV`, `bin/test-lane`, `Claude Opus 4.6`.
4. `npm run test` for `test/core/shared/skill-generation.test.ts` and `test/core/templates/skill-templates-parity.test.ts` — these hash only the OPSX-core workflow templates (explore/propose/apply/…), not gstack experts, so they must remain green; a failure signals accidental spillover into core. Run targeted to avoid the known global-config test-isolation flakiness in the full suite.
