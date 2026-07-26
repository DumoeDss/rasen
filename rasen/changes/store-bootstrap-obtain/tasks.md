## 1. Re-verify dependencies against landed code

Design's dependency table was verified at `HEAD=9f4286da`. Re-confirm only what
a rebase could have moved, then act on the drift it already records.

- [x] 1.1 Re-confirm `selectBootstrapLocation` and `inspectChosenLocation` (`src/core/store/bootstrap.ts`): the selection function and the target inspector. E3 calls both at clone time — confirm signatures and the `BootstrapLocation` variant shapes have not shifted.
- [x] 1.2 Re-confirm `deriveSafeLocationName` (`src/core/store/bootstrap.ts`): returns `string | null`, validates against separators, traversal, and `WINDOWS_RESERVED_DEVICE_NAMES`. E3 relies on it for the derived clone-target name.
- [x] 1.3 Re-confirm `registerExistingStore` (`src/core/store/operations.ts:945`): the `rasen store register <path>` path. E3 calls it after a successful clone. Confirm the signature `( { path: string } )` and idempotency.
- [x] 1.4 Re-confirm `execFileAsync` (`src/core/store/git.ts:19`): sets `windowsHide: true`, uses `execFile` (argument vector). E3 routes `git clone` through it — confirm the wrapper is still the single git spawn point.
- [x] 1.5 Re-confirm `registerProject` (`src/core/project-registry.ts`): E3 calls it when a project is obtained from a Store. Takes `{ projectRoot, projectId, mode }`, idempotent on path-exact match.
- [x] 1.6 Re-confirm `resolveProjectMembership` (`src/core/store/membership.ts`): E3 calls it after obtaining a Store to re-verify membership. Signature `(store, projectId, options)` → `StoreMembershipRecord | null`.
- [x] 1.7 Re-confirm `applyProjectFirstActions` (`src/core/store/bootstrap.ts`): E2's apply state machine. E3 extends it with the obtain step — confirm the step ordering and the `BootstrapStoreEntry` mutation pattern.
- [x] 1.8 Re-confirm `buildStoreFirstReport` (`src/core/store/bootstrap.ts`): E1's Store-first read path. E3 extends it for apply mode — confirm the report shape and the `BootstrapProjectEntry` fields.
- [x] 1.9 Re-confirm `BootstrapConsent` and `confirmAction` (`src/core/store/bootstrap.ts`): E2's consent infrastructure. E3's obtain steps use them — confirm `BootstrapConsentRequest.action` covers the obtain case or needs extending.
- [x] 1.10 Confirm the files E3 modifies are listed in `PHASE_A_FILES` (`test/core/store/identity-boundaries.test.ts`): `src/core/store/bootstrap.ts`, `src/core/store/git.ts`, and `src/commands/bootstrap.ts` are already there (E1/E2 added them). If E3 extracts a new module, add it.

## 2. Clone capability (`src/core/store/git.ts`)

- [x] 2.1 Add `cloneRepository(remote: string, target: string): Promise<void>` to `src/core/store/git.ts`. Route through the existing `execFileAsync` (sets `windowsHide: true`, uses `execFile`). Arguments: `['clone', '--', remote, target]`. The `--` separates the remote from git's options.
- [x] 2.2 On failure, throw a `StoreError` with code `store_clone_failed` and a `fix` naming the remote (redacted) and suggesting the user verify it is reachable and they have access. Match the pattern `initGitRepository` and `commitStoreFiles` establish.
- [x] 2.3 Detect `ENOENT` (git binary not installed) distinctly from a clone failure. Throw a `StoreError` with code `store_git_unavailable` and a `fix` suggesting the user install Git. Match `assertGitCommitIdentity`'s `isSpawnNotFoundError` pattern.
- [x] 2.4 Tests: clone succeeds into a non-existent target from a local `file://` fixture remote; clone fails with a clear error when the remote does not exist; clone fails when git is not available (mock or PATH manipulation); the argument vector is never a shell string (assert `execFile` is used, not `exec`).

