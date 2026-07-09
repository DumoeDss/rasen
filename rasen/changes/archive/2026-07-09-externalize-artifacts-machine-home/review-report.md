# Review report: externalize-artifacts-machine-home

- Reviewer: reviewer-machine-home (dispatched, report-only; not the author)
- Date: 2026-07-09
- Scope: uncommitted working-tree diff on the change's declared files (foreign dirty/untracked files ignored)
- Known facts accepted without re-verification: full suite green (2222 passed / 0 failed, tree a15a915f)
- **Round 2 verdict (final): CLEAN — all Round 1 findings resolved; see "Round 2 — delta re-review" at the end**

## VERDICT (Round 1): FINDINGS — 0 Blocker / 2 Major / 5 Minor / 4 Trivial

Scope check: CLEAN. Intent (proposal.md): project identity + machine registry + home resolver + doctor GC. Delivered diff matches; the one file outside the proposal's impact list (`src/core/completions/command-registry.ts`, `--gc` flag entry) is justified by the new doctor flag. No template/telemetry files touched. One artifact drift noted (T3 below). `test/core/completions/command-registry.test.ts` was listed in the review scope but has no diff (parity test passes as-is).

## Spec axis summary

All six spec requirements are implemented and unit-tested on their happy paths: identity minting/preservation (init + lazy append with revert-on-invalid), locked atomic registry updates, home naming with fork suffix, worktree share, moved-repo rebind, probe mode, self-heal throttle, doctor reporting and `--gc` reference-counted deletion. The findings below are compound/concurrent scenarios the tests do not reach.

**LEAD's specific concern — `ensureDefaultConfig` minting a projectId for every scaffolded config (incl. store roots): judged ACCEPTABLE, not a finding.** Evidence: the only caller chain is `rasen store create` → `ensureOpenSpecRoot` (`src/core/store/operations.ts:627`) → `ensureDefaultConfig` (`src/core/workspace-root.ts:318`) — a scaffold/write command, so the lazy-identity rule ("ordinary read commands never write into the repo") is not violated; the mint happens at creation time, exactly like init. Store roots are design-sanctioned projects (design D5: "projectRoot = directory containing rasen/ (a planning root, repo- or store-side)") and their changes will need T3 workdirs in child 2. The home directory the store-lifecycle test observed is created later by first-touch registration (self-heal), which D4 step 3 folds into registration and which writes only under `<globalDataDir>`, never the repo. Read-command repo purity verified: the only `ensure:true` caller is init (`src/core/init.ts:225`); `touchProjectRegistry` skips when the config has no projectId (`src/core/project-home.ts:128`) and never mints.

**Self-heal hook audit (LEAD ask):** error swallowing is complete — the entire body of `touchProjectRegistry` sits in one try/catch (`src/core/project-home.ts:126-157`) and `readProjectConfig`/`canonicalizeExistingPath` cannot throw past it; the 24h `lastSeen` throttle is correct (unparseable timestamp → treated stale → rewrite; future timestamp → treated fresh → skip). Windows canonicalization uses `realpathSync.native` (case-folds, expands 8.3 aliases, resolves subst/junctions) with covered tests.

---

## Findings

### MAJOR-1 — GC deletes home directories after releasing the registry lock (TOCTOU)

`src/core/project-registry.ts:366-370`. `gcProjectRegistry` computes `removedHomes` inside the locked updater but performs the `fs.rm` **after** `updateProjectRegistryState` returns, i.e. after `releaseFileLock`. A concurrent `registerProject` can run in the gap between the registry write and the `rm`.

Failure scenario: repo at path P (home `my-app-abcd1234`) is moved; its old entry dangles. Terminal 1 runs `rasen doctor --gc`: the dangling entry is removed and `removedHomes = ['my-app-abcd1234']`. Before the `rm` executes, terminal 2 runs a command in the moved repo: self-heal → `registerProject` → the same-id entry is gone (GC already removed it) → fresh fork re-derives the **same** base home name (same basename + same projectId hash) → creates the dir, registers a live entry, and (once child 2 lands) starts writing T3 state into it. Terminal 1's `rm -rf` then deletes a home referenced by a live entry — a direct violation of spec "A home directory still referenced by any live entry SHALL never be deleted", with data-loss potential once homes hold T3 state.

Fix direction: perform the deletions while still holding the lock (inside the updater, after mutating `projects`), or re-acquire the lock and re-check references immediately before each `rm`.

### MAJOR-2 — Default `rasen doctor` masks a corrupt registry as "Not registered"

