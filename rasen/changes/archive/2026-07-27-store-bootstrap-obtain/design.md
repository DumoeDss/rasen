## Context

This is slice 3 of 4 of Phase E. E1 (`store-bootstrap-diagnose`) shipped the
read-only diagnosis command at `f11daa1d`. E2 (`store-bootstrap-adopt-local`)
shipped the project-first acting-on-local half at `9f4286da`: registering the
current checkout, registering present-unregistered Stores, preparing the
knowledge location, writing the durable declaration, and re-verifying
membership after a Store becomes available. Both are review-clean and their
delta specs are frozen.

This change **carves the retrieval half** out of E's complete design rather than
re-deriving it. Where a requirement, a decision, or a task belongs to the
retrieval half, its wording is preserved from E. The carve point is E's own: E's
D5 named the data-loss path and the argument-vector discipline as the two things
that make retrieval different from every other write in the portfolio.

### The split question — resolved: keep E3 as one change

The decomposition plan §9 (calibrated against E1's 4 review rounds) recommended
splitting E3 into retrieval (groups 7, 8.1–8.6, 5.2 obtain half) versus
failed-retrieval cleanup (8.7 + E's requirement *A failed retrieval is cleaned
up only when provably safe*). The rationale: cleanup is where data destruction
lives and deserves isolated review.

**This change does not split.** Evidence from the actual code:

1. **The cleanup proof and the cleanup action are tightly coupled — splitting
   them creates a worse review posture.** The proof that "this run created the
   directory" is established by recording whether the target directory existed
   *before* the clone attempt (`fs.existsSync(target)` at the moment the obtain
   step begins). The cleanup decision consumes that proof at the point of clone
   failure. Splitting the two across changes means the proof mechanism becomes
   an interface contract between two codebases rather than a local invariant
   visible in one diff. A reviewer of the cleanup child alone would see the
   *consumption* of the proof but not its *establishment* — the more dangerous
   half of the contract.

2. **The inherited infrastructure makes the combined diff reviewable.** E2's
   construction-time `mutates` field means every new repair (obtain, clone)
   declares its mutation at the construction site — TypeScript makes the
   omission a compile error. The every-catch-pushes-diagnostics rule means every
   new reader (git operations, remote resolution) pushes diagnostics on failure.
   The consent-gating infrastructure (`confirmAction`) already exists and
   applies to obtain repairs. `computeBootstrapEndState` already refuses
   `complete` in the presence of error-severity diagnostics. These rules are
   battle-tested (E2 shipped in 1 round) and bind E3 without re-derivation.

3. **The data-destruction guard is a single, well-defined invariant with a
   specific test case, not a diffuse concern.** The cleanup decision is ONE
   branch point: did the target directory exist before this run? If no, removal
   is safe. If yes or unknown, the directory is left untouched. The required
   test case (E's D5 fear) is named explicitly: pre-existing directory with
   content → retrieval fails → directory and content are byte-identical
   afterward. A reviewer holds one branch point and one test; that fits inside a
   combined diff without diluting attention.

4. **E2 shipped in 1 round, not 4.** The premise of the §9 recommendation —
   that E3 is "too big to review" based on E1's 4 rounds — did not survive E2.
   E1's rounds were NOT about write-safety (one crash, one confident wrong
   answer, one rendering gap); the collapsing invariant bought less than
   expected because the defects were in a different axis. E3's data-destruction
   risk IS in the axis the invariant addresses (filesystem state), so the guard
   is more load-bearing here than E1's invariant was for E1's defects.

5. **The cleanup is ~3 tasks out of ~30.** Isolating it as its own change with
   full propose/review/ship/archive overhead is not worth the review benefit
   when the proof and action are coupled and the inherited rules already bind.

**How the cleanup risk is managed in a combined diff:** the guard is specified
as an invariant-level rule (not a comment) in the spec and in design D5 below.
The required test case is explicit in the spec scenario and in the tasks. The
reviewer knows to look for this specific test. The cleanup code is a small,
identifiable section of the obtain step — the reviewer can focus on it without
the rest of the diff competing for that specific attention.

### Dependency re-verification against landed code

E's group 1 asked for this, and every prior child found drift. Run against
`HEAD=9f4286da`:

| Surface | State | What E3 does with it |
|---|---|---|
| `selectBootstrapLocation` (`bootstrap.ts:478`) | landed (E1) | E3 reuses it unchanged for clone target selection. The function already refuses occupied directories and existing checkouts. E3 adds **enforcement**: when the location is refused, the clone does not proceed. |
| `deriveSafeLocationName` (`bootstrap.ts:422`) | landed (E1) | E3 reuses it for deriving a safe basename from a remote. Already validated against separators, traversal, and Windows reserved names. |
| `inspectChosenLocation` (`bootstrap.ts:495`) | landed (E1) | E3 calls it to determine whether a target is usable or refused at clone time. The check is already canonical-path-aware. |
| `registerExistingStore` (`operations.ts:945`) | landed | E3 calls it after a successful clone, exactly as E2 calls it for a present-unregistered Store. |
| `execFileAsync` (`git.ts:19`) | landed | E3 routes `git clone` through it. Already sets `windowsHide: true` and uses `execFile` (argument vector, never a shell string). |
| `BootstrapRepair` `mutates` field (`bootstrap.ts:138`) | landed (E2) | E3's new repairs (obtain, clone) carry `mutates: true` at construction. The filter blocks them at unknown arms. |
| `confirmAction` (`bootstrap.ts:1032`) | landed (E2) | E3's obtain steps use it for consent gating. Blanket covers declared Stores; non-declared always asks. |
| `applyProjectFirstActions` (`bootstrap.ts:1150`) | landed (E2) | E3 extends the apply path: after E2's registration step, an obtain step runs for absent-with-remote Stores. |
| `buildStoreFirstReport` (`bootstrap.ts:1818`) | landed (E1, read-only) | E3 extends it: in apply mode, the Store's own checkout is registered and explicitly selected projects are obtained. |
| `registerProject` (`project-registry.ts:292`) | landed | E3 calls it when a project is obtained from a Store, to register the new checkout. |
| `resolveProjectMembership` (`membership.ts:363`) | landed | E3 calls it after obtaining a Store, to re-verify membership against the now-readable records. |

Net: **no dependency drifted in a way that changes the plan.** Every surface E3
needs is landed and matches what E's design assumed.

## Goals / Non-Goals

**Goals:**

- Close the last gap in the project-first apply path: obtaining declared Stores
  that are absent with a recorded remote.
- Make the Store-first apply path act: register the Store's checkout and obtain
  explicitly selected projects.
- Enforce clone target safety at clone time — the refusal E1 previewed becomes
  a refusal that prevents the clone.
- Govern failed-retrieval cleanup by a provable-creation guard that never
  deletes a directory this run did not create.
- Keep the never-harvest rule true even under `--yes`.

**Non-Goals:**

- Rewriting the failure text of ordinary commands, and the doctor readiness
  integration. Those are E4.
- Cross-machine knowledge bundle import. That is F4.
- Re-litigating E1's report shape, E2's apply state machine, the `mutates`
  field, or the `--check` / `--dry-run` / `--apply` separation. E3 consumes
  them unchanged.
- Interactive conflict reconciliation, `git pull`, `git push`, distributed
  locks, or credential handling.

## Decisions

### D1 — Which of E's requirements this change takes, modifies, and defers

The governing rule (same as E1's and E2's): **split a requirement rather than
ADD one this change only half-satisfies.**

| E's requirement | Disposition | Why |
|---|---|---|
| A clone target is chosen by stated priority and never overwrites anything | **ADD** | E1 landed the previewed-location half (*A previewed location is chosen by stated priority and reported as usable or refused*). This change lands the enforcement half. Different title, clean `ADDED`. |
| A failed retrieval is cleaned up only when provably safe | **ADD** (verbatim) | Nothing was retrieved before; this is the first change where it applies. |
| Starting from a Store lists its projects and obtains none without being asked | **MODIFY** E1's *Starting from a Store checkout, its projects are listed with their local state* | E1 shipped the listing half (read-only). This change deepens it: apply mode registers the Store's checkout, and a project is obtained and registered on explicit selection. E1's four scenarios are preserved; the acting scenarios are added. |
| Starting from a project clone resolves every declared Store and reports each one's state | **MODIFY** E2's version (*Starting from a project clone, every declared Store is classified and reported*) | E2 shipped the acting-on-local half. This change adds the obtain path: an absent-with-remote declared Store is cloned and registered during apply. E2's scenarios are preserved verbatim; the obtain scenarios are added. One E2 scenario (*Apply does not retrieve from a remote*) is updated in body to describe when apply still does not retrieve (consent withheld, Store not declared). |
| Commands that cannot resolve a Store name bootstrap as the repair | **Deferred** to E4 | Its central claim is false until E4 ships the failure-text rewrite. |
| Checking and previewing are separate promises | **Already landed** by E1 | E3 does not touch the read-only modes. |
| One command reports everything a machine still needs | **Already landed** by E1 | E3's apply mode also produces the report. |
| Every hint bootstrap prints can be pasted and will work | **Already landed** by E1 | E3's new hints inherit the rule. |
| Running bootstrap again changes nothing that is already correct | **Already landed** by E2 | E3 inherits the idempotence discipline. |
| A declaration bootstrap writes is durable and usable | **Already landed** by E2 | E3 does not write declarations. |

Result: **two MODIFIED blocks and two ADDED blocks**, all against
`store-bootstrap`.

### D2 — The invariant, and where it is weaker than it looks

**The invariant:** every obtained repository either lands complete at the
location the preview named, or the filesystem is left exactly as it was found.
No silent overwrites, no partial clones left behind, no cleanup of directories
that pre-existed.

**Where it is weaker than it looks — the cleanup case.** "Left exactly as it
was found" is trivially true when the clone succeeds (the directory is new and
complete). It is also trivially true when the clone fails into a directory this
run created (the partial clone is removed, restoring the pre-clone state). It is
NOT trivially true when the clone fails into a directory that **already existed
before this run** — "cleaning up" that directory deletes the user's data. This
is E's D5 trap, stated as an invariant-level rule, not a comment:

> **Cleanup invariant:** bootstrap SHALL NOT remove a directory unless it can
> prove that this run created it. The proof is the recorded non-existence of the
> target directory at the moment the obtain step began (`fs.existsSync(target)`
  returned `false` before the clone was attempted). If the proof is absent,
  unknown, or indicates the directory pre-existed, the directory is left
  untouched and the failure is reported with what to inspect.

This is the single point where E3's invariant has teeth, and it is where the
review attention concentrates. The required test case constructs the exact
scenario: target directory pre-exists with content → retrieval "fails" (or the
path is occupied) → directory and content are byte-identical afterward.

### D3 — The obtain step in the project-first apply state machine

E2's apply state machine (design D5) runs in this order: (1) read and classify;
(2) register the current checkout; (3) register present-unregistered Stores;
(4) re-verify membership; (5) prepare the knowledge location; (6) write the
durable declaration.

E3 inserts the obtain step **between E2's step 3 and step 4**:

1. Read and classify (E1's path, unchanged).
2. Register the current project checkout (E2).
3. Register each present-unregistered Store the user named a location for (E2).
4. **Obtain each absent-with-remote declared Store** (E3, new). Clone to the
   location `selectBootstrapLocation` computed, then register through
   `registerExistingStore`. Consent-gated: without `--yes`, each obtain asks;
   with `--yes` (project-first), declared Stores are obtained without asking.
5. Re-verify membership for newly-available Stores (E2, now also covering
   obtained Stores — their records are readable for the first time).
6. Prepare the knowledge location (E2).
7. Write the durable declaration (E2).

Each step is individually idempotent. An obtained Store that is already
registered (a rerun) is reported as `already-registered` and not re-cloned.

**Why the obtain step goes after registration, not before.** E2's step 3
registers Stores that are present but unregistered. Step 4 (obtain) handles
Stores that are absent. Running registration first means a present-but-
unregistered Store is never cloned — the clone step only fires for Stores whose
classification is still `absent-with-remote` after registration, which is
exactly the set that needs cloning.

### D4 — The Store-first apply state machine

E1's Store-first flow reads the Store's identity, lists its projects, and
reports. E2 left `--apply` from a Store producing the same read-only listing.
E3 makes it act:

1. Verify the Store's identity and register the checkout (E1's read path +
   `registerExistingStore`). Consent for the Store's own checkout is covered by
   invoking apply, the same way E2 treats the project's own checkout.
