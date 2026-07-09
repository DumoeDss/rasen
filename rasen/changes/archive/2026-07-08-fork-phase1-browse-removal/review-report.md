# Review Report — fork-phase1-browse-removal

**Reviewer:** reviewer-a3 (independent; not the author)
**Branch:** dev-harness
**Date:** 2026-07-08
**Verdict:** ✅ APPROVE — clean removal, all gates green, no findings.

## Verification Gate (run by reviewer)

| Gate | Result |
|---|---|
| `pnpm build` | ✅ green — exit 0, "Build completed successfully!" (browse gone, no `build:browse`) |
| vitest: `skill-generation.test.ts` | ✅ 37 tests passed |
| vitest: `skill-templates-parity.test.ts` | ✅ 6 tests passed |
| vitest: `skill-sidecar-install.test.ts` | ✅ 1 test passed |
| vitest trio total | ✅ **44 passed / 44** (3 files) |
| `pnpm install --frozen-lockfile` | ✅ consistent — "Done in 579ms", no lockfile drift |
| `openspec validate fork-phase1-browse-removal` | ✅ "is valid" |
| expert count | ✅ now **19** (asserts 22 workflow + 19 expert = 41 total) |

## Review Dimensions

### 1. Removal completeness — PASS
`git grep -nE "getBrowseSkillTemplate|openspec-browse|browse/dist|build:browse|BROWSE_SETUP"` over `src test package.json` returns only ONE hit: `src/core/templates/experts/chrome-use.ts:7` — a design-rationale comment explaining chrome-use deliberately does NOT import browse's `BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE` constants. It is correct, intentional, and references no live symbol (`{{BROWSE_SETUP}}` placeholder confirmed absent everywhere). Not a dangling reference.
`.github/` and `.gitignore`: no browse references.
All browse trees deleted via staged `git rm`: `browse/` (48 files), `skills/experts/browse/` (48 files), `src/core/templates/experts/browse.ts`.

### 2. No collateral damage — PASS
- chrome-use expert still fully registered across all 4 hops: `skill-generation.ts:57` (import) + `:190` (expertSkills entry), `experts/index.ts:9` (re-export), `skill-templates.ts:39` (re-export).
- Parity file diff shows ONLY browse-row deletions — 5 `-` lines (import, `EXPECTED_FUNCTION_HASHES` row, `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` row, `GENERATED_SKILL_FACTORIES` row, `functionFactories` row), **zero `+` lines**. No other expert hash was re-pinned.
- playwright residual hits in `_shared.ts:941/973/1094` are test-framework-DETECTION prose in expert skill templates (matching a user's own `playwright.config.*`), unrelated to the removed optionalDependency. Out of scope, benign.

### 3. Spec REMOVED delta correctness — PASS
`specs/browse-integration/spec.md` names all 4 requirements with Reason + Migration: Browse Directory Inclusion, Browse Binary Availability, Playwright as Optional Dependency, Skill Browser Path Resolution. Each migration points to chrome-use. Validate confirms structural correctness.

### 4. package.json surgery exact — PASS
Diff vs HEAD removes exactly three things and nothing else: `bin.browse` (`./browse/dist/browse`), the `build:browse` script (compiled `browse` + the never-registered `find-browse`), and the `playwright` optionalDependency (dropping the now-empty `optionalDependencies` block). `openspec` bin, all other scripts/deps untouched. Lockfile regenerated; no playwright entry remains in `pnpm-lock.yaml`; frozen-install consistent.

### 5. Test edits — deletions/decrements only, no weakened coverage — PASS
- `skill-generation.test.ts`: 4 count decrements (42→41, 24→23, 20→19, 21→20) + deleted the now-moot `copySkillSidecars('browse')` skip test (skip logic no longer exists).
- `skill-sidecar-install.test.ts`: dropped browse `.ts`-tree + `openspec-browse` SKILL.md assertions; retained the meaningful sidecar-install + idempotency coverage via investigate/review sidecars.
- The `.ts`-exclusion / SKILL.md-exclusion coverage the browse test provided is preserved by the surviving generic subjects: review/investigate/qa/careful, and notably `chrome-use` at `:268` which covers the `.mjs/.js` sidecar path and excludes SKILL.md/*.tmpl/site-patterns. No coverage lost beyond the removed subject.

### 6. Docs — PASS
`docs/grill-gstack-absorption.md` + `docs/zh` mirror: minimal, truthful, history-aware edits (3 lines each) reframing browse from "current vendored tool" to "removed, replaced by chrome-use." English-verb "browse" prose untouched (out of scope). zh mirror matches en semantically.

## Concerns
None.

## Durable findings (for sibling C — release-prep)
- Final `package.json` state: `bin` now contains only `openspec`; no `browse` bin, no `build:browse` script, no `playwright`/`optionalDependencies`. `pnpm-lock.yaml` regenerated and frozen-install-clean. C's pack surface should reflect a single `openspec` bin.
- `files` array unchanged (still `dist`, `bin`, `skills`, etc.) — C should confirm no stale `browse/` path lingers in publish globs (none present in this diff).
