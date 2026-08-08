## Context

This is the portfolio's closing child. Its scope is not a feature — it is the union of what six siblings each wrote down as somebody else's. Four inputs define it, and each is a document in the tree rather than a judgement:

- `store-layout-v2-migration/evidence/caller-inventory.md:61` classifies `bootstrap.ts:1235` and `:2672` as `later-slice owner` and names this change.
- `store-planning-worktree-bindings/design.md:237` and `store-finalization-outcomes-v2/design.md:31` both defer "the doctor/CI consistency gates".
- `store-finalization-outcomes-v2/proposal.md:23` defers "the portfolio-wide read-caller sweep"; `design.md:101` defers "a diagnostic for child 7" for a v1 Archive record found in a v2 partition.
- `store-scoped-issues-management/proposal.md:55` defers read-caller migration, the literal-path and layout-consistency gates, documentation reconciliation, and the acceptance matrix — and states the constraint this child inherits: **no Store v2 mutator may be deferred into it.**

The accepted design supplies the two requirements none of the siblings could satisfy alone: §9.2 ("Rasen 无法阻止用户用原生 Git 手工合错 branch，因此 `rasen doctor` 与 CI 必须校验…") and §15, the acceptance matrix.

The census work was done against the tree as it stands rather than estimated. `bootstrap.ts:1235`/`:2672`, `doctor.ts:613-616`, `operations.ts:2023`, `change-status-policy.ts:125-130`, and `management-api/archive.ts:50` were each read. Line numbers are as of this proposal; child 5's implementer is editing `src/` concurrently, so an implementer should re-run the censuses in §10 rather than trust the numbers.

## Goals / Non-Goals

Goals:

- Every production reader of a layout-versioned Store record dispatches on the declared layout, and a gate keeps it that way.
- `rasen doctor` and `rasen store doctor` report one set of planning-layout findings, computed once.
- Committed planning facts are cross-checked against the target-line catalogs, and every disagreement is reported and none repaired.
- A read whose answer is narrowed by a missing scope dimension says so.
- The curated docs describe the layout the CLI writes, in every language they are published in.
- The design's §15 acceptance matrix runs as a matrix, including the three axes no journey carries today.

Non-Goals:

- **No mutator.** Not a doctor `--fix`, not a docs generator. The portfolio forbids deferring a mutator into this child, and every gate here reports. Two operations that sibling children left in prose as "a later slice's" are absent for a stronger reason than that: the accepted design excludes both. See §10.
- **No new aggregation.** Child 6 owns Store aggregate query and the grouped board. This change makes a narrowed read *state* its narrowing; it does not widen it into a cross-line rollup.
- **No new CI infrastructure.** The repository's gates are vitest source guards (`planning-path-source-guard.test.ts` is the precedent). A new `.github/workflows/` job would be a second, weaker enforcement path.
- **No repair of the five environmental `config.test.ts`/`config-editor.test.ts` failures.** They are proven environmental (`%LOCALAPPDATA%\rasen` above `os.tmpdir()`) and are a separate change's.

## Decisions

### 1. One diagnosis, two doctors — factored, not duplicated

`diagnoseLayoutMigration` already exists, is already read-only, and is already correct. The gap is purely that `src/commands/doctor.ts` never calls it. The fix is to call it, not to write a second, lighter version for the top-level command.

That distinction matters more than it looks. A "doctor-lite" that checks three of the eight findings is worse than no check, because `rasen doctor` reporting a clean Store is then a statement a user will act on. The requirement is written as "neither SHALL report a finding the other omits" so the two can only ever be one implementation.

The one behavioral addition: `diagnoseLayoutMigration` is currently invoked as `.catch(() => [])` at `operations.ts:2027`. Swallowing the failure turns an undiagnosable Store into a silently healthy one. Both call sites report the failure as an `undiagnosed` finding instead. This is the "absence is not proof" rule the portfolio learned three times, applied to the diagnosis itself.

