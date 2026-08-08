# store-scoped-issues-management — implementation report (session 2)

Continues `implementation-report.md`, which stays accurate for sessions 1's
work. **68 of 102.** Section 7 landed; the encoding defect the lead found was
repaired and the whole surface swept.

## 1. The NUL bytes

`src/core/store/query/module.ts` carried **two raw NUL bytes** (offsets 10209,
12174) as the composite bucket-key separator. Both were replaced with the
` ` escape. The runtime string is byte-identical; the file is text again
rather than binary to Git.

The idiom was kept, not removed. A printable separator would be wrong here:
`:`, `/`, and `-` all appear in real target-line ids (`line-0.2`), so
`("a", "b-c")` and `("a-b", "c")` would collide on one group. That reasoning is
now a comment above the key, because the next reader's instinct will be to
"simplify" it.

Then I swept the whole tree with the lead's `nul-sweep.mjs`, reading it first
as instructed — its raw output flags 831 of 1059 files, almost all `CR` from
this checkout's `core.autocrlf`. Filtering that:

| Finding | Count | Verdict |
|---|---|---|
| Raw NUL | **0 repo-wide** | mine was the only one; fixed |
| U+FFFD | 6, in 4 files | **all pre-existing in `HEAD`** |
| UTF-8 BOM | 1 (`skill-templates-parity.test.ts`) | pre-existing |

The U+FFFD files: `src/locales/ja.json` (3) and `zh-cn.json` (4) are real
committed mojibake in `learnedMaterialization.degradedRepair` and two
`tools`-validation strings; `layout-migration/apply.ts`,
`layout-migration-catalog-receipt.test.ts`, and `run-state.test.ts` are the
deliberate-literal case the lead warned about. None is mine.

**Reported, deliberately not acted on:** `packages/ui/src/api/types.ts` now has
mixed endings in the working copy — 1226 CRLF lines from checkout plus my 257
appended LF lines. `git diff --numstat` is **257/0**, so Git normalizes it and
the commit is insertions-only. Normalizing the working copy would mean touching
1226 pre-existing lines for no committed benefit.

## 2. Section 7 — the Store-level Issue scope intent

Both halves landed together, which is why neither landed in session 1.

**`src/core/store-planning/types.ts`**: `'store-issue'` on `PlanningIntent`, an
`OpenStoreIssue` input, a `StoreIssueAddress` union of the four Issue kinds
folded into `StoreReadAddress`, a `StoreIssueScope` capability exposing **only**
Issue addresses plus `storeCheckoutRoot`, and the `open` overload.

**`src/core/store-planning/internal/resolver.ts`**:

1. `open`'s if-chain became an **exhaustive `switch` with a `never` default**.
   The old shape's fallback was `creationCapability`, so a new intent added to
   the union without an arm would have silently authorized Change creation. It
   now fails to compile instead. This is the structural fix for the class the
   lead named, applied at the dispatch rather than at one call site.
2. `isStoreLevelIntent` replaces two hard-coded `intent === 'store-read'`
   comparisons, so a Store-level intent is not refused for having no project.
3. `store-issue` is the one intent permitted to resolve from a **project-shaped**
   resolution: standing in an execution worktree bound to one Change is the
   ordinary case, and requiring a `cd` would make the cross-project resource the
   hardest one to reach. `issueCapability` projects that ref down to its Store.
4. `location()` learned the four Issue kinds, computing every path through
   `resolveStorePlanningLayoutV2Path` and refusing them for a project ref.

### The strict-reader check the lead asked for

`parseAssociation`'s allow-list needs **no new field**: this intent writes
nothing into the execution association, the planning marker, or the machine
index. It is a pure resolution path. Rather than assert that in prose, the suite
opens an Issue scope from a bound execution worktree and then opens a
`project-read` from the same checkout, proving the association still parses —
which is exactly the shape that would have caught the original
`finalizedChange` defect.

### Task 7.6's ordering enumeration

