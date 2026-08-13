# Planning context: store-v2-foundation portfolio

Written by the LEAD before the first propose. Read this FIRST, then research only what is missing.
Append durable new findings (decisions, discovered constraints) at the bottom after each propose —
not chatter. This file is the shared memory across all three children's proposals.

Written in English deliberately: the Write tool corrupts multibyte Chinese to U+FFFD in this repo.

## The user's intent, verbatim

> auto-decompose 你来开始推进开发吧！implementer ship archive使用sonnet，其他使用opus，开始吧

Preceded by: enter the worktree, read `rasen/work/issue-centered-automation-platform/store-v2-onto-020/handoff/lead-1.md`,
understand the current task. That handoff's "Next action (Step 2)" is what this run executes.

## What this run is

Land the **first slice** of the `store-v2-onto-020` sub-direction: `store-v2-foundation` —
the store base v2 model plus the Store Issues module, on **0.2.0**.

- Direction: `rasen/work/issue-centered-automation-platform/store-v2-onto-020/`
  (`work.yaml` now `status: active`, `activeSlice: slices/store-v2-foundation`, commit `eb16db63`)
- Slice spec: `slices/store-v2-foundation/spec.md` — **read it, it is the acceptance gate**
- Slice plan: `slices/store-v2-foundation/plan.md`
- Higher authority (read-only): `../north-star.md`, `../goal.md` §4–5, `target-state.md` D1–D5

## Base and reference

| | |
|---|---|
| Worktree | `.claude/worktrees/store-v2-foundation`, branch `feat/store-v2-foundation` |
| Base | `origin/dev/0.2.0` @ `657c546d` |
| Reference | `origin/dev/0.1.7` @ `a3f49007` (tag `v0.1.7`, **released & frozen**) |
| merge-base | `e62b101f` (2026-08-01) |

**The 0.1.7 line is a READ-ONLY BEHAVIOR REFERENCE, never a copy target.** The two lines are
bidirectionally divergent; merge and cherry-pick have both been proven unviable. Every seam is a
re-implementation on 0.2.0's structures. Read 0.1.7 without checking it out:
`git show origin/dev/0.1.7:<path>`, `git ls-tree -r --name-only origin/dev/0.1.7 -- <dir>`.

## Survey already done — do NOT redo it

Full report: `.rasen/survey-store-v2.md` (519 lines, in this worktree). Its headline findings,
**independently re-verified by the LEAD**:

1. **`git diff e62b101f origin/dev/0.2.0 -- src/core/store` is EMPTY.** 0.2.0 has done zero work
   inside the store directory since the merge-base. Store internals are a **greenfield drop** onto
   an untouched base — the 779 lines of in-directory churn from 0.1.7 apply cleanly.
   The real collision is entirely in the **consumer rim**, where 0.2.0 has been building
   daemon / ECP / session-host:

   | Rim file | 0.1.7 churn | 0.2.0 churn | Risk |
   |---|---|---|---|
   | `src/core/management-api/router.ts` | +267 | +798 | HIGH |
   | `src/core/management-api/wire-types.ts` | +263 | +493 | HIGH |
   | `packages/ui/src/api/types.ts` | +290 | +991 | HIGH (wire-type mirror) |
   | `src/core/completions/command-registry.ts` | +279 | changed | MED |
   | `src/cli/index.ts` | +65 | changed | MED |
   | `src/locales/{en,ja,zh-cn}.json` + 3 UI locales | changed | changed | LOW, lockstep required |

2. **`StoreIssues` has exactly three methods** — `create`, `setState`, `publishPlan`
   (`origin/dev/0.1.7:src/core/store/issues/types.ts:247`). It has **no `list`/`show`**. The reads
   live in `src/core/store/query/` as `StoreAggregateQuery.{listIssues, showIssue, issuesReferencing,
   resolveExecutionPlan, listProjects, listTargetLines, listChanges}`. This is the
   *"a mutation refuses; a query reports"* invariant made structural. The slice spec has been
   corrected accordingly (it previously claimed `list`/`show` were on `StoreIssues`).

3. **`issues/` and `query/` have a genuine bidirectional import cycle** and CANNOT be split across
   Changes. Verified edges: `issues/module.ts` → `query/refs.js`, and
   `query/issues-read.ts` → `issues/{records,plans,types}.js` (8 edges total, both directions).