**Rejected:** teaching `rasen doctor` to shell out to `rasen store doctor` and merge its JSON. It would agree by construction, but it makes a read-only health check spawn a subprocess, and it inherits the child's exit code into the parent's.

### 2. The consistency gate compares recorded identity against holding location, and names both

The check is deliberately narrow and purely structural. For each active Change and Archive entry reachable under a project partition:

- its committed identity records a `projectId` and a `targetLineId`;
- its location records a project partition and, for an Archive entry, a target-line partition;
- if the two disagree, report both values.

No side is preferred. Preferring the recorded identity would mean an entry merged into the wrong line reads as fine; preferring the location would mean a hand-merge silently rewrites what a Change claims about itself. The design's §11.2 already establishes this discipline for migration ownership — evidence conflict is `unresolved`, never a guess — and this is the same rule at read time.

Two further checks come free from the same walk: a named target line with no catalog, and a catalog whose `storeRef` does not resolve.

**The never-repair rule is stated as a requirement, not a convention**, with a scenario asserting that every canonical spec is byte-identical after a full diagnosis. The accepted design's §9.2 is explicit that a non-landed Archive merged in by hand is passive history and must never trigger a spec replay; a diagnosis that walked Archive records is exactly where a replay would be easy to add by accident.

**Rejected:** blocking the operation instead of reporting it. Doctor is the surface a user reaches *because* something is wrong; a doctor that refuses to run on an inconsistent Store is useless in the only case it exists for. Write-side refusal already lives in `layout-write-guard.ts` and `finalization/module.ts` (`target_line_mismatch`), which is the right place for it.

### 3. The census bounds parsers, not paths — the fourth surface

`planning-path-source-guard.test.ts` bounds three surfaces: literal `join(rasen, 'changes'|'specs'|…)` construction, the Store v2 segment arrays, and `specsDir`/`changesDir`/`inRepoArchiveDir` against a Store root. None of the three can see `readStoreProjectRecord(store.root, projectId)` — it constructs no path literal and calls no flat helper. That is precisely why two such sites survived child 3's sweep and had to be recorded in prose instead of caught.

The fourth census matches on the parser call with a Store-root-shaped argument, in the same per-file/per-count shape, with the same classification vocabulary. It is the guard that would have failed on the bootstrap sites.

The requirement spells out the anti-relaxation rule and gives it its own scenario, because the portfolio's recorded corollary is that an allow-list weakened into a prefix rule keeps passing while losing the precision it exists for. It also spells out that a *removed* site fails the census — an equality assertion, not a subset one — so deleting a call site is a deliberate edit rather than a silent drift.

**Rejected:** an ESLint rule. `tsc --noEmit` excludes `test/`, and the repository's own gates are vitest source guards; a lint rule would be a second enforcement mechanism with different coverage and a different failure surface.

### 4. A narrowed read reports the narrowing; it does not widen itself

`handleArchive` takes `space.archiveDir ?? null`. For a Store v2 project scope with no resolved target line, `archive-line` is absent from the scope description, so `archiveDir` is `null`, so `getArchivedChangeIds` returns only the machine-home union. A project with archived work renders as a project with none.

The temptation is to make the handler enumerate every target line. That is child 6's `StoreQueryModule.listChanges`, which returns results already grouped by `(projectId, targetLineId)` — and duplicating it here would create a second, ungrouped answer to the same question, which is the exact failure §6 of the accepted design exists to prevent.

So this change does the smaller, honest thing: the result states which dimension was not addressed. An empty list plus "no target line was addressed" is a true answer; an empty list alone is a false one. The requirement is phrased generally (`Every planning consumer crosses the same scope seam`) because the same shape recurs wherever a scope supplies a partial address.

### 5. The action-context grant comes from the scope, not from a join

