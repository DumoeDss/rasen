## Why

The PR #88 acceptance review found the archived evidence chain unverifiable (M5) and five minor issues across specs, config reader, portability gate, and docs:

1. **M5:** Prior `pr88-rf-*` archived task ledgers have unchecked items yet were declared PASS/CLEAN; `pr88-rf-docs` lacks its claimed `review-report.md`; the roadmap points at a file not in the PR. This round-2 portfolio needs its own independent, traceable evidence artifact.
2. **Minor 1:** `session-runtime-context/spec.md:219` scenario title says "declaration-only is a valid choice" while the body rejects it.
3. **Minor 2:** `readProjectConfig` swallows YAML parse errors into `null`, making "unreadable" indistinguishable from "missing" at every caller.
4. **Minor 3:** Roadmap records head `c4e54285` (actual `728688ba`), says "Node 5.9.3 toolchain" (that's TypeScript), real Node is `>=20.19.0`, pnpm 9.15.9.
5. **Minor 4:** `assertPortableHintValue` misses `\Users\...` (single-backslash root-relative) and `\??\C:\...` (NT-namespace) paths on POSIX validation.
6. **Minor 5:** `git diff --check` EOF blank line at the archived planning-context.md.

## What Changes

- **M5:** Create `docs/audits/pr88-round2-evidence-reconciliation.md` listing each round-2 child, its findings, its review-report path (produced by its reviewer stage), and its real test verdict. Do NOT retroactively fake-check old ledgers.
- **Minor 1:** Rename the scenario at `session-runtime-context/spec.md:219` from "declaration-only is a valid choice" to rejection semantics matching the body.
- **Minor 2:** `readProjectConfig` distinguishes "no config file" (ENOENT → null) from "config exists but unparseable" (parse error → throw or carry a distinct diagnostic). Callers that need to distinguish consume the new signal.
- **Minor 3:** Correct the roadmap: head `728688ba`, Node `>=20.19.0`, pnpm 9.15.9, TypeScript 5.9.3 (named correctly).
- **Minor 4:** Extend `assertPortableHintValue` to reject single-backslash root-relative paths (`\Users\...`) and NT-namespace paths (`\??\C:\...`, `\\?\C:\...`) using `path.win32` semantics.
- **Minor 5:** Fix the EOF blank line and update clean-evidence claims.

## Capabilities

### New Capabilities

- `acceptance-evidence-reconciliation`: An independent, traceable evidence artifact for the round-2 portfolio that lists each child, its findings, its review-report path, and its test verdict.
- `project-config-diagnostics`: Distinct diagnostics for "config file is absent" vs "config file exists but cannot be parsed," and complete path-portability validation covering Windows root-relative and NT-namespace forms.

### Modified Capabilities

- `session-runtime-context`: Scenario title corrected from "declaration-only is a valid choice" to rejection semantics.

## Impact

- `docs/audits/pr88-round2-evidence-reconciliation.md` — new evidence artifact (M5).
- `rasen/specs/session-runtime-context/spec.md` — scenario rename (Minor 1).
- `src/core/project-config.ts` — `readProjectConfig` parse-error handling (Minor 2); `assertPortableHintValue` path coverage (Minor 4).
- `rasen/explorations/pr88-test-cases-and-roadmap.md` — correct head/toolchain (Minor 3).
- `rasen/changes/archive/2026-07-27-pr88-review-fixes/planning-context.md` — fix EOF blank line (Minor 5).
- Tests: portability gate coverage for new path forms; config-reader diagnostic for parse errors.
