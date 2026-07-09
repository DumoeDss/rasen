# Ship Log — phase0c-grill-add

**Date:** 2026-07-06
**Repo:** OpenSpec-code @ `dev-harness`
**Shipper:** local-commit only, no push

## Verification (terminal, reproduced independently of review-report.md)

| Gate | Result |
|------|--------|
| `bun run skill:check` | exit 0 — all 29 `SKILL.md` FRESH (incl. 4 new: domain-modeling, codebase-design, tdd, prototype) |
| `npx tsc --noEmit` | exit 0 |
| `openspec validate phase0c-grill-add --strict` | valid |

## Archive

`openspec archive phase0c-grill-add -y` → archived as `2026-07-06-phase0c-grill-add`. Two ADDED specs merged into main specs:

- `add-grill-expert-skills` (+4, created)
- `skill-authoring-guide` (+1, created)

Totals: +5 / ~0 / -0 / →0. `phase0c-grill-add` confirmed absent from `openspec list` active changes post-archive.

## Review conclusion

**Verdict: APPROVE** — 0 Blocker / 0 Major / 3 Minor / 2 Trivial (reviewer-0c, isolated from implementer).

- **Bodies byte-identical**: all four skill bodies (`domain-modeling`, `codebase-design`, `tdd`, `prototype`) diffed zero against grill `mattpocock/skills` sources after frontmatter/preamble strip. All 8 sidecars differ from source by exactly the 2-line MIT NOTICE header — no body edits.
- Full registration wiring verified: `experts/*.ts` ×4, `experts/index.ts`, `skill-templates.ts`, `skill-generation.ts` (4 imports + `getSkillTemplates()` entries), `AGENTS.md` (+4 rows). Template counts bumped 25→29 experts / 42→46 total, assertions in `skill-generation.test.ts` updated accordingly (29 tests green).
- `docs/skill-authoring.md`: faithful, repo-localized rewrite of grill `writing-great-skills` guide (predictability, invocation, information hierarchy, five-病 failure-mode clinic), MIT-attributed.

### Accepted-known (not fixed, carried forward)

- **M1/M2 — `codebase-design`/`domain-modeling` `allowed-tools` run wider than the skill body's own actions** (grants Write/Edit/Bash beyond what each advisory skill directly executes). Design-blessed per phase0c design doc D1 (uniform tool scope across the four methodology experts); left as-is. Revisit in phase0d if tighter least-privilege is prioritized.
- M3 (`docs/upstream-v1.5-stores-and-resolution.md` scope note) resolved by this commit: excluded via explicit pathspec per reviewer recommendation, not swept in.

## Commit

Scoped commit (no `git add -A`) covering: `skills/gstack/`, `src/core/`, `test/core/shared/skill-generation.test.ts`, `docs/skill-authoring.md`, `openspec/specs/`, `openspec/changes/archive/`, `openspec/changes/phase0-grill-integration/`. Excluded `docs/upstream-v1.5-stores-and-resolution.md` (unrelated untracked doc, per reviewer note M3).
