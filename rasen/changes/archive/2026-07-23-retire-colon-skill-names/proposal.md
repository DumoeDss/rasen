## Why

The commands era is fully retired (skills-only delivery, PR #26), but the 21 expert skill templates still carry colon-form names (`name: 'rasen:<x>'`). That name leaks verbatim into installed SKILL.md frontmatter, so Claude Code's slash-completion popup shows `/rasen:office-hours` while the actual invokable identifier is the directory name `/rasen-office-hours` — a visible mismatch the user hit in daily use. Beyond the popup, the retired colon namespace persists across the whole product surface: bundled pipeline YAMLs, a live supervisor invocation string, instruction bodies, the governance specs that still MANDATE the colon form, ~140 colon tokens across 41 main specs, and ~630 across 42 doc files. This change retires the `rasen:` colon namespace everywhere and folds in the known-open `/rasen:` literal-residue backlog.

## What Changes

- **Expert skill names unify to hyphen form**: all 21 expert templates in `src/core/templates/experts/*.ts` change `name: 'rasen:<x>'` → `'rasen-<x>'`, making `template.name === dirName`. Fresh `rasen init` and `rasen update` both regenerate SKILL.md frontmatter with the hyphen name, so completion popup and inserted identifier match.
- **Bundled pipeline YAMLs flip in the same commit**: `pipelines/{full-feature,small-feature,bug-fix,auto-decompose}/pipeline.yaml` stage `skill:` references change from `rasen:<x>` to `rasen-<x>` (execution preflight matches `template.name` exactly).
- **Legacy colon references keep resolving**: `mapLegacySkillId` gains a `rasen:<x>` → `rasen-<x>` branch, and its existing `openspec:<x>` branch retargets to hyphen form. Catalog skill-identity lookups (`requires.skills`, user pipeline usage scans) fall back through the legacy mapping so pre-existing user pipelines/packages authored with colon refs still resolve.
- **Live colon invocations fixed**: management-api whitelist entries `skill: '/rasen:auto'` / `'/rasen:goal'` (used verbatim as the supervised session's prompt token) become `/rasen-auto` / `/rasen-goal`.
- **Instruction-body and comment literals retired**: `/rasen:<x>` tokens in `_shared.ts`, `office-hours.ts`, `review.ts`, plus comments in `claude-settings.ts`, `archive.ts`, `project-config.ts`, `supervisor.ts`, `run-state.ts`, `workflow-chain.ts`, mapped to the real current skill names (non-uniform mapping, e.g. `/rasen:verify` → `/rasen-verify-change`, `/rasen:archive` → `/rasen-archive-change`).
- **Governance specs updated** (delta specs): `skill-name-prefix` drops the colon-name mandate in favor of unified `rasen-` naming (name == dirName); `spec-brand-consistency` replaces `/rasen:*` with `/rasen-*` in its current-token list and adds the retired colon form to the legacy keep-classes.
- **Behavior-neutral wording sweep**: remaining `rasen:` colon tokens in `rasen/specs/**/spec.md` (~140 across 41 files) and `docs/**` EN + zh (~630 across 42 files) rewritten to current hyphen skill names under the `spec-brand-consistency` governance (same precedent as the specs-brand-rewrite sweep). Legacy `openspec:` tokens and intentional legacy-mapping documentation stay.
- **Tests, fixtures, and parity hashes synced**: 16 test files referencing colon names updated; `test/fixtures/workflow-registry/builtins-v1.json` regenerated; the two pinned hash tables in `skill-templates-parity.test.ts` recomputed (all expert template payload and generated-content hashes change).
- **Not changing**: no version bump; `packages/ui` untouched (separate in-flight work line); `transformToHyphenCommands` kept as a cheap invariant guard (now a no-op on clean templates).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `skill-name-prefix`: the requirement mandating `rasen:`-prefixed skill names is replaced by a unified hyphen rule — every skill's `name` equals its `rasen-<x>` dirName; pipeline stages reference the hyphen form; generated frontmatter carries the hyphen name so slash completion displays the invokable identifier.
- `spec-brand-consistency`: the current-token list changes `/rasen:*` → `/rasen-*` (slash-invocation tokens use hyphen skill names), and `rasen:<x>` colon tokens join the enumerated legacy keep-classes (legacy-detection literals and migration documentation only).

## Impact

- **src**: `src/core/templates/experts/*.ts` (21 files + `_shared.ts`), `src/core/pipeline-registry/legacy-skill.ts`, `src/core/workflow-library.ts` (identity lookup fallback), `src/core/management-api/whitelist.ts` (+ comment in `supervisor.ts`), comment-only touches in `claude-settings.ts`, `archive.ts`, `project-config.ts`, `run-state.ts`, `workflow-chain.ts`, `command-references.ts` docs.
- **Bundled assets**: 4 pipeline YAMLs under `pipelines/`.
- **Specs**: delta specs for `skill-name-prefix` and `spec-brand-consistency`; wording sweep across ~39 other spec files.
- **Docs**: 42 files under `docs/` and `docs/zh/`.
- **Tests**: 16 test files incl. parity-hash tables and the builtins fixture; legacy-mapping tests flip expected outputs to hyphen form.
- **Compatibility**: old colon refs in user-authored pipelines/packages resolve via the extended legacy mapping; installed skills refresh on next `rasen update` (`.claude/skills` is not committed, nothing to migrate in-repo).
