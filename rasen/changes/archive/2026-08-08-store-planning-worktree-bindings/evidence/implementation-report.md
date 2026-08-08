# store-planning-worktree-bindings — implementation report (implementer-1)

Status: **production code complete; test coverage partial.** 73 of 98 tasks are
ticked. Everything unticked is listed in §6 with its reason, and the handoff at
`handoff/implementer-1.md` carries the working set for a successor.

**One blocking product conflict is unresolved and left visible as two failing
tests — see §1. Nothing else in the tree is red that was not red before.**

---

## 1. Blocking conflict: `rasen workspace` is a RETIRED command name

`test/commands/legacy-groups-removed.test.ts` pins that `workspace` is not a
top-level command:

```
it('rejects the deleted groups as unknown commands')   // expects: unknown command 'workspace'
it('lists neither group in --help')                    // expects: /^\s*workspace\s/m absent
```

`workspace` was the legacy editor-view group, retired in favour of `workset`.
Tasks 11.1/11.3 tell this change to register a NEW top-level `rasen workspace`
group, and design decision "Risks / Trade-offs" weighed the collision with
`rasen workset` — but not the collision with the RETIRED `workspace` group,
whose removal a test protects.

I did not silently rewrite that pin, and I did not unilaterally rename the
command, because both are product decisions. **The two cases above fail. They
are the only failures in the tree that are mine.**

Two clean resolutions, either of which is a small commit:

- **(a) Rename the CLI surface only.** The Module, the identities
  (`WorkspacePairId`), and the planning-seam names stay `workspace`, so the code
  keeps the design's vocabulary. Only the Commander group and its locale keys
  move. Files to touch: `src/commands/workspace.ts` (group name),
  `src/cli/index.ts` (registration), `src/core/completions/command-registry.ts`
  (one entry name), the three locale trees (one key rename each),
  `test/core/completions/command-registry.test.ts` (three ledger strings), and
  `test/commands/store-v2-workspace-journey.test.ts` (the CLI argv). `rasen
  worktree` and `rasen store workspace` are the obvious candidates.
- **(b) Keep `rasen workspace` and retire the pin.** Then the two cases must be
  rewritten to assert what still holds — the legacy VERBS are refused and no
  `.openspec-workspace/view.yaml` state is honoured — with names that say the
  group name has been re-issued for a different concept.

## 2. What was built

### New Modules

| Path | What it owns |
| --- | --- |
| `src/core/store/target-lines.ts` | `StoreTargetLines`: `add` / `setRef` / `list` / `show` / `resolve`, the `target_line_mismatch` gate, locator resolution that never falls back |
| `src/core/store/workspace/types.ts` | The Interface: plan, token, binding state, cleanup plan, and the closed error taxonomy |
| `src/core/store/workspace/diagnostics.ts` | `StoreWorkspaceError` + `workspaceRefusal`, which forces every taxonomy refusal to carry both disagreeing values and a repair hint |
| `src/core/store/workspace/dependencies.ts` | Filesystem, Git (closed verb set, enforced at runtime as well as by the source guard), machine-root coordination, clock, entropy |
| `src/core/store/workspace/identity.ts` | `canonicalRepositoryIdentity` = canonicalized `--git-common-dir`, `canonicalWorktreeIdentity` = canonicalized `--show-toplevel`, plus the platform case rule and containment |
| `src/core/store/workspace/locks.ts` | The four semantic keys, digest filenames, the fixed order, and an `AsyncLocalStorage`-scoped assertion that no path reaches back |
| `src/core/store/workspace/registry.ts` | The machine index and its fingerprint |
| `src/core/store/workspace/binding.ts` | The four carriers, the authority order, marker/association serialization, index re-verification, idempotent repair, ambiguity detection |
| `src/core/store/workspace/plan.ts` | Read-only, total plan construction with frozen OIDs and a content-addressed id |
| `src/core/store/workspace/apply.ts` | Revalidation, creation from frozen commits, marker writes, phase recording |
| `src/core/store/workspace/cleanup.ts` | The eight preconditions, phase-driven removal, index entry removed last |
| `src/core/store/workspace/module.ts` | `StoreWorkspace` plus the seam the planning resolver consumes |
| `src/commands/workspace.ts`, `src/commands/store-target-line.ts` | Consumer adapters; formatting only |

### Wired into existing code

- `src/core/store-planning/internal/dependencies.ts` gained three injected
  dependencies: `probePlanningWorktree`, `assertPlanningWorktreeUnbound`,
  `completeChangeBinding`.
- `src/core/store-planning/internal/resolver.ts`:
  `planningWorktreeVerified` is now `verifyPlanningWorktree()`, which requires a
  linked worktree, a marker declaring the resolved Store/project/target line, a
  target line whose Store ref resolves to a commit, and a re-derivable worktree
  identity. Every failure is named in the refusal. `createChange` now refuses a
  second Change in one planning worktree before creating anything, and completes
  the binding after publication. A target-line disagreement is now
  `target_line_mismatch` rather than `change_identity_mismatch`.
