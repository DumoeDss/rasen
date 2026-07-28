## 1. Fix Site 1 — writeCanonicalDirectory backup cleanup (lines 974-980)

- [x] 1.1 Change the second catch block (lines 976-979): remove the `rmSync(directory)` and `renameSync(backup, directory)` lines. Instead, catch the error and record a degraded message: `Backup cleanup left debris at ${backup}; it will be removed on the next mutation.`
- [x] 1.2 Change `writeCanonicalDirectory`'s return type from `void` to `string | undefined` (the degraded message or undefined when clean). Return `undefined` on the non-rewrite path (line 961) and on successful cleanup; return the degraded message on cleanup failure

## 2. Fix Site 2 — commitRename backup cleanup (lines 1324-1328)

- [x] 2.1 Separate the `writeCanonicalDirectory` call from the `fs.rmSync(backup)` in the try block. The try should cover only `writeCanonicalDirectory`; the `rmSync(backup)` gets its own try/catch
- [x] 2.2 In the new cleanup catch: do NOT delete `payload.directory` or restore `backup`. Record the degraded message and return it alongside the existing `LearnedSkillBlock | undefined` return

## 3. Propagate degraded to the mutation result

- [x] 3.1 In `commitLearnedSkillPlan` (line 1187), capture the degraded return from `writeCanonicalDirectory` and `commitRename`. Add `degraded?: string` to `LearnedSkillResult` if not already present
- [x] 3.2 Include the degraded message in the returned `LearnedSkillResult` when present

## 4. Regression test

- [x] 4.1 Test partial-delete failure: set up a rewrite mutation (existing record present); mock `fs.rmSync` to throw after removing some entries in the backup directory; assert the new record at `directory` is intact and readable; assert the backup is NOT restored to `directory`; assert the result carries a degraded warning
- [x] 4.2 Test rename partial-delete: same pattern for the `commitRename` path
- [x] 4.3 Test the happy path still works: normal rewrite with successful cleanup produces no degraded warning
- [x] 4.4 Test that sweepMutationDebris cleans up leftover backup debris on the next mutation

## 5. Verification

- [x] 5.1 Run affected test files in isolation (`test/core/learned-skills/mutate.test.ts` or equivalent)
- [x] 5.2 Run `pnpm exec tsc --noEmit` — confirm no type errors (especially the new return type)
- [x] 5.3 Run `pnpm lint` on changed files — confirm clean
