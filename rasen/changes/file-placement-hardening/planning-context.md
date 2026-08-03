# Planning context — file-placement-hardening

## User intent

> 审查一下pr#121 docs\zh\file-placement-and-planning-roots.md是我们的设计
>
> 去一个worktree检查
>
> 你先把审查结果保存文档，然后分析下如何处理接下来
>
> $rasen-auto auto-decompose 开始做吧

The remediation must preserve the approved planning-root / execution-root /
machine-root model in `docs/zh/file-placement-and-planning-roots.md`, repair PR
#121 against `dev/0.1.6`, and remain on the PR's delivery line rather than
turning required design behavior into post-merge follow-up work.

## Fixed review boundary

- Base: `dev/0.1.6` at `ace53693331998ff67050967b63fb710a0f11245`
- Reviewed head: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`
- Review report:
  `docs/audits/pr-121-file-placement-0.1.6-review-2026-07-31.md`
- Remediation branch: `fix/pr121-file-placement-hardening`

## Durable findings

1. All archive entry points must use one archive engine. The generated single,
   bulk, and in-ship workflows currently bypass cleaner/accounting by moving the
   Change directly.
2. Destructive behavior needs pure plan/apply separation. Cleaner and migration
   previews must fully describe what apply will do.
3. Known run-state is deletable only after schema validation. Malformed,
   future-version, nested, unknown, and source-tree entries remain preserved;
   source-tree discovery aborts all cleaning.
4. Migration conflicts must be no-clobber under concurrency, not just after a
   preflight existence check.
5. Store routing must carry an explicit planning root and execution root through
   command, migrator, session registry, and management API boundaries.
6. Archive accounting must be recoverable and final: sidecar and I/O failures
   cannot fail open, and evidence covered by a hash cannot be mutated afterward.
7. The original landing child is archived with completed tasks; the archive
   child is archived with every task unchecked. Preserve that history and use
   this new Change family for remediation truth.

## Constraints

- Node.js `>=20.19.0`, TypeScript ESM, cross-platform Windows/macOS/Linux.
- Use explicit constants/lookups for generated artifacts.
- Do not reuse the dirty `dev/0.2.0` checkout or the older dirty
  file-placement worktree.
- Author and verifier must be different workers.
- Each child uses the decompose-free `small-feature` pipeline.
- Child delivery is local; portfolio delivery happens once after every child is
  review-clean.

## Decomposition rationale

The work has five coherent slices. Migration safety is foundational because it
owns the cleaner and filesystem mutation semantics. Once it is review-clean,
Archive convergence and Store root routing touch disjoint implementation
surfaces and may proceed in parallel. The stronger closure P4 gate also
discovered an implementation-independent Windows legacy-lock contention defect,
which received its own bounded child correction. Closure acceptance depends on
all four implementation children and owns only documentation, schema
reconciliation, and the final complete verification gate.

## Cross-child interface decisions

- Migration safety owns the immutable core plan/apply seam. Root routing may
  supply explicit planning/execution roots through that seam, but must not
  reclassify actions after interactive confirmation.
- Archive engine consumes the cleaner's complete plan and typed blockers. A
  source-tree signal or non-`ENOENT` inspection failure blocks all cleaner
  deletion for that change; archive must surface that result rather than
  treating it as an empty ephemera directory.
- Archive engine owns the finalized evidence boundary for direct, single,
  bulk, and in-ship archive paths. Handoff disposition, the archive section of
  `ship-log.md`, and recursive quality capture must finish before evidence is
  hashed; no consumer may append an archive commit SHA afterward. Closure must
  preserve this non-self-referential contract when reconciling main specs and
  the authoritative design (the stable reverse link is the archive commit
  message plus Git history).
- Root routing freezes one `WorkMigrationRootContext` at the command boundary:
  `planningRoot`, `changesDir`, `executionRoot`, `legacyHomeOwnerRoot`, and the
  foundation `PathIdentityFlavor`. Store planning owns reports, handoff, and
  design docs; the selected member checkout/worktree owns active run-state,
  probes, sampling ephemera, and legacy-home lookup. Downstream planning and
  apply must not re-infer these values from cwd or Store membership.
- `rasen work migrate` must create one immutable `WorkMigrationPlan` per
  invocation. Interactive confirmation and `--json --yes` pass that exact plan
  to `applyWorkMigration`; report projection wraps the same plan before and
  after apply. Existing human/JSON fields and foundation scope, fingerprint,
  no-clobber, and fail-closed behavior remain compatible.
- Session filtering and planning `changeDir` stay under frozen
  `record.space.root`, while terminal lookup uses frozen
  `record.execution.root` for ephemera and legacy-home ownership. Missing,
  planning-only, or removed execution context reports an absent join and never
  substitutes the Store, daemon launch project, or another worktree.
- Windows legacy workflow/pipeline registry lock opens classify `EPERM`,
  `EACCES`, and `EBUSY` as transient only on Windows and only within the existing
  bounded deadline. Clearing contention reaches the existing semantic
  winner/`pipeline_already_exists` result; persistent contention retains the
  existing busy/timeout result; all other and non-Windows errors retain the
  existing create-failed diagnosis.
- `file-placement-hardening-closure` owns the dedicated Windows, macOS, and
  Linux archive fault/recovery CI definition and the focused local release
  evidence. Delivery owns the actual post-push remote execution record; the
  cross-platform gate remains pending until all three native legs succeed.

## Durable closure gates

- Reconcile the approved Chinese design and normative main `rasen/specs` from
  the four clean implementation-child delta sets in integration order. Merge overlapping
  requirements semantically once; do not duplicate child deltas or discard an
  earlier migration/archive guarantee when applying root-routing refinements,
  and include the independent Windows legacy-lock contract exactly once in
  `opsx-pipeline-registry`.
- Sweep generated workflows and skill templates, executable archive consumers,
  CLI help/completions/localization, schema instructions, and parity/golden
  tests for stale contracts. Preserve historical audit/review text and map
  every saved Blocker, Major, and Minor to its owner, clean review, focused
  proof, and any still-pending closure gate.
- Run explicit serial archive and migration/root/session focused suites with
  commands, exact file lists, elapsed time, counts, skips, and exit statuses.
- A repository-wide timeout without a Vitest summary is not a pass. Completion
  requires either a bounded clean monolithic run or deterministic bounded
  partitions whose union equals the discovered test manifest, whose pairwise
  intersections are empty, whose frozen files do not drift, and whose summaries,
  exits, and counts are all clean. Local process cleanliness is reported as
  `NOT EVALUATED` unless reliable spawn-time OS lineage evidence exists; no
  custom runner or bespoke/manual process termination is an acceptance tool.
- Add a required focused archive fault/recovery job on native Windows, macOS,
  and Linux at the Node.js floor. Path-flavor helper tests are supporting
  semantics only. Actual native acceptance necessarily waits for post-push CI
  URLs and results recorded by portfolio delivery.
- Before release, classify the final diff against the saved baseline, confirm
  `0.1.6`, Node.js `>=20.19.0`, existing CLI compatibility, additive flags/JSON
  fields, validation/build/typecheck/lint evidence, and no tracked `.rasen`
  ephemera. Closure apply does not commit, push, update a PR, or archive.

## Closure apply evidence snapshot — 2026-08-01

- The accepted local repository gate froze 341 test files and ran eight direct,
  sequential, one-worker Vitest partitions. Their union is exactly the frozen
  manifest, all pairwise intersections are empty, frozen size/SHA drift is
  zero, and all eight standard JSON reports pass.
- Final aggregate: 1,492/1,492 suites and
  `5,946 = 5,912 passed + 34 pending + 0 failed + 0 todo`. The earlier
  pre-freeze `6,050` aggregate is invalid/superseded because its mutable
  membership had 62 duplicated and 62 missing paths.
- Focused archive and migration/root/session groups, CI workflow contract,
  build, typecheck, lint, CLI/help compatibility, strict closure validation,
  and strict validation of all 208 main specs pass locally.
- Process cleanliness remains `NOT EVALUATED`. The three native recovery job
  URLs/results and all commit, push, PR-delivery, and archive actions remain
  pending portfolio delivery.
