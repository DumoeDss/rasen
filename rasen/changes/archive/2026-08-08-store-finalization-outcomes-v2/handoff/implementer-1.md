# Handoff — store-finalization-outcomes-v2, implementer-1

## Position

Sections 1–11 and task 12.1 are implemented and green. **The refusal is lifted
and a real Store v2 Change finalizes end to end through the real CLI** — see
`test/commands/store-v2-workspace-journey.test.ts`, which is the load-bearing
proof. 67 of 101 tasks are ticked. `evidence/implementation-report.md` is the
full account; this document is the working set.

Nothing is half-written. Every file that exists compiles, lints, and is
exercised by at least one passing suite. The gap is coverage and section 12's
remaining surfaces, not a partial mutation path.

## Remaining work, in the order I would take it

### 1. Section 12's three unbuilt surfaces (highest value)

Everything here is additive; none of it changes what already works.

- **12.4 / 12.5 — the argv consumers.**
  `src/core/archive-consumer-invocation.ts` builds the bulk/ship/single argv.
  `GeneratedArchiveConsumerArgvInput` needs `outcome?`, `reason?`, `by?`,
  `byTargetLine?`, `commit?`, threaded into `savedPreview` (planning) only —
  `apply` takes the token alone and must stay that way. The four workflow
  TEMPLATES already state the rule; this is the executable half.
  `test/core/archive-consumer-integration.test.ts` drives these arrays through
  the real Commander program and is where the new options get exercised.
- **12.6 — the management finalize endpoint.** Mirror
  `src/core/management-api/submit.ts` exactly: a new `finalize.ts` bridge that
  spawns `dist/cli/index.js` with
  `archive <change> --store … --project … --target-line … --outcome … --json --yes`,
  `shell: false`, argv array, cap-1 in flight. Router work:
  `MANAGEMENT_PATHS` cannot hold it (it has path parameters) — add a
  `matchStoreFinalizePath(pathname)` beside `matchSessionIdPath`, admit POST
  only, and add `finalize-change` to `WHITELIST` in `whitelist.ts` as a
  `bounded-cli` entry. The spec requires the COMPLETE scope in the path and
  refuses to complete any field from a filter or a session.
- **12.7 — the parity test.** Drive direct / bulk / in-ship / API with identical
  inputs and compare `finalizationPlanId`. `--dry-run --json` already emits the
  whole `ImmutableFinalizationPlan` under `archive.finalizationPlan`, and
  `finalizationPlanId` is exported from
  `src/core/store/finalization/index.js`, so the comparison is available now.
- **12.8** — `test/commands/archive-outcome-cli.test.ts`: flag parsing, the
  missing-outcome refusal, JSON/human parity, dry-run zero writes, stored-plan
  round trip.

### 2. The named unit suites (3.8, 4.8, 5.7, 6.8, 7.7, 8.8, 9.8, 10.7)

All eight modules are pure or adapter-injected, so these are cheap:

- `outcome.ts` — every refusal is reachable with NO fixture at all. Start here.
- `reachability.ts`, `successor.ts` — take a `FinalizationDependencies` whose
  `git` is a hand-written object. There is no in-memory Git implementation yet;
  write one for these two (they use only `resolveCommit`, `resolveRef`,
  `isAncestor`, `showBlob`, `showTree`).
- `spec-actions.ts`, `record.ts` — pure functions over `PreparedArchiveSpecAction`
  and the scope facts.
- `archive-engine-finalization-seams.test.ts` (8.8) — the destination override,
  both accounting writers, the new journal phase, the resume table, and the
  suffix-aware name matching. `archiveDatePrefixedNameMatches` and
  `parseArchivedRef` are pure and worth pinning first.

### 3. Section 13's integration work