`STORE_LOCK_ORDER` was `['issue', ...WORKSPACE_LOCK_ORDER]`. That is a spread,
which is the subset shape the lead ruled out: it would silently absorb a fifth
workspace key nobody had positioned relative to `issue`. It is now **five
literal entries, one per line with its reason**, plus
`assertStoreLockOrderAgreesWithWorkspace()` — called at module load — which
throws if the tail stops matching `WORKSPACE_LOCK_ORDER` or if `issue` stops
being first. A change on child 4's side is now a startup failure naming the
repair, not a silent absorption.

## 3. Defect found and fixed in section 7

**A Store-level Issue scope advertised a project follow-up.** `issueCapability`
projected the ref down to the Store but carried `description.followupSelection`
and `description.paths` forward from the project-shaped resolution. A caller
threading `followupSelection` into its next command would have started passing
`--project` — to the one resource that must never require one. Both are now
recomputed from the aggregate ref. Caught by the assertion that
`followupSelection.project` is undefined, not by inspection.

## 4. Mutation verification

Four guards verified in total, each producing exactly the intended failures.

| Guard | Mutation | Observed |
|---|---|---|
| read-only source guard (s1) | `'checkout'` added to `STORE_QUERY_GIT_VERBS` | 1 of 10 failed, the right one |
| unsearched-ref invariant (s1) | `openRef` records an unresolvable ref as *searched* | 1 of 23 failed, the right one |
| issue-lock ordering | `assertIssueAcquisitionOrder`'s later-key filter neutered | **2 of 15 failed — exactly the two ordering tests** |
| Issue write location | `issueCapability` uses `planningRoot` instead of `registeredRoot` | 1 of 7 failed, the "never the bound planning worktree" test |

A fifth mutation is recorded as **uninformative rather than passing**: moving
`'issue'` to second place in `STORE_LOCK_ORDER` trips the load-time agreement
assertion, so the module fails to import and vitest reports "no tests" instead
of a failing assertion. That is the intended loud-failure behaviour, but it does
not demonstrate that the *enumeration test* discriminates — so I am not claiming
it does.

**Still not mutation-verified**, unchanged from session 1: the eighteen-op
whitelist count, the 11.6 finalization-reachability assertion, the
command-registry exemption assertions, both pure-function suites, and the Issue
write/publish assertions other than the unreadable-ref one.

## 5. Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint src test` | clean |
| `test/core/store` | **73 files, 1180 passed, 2 skipped, 0 failed** |
| `test/core/store-planning` + `test/core/management-api` | **42 files, 525 passed, 1 skipped, 0 failed** |
| `validate store-scoped-issues-management --strict` | valid |
| `git diff --check` | exit 0 |
| byte sweep over the new files | **0 findings** |

No failing file. The resolver is the portfolio's hottest file, so the store,
store-planning, and management-api suites were run in full after the change, not
just my own.

## 6. Deviation a reviewer should judge

**Task 7.9 says to extend `test/core/management-api/planning-scope-routing.test.ts`.
I did not.** The lock coverage went into the file 7.9 also names
(`test/core/store/store-issue-locks.test.ts`, 15 tests) and the intent coverage
into a **new** file, `test/core/store/store-issue-scope-intent.test.ts` (7 tests).

Reason: `planning-scope-routing.test.ts` is child 2/4's, it stands up a loopback
HTTP server per case, and a fixer is live in neighbouring files. Adding to it
would have meant editing a shared file for assertions that need neither HTTP nor
the management API — the intent is a core-resolver contract. The substance of
7.2–7.4 is covered; the file it names is not touched. If the reviewer wants the
assertion in that specific file, it is a move, not new work.

Task 7.9 is therefore left **unticked** rather than claimed.

## 7. Remaining — 34 tasks

Unchanged from `handoff/implementer-1.md` except that section 7 is done:
**8.9** (CLI test files), **9.5/9.6/9.8/9.9** (the management-API suite; the code
is wired and exercised, the assertions are not written), **10.3–10.10** (the UI —
`packages/ui/node_modules` is still absent in this worktree, so the two
`satisfies` fixtures remain **written but never executed**), **11.1–11.8** and
**11.11**, plus **1.1/1.2**, **6.10**, **7.9**, and the three untested behaviours
**3.6 / 4.8 / 5.3**.
