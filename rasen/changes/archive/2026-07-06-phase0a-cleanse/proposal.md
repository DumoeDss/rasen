## Why

The gstack expert skills in this fork were transplanted from Garry Tan's private repo and still carry author-specific residue that a prior `branding-migration` pass did not catch. Concretely, the source `.tmpl` files and the `gen-skill-docs.ts` generator still contain:

- **Personal-brand prose** — three "A personal note from me, Garry Tan, the creator of GStack" founder cards in `office-hours`, `ycombinator.com/apply?ref=gstack` links, a `Powered by gstack · github.com/garrytan/gstack` card in `retro`, and `garrytan/gstack` example data (EUREKA branch names, remote URLs, greptile log rows).
- **Private-repo detail leaks in `ship`** — Step 3 and Step 3.25 hardcode a Rails/Vitest test harness (`RAILS_ENV=test bin/rails db:migrate`, `bin/test-lane`, `structure.sql`, `test/evals/*_eval_runner.rb`, `EVAL_JUDGE_TIER`, `config/system_prompts/*.txt`, `app/services/*_prompt_builder.rb`). A generic multi-runtime detector (`generateTestBootstrap`) already exists in the same file, so the hardcoded prose is both wrong for other project types and internally inconsistent.
- **Hardcoded co-author model name** — `Co-Authored-By: Claude Opus 4.6` is baked into the `ship` and `document-release` commit trailers.
- **File-telemetry to `~/.openspec/analytics/eureka.jsonl`** — a jq append in the generator's Search-Before-Building preamble section (writer) and a matching read in `retro`'s Eureka Moments section (reader), plus "log the eureka moment (see preamble)" clauses in `office-hours` and `design-consultation`.
- **Dead `# ... pending OpenSpec integration` stubs** — empty bash blocks standing in for a review-log / dashboard / diff-scope backend that does not exist in this fork, across eight `.tmpl` files and two generator functions, plus a `retro` global-mode section that is a self-declared dead end.

This is a fork the user develops with daily. Cleansing it now removes noise immediately, and the later elfspec productization vendors this content directly, so a clean base is inherited downstream. This change performs **only cleansing** — no skills are deleted (that is phase0b) and no skills are added (phase0c).

## What Changes

### 1. Extend branding cleansing to personal-brand prose and example data

Remove the residual Garry Tan / GStack personal branding the prior `branding-migration` did not cover: the `office-hours` founder cards and `ycombinator.com/apply?ref=gstack` links, the `retro` `Powered by gstack` card, and `garrytan/gstack` example data in `retro` and `review/greptile-triage.md`. Also catch one stray `CC+gstack` in the static `review/checklist.md` that the prior pass (scoped to generated files) missed. Structural names — the `skills/gstack/` directory and the `openspec-gstack-*` generated skill names — are **out of scope** and left unchanged.

### 2. Make `ship` runtime-agnostic

Rewrite `ship` Step 3 (test run) and Step 3.25 (eval suites) from the hardcoded Rails/Vitest private harness to runtime-agnostic guidance that reuses the existing detection convention (`generateTestBootstrap`): detect the project's test command, run it, and treat a prompt/eval regression suite as an optional, project-declared step rather than a hardcoded Rails eval runner.

### 3. De-hardcode the commit co-author trailer

Replace the hardcoded `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` in the `ship` and `document-release` commit-trailer examples with a non-model-specific trailer (or an explicit "omit if not configured" instruction), so the trailer does not pin a specific model version.

### 4. Remove the eureka.jsonl file-telemetry