2. Read the Store's project records and list each with its local state (E1's
   listing, unchanged).
3. For each project the user **explicitly selects** or supplies a path for:
   clone to the selected location, then register through `registerProject` and
   `registerExistingStore` as appropriate.
4. `--yes` covers registering the Store's own checkout only. It does NOT obtain
   any project, however many the Store records.

**Explicit selection mechanism.** The `--path <projectId>=<dir>` flag selects a
project and names its target location. In interactive mode (apply without
`--yes`), the user is asked which projects to obtain via an inquirer select
prompt — each selection triggers an obtain. A project the user does not select
is left unobtained, whatever its remote says.

**Why `--yes` does not count as selection.** A Store's roster is authored by
other people and can grow without the local user knowing. `--yes` means "I
trust my own committed configuration." The Store's project records are NOT the
user's own committed configuration — they are someone else's. Turning `--yes`
into "obtain whatever this Store now lists" would consume disk and network the
user never agreed to. This is E's adjudicated `--yes` asymmetry, carried forward
from E2 (which owned the project-first half) into E3 (which owns the Store-first
half). The two flows are not unified behind one predicate.

### D5 — THE data-destruction guard (clone target safety and cleanup)

This is the decision E3 owns outright, and it carries the only
data-destroying failure mode in the portfolio.