13.1's dedicated journey is where the four-outcome matrix belongs. **Use
`test/helpers/store-workspace-fixture.ts`** (child 4's shared real-Git fixture)
rather than building one: it constructs a layout-v2 Store, a code repository per
project, both registries, and a bound pair. The workspace journey shows the
shape a finalization assertion takes against it.

13.2 (Windows/POSIX destinations) is pure — `archiveEntryAddress` takes a
`flavor`, so both flavors are one loop.

## Decisions and why

1. **The record draft omits `evidence`/`missing`.** The transaction appends the
   `## Archive` section to the staged ship log, so plan-time digests would be
   wrong. The writer hashes the published tree. Do not "fix" this by hashing
   earlier — you will record a digest the entry does not have.
2. **Identity is re-verified at write time from portable preimages.** Brands do
   not survive serialization. `ArchiveV2IdentityPreimages` carries the planning
   scope id, the instance seed, and both worktree instance ids; the writer
   re-derives. Do not cast.
3. **`planId` excludes the transaction instance fields** (random transaction id,
   engine plan hash, stage/journal paths). Otherwise "equal inputs produce an
   identical plan" is false for every re-plan — child 4's defect 1.
4. **The outcome request is decided FIRST**, before every other precondition,
   in `declaredOutcomeDiagnostic` (`src/core/archive.ts`). It is a pure function
   of the flags. Moving it later makes the spec's "before any access" scenario
   unreachable from a planning checkout.
5. **The engine's default association adapter throws** rather than no-opping,
   because the engine cannot import the finalization Module. If you add another
   `applyArchive` caller for a v2 plan, it must supply the Module's adapter.
6. **Target-line facts resolve locally**, not through `StoreTargetLines.resolve`
   — that looks the code repository up in the machine project registry, while
   the archive plan already names the verified execution root.

## Dead ends — do not repeat these

1. **Do not add the finalization to `store-lifecycle.test.ts` or
   `store-v2-planning-scope-journey.test.ts`.** Both assert the execution
   checkout is byte-identical afterwards, and a successful finalization writes
   the execution-side binding by design (§8.2). I tried; the invariant is the
   test's whole subject. The workspace journey has the right fixture and no such
   invariant.
2. **A hand-assembled pair cannot finalize.** If a fixture's execution root is
   not a Git work tree, no execution worktree identity derives, so no
   `WorkspacePairId` derives, so `workspace_pair_unavailable` fires. That is
   design §11 behaving as specified. Any new finalization fixture needs real Git
   on BOTH sides.
3. **`s.index()` for the END bound of a slice.** A patch script took the first
   occurrence of `currentPhase = 'source-removed';`, which sits ~800 lines
   ABOVE the intended region, and duplicated 23 KB of `archive-engine.ts`. Use
   `rindex`, or anchor on a string that occurs once. Verify with marker counts
   before writing.
4. **Bash heredocs are refused in this worktree session.** Write patch scripts
   to the scratchpad and run them by absolute path (PowerShell with an env var
   for the repo root works; so does `python <abs-path>` from `Bash`).

## Working set

Read in this order:

- `src/core/store/finalization/module.ts` — the whole flow is `plan()` then
  `applyStoredPlan()`; every other file in the directory is called from there.
- `src/core/archive-accounting-v2.ts` — the write half.
- `src/core/archive-engine.ts`: `ArchivePlanFinalization`,
  `resolveArchiveTransactionPaths`, the accounting phase (~line 4526), the
  association phase right after it.
- `src/core/archive.ts`: `declaredOutcomeDiagnostic`,
  `inapplicableFinalizationOptions`, `runStoreV2Finalization`.
- `test/commands/store-v2-workspace-journey.test.ts`, the "finalization is live"
  block — the only end-to-end assertion of a completed finalization.

Useful commands:

```
npx vitest run test/core/store test/core/store-planning test/core/completions
npx vitest run test/commands/store-v2-workspace-journey.test.ts
npx vitest run test/core/templates
npx tsc --noEmit && npx eslint src test
```

Five failures are environmental and not this change's: `config.test.ts` ×1 and
`config-editor.test.ts` ×4 (`%LOCALAPPDATA%\rasen` above `os.tmpdir()`).

## For the shipper

- Section 14's archive-ordering preconditions are untouched and still apply:
  `store-layout-v2-migration` must archive BEFORE this change, because this
  change's `store-planning-scope-routing` delta MODIFIES a requirement that
  child adds.
- Eight pinned template hashes were re-baselined in
  `test/core/templates/skill-templates-parity.test.ts`. The delta is proven —
  substituting the old gate paragraph back reproduces all eight old hashes. The
  proof script is disposable; the method is recorded in the report.
- `.rasen/**` is run state and is never committed.