Surgically remove the `~/.openspec/analytics/eureka.jsonl` writer (the jq-append block in the generator's Search-Before-Building section), the reader (the `retro` Eureka Moments section), and the "log the eureka moment (see preamble)" telemetry clauses in `office-hours` and `design-consultation`. The EUREKA reasoning technique (naming a first-principles insight) is retained; only the file-logging is removed. This is distinct from the PostHog `telemetry` capability, which is untouched.

### 5. Delete the dead `pending OpenSpec integration` stubs

Remove every `# ... pending OpenSpec integration` dead bash block and its now-orphaned surrounding instructions across the eight `.tmpl` files (`autoplan`, `codex`, `land-and-deploy`, `plan-ceo-review`, `plan-design-review`, `plan-eng-review`, `retro`, `ship`) and the two non-preamble generator functions (`generateReviewDashboard`, `generateDesignReviewLite`). Remove the `retro` global-mode section that already tells the user the feature is unavailable.

### 6. Re-render and verify

Re-render all generated `SKILL.md` from the cleansed `.tmpl` + generator via `bun run gen:skill-docs`, confirm `bun run skill:check` (dry-run freshness) is clean, spot-check that no residue remains, and confirm the OPSX-core vitest suites stay green (they do not cover gstack experts, so they are a regression guard only).

### Boundary notes (explicitly deferred)

- **ETHOS preamble removal** is phase0b. This change leaves the preamble bundle's own internals (`generateSearchBeforeBuildingSection`'s surrounding prose, `generateCompletionStatus`'s Plan Status Footer stub) for phase0b's wholesale preamble removal, touching only the eureka jsonl-write lines inside it (item 4). The `office-hours` "Read ETHOS.md for the full Search Before Building framework" reference is a dangling-after-ETHOS-deletion concern owned by phase0b.
- **browse test fixtures** (`skills/gstack/browse/test/*.ts` using `garrytan/gstack` git URLs) are structural test data for slug-parsing logic; browse is slated for an adapter-layer rewrite in productization, not this phase — out of scope.

## Capabilities

### Modified Capabilities

- `branding-migration`: Extend brand cleansing to personal-brand prose, `garrytan/gstack` example data, and static (non-generated) review checklist files.

### New Capabilities

- `ship-portability`: Runtime-agnostic test/eval steps and a non-model-specific co-author trailer in the `ship` and `document-release` skills.
- `eureka-telemetry-removal`: Removal of the `~/.openspec/analytics/eureka.jsonl` file-telemetry writer, reader, and references.
- `dead-stub-removal`: Removal of all `pending OpenSpec integration` dead stubs and the `retro` global-mode dead-end section.

## Impact

Source `.tmpl` files (source of truth):
- `skills/gstack/office-hours/SKILL.md.tmpl` — founder cards, ycombinator links, eureka clause
- `skills/gstack/retro/SKILL.md.tmpl` — Powered-by-gstack card, garrytan example data, Eureka Moments section, global-mode section, pending stub
- `skills/gstack/ship/SKILL.md.tmpl` — Rails/Vitest Step 3 + 3.25, co-author trailer, pending stub
- `skills/gstack/document-release/SKILL.md.tmpl` — co-author trailer
- `skills/gstack/design-consultation/SKILL.md.tmpl` — eureka clause
- `skills/gstack/autoplan/SKILL.md.tmpl`, `codex/SKILL.md.tmpl`, `land-and-deploy/SKILL.md.tmpl`, `plan-ceo-review/SKILL.md.tmpl`, `plan-design-review/SKILL.md.tmpl`, `plan-eng-review/SKILL.md.tmpl` — pending stubs

Generator (SSOT for injected content):
- `scripts/gen-skill-docs.ts` — `generateSearchBeforeBuildingSection` (eureka jsonl-write), `generateReviewDashboard` (dead stub), `generateDesignReviewLite` (dead stubs)

Static checklist files (not generated):
- `skills/gstack/review/checklist.md` — stray CC+gstack
- `skills/gstack/review/greptile-triage.md` — GStack-reply prose, `~/.gstack` dir, `garrytan/myapp` example rows

Generated build products (re-rendered, not hand-edited):
- All `skills/gstack/**/SKILL.md` regenerated via `bun run gen:skill-docs`

Verification:
- `bun run skill:check` (freshness gate), `npm run test` targeting `test/core/shared/skill-generation.test.ts` and `test/core/templates/skill-templates-parity.test.ts` (regression guard)