4. **Verified dependency layering** inside `src/core/store/` (each edge grepped):
   ```
   Layer 0  planning-{validation,catalogs,identity,layout-v2} + finalization-v2
            + planning-foundation + src/core/canonical-json.ts     <- no store-internal deps
   Layer 1  workspace/ (13 files), target-lines.ts                 <- Layer 0
   Layer 2  issues/ (11) <=> query/ (7)   [CYCLE, inseparable]     <- Layer 0 + workspace/
   ```

5. **Prior art is the highest-value asset.** 0.1.7 built this in 9 archived changes, each with
   full proposal/design/specs/tasks under `rasen/changes/archive/` on `origin/dev/0.1.7`. The
   portfolio slicing deliberately mirrors that proven order. Per child, read its `priorArt` entry
   in `.rasen/changes/store-v2-foundation/ephemera/portfolio-run.json`.

6. **Missing spec capabilities on 0.2.0**: 9 directories, 76 requirements, ~165 KB of spec text.
   This portfolio covers 4 of them (see per-child `referenceSpecs`).

## The portfolio (decompose TAKEN)

Strict serial chain — **no parallelism**, matching `plan.md`'s own `Parallelism: None`:

```
store-planning-contract-v2  (S1)  ->  store-worktree-bindings-v2  (S2)  ->  store-issue-resources  (S3)
```

Authoritative record with per-child touch-sets, collision classes, reference specs and prior art:
`.rasen/changes/store-v2-foundation/ephemera/portfolio-run.json`.

Why split at all: `plan.md` preferred ONE change but pre-authorised a split "if the port proves too
large at design time". The survey measured it — the minimum coherent unit that delivers Issues is
~13,800 LOC of source plus ~345 KB of tests across three dependency layers. That is not one
reviewable diff.

**Out of scope for this slice** (they are their own later roadmap slices, do NOT pull them in):
`store/finalization/**` + `store-planning/**` (L3+L5), `store/layout-migration/**` +
`layout-write-guard` + `migration-ops-v2` + `consistency-gates` (L2).

## Locked decisions that constrain design (target-state.md D1–D5)

- **D1** — include the 0.3.0-adjacent Store-Issue content on 0.2.0. Operator override; do not re-litigate.
- **D2** — the explicit-capability execution root (`resolvedExecutionProjectRoot`) is the target;
  0.2.0's cwd-probe `resolveExecutionRoot` is to be removed. **Sequenced as a LATER slice (L6)** —
  do not do it here, but do not build anything that depends on cwd inference either.
- **D3** — `DISPATCH_ADAPTERS` is the target dispatch model; **work sequenced after this foundation**.
- **D4** — finalization + stored-plan (TOCTOU) is ONE later slice; must coexist with the B1
  `mergeConfirmed` gate.
- **D5** — one Issue serializer / lock / store. A receipt is historical evidence, never a live store.
  Planning space and execution root never collapse.

## Verified baseline (no-regression reference)

Established by the LEAD in this worktree BEFORE any change:

```
pnpm exec vitest run test/core/store test/core/change-run test/commands/store.test.ts \
  test/commands/store-root-selection.test.ts test/cli-e2e/store-lifecycle.test.ts
-> 104 test files, 1264 passed, 1 skipped, 468s
   gitTreeFingerprint 964a7c62d0c838360c62f68c7e1e2ee81a431f03
```

`pnpm install --frozen-lockfile` has been run (includes the Rust ProcessCapsule native build).

## Repo conventions that WILL bite

- **Locate code via the `architecture-index` skill**, not blind Grep/Glob (repo `CLAUDE.md` hard guardrail).
- **`src/core/templates/` is NOT file scaffolding** — it is AI skill instruction templates that
  generate `.claude/skills/rasen-*/SKILL.md`. Never hand-edit `.claude/skills/`; it is a build product.
- **`packages/ui` is EXCLUDED from the root vitest config.** `pnpm exec vitest run packages/ui/test/`
  silently runs 0 tests and prints "passed". UI tests need `pnpm -C packages/ui exec vitest run`.
- **Cross-platform is a hard product requirement** (macOS + Linux + Windows). Always `path.join()`/
  `path.resolve()`; tests must not hardcode separators. The v2 layout resolver has an explicit
  path `flavor: 'native' | 'win32' | 'posix'` precisely so Windows semantics are testable everywhere;
  there are dedicated `*-windows-paths.test.ts` suites — port them.
