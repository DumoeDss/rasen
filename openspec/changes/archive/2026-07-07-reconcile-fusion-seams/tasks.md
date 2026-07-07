# Tasks: reconcile-fusion-seams

## 1. Seam fixes (round 1 — reviewed & approved by reviewer-4)

- [x] 1.1 `schemas/spec-driven/schema.yaml`: remove `enhance: codebase-design` from the design artifact.
- [x] 1.2 `src/core/templates/workflows/explore.ts`: append the `/prototype` exception to the "Don't implement" guardrail in BOTH variants, identical wording.
- [x] 1.3 New `src/core/templates/workflows/change-context.ts` exporting `CHANGE_CONTEXT_CAPTURE_GUIDANCE`.
- [x] 1.4 `src/core/templates/experts/prototype.ts`: interpolate the guidance between body and store guidance.
- [x] 1.5 Non-author reviewer pass (reviewer-4): APPROVE — 1 Minor (delta `\opsx:` typo, fixed), 1 Trivial (accepted).

## 2. domain-modeling removal (round 2 — user decision at inspection)

- [x] 2.1 Delete `src/core/templates/experts/domain-modeling.ts`; remove export from `experts/index.ts`, re-export from `skill-templates.ts`, import + `getSkillTemplates()` entry from `skill-generation.ts`.
- [x] 2.2 Delete `skills/gstack/domain-modeling/` (SKILL.md, SKILL.md.tmpl, ADR-FORMAT.md, CONTEXT-FORMAT.md).
- [x] 2.3 `propose.ts`: drop the `/domain-modeling` sentence from the methodology-consult block (both variants); tighten capture wording.
- [x] 2.4 Navigator tmpl: vocabulary layer reduced to `/codebase-design`; AGENTS.md row removed.
- [x] 2.5 `change-context.ts`: wording trimmed to prototype-relevant capture locations.
- [x] 2.6 `docs/review-cycle-workflow-design.md`: planning-review line updated (no domain-modeling, no enhance hook).
- [x] 2.7 Count assertions 20→19 experts in `test/core/shared/skill-generation.test.ts` (4 places + comments).
- [x] 2.8 Delta specs: methodology-expert-fusion (propose rename, prototype-only adaptation, roster 3), add-grill-expert-skills (4→3 + stale count req REMOVED), methodology-skill-tool-scoping (domain-modeling req REMOVED), navigator-router-skill (vocabulary + must-not-reference).

## 3. Gates (round 2)

- [x] 3.1 `pnpm build` clean; `bun run gen:skill-docs` + `bun run skill:check` FRESH (19 skills).
- [x] 3.2 Parity hashes recomputed for explore + propose (function + content); parity/skill-generation/profiles suites green.
- [x] 3.3 `openspec update --force`; delete installed `openspec-gstack-domain-modeling` orphan; confirm no domain-modeling remnant installed; installed propose/explore/prototype carry the new wording.
- [x] 3.4 Repo grep: no live `domain-modeling` reference outside `openspec/changes/` records and this change's artifacts.
- [x] 3.5 `openspec validate reconcile-fusion-seams --strict --json` passes; `openspec config list` unpolluted.
- [x] 3.6 Non-author delta re-review (reviewer-4) of the removal round.
- [x] 3.7 Full `pnpm test` at ship gate (held until user completes their fusion-state inspection).
