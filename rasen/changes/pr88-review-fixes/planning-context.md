# Planning Context — PR #88 Review Fixes

## Mission
Fix every finding in §36 of `rasen/explorations/global-store-project-unification-development-plan.md`
(the PR #88 review report, dated 2026-07-27) and commit the fixes on PR #88.
PR #88 = `feat: Store/context portfolio — bootstrap, portable knowledge, and stabilization`,
base `origin/dev/0.1.5` (@e5c4189), head `a884f5e4`, 34 commits / 321 files.

## Working environment
- Worktree: `E:\...\OpenSpec-code-pr88-review`, branch `feat/pr88-review-fixes` @ `a884f5e4`
  (== origin/feat/store-context-portable-knowledge head; the `-wt-integration` worktree holds
  that branch's checkout at the same SHA and is NOT ahead).
- Delivery (portfolio-level, ONCE at the end): `git push origin feat/pr88-review-fixes:feat/store-context-portable-knowledge` (fast-forward).
- Children ship `local` (commit only); no per-child push.

## Baseline truth (verified by the review, do NOT re-litigate)
- `pnpm run lint` PASS. TypeScript `pnpm build` PASS.
- TWO pre-existing focused-test failures (stable, reproducible) — present until child
  `pr88-rf-regressions` fixes them. Any verify stage run BEFORE that child MUST treat these
  two as known-pre-existing, NOT regressions:
  - `test/commands/pipeline.test.ts:2446-2475` — `counts delegated stages as outstanding...`
    expects `completed=[]`, actual `['propose','apply','verify']` (→ B2).
  - `test/commands/pipeline.test.ts:2361-2403` — `child carries an out-of-enum status...`
    expects `status='unknown'`, actual `status='pending'` (→ M4).
- Full `pnpm test` is slow (~15min+); run focused/vitest per-children, run the full suite only
  in `pr88-rf-docs` (the evidence child). To run a focused test file:
  `pnpm vitest run test/commands/pipeline.test.ts` (or specific path).
- `git diff --check origin/dev/0.1.5...HEAD` FAILS on 14 canonical spec files (EOF blank line)
  — fixed in `pr88-rf-docs`.

## Decomposition (6 children, SERIAL in this order — file overlaps on bootstrap.ts /
## project-config.ts / import.ts make parallel unsafe per the conservative policy)

DAG: obtain → locks → regressions → validation → authority → docs

### C1 — `pr88-rf-obtain` (obtain/register correctness & safety)
Findings (read §36.3 B3,B4 + §36.4 M1,M2 + M11 for full text):
- **B3 (Blocker)** `src/core/store/bootstrap.ts:1508-1548` clone TOCTOU: records
  `targetExistedBefore` via one `fs.existsSync`, then on clone failure unconditionally
  `rm -rf target` if previously absent (1525-1530). Two processes racing on the same absent
  target → B can delete A's successful checkout. FIX: clone into a per-call exclusive staging
  dir, publish via no-replace/ownership-proven move; cleanup may delete ONLY the txn's own
  staging. Add cross-process same-target concurrent-clone regression test. Existing test
  `test/core/store/bootstrap-obtain.test.ts:290-319` covers only single-process pre-existing target.
- **B4 (Blocker)** `bootstrap.ts:1626-1655`: after clone, calls
  `registerExistingStore({path})` then marks entry obtained+verified WITHOUT re-reading clone
  metadata and comparing `entry.uid`. Wrong/swap remote gets registered as the expected Store.
  Project obtain (`bootstrap.ts:2720-2739`) already does identity compare — mirror it. Spec
  `rasen/specs/store-bootstrap/spec.md:373-375` requires zero-write on identity mismatch. FIX:
  before register, read clone modern/legacy Store metadata, strict-compare permanent UID;
  missing/unreadable/mismatch → fail closed, keep checkout for inspection, registry zero-write.
  Add wrong-UID, missing-UID, unreadable-metadata tests.
- **M1** `bootstrap.ts:2725-2749`: Project obtain only rejects when cloned ID "exists and not
  equal"; MISSING id still registers via Store record's ID and reports obtained. FIX: missing/
  unreadable/invalid/mismatch all fail closed, registry zero-write.
- **M2** `BootstrapInput.globalDataDir` supported & threaded through most read paths, but the
  three `registerExistingStore()` calls at `bootstrap.ts:1635,1824,2607` omit it;
  `operations.ts:945-1071` always uses the default registry path. FIX: registration API accepts
  and threads `StorePathOptions`; add A≠B three-path test.
- **M11** `foundation.ts:210-217` reads legacy `.openspec-store/store.yaml`; but
  `bootstrap.ts:2933-2938` swallows metadata-read exceptions to `null`, then uses only modern
  `.rasen-store` dir to decide Store-first → corrupt legacy-only metadata misroutes to
  project-first and can report `origin: project, state: complete`. FIX: metadata reader returns
  `absent|valid|unreadable`, probing BOTH modern and legacy locations; unreadable → blocked.

### C2 — `pr88-rf-locks` (owner-aware locking)
- **B5 (Blocker)** `src/core/file-state.ts:62-64,139-147`: 30s mtime-only stale heuristic,
  deletes lock with no heartbeat/owner/liveness check; `:164-169` release unconditionally
  deletes lock path. `src/core/knowledge-bundle/import.ts:917-920` holds it across the publish
  txn (large bundle / slow disk > 30s). FIX: lock file carries a unique owner token; use
  heartbeat or provable owner liveness; release deletes only its own token. Tests: >30s hold,
  old-holder releases, new-holder still running, dual-process import/rollback.
- **M7** `src/core/store/membership.ts:730-760`: read-modify-write of whole record, overwrite;
  `project-records.ts:462-478` only single-file temp+rename, no lock/CAS. Concurrent updates to
  same Project's roles/adoption/remote → last writer silently loses the other's field. FIX:
  owner-aware lock keyed by Store+projectId; re-read+merge+verify inside the lock.
- **M8** `src/core/project-config.ts:2060-2127`: line 2079 reads full hints, builds new array
  early, then overwrites the whole YAML field; writer re-reads YAML to preserve other fields
  but does NOT union hints added in the meantime. FIX: re-read inside config lock and merge by
  permanent UID. Add concurrent-different-Store-add test.

### C3 — `pr88-rf-regressions` (restore first-parent semantics lost in merge resolution)
- **B2 (Blocker)** `src/core/pipeline-registry/run-state.ts:576-589` `completedStages()`
  returns `delegated` alongside `done`/`skipped`; `src/commands/pipeline.ts:850-859` normal
  resume path uses that set for ready/next/remaining. `git diff HEAD^1..HEAD -- run-state.ts`
  shows first parent EXCLUDED delegated; merge resolution re-added it. FIX: normal run treats
  only `done|skipped` as complete; whether `delegated` is complete derives from portfolio child
  durable state. Keep & fix the existing focused test; add "portfolio record missing/corrupt".
- **M3** `src/core/init.ts:856-894` swallows ALL exceptions from plan + per-tool reconcile; vs
  first parent it also dropped `previousStores` and `execution.globalDataDir` propagation.
  `src/core/update.ts:784-830` keeps the correct diagnostics/context. FIX: restore first-parent/
  update error reporting, repair, `previousStores`, `globalDataDir`; add merge regression test.
- **M4** `src/core/pipeline-registry/portfolio-state.ts:109-126` saves `statusRaw` but rewrites
  public `status` to `pending`; `src/commands/pipeline.ts:705-714` echoes it. Focused test
  expects `unknown`, gets `pending`. FIX: public status = `unknown` for out-of-enum; keep
  `statusRaw` as the raw value.

### C4 — `pr88-rf-validation` (fail-closed, canonicalization, redaction)
- **M9** `src/core/project-config.ts:1421-1433` durable pointer reader accepts any non-empty
  remote; `bootstrap.ts:2191-2220,2050-2055` passes raw to obtain; `src/core/store/git.ts:160-180`
  puts it in process argv and folds `error.message` into the user error. Normal write path has
  `assertCredentialFreeRemote()` but hand-written/legacy config bypasses it. FIX: bootstrap
  rejects credential-bearing remote BEFORE obtain; error text uses redacted URL only.
- **M5** `src/core/learned-skills/catalog.ts:337-351` silently skips
  `.rasen-learned-skill-backup-*`; recovery only at next mutation (`mutate.ts:989-1032,1157-1160`);
  effective read (`effective.ts:595-600`) therefore sees empty → may pick global fallback or clean
  materialization. Violates fail-closed. FIX: read path reports recoverable backup as
  degraded/unavailable; forbid destructive reconciliation derived from "empty catalog".
- **M10** `src/core/project-knowledge-home.ts:96-113` normalizes project ID via trim+lowercase
  for the export path; `project-registry.ts:310-313` keeps the original string; import
  (`knowledge-bundle/import.ts:1107-1138`) compares strictly to the registry's original. Uppercase
  UUID exports a lowercase bundle but can't import it back. `test/core/knowledge-bundle/export.test.ts:184-229`
  shows the export side. FIX: ALL comparisons use `normalizeProjectIdentity()`; add uppercase
  UUID export→import roundtrip test.

### C5 — `pr88-rf-authority` (M6 — resolved by LOCKED decisions, no new design needed)
Dev-plan §33 locks: #7 planning binding vs membership separated; #8 Store membership authority =
projectId-sharded `projects/<projectId>.yaml`; #9 Project-side membership list is LOCATOR-only.
§12.4/§17.4/§34 + `rasen/specs/store-project-membership/spec.md:8-10` say Store record is the
SINGLE authority. BUT `rasen/specs/session-runtime-context/spec.md:211-234` and
`src/core/management-api/session-launch-context.ts:72-107` let Store record **OR** Project's own
Store declaration grant Session eligibility. FIX (per locked decisions): Store record is the sole
authority; the Project-side declaration is locator-only and must NOT grant eligibility. Remove the
OR-declaration eligibility arm in session-launch-context.ts; add legacy migration; align BOTH
specs (session-runtime-context, store-project-membership) to one answer.

### C6 — `pr88-rf-docs` (spec/doc/evidence closure)
- **M12** `rasen/changes/stabilize-store-context-foundation/` still active though tasks checked
  (only did archive rehearsal 7.2); its delta (pipeline/session/Store identity/verify-evidence)
  not fully synced to `rasen/specs/**`; applicability change stranded in delta. FIX: actually
  archive + sync; run requirement-title + scenario-preservation + Purpose checks. Also
  `rasen/specs/store-bootstrap/spec.md:5` Purpose still says obtaining/registering/writing
  declarations "not part of this capability yet" while lines 304/322/373 + impl include them —
  update Purpose to post-E4 final semantics.
- **M13** dev-plan §2.1/§2.4/§35 still say "start from Phase A"; §3.2 still says
  `LearnedSkillScope` is only `project|global` (actually `project|store|global` per
  `src/core/learned-skills/types.ts:26`); §19 omits `--apply`, keeps old flags (real CLI uses
  `--apply`/`--path`/`--into`, bare `rasen bootstrap` lists modes). FIX: add explicit OBSOLETE
  markers + update CLI contract. (The dev-plan doc is an untracked exploration note in the MAIN
  repo worktree, NOT in this PR worktree — edit the main-repo copy in place; it is not a PR
  commit. The code-relevant part = `docs/cli.md` + canonical specs, which ARE committed.)
- **M15** `CHANGELOG.md` covers Store config scope, migration commands, F1–F4 but not the full
  Store UID / project-keyed membership / Session runtime context / Store-scoped learned /
  bootstrap apply-obtain-doctor migration semantics, nor the §29.2 statement that 0.1.5 EXCLUDES
  Issue/Execution Plan/portable run checkpoint. FIX: complete per shipped surface.
- **Minor 1** PR body claims every child passed role-isolated review but 13 archive changes have
  no auditable `review-report.md`/ship log; the only persistent combined verification covers A–D2
  and recorded a `pnpm test` exit 1. FIX: link real artifacts or retract the unprovable claim.
- **Minor 2** `src/commands/bootstrap.ts:1-16` top comment still says bootstrap has only two
  read-only modes and no mutation flag — contradicts `--apply`. FIX: update comment.
- **Trivial 1** `src/locales/ja.json:446,450` and `src/locales/zh-cn.json:446,450` duplicate the
  `unknownHostRuntimeWarning` key. FIX: dedupe.
- **Trivial 2** PR body "Blocklers" typo. FIX.
- **B1 evidence** fix 14 EOF-whitespace spec files (`git diff --check` list in §36.6); serial
  `pnpm lint` / `pnpm build` / `pnpm test`; save machine+command+exitcode+pass/fail+failures;
  correct E1–E4 task statuses truthfully (don't mark full-suite-green when not proven).

## Cross-cutting invariants (every fix must obey)
- Fail closed; never treat "declared-but-currently-unavailable" as "absent/empty".
- Durable identity = UID/projectId; alias is display+locator only, never a primary key.
- No absolute machine path enters Git-shared schema; no credential-bearing remote in argv/errors.
- Ownership-aware locking for any read-modify-write of shared YAML.
- Reader before writer; migration keeps old data until new validated; no destructive Git reset.
- Each child: author(implementer) != verifier(reviewer); re-reviewer != fixer.

## Handoff digest discipline
After each child's propose, APPEND durable new findings (constraints, gotchas, confirmed fix
locations) back here so later children's planners and post-restart warm-seeds stay cheap.

## Appended durable findings (accumulate per child)

### C1 pr88-rf-obtain (planner)
- `resolveReadableStoreMetadataPath` (foundation.ts:210-218) ALREADY probes modern-first-then-legacy for reads; `writeStoreMetadataState` writes canonical rasen location; `copyForwardLegacyStoreMetadata` (foundation.ts:850-861) is the only legacy-forward migrator. Any "probe both locations" logic MUST reuse `resolveReadableStoreMetadataPath` — duplicating location precedence drifts.
- The canonical `store-bootstrap` spec ALREADY encodes fail-closed / zero-write-on-mismatch / unreadable=blocked at lines 34-38 and 395-399. Most bootstrap bugs are deviations from these lines, not missing spec — search the spec for the matching requirement before considering a delta.
- `StorePathOptions` (`{ globalDataDir?: string }`) is the established pattern for threading a non-default registry path (bootstrap.ts:1932/2499, migration-ops.ts:401/824/1004; base of `RegisterStoreInput`/`ResolveRegisteredStoreInput`/`CommitStoreRegistrationInput`). New store-layer APIs touching the registry SHOULD extend it.
- `commitStoreRegistration` (registry.ts:109) already extends `StorePathOptions`, so M2 threading stops at `registerExistingStore`.
- C1 line numbers all verified accurate vs the review — no drift.

### C3 pr88-rf-regressions (planner)
- Merge-regression signature: the resolver rewrote a function's doc comment to justify the WRONG body, then changed the body to match. When a merge conflict touches both a comment and its function body, check the body against first-parent intent (`git show HEAD^1:<file>`), not against "it compiles".
- `completedStages()` is the single "what's done" gate for normal resume — including `delegated` silently equates "handed to children" with "finished", letting a paused portfolio offer `ship` for unfinished work.
- `learnedMaterializationReport` is the canonical SHARED display helper for learned-skill reconciliation, used by BOTH init.ts and update.ts. Any divergence between the two commands' learned-skill handling is a merge-regression signal.
- M4 subtlety: `PortfolioDeliveryStatusSchema = PortfolioChildStatusSchema` (enum inheritance) — adding `'unknown'` to child status auto-adds it to delivery too; matches first-parent behavior.
- M4: `'unknown'` (not `'pending'`) is required because `runnableChildren` filters on `c.status === 'pending'` — `'pending'` would surface unknown-status children as "start fresh".

### C2 pr88-rf-locks (planner)
- The repo ALREADY has an owner-aware lock primitive: `withSchemeLock` / `releaseSchemeLock` in `src/core/threshold-schemes.ts:235-305`. It uses pid+nonce token, dev/ino re-stat, token-content re-read before unlink, and NEVER steals (just times out). C2 generalizes this pattern into a new `acquireOwnerAwareFileLock` / `releaseOwnerAwareFileLock` / `withOwnerAwareFileLock` in `src/core/file-state.ts`, paired with PID-liveness stale-stealing for B5's long-holder case. Future callers (registry, pipeline, workflow, worksets, named-profiles, learned-skills/mutate) should migrate to the new primitive; the existing `acquireFileLock` (mtime-based) stays for sub-second callers only.
- `os.tmpdir()` (NOT same-dir) is the correct lock placement when the locked FILE lives in a git repo. All existing locks (`updateStoreRegistryState`, `updateProjectRegistryState`, `lockPathFor`, `withSchemeLock`, worksets, workflows) live in the MACHINE DATA DIR — they can be sibling to the locked file because that dir isn't committed. M7 (Store record in Store repo) and M8 (project config in project repo) cannot use sibling placement without polluting commits, so they hash the absolute locked path into `os.tmpdir()/rasen-locks/<sha256-prefix>.lock`. `os.tmpdir()` is per-user on Windows and Linux (no cross-user collision concern for normal dev).
- PID liveness is sufficient — no heartbeat needed. `process.kill(pid, 0)` is cross-platform (returns success/EPERM for alive, ESRCH for dead). PID-reuse window is bounded and produces at worst a one-time false "busy" rather than silent data loss. Heartbeat field left as a future extension in the token format (a holder periodically rewrites `bornAt`), but no call site in B5/M7/M8 needs it: worst case is "PID alive but slow", handled by the 5 s deadline + busy error.
- B5 needs NO spec delta. The portable-project-knowledge spec already requires transactional safety; the defect is purely the lock primitive silently stealing from a legitimately long holder. The fix is mechanical (swap the dep defaults in import.ts:290-291 to the new primitives, drop the second arg to releaseLock at import.ts:1068).
- M7 + M8 need a delta to `store-project-membership` (MODIFIED two existing requirements — titles match exactly). The current spec does NOT promise concurrent-write preservation; adding it is a real behavioral promise. Use the same owner-aware lock contract language in both requirements so a future audit can verify the invariant in one place.
- `writeStoreMembershipHints` (project-config.ts:2109-2128) ALREADY re-reads the YAML to preserve other top-level fields. The concurrency bug is one layer up: `appendStoreMembershipHint` (line 2079) snapshots the `storeMemberships` array BEFORE the lock, then hands the stale array to `writeStoreMembershipHints`. The fix is to wrap the WHOLE function body in the lock, not to change `writeStoreMembershipHints`.
- C2 line numbers all verified accurate vs the review — no drift. No file overlap with C1 (bootstrap/operations/foundation) or C3 (run-state/init/pipeline/portfolio-state).

### C2 pr88-rf-locks (implementer)
- The new primitive lives at `src/core/file-state.ts:174-382` alongside (NOT replacing) the legacy `acquireFileLock` / `releaseFileLock`. Exports: `acquireOwnerAwareFileLock`, `releaseOwnerAwareFileLock`, `withOwnerAwareFileLock`, `machineLockPath`, plus interfaces `OwnerAwareFileLockOptions`, `OwnerAwareFileLockHandle`. Token = 4-line plain text (`pid:`/`bornAt:`/`holder:`/`nonce:`), the ENTIRE content IS the comparison token. Default deadline 5 s, default poll 50 ms — both overridable per call.
- M7's lock factory is `membershipRecordLockError` (code `store_membership_record_busy`, target `store.membership`); M8's is `projectMembershipHintLockError` (code `project_membership_hint_busy`, target `project.config`). Both use the shared `makeLockErrorFactory` template — diagnostic shape byte-identical to the registry lock.
- B5 swap is 4 lines in `import.ts`: the type signatures at 214-215, the DEFAULT_DEPENDENCIES at 290-291, and the release call at 1068 (dropped the 2nd arg — the handle carries `lockPath`). Error shape (`importLockError`) UNCHANGED — the new primitive uses the same `FileLockErrorKind` / `FileLockErrorInfo` types. No spec delta.
- Test strategy: concurrency tests use a "pre-acquire → start Promise.all → release" pattern to force DETERMINISTIC overlap (the test owns the lock first; both writes queue; release lets them serialize). This avoids scheduler-timing flakiness on fast Windows runs. `Promise.all` alone is insufficient because a sub-millisecond first write completes before the second polls.
- The owner-aware primitive writes the lock file with `fs.open(path, 'wx', 0o600)` then `handle.writeFile(token)` then `handle.stat({ bigint: true })` — mode 0o600 matches `withSchemeLock`'s precedent. On Windows `ino === 0n` for every file; the dev/ino check at release step 2 is necessary-but-insufficient there, and the token-content re-read at step 3 is the actual guard. Both checks kept (defense in depth).
- `machineLockPath` hashes the absolute path with SHA-256 (first 32 hex chars) and returns `os.tmpdir()/rasen-locks/<digest>.lock`. Deterministic, never committable, per-user, self-cleaning on reboot.