- **`storeRoot` must be absolute** or `resolveStorePlanningLayoutV2Path` throws `invalid_store_layout_v2`,
  "so resolution never depends on cwd". This is load-bearing for D2/D5, not a detail.
- **Locales move in lockstep** across `src/locales/{en,ja,zh-cn}.json` and the UI's own locale files.
- **The commit hook flags trailing blank-line-at-EOF** in archive-rebuilt specs. Fix with
  `perl -0pi -e 's/\n+\z/\n/' <file>` and re-stage. Do NOT use `--no-verify`.
- **CI whitespace gate** (`git diff --check`) scans the whole PR diff — evidence files authored
  outside the repo and moved in will trip it.
- Spec/proposal language is **user-facing product behavior**, not implementation mechanics
  (`rasen/config.yaml` `rules.specs`). Put mechanism in design.md unless it IS the product contract.
- `KNOWN_SLOW_TEST_WEIGHTS_MS` already names 0.1.7 store suites; adding ~78 store suites will need
  new weights or the macOS/Windows CI shards will skew.

## Design questions genuinely still open (decide these, with evidence)

1. **S2 scope**: is the whole `workspace/` module (13 files, 6,445 LOC) required, or only the subset
   `issues/` actually imports (`dependencies`, `locks`, `binding`, `registry`)? Decide from the
   import graph. Do not port blindly, and do not under-port and strand S3.
2. **Rim wiring strategy**: `router.ts` / `wire-types.ts` / `packages/ui/src/api/types.ts` are the
   HIGH-risk Category-B collisions. Decide whether S3 edits them directly, or whether the CLI/API
   surface is carved out. Whatever is chosen must keep the wire-type mirror in sync — a wire-type
   added without its UI mirror is a known silent-drift failure mode in this repo.
3. **`target-lines.ts` placement**: S2 by the layering, but confirm nothing in S1 needs it.
4. Which 0.1.7 tests port as-is versus need re-authoring against 0.2.0 structures.

## Appended findings

<!-- Planner: append durable findings below, newest last. Decisions and discovered constraints only. -->

### From S1 `store-planning-contract-v2` (planner-1)

**A. The 0.1.7 tip of a file is NOT the port target — attribute per commit first.** Each child's
contribution must be separated from what LATER 0.1.7 children added to the same files. Method that
worked, reusable for S2/S3:

```
git log --oneline e62b101f..origin/dev/0.1.7 -- <the child's own new files>   # find the ship commit
git show --stat <shipCommit>                                                  # exact file inventory
git diff --stat <shipCommit> origin/dev/0.1.7 -- <those files>                # what came later
git diff <shipCommit> origin/dev/0.1.7 -- <file>                              # read it, attribute it
```

S1's ship commit is `a7135669` (4,307 insertions, 13 source + 5 test files). The other 0.1.7 commits
that touched `src/core/store/` after it: `1fa114d4`, `79fd80a9`, `0ede6cfb` (the last is a large
squash). Applied to S1, the split was: **S3 owns** `planning-validation.ts` +93 (`IssueId`,
`ExecutionPlanRevisionId`, `formatExecutionPlanRevisionId`, `invalid_issue_record` /
`invalid_execution_plan` codes) and `planning-layout-v2.ts` +47 (the `issue`, `issue-record`,
`execution-plans`, `execution-plan` addresses). **S3 must add these back** when it lands — S1
deliberately omits them. Decisive evidence for the split: the tip's own TEST delta over the ship
commit is only +15 lines, so porting the tip would ship ~140 lines no suite in that child exercises.

**B. The frozen reference carries three defects in S1's own surface, each found by a LATER child.**
All three are folded into S1's port; expect the same pattern (a later child discovering the contract
is too strict) for S2/S3:
- `planning-catalogs.ts` — the v2 project catalog `id` (a **human display name**: `Elftia`, `my app`)
  was validated with `parseChangeId`, so any Store whose v1 membership record held what the field is
  documented to hold could not be migrated at all. **General rule: a migration must never block on
  data the schema it migrates FROM accepted.**
- `finalization-v2.ts` — spec-action `capabilityId` was typed as a single kebab id; a capability
  address can be slash-delimited kebab segments.
- `planning-layout-v2.ts` — `path.win32.isAbsolute('/store')` is `true` (Windows accepts a
  current-drive-rooted path), so absoluteness alone let process drive state complete a "self-contained"
  root. Fix requires a drive, UNC share, or device root under win32 semantics.