**Clone target enforcement.** E1 previewed where a repository would land and
reported occupied or checkout-holding locations as refused. E3 enforces the
refusal:

- **Before cloning**, `selectBootstrapLocation` is called (the same function E1
  uses for preview). If the result is `refused` (not-empty, existing-checkout,
  or unreadable) or `required` (no location), the clone does not proceed. The
  refusal is reported; no git command runs.
- **The remote is passed as an argument vector, never a shell string.**
  `execFileAsync('git', ['clone', remote, target])` — the same function
  `src/core/store/git.ts` already routes every git spawn through, which sets
  `windowsHide: true` and uses `execFile` (not `exec`). The remote never appears
  in a concatenated command line.
- **No legacy recorded path influences the target.** `selectBootstrapLocation`
  takes no recorded path, by construction — it receives only `suppliedPath`,
  `parentDirectory`, and `nameSource`. A path another machine wrote cannot reach
  it.

**Failed-retrieval cleanup.** When `git clone` fails (network error,
authentication failure, invalid remote, or the target directory turns out to be
occupied despite the pre-check):

1. **Did this run create the target directory?** The proof is the recorded
   `fs.existsSync(target)` from before the clone attempt. If it returned
   `false`, this run created (or attempted to create) the directory, and
   removing it restores the pre-run state. If it returned `true`, the directory
   pre-existed, and removing it would delete the user's data.
2. **If this run created it:** remove the directory and report the failure. The
   directory contained only the failed clone attempt; removing it is safe.
3. **If it pre-existed, or provenance is unknown:** leave the directory exactly
   as it is. Report the failure, name the directory, and say what to inspect.
   Do NOT attempt partial cleanup — a half-corrupted clone in a pre-existing
   directory is the user's to diagnose, not bootstrap's to "fix" by deleting.

**The guard is local.** The provenance check (`fs.existsSync(target)` before
clone) and the cleanup decision are in the same function — the proof does not
cross a module boundary where a future change could consume it without
establishing it.

### D6 — The never-harvest rule, even under `--yes`

E's D4 states it: a Store can hold a hundred projects; a bootstrap that
obtained all of them would consume disk and network the user never agreed to.
E3 inherits this as a hard rule:

- **Store-first:** a project is obtained ONLY on explicit selection (interactive
  pick or `--path <projectId>=<dir>`). `--yes` does not select; it covers
  registering the Store's own checkout only.
- **Project-first:** `--yes` MAY obtain the Stores the project itself declares,
  because the expected set comes from the user's own committed declarations.
  This is the asymmetry E2 established; E3 implements the project-first obtain
  half of it.

The rule is tested directly: a Store fixture with many obtainable projects, run
under `--yes`, obtains zero projects and registers only the Store's checkout.

### D7 — Git clone through the existing spawn discipline

E3 is the first code in the product that runs `git clone`. The existing
`src/core/store/git.ts` module already:

- Routes every git spawn through `execFileAsync`, which sets `windowsHide: true`
  (prevents conhost window flashes on Windows) and uses `execFile` (argument
  vector, not a shell string).
- Has `isSpawnNotFoundError` for detecting a missing git binary.

E3 adds a `cloneRepository` function to `git.ts` that:

- Takes `(remote: string, target: string)` — the remote is an argument, never
  concatenated.
- Calls `execFileAsync('git', ['clone', '--', remote, target])`. The `--`
  separates the remote from git's own options, preventing a remote starting with
  `-` from being interpreted as a flag (the argument-vector discipline makes
  this defense-in-depth, not a primary guard — `execFile` never invokes a
  shell).
