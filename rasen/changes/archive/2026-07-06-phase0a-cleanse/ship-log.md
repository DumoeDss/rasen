# Ship Log — phase0a-cleanse

**Date:** 2026-07-06
**Branch:** dev-harness
**Ship mode:** local commit only (no push)

## Verification (pre-archive)

- `bun run skill:check` (dry-run `scripts/gen-skill-docs.ts`) → **EXIT 0**, all 28 skills `FRESH`.
- `openspec validate phase0a-cleanse --strict` → **valid**.
- vitest sentinel (`skill-generation` + `skill-templates-parity`, per review-report Fix Round 1) → **31 passed**.
- Residue greps (sources + generated, excl. `gstack-upgrade/`, `browse/test` exemptions) for all enumerated tokens — `Garry Tan`, `ycombinator`, `Powered by gstack`, `eureka.jsonl`, `RAILS_ENV`, `bin/test-lane`, `test-lane`, `structure.sql`, `eval_runner`, `EVAL_JUDGE_TIER`, `Claude Opus 4.6`, `pending OpenSpec integration`, `garrytan`, `CC+gstack`, `~/.gstack` (greptile), `GStack recommends`, `.gstack-dev`, `skip_eng_review`, `commit hash shows`, `global (optionally` — all **0**.
- Review-loop R1 (reviewer-0a, isolated, author != verifier): initial verdict **DONE_WITH_CONCERNS** (0 Blocker / 2 Major / 2 Minor). LEAD ruled all four in-change; implementer-0a fixed all four (retro `global` argument no longer whitelisted after its handler was removed; plan-ceo-review/plan-design-review/plan-eng-review genericized to stop referencing dashboard fields the neutralized `generateReviewDashboard` no longer emits; `GStack recommends` → `We recommend` in ship; `~/.gstack-dev/evals/` paths made project-declared/optional + `docs/ARCHITECTURE.md` normalized to `~/.openspec-dev/`). Re-review: **CLEAN — 4/4 RESOLVED, 0 new issues, delta in bounds** (38 tracked files total, nothing outside `skills/gstack/` + `scripts/gen-skill-docs.ts`).

## Archive

- `openspec archive phase0a-cleanse` → merged delta specs into `openspec/specs/` (branding-migration: +3/~1; dead-stub-removal: +3; eureka-telemetry-removal: +4; ship-portability: +3 — totals +13/~1/-0/→0) and moved the change to `openspec/changes/archive/2026-07-06-phase0a-cleanse/`.
- Confirmed via `openspec list`: `phase0a-cleanse` no longer appears among active changes (remaining active: phase0c-grill-add, phase0b-slim, phase0-grill-integration, unify-template-generation-pipeline, add-tool-command-surface-capabilities, add-global-install-scope, add-change-stacking-awareness).

## Commit

Scoped `git add` (not `-A`): `skills/gstack/`, `scripts/gen-skill-docs.ts`, `openspec/specs/`, `openspec/changes/archive/`, `openspec/changes/phase0-grill-integration/`.

Excluded: `openspec/pipelines/` (pre-existing unrelated untracked dir), `openspec/changes/phase0b-slim/`, `openspec/changes/phase0c-grill-add/` (later-phase work, not part of this ship unit).

Commit message:

```
chore(gstack): phase0a cleanse — strip personal branding, private-repo details, telemetry sink, dead stubs

- neutralize Garry Tan/GStack founder cards, ycombinator ref links, powered-by card
- rewrite ship test/eval steps runtime-agnostic (reuse Test Framework Bootstrap detection)
- remove eureka.jsonl telemetry sink (keep EUREKA reasoning prose)
- delete pending-integration dead stubs (8 tmpls + generator fns incl. CompletionStatus, AdversarialStep x3)
- cleanse static review/*.md + normalize ~/.gstack-dev paths
- re-render all gstack SKILL.md (skill:check FRESH); review-loop R1 clean (4/4 resolved)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

No push performed.