`change-status-policy.ts:125-130`'s `planningDirectoriesOf(root)` joins `<root>/rasen/specs` and `<root>/rasen/changes` unconditionally. `buildActionContext` feeds it `session.planning.root`, which for a `type: 'store'` planning ref is the **Store checkout root** — so a Store v2 session's declared planning write grant is the two paths `layout-write-guard.ts` refuses to write, and omits `rasen/projects/<projectId>/`.

This is a genuine narrowing rather than a cosmetic one: the grant is the sandbox an agent is told it may write in. It is also *not* caught by the existing spec text, whose closest sentence forbids a compatibility field naming a **broader** writable root than the action context permits — the defect here is the action context itself, and it is narrower and wrong rather than broader.

`RuntimePlanningRef`'s store arm already carries `projectId` and `targetLineId`, so the fix needs no new frozen fact. The parallel path, `buildResolvedPlanningActionContext`, already receives `[root.specsDir, root.changesDir]` from the scope projection (`commands/workflow/shared.ts:93`) and is already correct — which is the evidence that the scope-derived form is the intended one and `buildActionContext` is the straggler.

### 6. Documentation: mark the superseded, condition the conditional

Three distinct treatments, chosen per document rather than uniformly:

- **`docs/zh/file-placement-and-planning-roots.md` is superseded in part, and is marked as such.** The accepted design's own preamble says it overrides that document's flat-Store conclusions and its `--store`/`--project` exclusivity. Silently editing a design document to match a later design destroys the record of what was decided when; deleting it destroys the parts still in force (ephemera, probes, machine root). So the superseded sections get a marker naming the replacing document. This is the treatment the new requirement's fourth scenario codifies.
- **The Store user guides are wrong and get corrected.** `docs/stores-beta/user-guide.md:78` and its zh twin at `:64` show `Created change 'add-login' at …/team-plans/rasen/changes/add-login/`; the architecture diagram at `:161-166` / `:130-135` shows the flat tree. These state current CLI behavior and the CLI no longer behaves that way.
- **Universal rules that became conditional get their condition.** `docs/cli.md:2207`'s Store-mode `planningWriteRoots` example, and the archive-destination steps at `:1713-1714` and `docs/commands.md:520`, are correct for standalone and wrong or incomplete for Store v2. They name the case.

`docs/concepts.md`, `docs/glossary.md`, and `docs/team-workflow.md` describe the in-project layout, which the accepted design explicitly preserves ("未绑定 Store 的独立项目仍沿用原有 in-project 布局"). They are **not** stale and are not touched — over-correcting them would document Store mode as the default, which it is not.

**Verified rather than assumed:** `src/locales/{en,ja,zh-cn}.json` contain no flat-Store planning path. The staleness is confined to `docs/`.

### 7. The matrix composes fixtures; it does not re-derive them

Four Store v2 CLI journeys exist (`store-v2-planning-scope-journey`, `store-v2-migration-journey`, `store-v2-workspace-journey`, `store-v2-workspace-concurrency`), plus `test/cli-e2e/store-lifecycle.test.ts` which already walks legacy-flat → migrate → work → clone. Child 5 adds a finalization journey (its task 13.1) and child 6 a cross-project one (its 11.1).

The matrix does not restate those. It adds the axes none of them carries:

| Axis | Covered today | Added here |
| --- | --- | --- |
| Layout flavor | standalone, legacy flat, migrated v2 | — |
| Project partition | one project per journey | the same Change name in two projects, non-colliding |
| Target line | one line per journey (child 5's adds two) | the same Change name on two lines of one project |
| Outcome | child 5's journey (unwritten at proposal time) | consumed, not restated |
| Path flavor | unit fixtures only; **no journey has a `win32`/`posix` axis** | address construction across both flavors at journey scope |
| Standalone non-regression | nothing compares before/after v2 | the comparison |

The last row is the one that matters most and is the easiest to skip. "Preserve standalone" is the portfolio's most load-bearing promise and the only one with no test that would fail if it broke.

### 8. Every new test must discriminate

The portfolio's recorded rule, earned on nine inverted tests in child 2: a gate that has not been shown to fail is not known to be a gate. Each gate added here carries an explicit negative fixture — a deliberately mis-partitioned Archive entry, a deliberately unclassified parser call site, a deliberately un-dispatched record read — and the task list requires reverting the fix and confirming that test, and only that test, fails.

This is stated as a task rather than a requirement because it is a property of the work, not of the product.

### 9. What this change takes from unfinished siblings

| From | Consumed | If it shifts |
| --- | --- | --- |
| Child 3 | `diagnoseLayoutMigration`, `listStoreMembership`/`readStoreMembership`, `readStoreLayoutState` | These are landed and stable; a signature change is a mechanical follow. |
| Child 4 | target-line catalogs (`src/core/store/target-lines.ts`), the machine workspace index | The consistency gate reads the catalog's `storeRef` and per-project `codeRef`. If the catalog shape changes, the gate reads the new field; the requirement names no field. |
| Child 5 | the Archive v2 record's recorded project, target line, and outcome | **Unfinished at proposal time.** The requirement says "recorded target line", not a JSON key. If child 5's record dispatch changes such that a v2 partition can hold either schema with no declared discriminator, the gate reports the ambiguity rather than sniffing — which is exactly what child 6's `design.md:226` predicted would become child 7's diagnostic. |
| Child 6 | `StoreQueryModule` for the matrix's multi-project axis only | If child 6 lands after this change is written, the matrix uses the CLI surface directly; it never needs the query module's internals. |

The gate is designed so no field name from an unfinished sibling appears in a requirement. Every requirement here names a *fact* ("the recorded target line") and leaves its encoding to the owning child.

### 10. Two operations the siblings deferred are excluded by the design, not orphaned

Children 3, 4, and 5 each wrote "a later slice's" beside two operations. Read together with nothing else, that phrasing says the portfolio ends with a hole. Read against the accepted design, it does not — each is forbidden, and the portfolio is complete without it. Recording the citation here so a reviewer does not spend the time re-deriving it.

**Merging a planning branch into its Store integration ref.** §16's sixth line is 不自动 merge、rebase、force-delete branch 或 worktree — Rasen does not automate a merge, a rebase, or a branch/worktree force-delete. §9.1's step 6 ("把规划 branch 合入同一个 `targetLineId` 的 Store integration ref") is a step in a numbered **human** landing protocol, not a tool requirement; §16 is what governs what the tool does. And §9.2 asks the tool for the opposite of automation: 跨发布线继承应是显式 release-line merge；把废弃线 feature branch 直接合进新线必须被门禁报告 — the inheritance is an explicit human merge, and a wrong one **must be reported by the gate**. Decision 2's consistency gate is that report. This is therefore delivered, not deferred.

**Upgrading a relocated legacy Archive entry into an Archive v2 record.** Two independent reasons, and the second is the harder one.

*It would have to fabricate.* The portfolio's locked decision is verbatim: legacy Archives "never invent Archive outcome, target-line, or workspace-pair facts that legacy evidence cannot prove" (`planning-context.md:89-90`). §11.2 states the same discipline for migration generally — 不能依据 change 名前缀、Git branch 名、目录相邻关系…猜测, and 证据冲突或未知时，plan 把条目标为 `unresolved` 并阻止 apply. A legacy entry typically carries none of the three facts, so the upgrade is exactly the forbidden invention. Child 3's own diagnostic already says so in its repair text: "legacy evidence cannot prove an outcome, reachability, or a workspace pair, so migration never synthesized one."

*The sanctioned route covers two of the three facts, and cannot cover the third.* §11.2's priority list is explicitly a list for determining `projectId`, so it is not by itself authority over the outcome facts — but its priority-4 audited mapping file is the mechanism the shipped migration already generalized: `src/core/store/layout-migration/plan.ts:278` emits "Declare defaultTargetLine, or …targetLine, in the mapping file". So **project and target line are user-suppliable today**. The **outcome is not, and cannot be**: §8.1 requires a `landed` outcome to prove its code commit reachable from the code ref that entry's target line declares for its project, and requires every non-landed outcome to carry a non-empty operator reason, with `superseded` additionally naming a `supersededBy` instance. A mapping file supplies none of that, and a batch pass cannot invent an operator's reason.

So the upgrade is an **operator declaration, one entry at a time** — which is a finalization act belonging to `ChangeFinalizationModule`, not a compatibility sweep. That is the second reason it may not land here, and it is independent of the mutator rule: even if this child were allowed a mutator, this particular one belongs to child 5's Module.

**What a user does instead, today.** Leave the legacy entry as legacy — it is passive history and nothing replays from it. If a specific entry genuinely needs an Archive v2 record, the operator finalizes a Change with an explicit outcome through the normal path; the reachability proof or the reason is supplied at that moment, by the person who knows it, and is recorded as evidence rather than inferred.

## Risks / Trade-offs

- **Child 5 is unfinished, and this change reads its output.** Mitigated by naming facts rather than fields, and by ordering the tasks so the consistency gate's fixtures are constructed from the finalization CLI rather than hand-written records — if child 5's record shape moves, the fixtures move with it.
- **Concurrent edits to `src/`.** Another implementer is editing `src/core/store/**` and `test/**` while this proposal is written. Every task that cites a line number instructs a re-run of the census rather than trusting the number.
- **Widening the census can break sibling children.** Adding the fourth census will fail on any un-enumerated site the siblings introduced. That is the census working. The correct response is to classify each site, never to loosen the pattern — and each new entry gets a recorded reason, per the portfolio's corollary.
- **The matrix is the largest single piece of new test code here**, and a matrix that is slow gets skipped. It composes existing fixture builders and runs the CLI once per cell rather than once per assertion.
- **Doctor's output grows.** A user running `rasen doctor` in a standalone project must not see Store layout noise; the layout section is emitted only when a Store was actually resolved, and the standalone non-regression comparison in the matrix is what proves it.

## Migration Plan

No data migration. Every change here is a read path, a diagnostic, a gate, a document, or a test.

Two behavior changes are visible to an existing user, both narrowing what is *claimed* rather than what is permitted:

1. `rasen doctor` on a Store with an unfinished or inconsistent layout stops reporting a clean bill and starts reporting findings. This is the point of the change; the findings carry repairs.
2. A Store v2 project archive listing with no resolved target line stops rendering as "no archived changes" and starts rendering as "no target line addressed". Consumers that treated the empty list as an absence see a stated narrowing instead.

Order matters only in one place: the census (§3) is added **after** the two `bootstrap.ts` sites are migrated, so its first run is green and its first failure is a real regression rather than a known one.

## Open Questions

None blocking. Three decisions above resolve silences in the accepted design and are the ones worth re-reading in review: reporting rather than repairing every consistency finding and asserting byte-identical canonical specs afterwards (decision 2); making a narrowed read state its narrowing instead of widening it into an aggregation that child 6 owns (decision 4); and marking a superseded design document rather than editing or deleting it (decision 6).

Two operations that children 3, 4, and 5 each recorded as "a later slice's" are **excluded by the accepted design**, not left orphaned — §10 gives the citation and the one-line reason for each. Neither is a portfolio gap, and neither needs a follow-up slice: automating the integration-ref merge is forbidden by §16, and what §9.2 asks for instead is the detection this change delivers; upgrading a legacy Archive record would fabricate the three facts the portfolio's locked decision forbids inventing, and its one un-suppliable fact — the outcome — makes it an operator declaration inside `ChangeFinalizationModule` rather than a compatibility sweep.