**C. Rim collision for the non-`src/core/store` files is effectively nil, measured.** Empty
`e62b101f..origin/dev/0.2.0` diffs for: `src/core/change-metadata/**`, `src/core/id.ts`,
`src/core/zod-issues.ts`, `src/core/store/{identity-types,errors,remote}.ts`,
`src/core/workflow-package/canonical.ts`. `src/core/index.ts` has +1 on each line but both are
appended export lines — an append, not a conflict. `src/core/config.ts` diverges only by an unrelated
0.1.7 AI-tool entry (Oh My Pi), needed by nothing in this portfolio.

**D. `.strict()` on `ChangeMetadataSchema` breaks the product's own archive output.**
`archive-engine.ts:2965` writes `metadata.quality = summary` into the ARCHIVED `.openspec.yaml` via
raw YAML (so the write path bypasses the schema), but `readChangeMetadata`
(`src/utils/change-metadata.ts:130`) **throws** on strict-parse failure. This repo holds **33**
archived records carrying `quality:` (0.1.7 holds 35 and shipped the defect). Active changes carry
only `schema`/`created`/`goal`. Historical shapes vary — the oldest also carry `rulesExtracted`, which
is not in the current `ArchiveQualitySummary`, so any passthrough must be permissive. S1 adopts
`.strict()` AND admits `quality`; this is a deliberate divergence from the frozen reference.

**E. The reference has NO Layer-0 purity test.** `planning-foundation-consumer.test.ts` is a
type-level branding test (`expectTypeOf`), valuable but orthogonal — purity is asserted only in the
barrel docstring. S1 adds a static import-allowlist guard plus a required mutation proof. The
verified-pure allowlist is: `zod`, `yaml`, `node:crypto`, `node:path`, `../canonical-json.js`,
`../zod-issues.js`, `../id.js`, `./identity-types.js`, `./remote.js`, `./planning-validation.js`,
`./planning-identity.js`. Transitively sound: `id.ts` has zero imports, `zod-issues.ts` imports only a
zod type, `identity-types.ts` only `node:crypto`, `remote.ts` only `./errors.js`, which has zero
imports.

**F. Test-file inventory correction (the S1 brief undercounted).** S1's suites are **five**, ~159
tests: `planning-validation-v2`, `planning-layout-v2`, `planning-identity-v2`, `finalization-v2`,
`planning-foundation-consumer`. There is **no `planning-*-windows-paths.test.ts`** anywhere on 0.1.7 —
the three `*-windows-paths.test.ts` suites belong to `finalization/`, `layout-migration/`, and
`workspace/`. **S2 owns `workspace-windows-paths.test.ts`**; the other two are out of portfolio scope.
Windows coverage for S1 lives inside `planning-layout-v2.test.ts`.

**G. `KNOWN_SLOW_TEST_WEIGHTS_MS` lives in `vitest.config.ts:34` and falls back to `file.size / 10`
for unlisted files.** Pure unit suites need no entry. S2/S3, whose suites use real fixtures, should
measure and add entries or the macOS/Windows shards will skew.

**H. S1 scope decisions taken** (do not re-litigate): three NEW capabilities, not two — the brief's
`referenceSpecs` omitted `change-finalization-record-v2`, which is the spec for `finalization-v2.ts`
and therefore S1's. Requirement counts are 8 / 7 / 7 (layout / identity / finalization); the layout
capability's live 0.1.7 spec carries more because later children added to it. Modified capabilities:
none — S1 changes no existing capability's requirements.

**I. Answers to two of the open design questions above.** Q3 (`target-lines.ts` placement):
**confirmed S2** — nothing in S1 imports it, and S1's five Layer-0 modules reach only the allowlist in
finding E. Q4 (which tests port as-is): S1's five suites port as-is; they are pure unit tests with no
fixtures, no Git, and no filesystem, so 0.2.0's structures do not touch them.

### From S2 `store-worktree-bindings-v2` (planner-1, same planner warm-reused)

