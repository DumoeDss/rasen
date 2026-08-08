# Handoff — store-planning-worktree-bindings, implementer-1

## Position

Production code for all twelve task sections is written, typechecks, lints,
builds, and is exercised end-to-end by two real-CLI journeys. What remains is
almost entirely **test coverage**: ten named unit suites and three
cross-platform/concurrency cases. Read
`evidence/implementation-report.md` first — it carries the gate results, the
four defects the journey found, and every judgment call. This file carries only
what a successor needs to keep going.

## Decide this before writing code

**`rasen workspace` collides with a retired command group.** Two cases in
`test/commands/legacy-groups-removed.test.ts` fail because of it. Report §1 has
the two resolutions and the exact file list for a rename. Do not start the
remaining test suites until this is decided: if the group is renamed, the CLI
suite (11.7) and the journey's argv change with it.

## Working set

Production (all new unless noted):

```
src/core/store/target-lines.ts
src/core/store/workspace/{types,diagnostics,dependencies,identity,locks,
                          registry,binding,scope,plan,apply,cleanup,module,index}.ts
src/commands/workspace.ts
src/commands/store-target-line.ts
src/core/store-planning/internal/{dependencies,resolver}.ts   (modified)
src/core/store-planning/diagnostics.ts                        (modified)
src/core/session-runtime-context.ts                           (modified)
src/core/management-api/supervisor.ts                         (modified)
src/commands/context.ts, src/core/working-set.ts              (modified)
src/commands/workflow/shared.ts                               (modified)
src/core/completions/command-registry.ts, src/locales/*.json  (modified)
```

Tests:

```
test/core/store/workspace-git-verb-guard.test.ts        (new)
test/commands/store-v2-workspace-journey.test.ts        (new, 2 cases)
test/commands/store-v2-planning-scope-journey.test.ts   (fixture + 1 assertion)
test/core/store-planning/store-planning.test.ts         (fixture only)
test/core/session-runtime-context.test.ts               (fixture only)
test/commands/pipeline-store-root-selection.test.ts     (1 case, spec change)
test/core/completions/command-registry.test.ts          (ledgers + 1 exemption)
```

## Remaining work, in the order I would do it

1. **12.5 `workspace-windows-paths.test.ts`** — highest risk. `identity.ts`
   (`comparablePath`, `isContainedIn`, `samePath`) and `plan.ts`
   (`defaultWorktreeDestination`, containment preconditions) all take a
   `StorePlanningPathFlavor` and are only exercised on this host's native
   flavor. Cover `path.win32` and `path.posix` explicitly, mixed-case drive
   letters, short-name and junction aliases, separator forms, a UTF-8 Chinese
   worktree name, and a long path.
2. **The ten unit suites** (2.8, 3.10, 4.9, 5.8, 6.9, 7.7, 8.7, 9.6, 10.10,
   11.7). They can share one real-Git fixture builder; copy the `beforeEach`
   shape from `test/commands/store-v2-workspace-journey.test.ts`, which already
   builds a layout-v2 Store, two code repositories, and both registries.
   `withDeterministicWorkspaceIdentity` gives a fixed clock and seeded entropy.
3. **12.2 two concurrent lines** — two `runCLI` invocations in flight on
   different target lines of one Store. The scope lock key is
   `(storeUid, projectId, targetLineId)`, so they must not serialize; assert
   both complete and neither observes the other's planning content.
4. **12.3 branch rename** — rename the planning branch with plain Git, then
   prove the Change instance still resolves through metadata and the index, and
   that nothing parses the branch name.
5. **1.2 baseline suite** — the marker-only acceptance it was meant to capture
   is already gone. Either reconstruct it from git history or drop the task
   with a note; do not write a suite that asserts the new behavior and call it
   a baseline.

## Things that will bite you

- **`runCLI` uses `dist/`.** Run `npm run build` after every production edit or
  you will debug the previous build. Vitest prints "dist/ matches the current
  sources; skipping build" when it is current.
- **Five failures on this host are environmental** and never yours:
  `config.test.ts` ×1 and `config-editor.test.ts` ×4.
- **The working tree also holds child 3's unshipped work.** `git status` shows
  files neither of us wrote in this change (`src/core/archive.ts`,
  `src/core/store/migration-ops.ts`, several `test/commands/store*.test.ts`,
  `test/core/templates/skill-templates-parity.test.ts`). Do not revert or
  attribute them.
- **Locale/registry/Commander parity is strict.** `applyCliPresentation`
  compares option counts, names, and value arity against the registry, and
  every flag needs an English description. Adding one flag means touching
  `command-registry.ts` and all three locale trees. The three locale files
  round-trip byte-identically through
  `json.dumps(data, ensure_ascii=False, indent=2) + '\n'`, so a Python patch
  script produces an additive-only diff.
- **The planning path source guard** (`test/core/store-planning/planning-path-source-guard.test.ts`)
  counts hand-joined `rasen/{projects,changes,specs,design-docs}` paths per
  file. Derive collection paths from the Foundation contract instead — see the
  `api.dirname(resolveStorePlanningLayoutV2Path(...))` pattern in
  `target-lines.ts` and `scope.ts`.
- **`StorePlanningDependencies` now has three more required members.** Any new
  fixture that builds it directly must supply them; the healthy default lives
  in `store-planning.test.ts` as `healthyPlanningProbe()`.
- Write patch scripts to the scratchpad and run them by path. Inline heredocs
  mangled `\n` inside string literals twice.

## Dead ends

- **Putting `createdAt` in the plan digest.** It makes every re-plan a different
  plan, which breaks both the determinism scenario and the "re-plan to check
  nothing moved" workflow. It is now recorded beside the id.
- **Passing a full ref to `git worktree add -b`.** Creates
  `refs/heads/refs/heads/...`. The adapter converts and refuses a non-branch.
- **Counting the Module's own `.rasen/` documents as untracked work.** It makes
  every pair this Module prepares permanently un-removable.
- **Adding `rasen workspace` to `STORE_SELECTION_GUIDANCE`.** It re-baselines
  all 42 pinned skill-template digests for copy that is not about specs or
  Changes. Exempted in the registry test instead, with the reason written down.