- `src/core/session-runtime-context.ts`: `RUNTIME_CONTEXT_VERSION` is 2, both
  arms carry `worktree: { root, worktreeInstanceId, ref?, headOid? }`, and the
  context carries `changeInstanceId` / `workspacePairId` when bound.
- `src/core/management-api/supervisor.ts` freezes the pair at session start.
- `src/commands/context.ts` + `src/core/working-set.ts`: the `workspace`
  projection, in both JSON and human form.
- `src/commands/workflow/shared.ts`: `statusFromError` now duck-types any coded
  diagnostic instead of collapsing it to `change_error` (see §3, defect 4).
- Command registry + all three locale trees.

## 3. Four production defects the real-CLI journey found

`test/commands/store-v2-workspace-journey.test.ts` was written after the module
compiled and every unit-level path looked right. It found four defects, all now
fixed — the same lesson child 3's `apply` taught:

1. **Plan ids were not deterministic.** `createdAt` was inside the hashed body,
   so the spec's "equal inputs produce an identical plan" was false for every
   re-plan. `createdAt` now sits beside the id, not inside it. Same fix applied
   to the cleanup plan.
2. **`git worktree add -b refs/heads/x` created `refs/heads/refs/heads/x`.**
   `-b` takes a short branch name; everything above the adapter speaks full
   refs. The adapter now converts and refuses a ref that is not a branch.
3. **Cleanup was permanently unusable.** The marker and association that `apply`
   itself writes are untracked, so precondition 5 failed for every pair this
   Module prepares, and `git worktree remove` (never forced) would have refused
   anyway. The pair's OWN run-state documents are now listed separately
   (`CleanupTarget.ownRunState`), excluded from the untracked census that
   protects the user's work, and removed before the worktree is.
4. **Taxonomy codes were collapsing at the `new change --json` surface.**
   `statusFromError` unwrapped only `RootSelectionError`, so
   `workspace_already_bound` reached the agent as `change_error`.