**J. The attribution recipe gives OPPOSITE answers per child — run it, never assume it.** For S1 the
verdict was "port the ship commit, exclude the tip". For S2 it is "port the TIP", because every
post-squash change to `workspace/**` is either one of the two mandated fixups or the block they
rewrote. There is no single S2 ship commit: `0ede6cfb` is a squash of five 0.1.7 children, but its
effect on S2's files is unambiguous (creates all of them from zero, 6,619 insertions). Attribution
table: `0ede6cfb` = base; `79fd80a9` +468 / `55aafa1d` +113 / `bf6bdbb7` +489 all rewrite the ONE
atomic-write block in `dependencies.ts`; `70b5a74c` = the existing-change binding fixup
(`apply.ts` +78, `module.ts` +41). **`project-registry.ts` +471 is NOT S2** — it comes from
`3b050663 feat(store): add planning scope routing` plus two registry-hardening commits, all out of
portfolio scope. Verify before porting it.

**K. A commit's TITLE lies about its owner; the consumer graph and the archived fixup decide.** Two
of the four commits that built `workspace/dependencies.ts`'s atomic-write block are titled
`fix(archive): …`, and the block's only PRODUCTION consumer is `finalization/association.ts` — a
deferred slice. By S1's rule that argues for exclusion. It is still IN, for three measured reasons:
`bf6bdbb7` **is** the archived fixup `2026-08-10-fix-workspace-claim-portability` that S2 is mandated
to fold in and whose own proposal names that file; the block has a dedicated ~920-line suite in S2's
own namespace (`test/core/store/workspace-atomic-write.test.ts`) that imports no finalization; and
excluding it is mechanically impossible without inventing a file state that never existed on the
reference line. Generalisation: **"no production consumer in this child" is not sufficient for
exclusion — check for a dedicated suite and check whether a mandated fixup already rewrote it.**

**L. `session-runtime-context` is a 0.1.7-vs-0.2.0 trap, and it recurs.** The 0.1.7 worktree-bindings
change ALSO modified `session-runtime-context` (a third capability the brief did not name — the same
omission pattern as S1's `change-finalization-record-v2`) and **raised `RUNTIME_CONTEXT_VERSION`
1 → 2, declared BREAKING**. On 0.2.0 that file has **13 production consumers, 6 in `management-api/`**
(`supervisor`, `sessions`, `session-registry`, `durable-session-registry`, `reusable-session-api`,
`session-launch-context`) — none of which existed on 0.1.7. The version is load-bearing, not
advisory: it is bound as `z.literal(RUNTIME_CONTEXT_VERSION)` and a differing declared version is
rejected on read, so a bump makes every on-disk context file unreadable under a live daemon. **S2
carves it out** and hands the session-freezing + `rasen context` projection forward as an inbound item
to the store-session execution-context slice (which owns that file anyway). Carve-out is clean:
nothing in `workspace/**`, `target-lines.ts`, or the two command files imports it. The pair stays
auditable via `store workspace show`. **Any later slice touching 0.1.7's session/daemon-adjacent
surfaces must re-run this consumer count first.**

**M. S2's `workspace/` imports NOTHING from `store-planning/`, `layout-migration/`, `issues/`, or
`query/`** — verified by enumerating every `from '...'` in the module. The 0.1.7 proposal's stated
dependency on `store-planning`/`store-layout-v2-migration` was about *wiring* (`planChangeWorkspace`
surfaced ON `StorePlanning`), not about the module's own imports, so that wiring is droppable without
touching the module. Cheap check worth repeating: `git grep -h "from '" origin/dev/0.1.7 -- <dir> |
grep -oE "from '[^']+'" | sort -u`.

**N. Six digest sites in S2 make it squarely subject to the relational-blindness lesson**, and the
reference's own strongest plan scenario is the blind shape. Sites: `plan.ts:794` (the
content-addressed token `apply` consumes), `cleanup.ts:170` and `:251`, `locks.ts:128` (versioned
domain preimage `workspace-lock/v1`), `registry.ts:201`, `binding.ts:93`, `dependencies.ts:343`. The
ported scenario **"Equal inputs produce an identical plan"** compares two derivations *to each other*
and stays green under any uniform preimage or serialization change — it is now anchored to a pinned
literal value.

**O. S2 declares ZERO new branded types** — `git grep 'unique symbol'` over `workspace/**` and
`target-lines.ts` on 0.1.7 is empty. So S1's three-file brand-vocabulary guard needs no extension
here. **S3 must re-run that grep rather than inherit this answer**, since `issues/` is the likelier
place for new brands.

**P. `rasen validate --strict` requires SHALL/MUST on the FIRST LINE of a requirement's description**,
not merely somewhere in the paragraph. A requirement whose opening line is scene-setting and whose
SHALL lands on line 2 fails with `must contain SHALL or MUST`. Lead with the normative clause.