## 3. Clone target enforcement (design D5)

- [x] 3.1 In the obtain step (before calling `cloneRepository`), call `selectBootstrapLocation` with the same inputs E1's preview uses. The function is unchanged — E3 adds the enforcement that a non-`usable` result prevents the clone.
- [x] 3.2 If the location is `refused` (not-empty, existing-checkout, unreadable): report the refusal, do not clone, do not register. The entry's `action` is `not-acted` with a diagnostic naming the refused location.
- [x] 3.3 If the location is `required` (no-location-supplied, no-safe-name): report the demand, do not clone. The entry carries a `supply-path` repair.
- [x] 3.4 If the location is `usable`: proceed to clone. Record `fs.existsSync(target)` BEFORE the clone — this is the provenance proof for the cleanup guard (group 4).
- [x] 3.5 Tests: a refused location (occupied, existing-checkout) is never cloned into; a required location produces no clone; a usable location is cloned into and registered; the canonical-path comparison (drive-letter case, separator form) treats the same path written two ways as one location.

## 4. Failed-retrieval cleanup — THE data-destruction guard (design D2, D5)

- [x] 4.1 After a `cloneRepository` failure, consult the provenance proof recorded in 3.4 (`fs.existsSync(target)` before the clone attempt).
- [x] 4.2 **If the target did NOT exist before this run** (provenance = `false`): the clone created (or attempted to create) the directory. Remove it via `fs.rmSync(target, { recursive: true, force: true })`. Report the failure and the cleanup.
- [x] 4.3 **If the target DID exist before this run** (provenance = `true`), or **provenance is unknown** (the check was not recorded): leave the directory exactly as it is. Report the failure, name the directory, and say what to inspect ("the directory pre-existed; its contents are unchanged"). Do NOT attempt partial cleanup.
- [x] 4.4 THE critical test (E's D5 fear): construct the exact scenario. Target directory pre-exists with known content → retrieval fails (or the path is occupied so the clone is refused) → **snapshot the directory tree before and after → assert byte-identical**. This test is the guard's reason for existing; it MUST pass.
- [x] 4.5 Tests: a self-created directory (provenance = false) is cleaned up on failure; a pre-existing directory (provenance = true) is left untouched on failure; a pre-existing directory with content is byte-identical after a failed retrieval (whole-tree snapshot).

## 5. Project-first obtain step (design D3)

- [x] 5.1 Extend `applyProjectFirstActions` (`src/core/store/bootstrap.ts`): after E2's step 3 (register present-unregistered Stores), add the obtain step. For each Store whose classification is still `absent-with-remote` after registration, clone and register it.
- [x] 5.2 The obtain step calls `selectBootstrapLocation` (group 3 enforcement), `cloneRepository` (group 2), and `registerExistingStore` (the same path E2 uses). On success, the Store's classification moves to `verified` and its action is `registered`.
- [x] 5.3 Consent gating through `confirmAction`: without `--yes`, each obtain asks; with `--yes` (project-first), declared Stores are obtained without asking. A Store NOT declared by the project is NOT covered by `--yes` and always asks.
- [x] 5.4 Extend `BootstrapConsentRequest.action` with `'obtain-store'` (or confirm the existing union covers it). The command layer renders the appropriate consent prompt.
- [x] 5.5 After a successful obtain, re-verify membership through `resolveProjectMembership` (E2's step 4, now covering obtained Stores). The Store's records are readable for the first time.
- [x] 5.6 A failed obtain (clone error, registration failure) is reported and does not abort the whole run — the remaining steps still execute. The failure carries a diagnostic and a repair. The cleanup guard (group 4) runs before reporting.
- [x] 5.7 An obtained Store that is already registered (a rerun) is reported as `already-registered` and not re-cloned. The `fs.existsSync` check on the target returns `true` (the clone from the prior run succeeded), so no clone is attempted.
- [x] 5.8 Tests: an absent-with-remote declared Store is cloned and registered during apply; consent is required before obtaining; `--yes` covers declared Stores; a non-declared Store is NOT obtained under `--yes`; a failed obtain is reported without aborting; a rerun does not re-clone.

## 6. Store-first apply flow (design D4)

- [x] 6.1 Extend `buildStoreFirstReport` for apply mode: after E1's read path (verify identity, read project records, list projects), register the Store's own checkout through `registerExistingStore`. Consent for the Store's own checkout is covered by invoking apply (same as E2 treats the project's own checkout).
- [x] 6.2 Under `--yes`, the Store's checkout registration is confirmed without asking (it is the Store the user is running bootstrap from). Without `--yes`, the user is asked.
- [x] 6.3 For each project the user explicitly selects (interactive pick or `--path <projectId>=<dir>`): clone to the selected location, register through `registerProject`, and register the Store relationship through `registerExistingStore` if applicable.
- [x] 6.4 Explicit selection mechanism: in interactive mode, use `@inquirer/prompts` `select` or `checkbox` to ask which projects to obtain. Each selection triggers an obtain. A project the user does not select is left unobtained.
- [x] 6.5 The `--path <projectId>=<dir>` flag selects a project AND names its target location. The selector matching uses the project's `projectId` and `id` fields (the same `suppliedPathFor` function E1 uses).
- [x] 6.6 After obtaining a project, re-read its identity from the cloned checkout and verify it matches what the Store recorded. A mismatch is reported and the checkout is left in place (the user decides what to do with it — bootstrap does not delete a checkout that exists for a reason it cannot verify).
- [x] 6.7 Tests: the Store's checkout is registered during apply; a project selected interactively is obtained and registered; a project named via `--path` is obtained; a project not selected is left unobtained; a rerun does not re-obtain; the Store's identity mismatch is reported.

## 7. Never-harvest enforcement (design D6)

- [x] 7.1 Assert directly: a Store fixture with multiple obtainable projects, run under `--yes` in apply mode, registers the Store's checkout and obtains ZERO projects. No project is cloned, no project checkout is registered.
- [x] 7.2 Assert: `--yes` in the Store-first flow does NOT produce an obtain prompt for any project. The listing is shown; the user must explicitly select to obtain.
- [x] 7.3 Assert: in the project-first flow, `--yes` DOES obtain declared Stores with remotes (the asymmetry). The two flows are not unified behind one predicate.
- [x] 7.4 Tests: the never-harvest scenario with 5+ obtainable projects and `--yes`; the asymmetry both ways (project-first `--yes` obtains; Store-first `--yes` does not).

## 8. Command surface

- [x] 8.1 The `--apply` mode from a Store checkout now acts (E2 left it producing the read-only listing). Confirm the bare invocation, `--check`, and `--dry-run` are unchanged.
- [x] 8.2 The `--path` flag accepts project IDs as selectors in the Store-first flow (`--path <projectId>=<dir>`). The `parseSuppliedPaths` function already handles `<selector>=<dir>`; confirm it accepts project IDs without special handling.
- [x] 8.3 Extend `src/commands/bootstrap-messages.ts` with obtain-mode messages: the obtain consent prompt, the obtain-succeeded / obtain-failed state names, the cleanup report ("the failed clone at <path> was removed" / "the directory at <path> pre-existed and was left untouched"), and the Store-first project-selection prompt. No inline English in the command or core module.
- [x] 8.4 The Store-first interactive selection prompt uses localized strings from the messages module. Confirm the prompt names each project with its `id` (or `projectId` when `id` is absent) and its presence state.
- [x] 8.5 Tests: `--apply` from a Store acts; the `--path` flag selects projects in the Store-first flow; JSON shape stable and carrying the same facts as the human output; the obtain consent prompt is localized.

## 9. Acceptance tests (E's group 13, E3 slice)

- [x] 9.1 Two-machine fixture with an empty machine data directory: a second machine bootstraps from a project clone alone, apply obtains the declared Stores from their remotes (local file:// fixture remotes), registers them, and re-verifies membership.
- [x] 9.2 A Store already registered before apply is reported as `already-registered` and its path is unchanged — no re-clone.
- [x] 9.3 `--yes` asymmetry proven both ways: from a project checkout it obtains the project's declared Stores; from a Store it registers the checkout and obtains zero projects.
- [x] 9.4 A declared Store NOT declared by the project (a local record only) is NOT obtained under `--yes` — it asks.
- [x] 9.5 Clone target enforcement: an occupied target is refused and never cloned into; an existing checkout is never overwritten; a legacy recorded path never influences the target.
- [x] 9.6 THE cleanup test: a pre-existing target directory with content survives a failed retrieval — byte-identical before and after (whole-tree snapshot).
- [x] 9.7 A self-created target (provenance = false) is cleaned up on failure — the directory is removed and the failure is reported.
- [x] 9.8 A rerun is idempotent — no re-clone, no re-register, `already-registered` in the report.
- [x] 9.9 Never-harvest: a Store with many obtainable projects, run under `--yes`, obtains zero projects.
- [x] 9.10 The remote is passed as an argument vector, never a shell string — assert `execFile` is used (not `exec`), and the remote never appears in a concatenated command line.
- [x] 9.11 Windows: clone targets, the non-empty-directory guard under a path differing only by drive-letter case or separator form, derived-name safety, and git invoked with `windowsHide`. Expected paths built with `path.join()`.
- [x] 9.12 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`. Run serially, backgrounded with bounded foreground polling; never concurrent vitest batches. Attribute any pre-existing failure individually (known baseline: `test/release-contract.test.ts`, `test/cli-e2e/basic.test.ts`, `test/commands/handoff.test.ts`, `test/commands/workset.test.ts` — all unmodified in this tree).

## 10. Docs and locales

- [x] 10.1 `docs/cli.md`: the obtain flow (project-first and Store-first), the `--yes` asymmetry stated explicitly, the clone target rules, and the cleanup guarantee.
- [x] 10.2 The obtain troubleshooting section: one entry per degraded and blocked state with its repair, including a failed retrieval (cleanup ran vs. directory pre-existed) and a refused clone target.
- [x] 10.3 JSON examples for an obtain result: a complete apply (all declared Stores obtained), a degraded apply (a Store could not be obtained), and an idempotent rerun.
- [x] 10.4 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message, state name, consent string, and cleanup report, with no English fallback for new keys.

## 11. Verification and integration

- [x] 11.1 `node bin/rasen.js validate store-bootstrap-obtain --changes --json` clean. Read the per-item `valid` for THIS change; the summary totals carry unrelated failures from delta-less container dirs.
- [x] 11.2 Rehearse the spec merge with `rasen archive --json --yes` in a scratch root (copy `rasen/config.yaml` + `rasen/specs/` + this change dir into a temp dir and run with cwd there). `validate` does not apply deltas to main specs; only the archive rehearsal proves the merge. **The MODIFIED blocks must carry every scenario the current spec holds** — confirm the rehearsal does not throw `findMissingCurrentScenarios`. **Method:** archive E1 first in the scratch root (creates `rasen/specs/store-bootstrap/`), then archive E2 on top, then archive E3 on top — all three must succeed clean. The two MODIFIED requirements chain E1→E2→E3 serially.
- [x] 11.3 Re-run the portfolio-wide collision sweep over ALL active change directories. This change carries two MODIFIED blocks against `store-bootstrap` (requirements 3 and 5) and two ADDED blocks (disjoint titles). Confirm no other active change MODIFIEs the same requirements concurrently — E3 archives after E2 (the E2→E3 edge is HARD, §6.3 of the decomposition plan).
- [x] 11.4 Confirm `rasen/changes/store-bootstrap-and-hydration/` was not modified, moved, or deleted by this work — it is the source material for E4.
- [x] 11.5 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, and sibling change dirs. Never `git add -A`. Keep `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md` out of every pathspec.
- [x] 11.6 Confirm no version number in `package.json` was changed by this work.
- [x] 11.7 Confirm Windows CI covers this change's path-sensitive test files (clone targets, git spawn, derived names).