## 4. Gate results

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm run lint` | clean |
| `pnpm run build` | clean |
| `git diff --check` | clean |
| Encoding audit (21 new/changed files: UTF-8 strict, BOM, NUL, U+FFFD, CRLF, trailing newline) | clean for everything this change wrote |
| `test/core/store/**` + `test/core/management-api/**` | 1162 passed |
| `test/core/store-planning/**` | 25 passed |
| `test/core/session-runtime-context*.test.ts` | 27 passed |
| `test/core/completions/**`, `test/locales/catalog.test.ts`, `test/cli-program.test.ts` | 346 passed |
| `test/commands/**` | 1070 passed, 8 failed |

The 8 command failures are: 5 environmental (`config.test.ts` ×1,
`config-editor.test.ts` ×4 — `%LOCALAPPDATA%\rasen` above `os.tmpdir()`, not
mine, never "fixed"), 2 the `rasen workspace` name collision in §1, and 1 that
was fixed (`pipeline-store-root-selection.test.ts`, see §5).

**`rasen validate store-planning-worktree-bindings --strict` was NOT run.**

## 5. Existing tests changed, and why

Rule 1 says never rewrite a test to match the code. Five files changed; each is
either a fixture that had to learn a new dependency, or a behavior the spec
deliberately changed.

1. **`test/core/store-planning/store-planning.test.ts`** — fixture only. The
   `resolver()` helper gained the three injected dependencies, with a HEALTHY
   default probe, mirroring how it already stubs `checkoutRole`. No assertion
   changed; all 22 cases still assert what they asserted.
2. **`test/commands/store-v2-planning-scope-journey.test.ts`** — fixture plus one
   added assertion. The fixture's target line names `refs/heads/release/0.2`,
   which never existed in the fixture repo; under the tightened gate that
   correctly disqualifies the worktree, so the fixture now creates the branch it
   already claimed. Every pre-existing assertion is untouched. Added: the
   hand-assembled pair is indexed on first use, asserted against literal paths.
3. **`test/commands/pipeline-store-root-selection.test.ts`** — behavior changed
   by spec. A Change frozen against another line now refuses with
   `target_line_mismatch` naming both lines, not the generic
   `change_identity_mismatch`. The case is renamed to say so and now also
   asserts both line names appear.
4. **`test/core/session-runtime-context.test.ts`** — fixture only. Two literal
   `version: 1` constants became `RUNTIME_CONTEXT_VERSION`, so the fixture
   tracks the version instead of pinning the old one. The "unknown version"
   case (version 99) is untouched and still discriminates.
5. **`test/core/completions/command-registry.test.ts`** — ledger updates plus one
   documented exemption. `store target-line` is added to the store subcommand
   list; `workspace plan/show/cleanup` are added to the store-selection lifecycle
   list; `store target-line *` is exempted from the "--store implies --project
   and --target-line" pairing rule because the line is the positional operand
   there, not a selector. `workspace *` is exempted from the
   STORE_SELECTION_GUIDANCE requirement — see §7.

## 6. What is NOT done

Production code is complete for every task section. What is missing is test
coverage. Unticked tasks, with reasons:

- **1.1, 1.2** — the caller inventory was done to write the code but never
  written down, and no `workspace-baseline.test.ts` captures pre-change
  behavior. The tightened gate is now the behavior, so a baseline suite would
  have to be reconstructed from git history.
- **1.5 (partial)** — the deterministic clock/entropy wrapper exists
  (`withDeterministicWorkspaceIdentity`); in-memory filesystem and Git
  implementations do not. Every test written so far uses real Git.
- **2.8, 3.10, 4.9, 5.8, 6.9, 7.7, 8.7, 9.6, 10.10, 11.7** — the ten named unit
  suites. None exist. `workspace-git-verb-guard.test.ts` and the two journeys
  are the only new tests.
- **2.5, 7.5, 8.5, 8.6, 9.4, 10.8, 12.4** — implemented and partly exercised
  through the journeys, but with no dedicated assertion.
- **12.2** (two concurrent lines), **12.3** (branch rename), **12.5**
  (`workspace-windows-paths.test.ts`) — not written. 12.5 is the biggest single
  risk: `path.win32`/`path.posix` construction, mixed-case drive letters,
  short-name and junction aliases, and long paths are all handled in
  `identity.ts` and `plan.ts` but are only exercised on this host's native
  flavor.
- **12.8, 12.9 (partial)** — the affected suites were run and attributed above;
  `rasen validate --strict` was not run.

## 7. Judgment calls

1. **`--include-untracked` deletes the files it lists.** `git worktree remove`
   refuses a tree with untracked files and this Module may never pass `--force`,
   so the flag could not otherwise mean anything. Applying a cleanup removes
   exactly the paths the plan printed, each re-checked as still untracked and
   still inside the recorded root. This is the only place cleanup deletes
   something that is not a worktree.
2. **`bindingState` semantics.** Design decision 5 calls a prepared-but-unbound
   workspace "unbound", while decision 10 lists four states. I mapped them so all
   four mean something: `unbound` = nothing prepared for the scope, `prepared` =
   pair exists without a Change instance, `bound` = pair id complete, `drifted` =
   recorded pair disagrees with live Git.
3. **Index file shape.** Task 3.4 fixes the path at
   `index/<planningScopeId>.json` but ambiguity detection needs several entries.
   The file is a per-scope DOCUMENT holding one entry per Change alias.
4. **Index fingerprint excludes the plan's own Change entry.** Otherwise
   re-applying a token after a partial failure fails the fingerprint check on
   the entry the failed run itself wrote — and re-applying is how an interrupted
   apply is meant to complete. A concurrent preparation of a different Change in
   the same scope still invalidates the plan.
5. **Target-line writes take ONE scope lock per (Store, line)**, keyed with
   `projectId: '*'` (not a legal projectId). A Store-ref edit and a per-project
   code-ref edit write the same file, so they must serialize; two different
   lines still take different locks, which is the concurrency property that
   matters.
6. **`--existing-change` was added to `rasen workspace plan`.** Task 11.1's flag
   list does not include it, but `intent: 'existing-change'` (design decision 5)
   is otherwise unreachable from the CLI.
7. **`workspace *` is exempted from STORE_SELECTION_GUIDANCE.** Naming it there
   would re-baseline all 42 pinned skill-template digests
   (`test/core/templates/skill-templates-parity.test.ts`) for agent-facing copy
   that is about threading selectors through spec/Change commands. The exemption
   is written into the registry test with that reason.
8. **Preparation prints no commit suggestion.** It writes nothing Git-tracked —
   the marker and association are `.rasen/` run state and the index is machine
   local — so `suggestedCommits` is deliberately empty, with a comment saying so.
   Target-line writes DO print one.
9. **No `repo_...` identity is minted anywhere** (decision 3). `projectId` is the
   portable execution-repository fact; canonical repository identity is recorded
   for drift detection only.

## 8. Pre-existing issues found, not fixed

- `src/locales/ja.json` carries 3 U+FFFD replacement characters
  (`knowledge.degradedRepair`) and `src/locales/zh-cn.json` carries 4
  (`config.invalidTools`, `config.invalidToolsEntries`). Both counts are
  identical at `HEAD`, so they predate this change. They are real corruption in
  user-facing copy and want a separate fix.

---

# Implementer 2

Status: **complete.** 97 of 98 tasks are ticked. The one that is not is 1.2, and
§6 below says why it was dropped rather than faked. The blocking conflict from
§1 is resolved, and `legacy-groups-removed.test.ts` passes with both of its
cases untouched, which is the confirmation the rename is complete.

## 1. The CLI surface is now `rasen store workspace`

The LEAD ruled option (a): rename the Commander group only. The Module, the
identities (`WorkspacePairId`), the planning-seam names, and every internal
vocabulary word stay `workspace`; only the command group moves, from top-level
`workspace` to a subcommand of `store`.

The reasoning, recorded so it is not re-litigated:

- `workspace` is a **retired** top-level name — the legacy editor-view group
  replaced by `workset` — and `test/commands/legacy-groups-removed.test.ts`
  exists to keep it dead. Re-issuing a retired name for a different concept
  gives anyone with muscle memory or an old doc something semantically
  unrelated, and rewriting the retirement pin to accommodate new code is the
  anti-pattern this portfolio has already paid for.
- The top level already carries `work`, `workset`, and `workflow`. A fourth
  `work*` group is bad for discoverability and completion regardless.
- A workspace pair is inherently Store content: a standalone project has no
  planning/execution pair. It belongs beside `store adopt`, `store eject`, and
  `store migrate-layout`.

**Files touched, and what was beyond the predicted list.** The prediction in
§1 named six files. Four more were needed, all for the same reason — the group
name appears in user-facing copy, not only in registration:

| File | Change | Predicted? |
| --- | --- | --- |
| `src/commands/workspace.ts` | `registerWorkspaceCommand(store)` builds `store.command('workspace')`; three `Ready to apply` / `Safe to remove` / fix strings re-pointed | yes |
| `src/cli/index.ts` | registration removed | yes |
| `src/commands/store.ts` | registration added after `registerStoreTargetLineCommand` | yes (as "registration") |
| `src/core/completions/command-registry.ts` | entry moved under `store.subcommands`, after `target-line` | yes |
| `src/locales/{en,ja,zh-cn}.json` | subtree moved from `cli.root.commands.workspace` to `cli.root.commands.store.commands.workspace`; the `apply-plan` description re-pointed in all three languages | yes |
| `test/core/completions/command-registry.test.ts` | store subcommand ledger gains `workspace`; three lifecycle strings and three exemption strings become `store workspace *` | yes |
| `test/commands/store-v2-workspace-journey.test.ts` | 9 argv sites | yes |
| `src/core/store/workspace/module.ts` | 6 refusal fix hints | **no** |
| `src/core/store/workspace/binding.ts` | 4 refusal fix hints | **no** |
| `src/core/store/workspace/apply.ts` | 1 refusal fix hint | **no** |
| `src/core/store-planning/internal/resolver.ts` | the `planning_worktree_required` repair hint, which prints a full ready-to-run command line | **no** |

Nothing else moved. No skill template mentions the group, so
`skill-templates-parity.test.ts` was not re-baselined and its 42 pinned digests
are untouched. `src/core/config.ts`'s "the rasen workspace" comment is about the
config directory and was deliberately left alone.

The three change artifacts were updated to match: `tasks.md` 11.1, `proposal.md`
(two bullets), and `design.md` (the Risks bullet that previously argued AGAINST
renaming, plus two references). The design's risk entry now records the split
between "the concept keeps its name" and "the command group moves", so a
reviewer reading only `design.md` sees the resolved decision rather than the
superseded argument.

`legacy-groups-removed.test.ts` was not edited.

## 2. Test coverage added

Twelve new files and four extended ones. Every one of them was run to green and
the load-bearing ones were mutation-checked (§4).

| Task | File | Cases |
| --- | --- | --- |
| 12.5 | `test/core/store/workspace-windows-paths.test.ts` (new) | 23 |
| 2.5, 2.8 | `test/core/store/target-lines.test.ts` (new) | 23 |
| 3.3, 3.9 | `test/core/store/workspace-identity.test.ts` (new) | 6 |
| 3.4-3.8, 3.10 | `test/core/store/workspace-binding.test.ts` (new) | 15 |
| 4.9 | `test/core/store/workspace-plan.test.ts` (new) | 19 |
| 5.8 | `test/core/store/workspace-locks.test.ts` (new) | 11 |
| 6.9 | `test/core/store/workspace-apply.test.ts` (new) | 13 |
| 7.5, 7.7 | `test/core/store/workspace-pairing.test.ts` (new) | 11 |
| 10.8, 10.10 | `test/core/store/workspace-cleanup.test.ts` (new) | 13 |
| 11.7 | `test/commands/workspace-cli.test.ts` (new) | 12 |
| 11.7 | `test/commands/store-target-line-cli.test.ts` (new) | 8 |
| 9.1-9.6 | `test/commands/context-workspace.test.ts` (new) | 6 |
| 12.2, 12.3 | `test/commands/store-v2-workspace-concurrency.test.ts` (new) | 3 |
| — | `test/helpers/store-workspace-fixture.ts` (new) | shared real-Git fixture |
| 8.1-8.3, 8.6, 8.7 | `test/core/session-runtime-context.test.ts` (extended) | +6 |
| 8.4, 8.5, 12.4 | `test/core/store-planning/store-planning.test.ts` (extended) | +6 |

The shared fixture builds one layout-v2 Store repository, one code repository
per project, both registries, and a `StoreWorkspace` / `StoreTargetLinesModule`
on a deterministic clock and entropy source. Real Git throughout: an in-memory
Git would prove none of what this change is about. It exposes every path it
builds, so a suite asserts destinations against the fixture's own roots rather
than against the code under test.

Two deliberate placements differ from the task text:

1. **9.6 lives in `test/commands/context-workspace.test.ts`, not inside
   `context.test.ts`.** That file's fixture is a legacy-flat Store built by
   `createOpenSpecRoot` and registered without layout v2; a workspace pair
   exists only in layout v2 with a real Git repository on both sides, so the
   block would have needed its own `beforeEach` shadowing the outer one. The new
   file's header says where it came from and why.
2. **The `bound` binding state in the CONTEXT projection is covered by
   `store-v2-workspace-journey.test.ts`** (which creates the Change through the
   real CLI and then asserts `rasen context` in both forms), not by
   `context-workspace.test.ts`, which covers `unbound`, `prepared`, and
   `drifted`. All four states of `describe` are covered in
   `workspace-pairing.test.ts`.

## 3. Two production changes

Both were found by exercising the real CLI, which is the same way the four
defects in §3 above were found.

1. **`plan --json` dropped the verified Change instance.** Under
   `intent: 'existing-change'` the plan carries `changeInstanceId` — the
   identity it VERIFIED rather than one it will mint — and `planPayload`
   enumerated fields without it, so an agent could not see which Change it was
   about to bind. Added to `planPayload` and to `renderPlan`, so human/JSON
   parity still holds, and asserted in both directions (present under
   `--existing-change`, absent under the default intent).
2. **`defaultWorktreeDestination` is now exported from `plan.ts`.** It is the
   naming rule the CLI documents ("defaults beside the store checkout") and the
   only part of the flavor-sensitive destination logic that had no reachable
   unit surface. No behavior changed.

## 4. Mutation verification

Rule 2 says a new test must discriminate. Five production lines were reverted
one at a time against `workspace-windows-paths.test.ts`, each confirmed to fail
the suite, and each restored:

| Mutation | Failures |
| --- | --- |
| `comparablePath` drops the explicit `win32` arm of the case rule | 4 |
| `isContainedIn` stops rejecting a `..` escape | 5 |
| `defaultWorktreeDestination` writes inside the repository instead of beside it | 4 |
| `isLinkedWorktree` compares the raw spelling instead of the canonical one | 2 |
| `deriveWorktreeIdentity` degrades to the literal path instead of failing closed | 3 |

Two earlier mutation attempts were discarded because they did not compile, which
means `pnpm run build` would have failed before any test ran and the mutation
would have proven nothing. The five above all compile.

Beyond the harness, several cases are discriminating by construction: the
concurrency case holds one line's scope lock with a live owner and requires the
other line to complete anyway, and the apply suite injects a failure at each
action and asserts the exact resumable phase that remains.

## 5. Gate results

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm run lint` | clean |
| `pnpm run build` | clean |
| `rasen validate store-planning-worktree-bindings --strict` | `Change 'store-planning-worktree-bindings' is valid` |
| `git diff --check` | clean |
| Encoding audit, 33 files (strict UTF-8, BOM, NUL, U+FFFD, CRLF, trailing newline, trailing whitespace, tabs) | clean for everything this change wrote |
| `test/core/store/**`, `test/core/store-planning/**`, `test/core/session-runtime-context*`, `test/core/completions/**`, `test/core/management-api/**` | 106 files, 1686 passed, 16 skipped, **0 failed** |
| `test/commands/**`, `test/cli-program.test.ts`, `test/locales/catalog.test.ts`, `test/core/templates/**` | 75 files, 1189 passed, 1 skipped, **5 failed** |

The 5 command failures are exactly the environmental ones the LEAD pre-declared
and that §4 above already attributed: `config-editor.test.ts` x4 and
`config.test.ts` x1, all "outside a Rasen project" cases that fail because
`%LOCALAPPDATA%\rasen` sits above `os.tmpdir()` on this host. **Zero failures
belong to this change.** The two that §1 left red are green.

The full suite was not run; the LEAD runs it.

The U+FFFD counts in `ja.json` and `zh-cn.json` were compared key-path by
key-path against `HEAD` after the locale subtree was moved: identical before and
after (`ja` 3 in `knowledge.degradedRepair`, `zh-cn` 2+2 in
`config.diagnostics.invalidTools*`). §8's pre-existing finding stands and this
change neither added nor moved one.

## 6. Task 1.2, satisfied retrospectively

**Superseded — see §9.** This section is left as written because it records the
reasoning that led to the retrospective form, but 1.2 is now ticked and
`test/core/store/workspace-baseline.test.ts` exists.

The original conclusion was: 1.2 asks for a baseline suite capturing the
marker-only planning-worktree acceptance before anything moved, that behavior
had already been replaced in 6.7, and the only two ways to satisfy the task
literally were to reconstruct the old resolver from git history or to write a
suite that asserts the NEW behavior and call it a baseline — the second being
the thing rule 1 exists to prevent.

The LEAD supplied the third way, which child 3 had already used for its own 1.2:
make the suite RETROSPECTIVE. §9 records what that produced.

## 7. Judgment calls and findings for review

1. **A FRESH reuse adopts the ref the worktree is already on.** Pointing
   `--planning-worktree` at an existing worktree that is on an unrelated branch
   does not refuse; the plan records that branch as the pair's ref. This matches
   the spec scenario, which is written about "the RECORDED planning worktree",
   and matches `plan.ts`'s stated reasoning (there is nothing yet to disagree
   with, and preparation never moves a HEAD). It is visible: the precondition
   table the user reads before applying prints which ref was adopted. Both
   halves are pinned —
   `adopts the ref a freshly reused worktree is already on, because nothing is
   recorded yet` and
   `refuses to reuse a RECORDED worktree that has moved to another ref`. Worth a
   reviewer's eye because the two read as contradictory until you notice which
   one has a recorded pair.
2. **`resolveLocator`'s ambiguity branch is unreachable through the production
   Git adapter.** `nodeWorkspaceGit.resolveRef` filters `for-each-ref` output to
   an exact `refname` match, so a locator can never resolve to two targets in
   production. That is defense in depth rather than dead code — the Module is
   written against a substitutable adapter — so it is covered two ways: one case
   substitutes an adapter that returns two targets and asserts the refusal lists
   both, and one case pins the production filter itself by creating
   `refs/heads/dup/one` and `refs/heads/dup/two` and proving the locator
   `refs/heads/dup` resolves to NOTHING rather than to the refs beneath it.
   That second case is the sharper half of task 2.5.
3. **On Windows, `store.checkoutRoot` echoes Git's forward-slash spelling.**
   `resolveStoreCheckout` returns the root as `git worktree list --porcelain`
   printed it, so a commit suggestion reads `git -C C:/Users/.../store-integration
   add -- ...`. Harmless — `git -C` accepts it, and every computed DESTINATION
   goes through the layout contract and is native — but a test comparing a
   suggestion against a native path must normalize. Not fixed; noted.
4. **The fixture's Git and the Module's Git see different line endings inside a
   worktree Git itself created.** The test helper runs Git with an empty global
   config (`isolatedGitEnv`); the Module's adapter inherits the host's, where
   `core.autocrlf` is set. In the MAIN checkouts both agree, because the fixture
   wrote and committed those files itself. In a worktree created by
   `git worktree add` through the adapter, the checkout is normalized one way
   and the test's `git status` reads it the other, so every tracked file looks
   modified. Production never mixes the two. Dirtiness inside a created worktree
   is therefore asserted through `dependencies.git.dirtyEntries`, which is the
   view every precondition actually uses, with a comment saying why.
5. **`tsc --noEmit` does not cover `test/`.** `tsconfig.json` excludes it, so a
   test that omits a required field of a production input type compiles under
   vitest's esbuild and fails at runtime with an unhelpful message. It happened
   once here (`completeChangeBinding` without `changeInstanceId`). ESLint is the
   only type-aware gate over `test/`. Flagged for the LEAD; out of scope to
   change here.

## 8. Notes for the shipper

- `test/helpers/store-workspace-fixture.ts` is new and shared by nine suites.
  It is not exercised by anything outside this change.
- No skill template, no `STORE_SELECTION_GUIDANCE` entry, and no pinned digest
  changed, so `skill-templates-parity.test.ts` needs nothing.
- `.rasen/**` under any fixture is run state and is never committed; the fixture
  builds all of it under `os.tmpdir()`.

## 9. Task 1.2 — the retrospective baseline

`test/core/store/workspace-baseline.test.ts`, 7 cases. Its header states in as
many words that it is retrospective and why, so nobody later reads it as a
before-snapshot it is not.

The task named three things. Two were adaptable and one was not:

1. **"the marker-only planning-worktree acceptance" — PRESERVED, asserted.**
   Two cases build a planning worktree the way an operator had to before this
   change existed — `git worktree add` plus a hand-written marker, no plan, no
   token, no index entry, no execution association — and drive `rasen new change`
   through the real CLI from inside it. The first asserts the mutation is
   authorized and that no plan was ever produced (`plans/` does not exist), which
   is the load-bearing claim: this change's machinery is AVAILABLE, not REQUIRED.
   The second asserts the pair is indexed on first use from what was already true
   on disk — the literal planning root, the literal ref, an empty execution side,
   and no pair identity, because nothing on disk said otherwise.
2. **"the `planning_worktree_required` refusal from an integration checkout" —
   PRESERVED, asserted** by code name, with the integration checkout
   byte-identical afterwards and no project partition created.
3. **"the absence of any target-line writer" — ENDED BY THIS CHANGE, so it is
   NOT asserted.** Asserting it would assert something now false. Two cases
   assert the current truth instead: `StoreTargetLines.add` writes exactly one
   catalog at the layout-contract path and stages nothing, and a source-level
   scan pins the writer SET at exactly two — `src/core/store/target-lines.ts`
   (this change, 2 call sites: `add` and `setRef`) and
   `src/core/store/layout-migration/plan.ts` (child 3's migration, 1 call site,
   which was the only writer before this change). Verified by hand first:
   `migration-ops-v2.ts` and `planning-layout-v2.ts` mention the catalog kind but
   only READ or compute a path. The scan keys on the Foundation serializer, which
   is the funnel every catalog write goes through; a hand-rolled YAML writer
   would evade it, and the test says so rather than overclaiming.

**Two cases were added that the task did not ask for**, because a suite that
asserted only "nothing changed" would be misleading about a change whose
proposal carries an explicit "Behavior tightening" bullet. They state the
narrowing directly: a marker that declares no project or line is refused, and a
marker whose target line names no commit is refused. Both leave the planning
worktree without a Change directory.

**A correction to my own first draft.** I expected the "marker declares nothing"
case to refuse with `workspace_marker_conflict` and it refuses with
`planning_worktree_required`. The production behavior is right and the
expectation was wrong: a marker that declares NOTHING contributes no evidence,
so the worktree is simply not verified for the resolved scope;
`workspace_marker_conflict` is reserved for a marker that declares something
CONTRADICTORY, which `workspace-binding.test.ts` and `workspace-pairing.test.ts`
cover. The assertion was corrected to the true code and the distinction is
written into the case, not silently accepted.

**Discrimination.** A sixth mutation was run against this suite:
`verifyPlanningWorktree` was made to append an unconditional
`planning_requires_prepared_pair` finding — precisely "the binding machinery
narrowed the path child 2 established". Exactly the two acceptance cases failed;
the three refusal cases and the two writer cases still passed. That profile is
the point: this suite's job is to fail if, and only if, the preserved path stops
being preserved.

### Gates after 1.2

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm run lint` | clean |
| `pnpm run build` | clean |
| `rasen validate store-planning-worktree-bindings --strict` | valid |
| `git diff --check` | clean |
| Encoding audit (34 files, now including the baseline suite) | clean |
| `test/core/store/**` + `test/core/store-planning/**` | 0 failed |
| `test/commands/**` | 5 failed, all the pre-declared environmental ones |

**98 of 98 tasks are ticked.**

## 10. Full-suite fallout, and the surfaces my focused suites could not see

The LEAD's full-suite run found four items my focused suites were structurally
incapable of finding: three of them are repository-wide gates that no per-feature
suite selects, and the fourth is a fixture in a capability I do not own. All four
are resolved. None was a defect in this change's production code.

### 10.1 `vocabulary-sweep.test.ts` — 31 codes recorded in the ledger

The sweep holds an allow-list of `(workspace|initiative)_[a-z_]+` tokens
appearing anywhere in `src/`, previously exactly two. This change's 31 new
`workspace_*` codes tripped it. Per the LEAD's ruling this follows from the
decision that internal vocabulary stays `workspace`, so it is resolved by
recording the decision, not by relaxing the gate.

All 31 are enumerated INDIVIDUALLY — no `workspace_` prefix rule, no directory
exemption — so a 32nd unexpected token still fails. They are grouped with
sub-comments by what they are: the 9 members of the closed refusal taxonomy that
match the pattern (the other 4 are `planning_*` / `target_line_*` and do not), 9
operational codes, 9 verification findings, and 4 consumer-adapter fallbacks. A
comment block above them states that a WORKSPACE here is the bound worktree
PAIR, that it is a different concept from the retired editor-view command group,
and that the retired GROUP stays dead and is pinned by
`legacy-groups-removed.test.ts`.

Enumerated set, for review:

```
workspace_already_bound          workspace_binding_ambiguous      workspace_cleanup_unsafe
workspace_destination_exists     workspace_dirty_tree             workspace_lock_unavailable
workspace_marker_conflict        workspace_plan_stale             workspace_ref_mismatch
workspace_git_failed             workspace_identity_unavailable   workspace_layout_version_unsupported
workspace_plan_missing           workspace_plan_not_applicable    workspace_project_unresolved
workspace_repository_unavailable workspace_store_unresolved       workspace_target_line_unknown
workspace_execution_side_unknown workspace_not_prepared           workspace_planning_identity_unavailable
workspace_ref_drift              workspace_repository_identity_drift
workspace_unresolved             workspace_worktree_absent        workspace_worktree_identity_drift
workspace_worktree_not_a_repository
workspace_apply_failed           workspace_cleanup_failed         workspace_plan_failed
workspace_show_failed
```

### 10.2 `session-context-precedence.test.ts` — stale fixture, and a sweep

The fixture wrote a literal `version: 1` runtime context, which this change's
version raise now correctly reports as unsupported. The code is right; the
fixture was stale. It now uses `RUNTIME_CONTEXT_VERSION`, so it tracks the
version instead of pinning one, and the suite keeps asserting its actual
subject — that the environment-pointed session context beats the working
directory. It was NOT weakened into asserting the version error.

Applying the LEAD's lesson, I then swept `test/` for every other literal that
pins the context version rather than relying on the run. **Three more fixtures
carry the same stale literal and pass only because they hand the object straight
to a function instead of parsing a file** — latent, not failing, and guaranteed
to lie after the next raise:

- `test/core/session-runtime-context-e2e.test.ts` (the twin-checkout case)
- `test/core/management-api/session-context-handover.test.ts` (crashed-session leftover)
- `test/core/pipeline-registry/execution-binding.test.ts` (two fixtures)

All three now use the constant. The edits are EOL-preserving — those files sit
CRLF in the working tree — so the diffs are 5, 5, and 11 lines rather than
whole-file churn. Every other `version: 1` in `test/` belongs to a different
schema (Store metadata, project catalog, target-line catalog, planning marker,
learned-skill ledger) and was left alone.

**Answer to the LEAD's direct question: yes, it is already recorded as
BREAKING**, as a first-class bullet in `proposal.md` naming the recovery:

> **BREAKING (session context):** the session context file version is raised
> from 1 to 2 … A session started by an earlier build and still running when the
> binary is upgraded will report its context as an unsupported version … The
> repair is to restart the session; the file is machine-local and is removed
> when the session ends, so nothing durable is affected.

No proposal edit was needed.

### 10.3 `capstone-journeys.test.ts` journey 3 — a half pair the tightening now refuses

Verdict: **legitimate consequence, fixture completed.** Not a refusal assertion —
the journey still runs the whole lifecycle from the pointer repo with zero
selectors.

The fixture built a linked planning worktree and wrote an execution association
in the code repo naming it, but never wrote the planning worktree's own marker.
The old gate was satisfied by `association?.planningRoot || marker?.planningRoot`
— either side alone — which is precisely the hole `design.md`'s Context section
names: "an execution checkout with a stale association and a planning worktree
with a stale marker are indistinguishable from a bound pair." The capability now
requires the planning side to declare itself, and the proposal records it as a
deliberate behavior tightening under which "a healthy hand-assembled pair keeps
working".

So the fixture was describing a healthy hand-assembled pair while actually
assembling half of one. It now writes both carriers. The comment cites the
capability requirement and the proposal bullet, and says in as many words that
the fixture previously got away with half a pair.

### 10.4 `store-lifecycle.test.ts` — the machine-root family

Verdict: **legitimate consequence, allow-list extended.** A different cause from
10.3 entirely: the case enumerates what may exist under the global data
directory, and `planning-workspaces/` — the one machine-root family this change
adds, declared in the proposal's Impact section — was not in the list.

Following the same precision principle as 10.1, it is added as a NAMED family
rather than by widening the pattern, and a second assertion confines its contents
to the three documented kinds (`index`, `plans`, `locks`), so an unexpected
fourth family or an unexpected subdirectory still fails. The checkout half of the
case — which is what proves neither Git repository stores a plan, a token, a
lock, or an index entry — is untouched and still passes.

### 10.5 Sweep for anything else pinning what I touched

Rather than trust the run, I enumerated the pinning surfaces directly:

- Tests pinning the retired `workspace` GROUP: `legacy-groups-removed.test.ts`
  (untouched, passes), `vocabulary-sweep.test.ts` (10.1),
  `store-lifecycle.test.ts`'s `/initiative|workspace/i` checkout assertion
  (passes — this change writes nothing named `workspace` into a checkout; the
  marker is `.rasen/planning-line.json`). Three further files match on the word
  alone and are unrelated: a temp directory named `workspace`
  (`artifact-graph/outputs.test.ts`), the legacy `.rasen-workspace/view.yaml`
  editor state (`root-selection.test.ts`), and a synthetic completion fixture
  (`zsh-generator.test.ts`).
- Tests enumerating machine data-dir families: exactly one,
  `store-lifecycle.test.ts` (10.4).
- Tests pinning the runtime-context version: the four in 10.2.

### 10.6 Gates after the fallout round

Only test files changed in this round; no production code was touched.

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm run lint` | clean |
| `git diff --check` | clean |
| Encoding audit, 7 edited tracked files (UTF-8, BOM, NUL, U+FFFD, MIXED endings, trailing newline, trailing whitespace, tabs) | clean; CRLF is not a finding for these — they sit CRLF under `core.autocrlf` and the edits were EOL-preserving, so the check applied was that no file became MIXED |
| `test/vocabulary-sweep.test.ts`, `test/core/learned-skills/**`, `test/core/session-runtime-context*`, `test/core/management-api/**`, `test/core/pipeline-registry/**`, `test/cli-e2e/**` | 69 files, **1157 passed, 1 skipped, 0 failed** |

### 10.7 The pattern, acknowledged

The LEAD is right, and the correction is worth writing down rather than
absorbing. I verified the rename against `legacy-groups-removed.test.ts` because
that was the stated proof, and stopped there. `vocabulary-sweep.test.ts` pins the
same retirement at a different granularity — token, not command — and I never
looked for it. The rule that would have caught it, and that 10.5 now applies:
**when you touch a retirement, a guard, or a refusal, grep the TOKEN across
`test/`, not the file you expect to hold it.** One surface is never proof for a
repository-wide invariant.