### From S3 `store-issue-resources` (planner-1, same planner warm-reused)

**Q. Three children, three different attribution answers — the recipe is the only reliable input.**
S1 = "not the tip" (tip carried S3's code). S2 = "the tip" (every later commit was its own mandated
fixup). S3 = **"the squash base, excluding a whole later roadmap slice"**. Only two commits touch
S3's files: `0ede6cfb` (the five-child squash, creates them from zero) and `f4a48a36 feat(store):
migrate coordinators to Store Issues` — the **coordinator-bridge slice**, which added +409 lines:
`issues/migration-compiler.ts` +110 (new), `locks.ts` +70 (`withIssueLockBatch` etc.), and an
**extraction** of reference verification out of `module.ts` into `reference-verification.ts` +156
(`module.ts` shrank 520 → 441). All excluded.

**R. The cleanest exclusion signal is source and its dedicated suite arriving in the SAME commit.**
`f4a48a36` added `migration-compiler.ts` *and* the only suite for it, and the `locks.ts` batch code
*and* the only cases for it (`store-issue-locks.test.ts` +93). So they leave together: nothing
untested, no orphan test. This is the exact mirror of finding K — where S2's atomic block had a
dedicated suite that arrived *separately* and therefore stayed. **The test/source co-arrival test is
the discriminator, not the commit title and not the consumer count.**

**S. Beware excluding an EXTRACTION — check what the base did before the refactor.** `f4a48a36` did
not introduce reference verification (a named S3 deliverable); it moved it out of `module.ts`. The
squash base performs it inline, covered by the base change's own tests, so excluding the extraction
keeps the behaviour and loses only the file split. Likewise `issueLockCanonicalBytes` is an extraction
of an inline expression — the lock filename digest is byte-identical either way. **Consequence to
record openly: S3's `issues/module.ts` will NOT be byte-identical to `origin/dev/0.1.7`**, the first
deliberate departure from the portfolio's byte-comparability preference. That is correct —
comparability is a means of keeping the reference diffable, not a reason to import a later slice.

**T. S3 has NO decomposition gap — measured at propose time, per the S2 mandate.** Grepped every S3
test for `--target-line` / `new change` / `planning_worktree_required`: the only hits are
`store issue new …` and `store aggregate --project/--target-line`, which are S3's OWN new command
surface. Their whole import surface resolves to S1, S2, `test/helpers/run-cli.js`, and node builtins.
**The propose-time CLI-surface scan is cheap and should now be standard** — two greps, and it converts
S2's mid-implementation surprise into a recorded fact.

**U. The brief undercounted the capability set for the THIRD time in a row.** S3's reference change
carries SEVEN spec files, not the two named: `store-issue-resources` (8 ADDED, not 11 — the live spec
has 11 because `f4a48a36` added 3), `store-aggregate-query` (7), `store-planning-layout-v2` (2 ADDED —
**the debt S1 deliberately deferred to S3**, closing finding A), `store-planning-scope-routing` (1 —
dropped, capability absent on 0.2.0), and the rim: `board-ui` (4), `management-http-api` (3),
`management-ui-shell` (1) — all three of which DO exist on 0.2.0. **Always list the prior-art change's
`specs/` directory; never take the brief's capability count as the inventory.**

**V. A MODIFIED delta against a diverged rim capability is a trap; convert it to a bounded check.**
The reference change amended `board-ui`'s member-chip-filter requirement and `management-http-api`'s
loopback/bearer-security requirement. MODIFIED is whole-requirement replacement, and this repo's known
failure mode is that a drifted heading or a missing scenario silently deletes content at archive time.
S3 ships **ADDED-only** rim deltas and makes it a task to read the LIVE 0.2.0 text of both
requirements, decide whether the new surface genuinely alters them on THIS line, and author the
MODIFIED delta from the 0.2.0 text if so — never from the reference's.

**W. The symmetric-anchor trap, stated as the mutation that discriminates.** An anchor whose expected
value is produced by calling production's own serializer a second time is blind: a serializer change
moves both sides together. Perturbing an INPUT field does not test this — it moves one side only and
is the break the unstrengthened anchor already caught. The discriminating mutation is a change to the
**serializer or preimage itself with inputs held fixed** (reorder a field, change a separator, drop a
domain tag). S3's tasks state this explicitly for all five of its durable-format sites.
