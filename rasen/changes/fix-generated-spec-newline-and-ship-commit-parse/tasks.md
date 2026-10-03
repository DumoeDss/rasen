## 1. Reproduction

- [x] 1.1 Branch from `upstream/dev/0.1.8` and confirm the four affected sources are byte-identical to that branch.
- [x] 1.2 Add a red regression asserting a canonical specification generated from a delta ends with exactly one newline, for both a newly created capability and an updated existing one. Both cases produced `\n\n` before the fix.
- [x] 1.3 Add a red regression asserting an archived ship log whose `**Commit:**` value is enclosed in a matched pair of backticks carries `**Ship commit:**` in its archive section. The section omitted the field entirely before the fix.

## 2. Implementation

- [x] 2.1 Normalize the serializer's output in `src/core/specs-apply.ts` so a written canonical specification ends with exactly one newline and no trailing whitespace, leaving `extractRequirementsSection` and the reconciliation body untouched.
- [x] 2.2 Introduce one exported ship-commit reader that captures the `**Commit:**` line's value, strips a single matched surrounding pair of backticks, and validates the result as a 7-to-64 character hexadecimal hash, distinguishing an absent field from a present unreadable one.
- [x] 2.3 Replace the duplicated regular expression in `src/core/archive.ts` and `src/core/archive-engine.ts` with that reader, keeping `recordedCommit: null` for an unreadable field and adding no new blocker.

## 3. Verification

- [x] 3.1 Turn 1.2 and 1.3 green and extend them to the full matrix: zero, one, and multiple terminating newlines, CRLF input, a specification whose `## Requirements` is not the final section, and idempotent rewriting. `test/core/specs-apply.test.ts` covers eight cases; the file runs 23 passed.
- [x] 3.2 Cover ship-commit reading for a bare hash, a matched code span, an unmatched backtick, an abbreviated hash, a trailing qualifier, a non-hexadecimal value, an empty field, and an absent field, and assert planning and finalization agree on each. `test/core/archive.test.ts` drives all eight through a real plan-and-apply, asserting `plan.shipLog.recordedCommit` and the archived log's `**Ship commit:**` line together; 8 passed.
- [x] 3.3 Confirm no existing test pinned the previous output: run the archive, finalization, and specs-apply regression scope and record the result. 138 files passed, 2299 tests passed, 28 skipped, none failed, in 345s.
- [x] 3.4 Prove the compatibility claims with an executable check — a plan saved before the change still applies unchanged, and a delta rewrite of an already-normalized specification produces identical bytes. A plan saved by an `upstream/dev/0.1.8` build (`rebuilt` ending in two newlines) applied `complete` with no blockers under the fixed build, and the written file was byte-identical to the stored `rebuilt`. Idempotent rewriting is pinned by `rewrites an already-normalized spec to identical bytes`.
- [x] 3.5 Stage generated canonical specifications from a real archive run and confirm `git diff --cached --check` reports nothing for them. A real `rasen archive --yes` in a disposable repository created one capability and updated another; both files ended with one newline and the staged check exited 0 with no findings.
- [x] 3.6 Run TypeScript checking and ESLint for every changed file. `tsc --noEmit` and `eslint` over the three sources and three test files both exited 0.