`src/commands/doctor.ts:110-124` (`.catch(() => null)` / `.catch(() => [])` around `findProjectRegistryEntry` and `findDanglingProjectEntries`). `parseProjectRegistryState` produces exactly the diagnostic the spec requires ("Invalid project registry state: … Repair or remove <path>", `src/core/project-registry.ts:92-97`), but doctor's gather step swallows it.

Failure scenario: `registry.json` is corrupted (truncated write, manual edit). The user runs `rasen doctor` — the designated health surface — and gets `Machine home: Not registered`, `dangling: []`: actively misleading, no hint the registry is broken. Spec (project-registry, "Machine-wide project registry"): "A malformed registry SHALL produce a clear diagnostic naming the file" — swallowing is correct for ordinary commands ("SHALL never crash commands that do not need the registry"), but doctor *does* need the registry; it is the reporting surface. (`--gc` on the same corrupt file surfaces the error via `doctor_failed`, making default doctor's silence inconsistent even internally.)

Fix direction: in `gatherHealth`, catch the error and emit a machine-home status/diagnostic entry (e.g. `machineHome.error` with the StoreError message + fix) instead of defaulting to unregistered/empty.

### MINOR-1 — Moved-repo rebind takes precedence over worktree share, hijacking a deleted clone's home

`src/core/project-registry.ts:252-269`. The 2a rebind loop runs before the 2b worktree check. Scenario: clone A live (home X), clone B deleted but not GC'd (home X-2, dangling entry, same projectId). User creates a git worktree of clone A. Registration walks same-id entries, hits B's stale path first → "moved repo" rebind → the worktree is bound to home **X-2** instead of sharing A's home X. Spec scenario "Worktrees resolve to one home" is violated in this compound state, and the worktree will not share ephemera with its main checkout. Design D4's prose lists the cases in this order but describes them as classifications, not a mandated precedence; checking worktree-siblinghood before claiming a rebind would resolve it.

### MINOR-2 — A copy of a project inside the same repository wrongly shares one home

`src/core/project-registry.ts:193-197` (`isGitWorktreeSibling`). The predicate compares only `git rev-parse --git-common-dir`, which is identical for any two directories inside the same working tree — not just worktrees of one repo. Scenario: `cp -r packages/app packages/app-experiment` inside one repo (config incl. projectId copied along); both paths exist, same projectId, same common dir → they SHARE one home, cross-contaminating future T3 run-state between two genuinely distinct projects — exactly the failure mode design D4 says forking is meant to prevent ("sharing when wrong cross-contaminates"). The implementation is faithful to the design's stated predicate; the predicate itself has this hole. A stronger check: require equal root-relative paths (`git rev-parse --show-toplevel` offsets) in addition to a shared common dir. Flagged for LEAD triage as a design-level gap; should be closed before child 2 puts real state in homes.

### MINOR-3 — Unlocked projectId minting race can revert a registered identity and cause permanent config/registry divergence

`src/core/project-config.ts:527-560`. `ensureProjectIdInConfig` is read-append-verify with no lock. Two concurrent first-ever home-needing runs: both read no-projectId, mint UUID-A and UUID-B, both append. Interleaving 1: B's verify re-read sees A's later append (`extractProjectIdField != UUID-B`) → B reverts the file to its pre-append snapshot, deleting UUID-A that process A already returned **and registered** — config ends with no projectId while the registry holds UUID-A. Interleaving 2: config ends with UUID-B while the registry entry holds UUID-A (path-exact updates never change `projectId`, `src/core/project-registry.ts:241-246`), and nothing ever reconciles them — `touchProjectRegistry`'s `isCurrent` check (`src/core/project-home.ts:140-144`) then fails on every subsequent command, so every command takes the registry lock and rewrites the file forever (defeats the 24h throttle; spec "Unchanged state does not rewrite the registry" in spirit). Design's Risks section covers concurrent *registration* but not the config append. Homes stay stable (path-exact keeps `home`), so no data loss. Fix direction: route the mint through a lock (the registry lock is available), and/or let path-exact registration adopt the config's projectId when it diverges.

### MINOR-4 — GC completeness and truthfulness gaps

`src/core/project-registry.ts:354-370`. (a) Only homes belonging to entries removed **in this run** are candidates for deletion; a home directory with no registry entry at all — left by a prior GC whose `rm` failed (errors swallowed at :369) or a crash between the registry write and the `rm` — is never collected by any later `--gc`, contra spec "delete home directories that no remaining entry references". (b) `removedHomes` is computed before deletion and `rm` failures are swallowed, so `doctor --gc` prints "Deleted orphaned home: X" (and reports it in `--json`) even when nothing was deleted. Fix direction: scan `<globalDataDir>/projects/` for directories not referenced by any entry, and build `removedHomes` from successful deletions.

### MINOR-5 — Self-heal has no globalDataDir injection seam; always writes the real machine registry

`src/core/root-selection.ts:521`. `touchProjectRegistry(root.path)` is called with no options, so it always targets `getGlobalDataDir()`, while everything else in the new code follows the store-code DI pattern (`globalDataDir` option) and the design's stated test policy ("tests inject globalDataDir via options like the store code does"). Any in-process test (or future embedder) that exercises `resolveRootForCommand` against a projectId-bearing project silently registers temp paths (and creates home dirs) in the developer's real `%LOCALAPPDATA%\rasen` unless the process env pins `XDG_DATA_HOME` — the exact hazard `test/core/root-selection.test.ts:26-31` documents as needing a backstop. Today all shipped tests are isolated (runCLI injects XDG env; init tests pin `XDG_DATA_HOME`), so this is latent, not active. Fix direction: accept/thread an options bag on `resolveRootForCommand` or read the resolver's own `globalDataDir` when present.

### TRIVIAL-1 — Init's config-write-failure path prints "run 'rasen init' first" during init

`src/core/init.ts:756-773` + `:225`. When `createConfig` returns `'skipped'` (config write failed), `registerMachineHome` → `ensureProjectIdInConfig` throws "No Rasen config found … run 'rasen init' first", which init then prints as its own warning — confusing advice from inside init itself.

### TRIVIAL-2 — `doctor --gc` on a machine with no registry creates an empty registry.json

`src/core/project-registry.ts:343-364`. `updateProjectRegistryState` unconditionally writes, so a no-op GC materializes `projects/registry.json` (and bumps mtime on every no-op GC). Cosmetic state creation on what should be a pure cleanup.

### TRIVIAL-3 — Proposal/impact drift: self-heal hook location

Proposal Impact names `src/cli/index.ts (self-heal hook)`; the hook landed in `resolveRootForCommand` (`src/core/root-selection.ts:521`), which is what design D6 specifies. Design wins; the proposal's impact list is the stale artifact.

### TRIVIAL-4 — gitCommonDir equality check does not case-fold on Windows

`src/core/project-registry.ts:196`. `path.resolve(a) === path.resolve(b)` is case-sensitive; a casing mismatch between git outputs would misclassify a worktree as a clone. Failure mode is the safe default (fork), per design D4's "fork when unsure" rule, so impact is an extra home at worst.

---

## Standards axis

No documented-standard violations found. New code mirrors `store/foundation.ts` idioms (lock factory wording, Zod strict schemas, `formatZodIssues`, DI via options bag), reuses `file-state.ts` unchanged as required, and matches surrounding comment/naming style. `toKebabCase` (`src/core/id.ts:23-29`) is consistent with the module's grammar utilities. One nit folded into TRIVIAL findings (init warning indentation `  ⚠` under flush-left summary lines — not separately counted).

## Coverage gaps (informational, feed MINOR findings above)

- No test for GC racing a concurrent registration (MAJOR-1) — would need interleaved-process orchestration; acceptable to cover by moving `rm` under the lock and testing that ordering instead.
- No test for doctor's output on a corrupt registry (MAJOR-2) — easy to add: write `{not json` and assert doctor surfaces a diagnostic.
- No test for the stale-entry-plus-worktree compound (MINOR-1), the same-repo-copy share (MINOR-2), concurrent first mint (MINOR-3), or orphan-home-without-entry GC (MINOR-4).

---

## Round 2 — delta re-review (2026-07-09)

Re-review of the fix delta by the original reviewer (fixer was a separate non-author worker). Every fixer claim verified against actual code; targeted suites re-run by the reviewer: 129/129 across the 6 affected test files (project-registry, project-config, project-home, root-selection, doctor, relationship-health), `tsc --noEmit` exit 0.

### Per-finding verdicts

**MAJOR-1 (GC TOCTOU) — RESOLVED.** `gcProjectRegistry` (src/core/project-registry.ts:405-445) now runs read → registry write → home deletions entirely inside one hold of the new `withProjectRegistryLock` (:179-192); a concurrent `registerProject` cannot acquire the lock until deletions finish, so it can never re-claim a home in the gap. No lock re-entrancy: the GC body calls `readProjectRegistryState`/`writeProjectRegistryState` directly, not `updateProjectRegistryState`. Regression test "never leaves a home deleted while a concurrent registration re-claims its exact name (MAJOR-1 TOCTOU)" validates both interleavings (rebind-first and gc-first) — both leave the home dir existing and the entry pointing at it.

**MAJOR-2 (doctor masks corrupt registry) — RESOLVED.** `gatherHealth` (src/commands/doctor.ts:113-136) wraps the probe in try/catch and forwards a `machineHomeError` (message + StoreError fix) instead of defaulting silently; `MachineHomeHealth` gains an optional `error` field (additive, JSON-shape backward compatible); human output prints `Error:`/`Fix:` and no longer says "Not registered" on a corrupt file. Regression test asserts both JSON and human surfaces, exit 0.

**MINOR-1 (rebind precedence hijack) — RESOLVED.** Worktree-share detection now runs before moved-repo rebind (src/core/project-registry.ts:285-308). The reordering is safe in the reverse direction: a missing old path can never match the worktree check (git fails on a missing directory → `gitCommonDir` null), so genuine moves still fall through to rebind. Regression test covers the exact hijack scenario (live clone + dangling same-id fork + new worktree → shares the live clone's home).

**MINOR-2 (same-tree copy shares home) — RESOLVED.** `isGitWorktreeSibling` (src/core/project-registry.ts:222-230) now additionally requires `git rev-parse --git-dir` to DIFFER (new `gitDir()` in src/core/store/git.ts:194-206). Verified against the true-share matrix: main root + linked worktree (differs → share), two linked worktrees (share), subdir projects across worktrees (share), same-tree `cp -r` copy (identical git-dir → fork), non-git (fork). Regression test covers the monorepo copy case. Residual (accepted): a copy placed inside a *different worktree* of the same repo would still share (same common-dir, distinct git-dirs) — exotic; a root-relative-path comparison would close it if it ever matters.

**MINOR-3 (unlocked mint race) — RESOLVED.** `ensureProjectIdInConfig` (src/core/project-config.ts:533-584) keeps the lock-free fast path for configs that already carry an id, and serializes minting under `withProjectRegistryLock` with a re-read under the lock; the loser of the race adopts the winner's id instead of appending a second one, so the verify-revert clobber and the permanent config/registry divergence are both unreachable via the race. Import direction is one-way (project-config → project-registry; no cycle). Regression test races two callers and asserts one id, one `projectId:` line. Residual (accepted, pre-existing scope): a *manual* projectId edit still diverges from the registry's immutable entry and re-triggers a self-heal write per command — out of the original finding's race scenario.

**MINOR-4 (GC completeness/truthfulness) — RESOLVED.** New `listUnreferencedHomeDirs` (src/core/project-registry.ts:376-389) folds entry-less orphan homes into GC candidates; `removedHomes` now reports only deletions whose `fs.rm` succeeded. Regression test covers the crashed-prior-GC orphan. Forward-looking note for siblings: GC deletes ANY unreferenced directory under `<globalDataDir>/projects/` — future children must not park non-home directories there.

**MINOR-5 (self-heal DI seam) — RESOLVED.** `resolveRootForCommand` gains a `globalDataDir` output option threaded to both `resolveOpenSpecRoot` and `touchProjectRegistry` (src/core/root-selection.ts:498-532). Regression test asserts the touch lands in the injected registry and does NOT leak into the XDG-default one.

**TRIVIAL-2 — taken.** No-op GC no longer writes the registry (write gated on `removedEntries.length > 0`). Cosmetic residue (accepted): acquiring the lock still `mkdir`s an empty `projects/` dir on a registry-less machine.

**TRIVIAL-1 / TRIVIAL-3 / TRIVIAL-4 — intentionally left; accepted-known.** Confirmed the remaining accepted-known set is exactly T1 (init 'skipped'-config warning wording), T3 (proposal-impact drift re: hook location), T4 (gitCommonDir comparison case-folding; failure mode is the safe fork).

### New-issue sanity check on the fixes

- **Lock scope / deadlock:** no nested acquisitions anywhere (`gcProjectRegistry` and `ensureProjectIdInConfig` bodies never call the locking update helper; `resolveProjectHome` acquires mint-lock and register-lock sequentially, never nested). Mint lock is held only on the first-ever mint; steady-state commands stay lock-free.
- **Residual (accepted): GC lock-hold duration vs stale-steal.** GC now deletes home dirs while holding the lock; `file-state.ts` steals locks older than 30s. If deletions ever exceed 30s (large future T3 trees, many orphans), a competitor could steal mid-GC and reopen a narrow race. Homes are near-empty in this child; revisit when child 2 puts real state in homes (refresh the lock file mtime during long deletions, or chunk).
- **Worktree predicate regression risk:** checked — real worktree sharing (root-level and subdir) still shares; the existing share tests pass.
- **Foreign file note:** `test/core/templates/skill-templates-parity.test.ts` is now dirty in the tree — owned by the concurrent session, not part of this change, not reviewed.

## FINAL VERDICT: CLEAN — 0 Blocker / 0 Major open; all Round 1 findings resolved (7/7), accepted-known set = T1/T3/T4 plus the three residual observations noted above.
