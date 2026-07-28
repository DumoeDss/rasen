## Context

`src/core/learned-skills/mutate.ts` has two backup-cleanup sites with identical data-loss patterns:

**Site 1 — `writeCanonicalDirectory` (lines 963-980):**
```
rename(directory → backup)     // move current record aside
rename(staging → directory)     // publish new record  ← SUCCESS
rmSync(backup)                  // cleanup              ← CAN FAIL PART-WAY
  catch:
    rmSync(directory)           // ← DELETES THE GOOD NEW RECORD
    rename(backup → directory)  // ← RESTORES PARTIAL BACKUP
```

**Site 2 — `commitRename` (lines 1316-1329):**
```
rename(fromDirectory → backup)
writeCanonicalDirectory(directory)  // publish new record  ← SUCCESS
rmSync(backup)                      // cleanup              ← CAN FAIL PART-WAY
  catch:
    rmSync(directory)               // ← DELETES THE GOOD NEW RECORD
    rename(backup → fromDirectory)  // ← RESTORES PARTIAL BACKUP
```

Both catch blocks invert the safety property: a cleanup failure triggers the worst possible action — destroying the published record and restoring a corrupt backup.

The backup debris uses `LEARNED_SKILL_BACKUP_PREFIX` (a temp prefix), so the catalog ignores it. `sweepMutationDebris` (called at the top of `commitLearnedSkillPlan`, line 1160) discovers and cleans such debris on the next mutation. So leftover backup debris is self-healing and inert.

## Goals / Non-Goals

**Goals:**
- A backup-cleanup failure after successful publication never deletes the new record or restores the partial backup.
- The new record stays intact; debris is left for `sweepMutationDebris`.
- A degraded condition is reported in the mutation result.
- Regression test injects a partial-delete failure mid-rmdir; asserts new record intact, no restore.

**Non-Goals:**
- Making the backup cleanup itself fault-tolerant (retry logic, EPERM handling). That's a separate concern; the safety property holds regardless.
- Changing the swap-in protocol (rename-based publication stays).
- Changing `sweepMutationDebris` (it already handles complete debris).

## Decisions

### D1: Separate "publish" from "cleanup" — cleanup failure is non-fatal

Rewrite both catch blocks so that `fs.rmSync(backup)` failure is caught and reported as degraded, without touching the new record:

**Site 1 (writeCanonicalDirectory, lines 974-980):**
```typescript
// New record is published. Backup cleanup is best-effort.
let degraded: string | undefined;
try {
  fs.rmSync(backup, { recursive: true, force: true });
} catch {
  degraded = `Backup cleanup left debris at ${backup}; it will be removed on the next mutation.`;
}
return degraded;
```
The function signature changes from `void` to `string | undefined` (the degraded message, or undefined when clean).

**Site 2 (commitRename, lines 1324-1328):**
Same pattern — `fs.rmSync(backup)` failure is caught, degraded message recorded, new record untouched. `commitRename`'s return type adds a `degraded` field alongside the existing `LearnedSkillBlock | undefined`.

### D2: Propagate degraded to the mutation result

`commitLearnedSkillPlan` (line 1187) calls `writeCanonicalDirectory`. After the fix, it checks the returned degraded message and includes it in the `LearnedSkillResult`:

```typescript
const degraded = writeCanonicalDirectory(payload.directory, ...);
// ...
return {
  outcome,
  ...base,
  status: ...,
  directory: payload.directory,
  ...(degraded ? { degraded } : {}),
  changedFiles: changedFiles(payload),
};
```

If `LearnedSkillResult` doesn't already have a `degraded` field, add one as `degraded?: string`. Callers that surface results to the user (CLI, UI) include the warning in their output.

### D3: The swap-failure catch stays (it's correct)

The FIRST catch block in both sites (the one covering the rename/write of the new record, BEFORE cleanup) stays unchanged. If the new record fails to publish, rolling back to the backup is correct — the backup is still intact at that point. Only the SECOND catch (covering cleanup) changes.

## Risks / Trade-offs

- **[Debris accumulation]** → If cleanup consistently fails (e.g., persistent AV lock), debris accumulates until the next `sweepMutationDebris` run. This is already the design for crash-recovery debris. The degraded message names the debris path so the user can manually clean if desired.
- **[Lock deadline]** → The backup cleanup runs inside the owner-aware lock (post-#1). `fs.rmSync` is synchronous and typically fast. If retry logic is later added inside the lock, the default 5 s deadline may need an explicit `deadlineMs` — noted for the implementer but not required for this fix.
- **[`LearnedSkillResult` type change]** → Adding `degraded?: string` is additive. Existing callers that don't read the field are unaffected.