- Throws a `StoreError` with a `fix` on failure (clone failed, remote
  unreachable, authentication required), matching the pattern `initGitRepository`
  and `commitStoreFiles` already establish.
- Reports `ENOENT` (git not installed) distinctly from a clone failure, matching
  `assertGitCommitIdentity`'s pattern.

Tests use **local file:// remotes** (fixture repositories created in temp
dirs), never real network. Every test that writes to disk uses a temp dir with
whole-tree snapshots before and after.

### D8 — Cross-platform

Inherited from E1's D9 and E2's D11, with the path discipline now binding on
clone targets:

- Every path is composed with `path.join()`; clone targets resolve through
  `selectBootstrapLocation`, which already uses `canonicalLocation` (canonical
  comparison through `FileSystemUtils.canonicalizeExistingPath` with the
  `path.resolve` fallback).
- The `git clone` argument vector passes `target` as a resolved absolute path,
  composed with `path.resolve`.
- `execFileAsync` sets `windowsHide: true`, matching every other git spawn in
  the repo.
- The derived name from a remote is validated by `deriveSafeLocationName`,
  which already checks separators, traversal, and Windows reserved device names.
- Tests build expected paths with `path.join()`.

## Risks / Trade-offs

- **Cleanup deletes user data when the provenance check is wrong.** → The check
  is local (same function as the cleanup decision), the proof is a simple
  `fs.existsSync` recorded before the clone, and the required test constructs
  the exact fear scenario. The invariant is stated in the spec, not just the
  design. (D2, D5.)
- **TOCTOU window (theoretical).** Between `fs.existsSync(target)` recording
  the provenance proof and `cloneRepository` actually running, another process
  could create the target directory with user data. If the clone then fails,
  the guard would see `targetExistedBefore = false` (recorded before the other
  process created the directory) and remove it — deleting data the guard's
  snapshot never saw. This is judged **theoretical, not practical**: bootstrap
  runs single-user with sequential `await` (no parallel clone of the same
  target), the window is microseconds, and this is the standard pattern for
  provenance-based cleanup guards (no better option exists without OS-level
  locking, which would introduce deadlock and portability risks worse than the
  theoretical race). Recorded here as a known limitation; do not attempt to fix
  with a lock.
- **`git clone` is the first network-touching operation in bootstrap.** → It
  runs only in apply mode, only for Stores the user explicitly consented to
  obtaining, and the remote is an argument vector never assembled into a shell
  command line. `--check` still contacts no network at all; `--dry-run` still
  creates no directory. (D5, D7.)
- **A Store-first mass clone.** → Explicit selection per project, stated as its
  own requirement. `--yes` does not count as selection. (D4, D6.)
- **A derived name collides with an existing directory.** → `selectBootstrapLocation`
  already inspects the target and reports it as refused. E3 enforces the
  refusal: the clone does not proceed. (D5.)
- **`git` is not installed.** → `cloneRepository` reports `ENOENT` distinctly,
  matching the existing pattern. The failure carries a repair.

## Migration Plan

1. **Clone capability.** Add `cloneRepository` to `src/core/store/git.ts`,
   routed through `execFileAsync`. Tests with local file:// fixture remotes.
2. **Project-first obtain step.** Extend `applyProjectFirstActions` with the
   obtain step between registration and membership re-verification. Consent
   gating through the existing `confirmAction`.
3. **Clone target enforcement.** The obtain step calls
   `selectBootstrapLocation` and refuses to clone if the location is not
   `usable`.
4. **Failed-retrieval cleanup.** The provenance check and cleanup decision in
   the obtain step, with the required test case.
5. **Store-first acting flow.** Extend `buildStoreFirstReport` for apply mode:
   register the Store's checkout, list projects, obtain explicitly selected
   ones.
6. **Never-harvest.** The Store-first selection mechanism (interactive and
   `--path`); the `--yes` Store-first prohibition.
7. **Docs and locales.**

Rollback: reverting removes the obtain step and the Store-first acting flow.
The registrations bootstrap writes are the same registrations the existing
commands already write and understand. A cloned checkout is a real git
repository — removing the bootstrap command does not make it unreadable.

## Open Questions

- Whether bootstrap should offer to record a membership hint when a Store
  records the project but the project does not declare it. Unchanged from E's
  open question — it is child B's write path. E3 reports the drift; it does not
  write the hint.
