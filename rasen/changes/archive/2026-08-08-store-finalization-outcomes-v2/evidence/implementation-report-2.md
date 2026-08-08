# store-finalization-outcomes-v2 — implementation report (implementer-2)

Continues `implementation-report.md`, which covers sections 1–11 and task 12.1.
This report covers everything else: the rest of section 12, the named unit
suites, section 13, and the section 14 notes.

**Task count: 101 of 101.** One caveat, stated up front: the whole-repository
`vitest run` could not be taken cleanly, because another agent was editing this
same worktree throughout. Every AFFECTED suite was run and attributed instead —
see §5 and §6.

---

## 1. What was built

### Production code

| File | Change |
| --- | --- |
| `src/core/archive-consumer-invocation.ts` | The finalization half of the generated argv (task 12.4/12.5): a `finalization` input threaded into `savedPreview` **only**, validated through the CLI's own `resolveFinalizationOutcomeRequest` so a generated array can never express a combination the command would refuse; `createGeneratedArchiveBatchArgv`, which refuses a whole batch naming every member that declares no outcome; and an in-ship guard that admits `landed` and nothing else |
| `src/core/management-api/finalize.ts` | New. The change-finalization bridge (task 12.6): validates the path scope, then runs the CLI TWICE — a read-only `--dry-run --save-plan --json` preview, and only if the plan's `changeInstanceId` equals the one in the PATH, `--apply-plan … --yes`. Cap-1 in flight, `shell: false`, argv array, CLI entry resolved from this installation |
| `src/core/management-api/router.ts` | `matchStoreFinalizePath` beside `matchSessionIdPath` (the path has four parameters, so `MANAGEMENT_PATHS` cannot hold it), POST-only admission, `isManagementPath` membership, and the handler |
| `src/core/management-api/whitelist.ts` | `finalize-change` enumerated as the fifteenth `bounded-cli` entry, with its reason |
| `src/core/store/finalization/types.ts` | Two compile-time constants that prove no passive plan variant is assignable to a shape carrying `specActions` (task 1.4). `tsc --noEmit` excludes `test/`, so the proof lives in `src/` where the build enforces it |
| `src/core/store/finalization/module.ts` | Three defect fixes — see §2 |
| `src/core/store-planning/internal/resolver.ts` | One defect fix — see §2 |

### Test suites

| Suite | Tasks | Tests |
| --- | --- | --- |
| `test/core/archive-standalone-baseline.test.ts` | 1.2, 8.6 | 6 |
| `test/core/store/finalization-plan-union.test.ts` | 1.4, 6.2 | 6 |
| `test/core/store-planning/finalize-scope.test.ts` | 2.4, 2.6 | 13 |
| `test/core/store/finalization-outcome.test.ts` | 3.8 | 22 |
| `test/core/store/finalization-reachability.test.ts` | 4.8 | 14 |
| `test/core/store/finalization-successor.test.ts` | 5.7 | 13 |
| `test/core/store/finalization-spec-sync.test.ts` | 6.7, 6.8 | 13 |
| `test/core/store/finalization-record.test.ts` | 7.7 | 17 |
| `test/core/archive-engine-finalization-seams.test.ts` | 8.8 | 15 |
| `test/core/store/finalization-plan-token.test.ts` | 9.6, 9.7, 9.8 | 12 |
| `test/core/store/finalization-association.test.ts` | 10.7, 13.3 | 7 |
| `test/core/store/finalization-surface-parity.test.ts` | 12.7 | 6 |
| `test/commands/archive-outcome-cli.test.ts` | 12.2, 12.3, 12.8 | 16 |
| `test/core/management-api/store-finalize-api.test.ts` | 12.6 | 9 |
| `test/core/store/finalization-windows-paths.test.ts` | 13.2 | 14 |
| `test/commands/store-v2-finalization-journey.test.ts` | 13.1, 13.4, 13.5 | 1 (long) |

Two new helpers: `test/helpers/store-finalization-fixture.ts` (a bound,
real-Git pair on top of child 4's workspace fixture, plus `hashTree` and
`prepareSpecActions`) and `test/helpers/finalization-memory-git.ts` (a
deterministic in-memory read-only Git adapter, for the cases real Git will not
produce on demand — an indeterminate ancestry answer, an ambiguous ref, an
unreadable Store ref).

---

## 2. Four production defects found and fixed

Each was found by a test that executed the real path, and each is now pinned by
a test that was mutation-verified (§4).

### D1 — A finalized execution checkout became unusable (major)

**`src/core/store-planning/internal/resolver.ts`, `parseAssociation`.**

The `association-finalized` phase writes a `finalizedChange` block into the
execution checkout's `.rasen/planning-binding.json` (design §8.2). But
`parseAssociation` holds a strict field ALLOW-LIST, and any unknown key is
`planning_selection_conflict`. So the moment a Change was finalized, **every
subsequent Rasen command run from that execution checkout failed to resolve its
scope.**

Child 4's `binding.ts` says out loud that it uses "exactly the field set the
planning resolver already parses" so a pair it writes stays readable. This
change added a field to that document and did not extend the reader. Nothing
caught it because the workspace journey finalizes and then stops — it never
resolves a scope from that checkout again.

Fixed by enumerating `finalizedChange` in the allow-list with its reason (never
by relaxing the check to a prefix rule) and parsing it into the fact as
`finalizedChangeId`, explicitly NOT as scope evidence: a finalization changes no
Store, project, or target line.

Pinned by `archive-outcome-cli.test.ts` → *"leaves the execution checkout
resolvable after its Change is finalized"*.

### D2 — Equal inputs did not produce an identical plan id

**`src/core/store/finalization/module.ts`, `finalizationPlanId`.**

`planId` excluded `paths.stage` and `paths.journal`, but the engine's ordered
ACTION list embeds those same paths, and each carries the random transaction id.
Two plans of identical inputs therefore had different ids — the property the
spec asks for, and child 4's defect 1 in a different costume.

Fixed by normalizing the transaction id out of the canonical bytes before
hashing (substituting it wherever it appears, at any depth) rather than deleting
the action list, which would drop real decisions from the identifier.

Pinned by `finalization-plan-token.test.ts` → *"is identical for equal inputs"*.

### D3 — A precise landed refusal was replaced by a vaguer one

**`module.ts`, the landed branch of `plan()`.**

When the reachability proof failed, the specific refusal
(`landed_commit_unreachable`, naming the commit, the ref, and the ref's OID) was
collected as a blocker — and then `buildArchiveV2RecordDraft` threw
`landed_proof_unavailable` ("a proven code merge is required"), which is what
the user actually saw. The spec's scenario requires the command to "refuse
naming the commit and the ref".

Fixed by raising the collected blocker as the refusal it was, before the record
draft is built.

Pinned by `archive-outcome-cli.test.ts` → *"refuses a landed outcome whose
commit is not reachable"* and by the management-API suite's diagnostic
pass-through case.

### D4 — An unverifiable successor reported a shape complaint

**`module.ts`, the outcome validation call.**

When the successor search found nothing, its `successor_scope_unverified`
diagnostic (which lists the searched and unsearched refs) was collected, and
then the canonical validator was called anyway with no successor scope, throwing
the generic *"successorScope: is required to verify a superseded outcome"*.

Fixed by skipping the successor arm of the canonical validator exactly when the
search produced no scope for it to compare — the blocker already carries the
better message, and the shape half of the request was validated before any I/O.

Pinned by `archive-outcome-cli.test.ts` → *"refuses an unverifiable successor
with the SPECIFIC diagnostic"*.

---

## 3. Judgment calls

1. **The management route runs the CLI twice, and the order is the point.** The
   path names the Change INSTANCE; the CLI addresses a Change by its alias. To
   refuse a disagreeing scope *before* mutating, the bridge takes the read-only
   `--dry-run --save-plan` plan first, compares its `changeInstanceId` to the
   path, and only then applies the stored plan. Both invocations are the CLI,
   only the second mutates, and the preview is the same immutable plan every
   other surface produces — which is also what makes the API a real fourth
   surface in the parity test rather than an assertion about a string.
2. **`changeId` is required in the finalize request body.** The path carries
   identity; the CLI needs the alias. Neither is inferred from the other, and a
   disagreement is a 409 rather than a reinterpretation. This is not "completing
   a scope field from a filter" — the alias is a locator supplied by the caller,
   and the identity in the path is what it is checked against.
3. **Surface parity normalizes two values and nothing else.** The random
   transaction id, and the wall-clock instant (`archivedAt` is a recorded fact
   of the finalization, and four surfaces cannot be invoked at the same
   millisecond from a test). Everything else — destination, record draft, spec
   sync, evidence inventory, association plan, lock keys, and the engine's whole
   ordered action list — is compared byte for byte, and the assertion then
   re-derives the identifier through production's own `finalizationPlanId`.
4. **A non-ASCII Change alias is REFUSED, not supported.** Task 13.2 asks for
   "UTF-8 Chinese Change aliases"; a Change alias is a portable kebab id, so
   `结算规则` never becomes an entry name and the address boundary refuses it
   before returning a path. That is the correct behavior — an entry name that
   differed by Unicode normalization form between two machines would make the
   address itself unstable — and the suite pins the refusal rather than
   pretending the case works. A Chinese Store ROOT is carried through unchanged,
   which is the part that is genuinely the user's.
5. **`finalization_already_complete` is reachable only when an active source
   still exists.** After a *successful* finalization the active directory is
   gone, so a re-run fails earlier with "change not found". The idempotence case
   is the recoverable one — entry published, source retained — and that is what
   the test sets up. It also asserts the negative: a DIFFERENT instance of the
   same alias is not reported as already complete, which is what makes "decided
   from the record, not a directory scan" a real claim.
6. **The parity suite imports its fixture first, deliberately.** The Store
   planning and workspace modules have a cycle between `workspace/module.ts` and
   `workspace/binding.ts`; entering that graph from the management-API bridge
   first leaves `assertCarrierAgreesWithScope` in its temporal dead zone. The
   import order carries a comment saying so. **This is a latent fragility in
   production module structure, not a test artifact** — a future `src/` import
   could hit it. Flagged for the reviewer.

---

## 4. Mutation verification

Every fix and every new guard was checked by reverting the production change and
confirming the corresponding test — and only it — fails.

| Reverted | Test that failed | Observed |
| --- | --- | --- |
| `finalizedChange` removed from the resolver allow-list | `archive-outcome-cli` → "leaves the execution checkout resolvable" | `planning-binding.json contains unsupported fields: finalizedChange` |
| transaction-id normalization removed from `finalizationPlanId` | `finalization-plan-token` → "is identical for equal inputs" | two different digests |
| landed-proof re-raise disabled | `archive-outcome-cli` → "not reachable from the code ref" | `landed_proof_unavailable` instead of `landed_commit_unreachable` |
| successor guard disabled | `archive-outcome-cli` → "SPECIFIC diagnostic" | `finalization_outcome_invalid` instead of `successor_scope_unverified` |
| in-ship `landed`-only guard neutered | `finalization-surface-parity` → "refuses any in-ship outcome other than landed" | no throw |
| batch `requireFinalization` neutered | `finalization-surface-parity` → "refuses a whole BATCH" | no throw |
| `finalizeArchiveAssociation` call removed from the engine | 10 tests across `archive-engine-finalization-seams` and `finalization-association` | the association phase, its ordering, its recovery, and its default-adapter refusal all fail; the standalone/v1 cases stay green |

The last row is the important one: it confirms the association suites
discriminate on the phase itself, not on incidental state, and that the
standalone baseline is genuinely independent of it.

An eighth was verified by observation rather than by a deliberate revert:
removing `workspace_pair_unavailable` from the `vocabulary-sweep` ledger is what
the full run was already failing on, and re-adding it is what turned it green
(§7). That is the same evidence a revert would produce.

### What was NOT mutation-verified, stated plainly

Discrimination was proven for every case where a **production behaviour** could
be reverted. It was **not** proven, one assertion at a time, for the bulk of the
new coverage — roughly 160 of the ~190 new assertions. Specifically:

- The **pure-function suites** (`finalization-record`, `finalization-outcome`,
  `finalization-reachability`, `finalization-successor`,
  `finalization-windows-paths`, the digest-mapping half of
  `finalization-spec-sync`, the seam-1 and seam-4 halves of
  `archive-engine-finalization-seams`) assert refusals and mappings the
  production code already implemented before this pass. Each one fails if its
  function's behaviour changes — that is what the assertions are — but I did not
  perturb each function individually to demonstrate it.
- The **scope suite** (`finalize-scope`) and the **journey**
  (`store-v2-finalization-journey`) assert composed end-to-end behaviour. The
  journey in particular is one long test; a single revert would fail it for many
  reasons at once, so a revert proves little about which assertion is load-bearing.
- The **API suite's** non-spawning cases (401, three 405s, two 400s) are pinned
  by the route existing at all; they could not pass without
  `matchStoreFinalizePath` and the POST-only admission, which is weaker evidence
  than a revert but is not nothing.

Two of the mutation-verified rows above were found *because* a test failed
against real behaviour rather than being written to match it (D3 and D4 in §2),
which is the stronger signal — but a reviewer should treat the unverified
majority as ordinary assertions, not as proven-discriminating guards.

---

## 5. Gate results

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint src test` | clean |
| `pnpm run build` | clean |
| `rasen validate store-finalization-outcomes-v2 --strict` | `Change 'store-finalization-outcomes-v2' is valid` |
| `git diff --check` | clean (exit 0; output is only `core.autocrlf` notices) |
| Encoding audit of all 20 files this implementer created | clean — UTF-8, no BOM, no U+FFFD, no mojibake, LF, no trailing whitespace, no blank line at EOF |
| Line endings of the 3 tracked files edited in place | CRLF **in the working tree only**, which is this checkout's normal state (`core.autocrlf=true`; untouched files such as `src/core/id.ts` are CRLF too). Git normalizes to LF on commit and `git diff --check` confirms it |
| MODIFIED title / scenario comparison (task 14.2) | 4 of 5 match canonical exactly with no scenario drift; the 5th is introduced by the unshipped sibling `store-layout-v2-migration`, which is the documented archive-ordering dependency |

Focused suites, all green when run individually:

```
finalization-record            17 passed
finalization-reachability      14 passed
finalization-outcome           22 passed
finalization-successor         13 passed
finalization-plan-union         6 passed
finalization-windows-paths     14 passed
finalize-scope                 13 passed
archive-standalone-baseline     6 passed
archive-engine-finalization-seams 15 passed
finalization-spec-sync         13 passed
finalization-plan-token        12 passed
finalization-association        7 passed
finalization-surface-parity     6 passed
archive-outcome-cli            16 passed
store-finalize-api              9 passed
store-v2-finalization-journey   1 passed
workflow-whitelist              6 passed
```

### The affected suites (task 13.6), run serially and all green

Run with `--no-file-parallelism`, because `test/helpers/run-cli.ts` shells out
to `pnpm run build:if-stale` per invocation and parallel workers race on
`dist/` (see §6):

| Batch | Result |
| --- | --- |
| `test/core/templates`, `test/core/store-planning`, `test/core/completions`, and every `test/core/archive*` suite | **33 files, 557 passed, 14 skipped, 0 failed** |
| all of `test/core/store` plus `management-api/{planning-scope-routing,archive,archive-api}` | **70 files, 1064 passed, 2 skipped, 0 failed** |
| `cli-e2e/store-lifecycle`, `cli-e2e/capstone-journeys`, `commands/store-v2-planning-scope-journey`, `commands/store-root-selection` | **4 files, 47 passed, 0 failed** |
| `commands/archive-outcome-cli`, `management-api/store-finalize-api`, `commands/store-v2-finalization-journey`, `commands/store-v2-workspace-journey` | **4 files, 28 passed, 0 failed** |

Re-verified on a later, freshly built tree (second session), because other
agents kept editing this worktree in between:

| Batch | Result |
| --- | --- |
| all ten repository-wide guard suites (`vocabulary-sweep`, `brand-guard`, `edit-boundary-vocabulary`, `vet-literal-guard`, both git-verb guards, `planning-path-source-guard`, `legacy-store-gate-guard`, `windows-hide-guard`, `legacy-groups-removed`) | **10 files, 41 passed, 0 failed** |
| `commands/archive-outcome-cli`, `commands/store-v2-finalization-journey`, `commands/store-v2-workspace-journey`, `store/finalization-surface-parity` | **4 files, 25 passed, 0 failed** |
| all of `test/core/management-api` + all of `test/core/templates` | **50 files, 542 tests: 3 failed on the first attempt, 0 on the rebuild — see below** |

The three that failed were `store-finalize-api`'s CLI-spawning cases, and the
recorded error is `Error: Cannot find module '…\dist\cli\index.js'` from Node's
loader: another agent cleaned and rebuilt `dist/` mid-run. `pnpm run build`
followed by a re-run of that file gives **9 passed, 0 failed**. This bridge is
maximally exposed to that race because, unlike `test/helpers/run-cli.ts`, it
resolves `dist/cli/index.js` directly and does not build first — which is
correct for production (a server must not shell out to a build) but makes the
suite fragile while another process is rebuilding.

---

## 6. The full-suite run, and why it is not attributable

`npx vitest run` over the whole repository reported **42 files / 358 tests
failed, 6368 passed, 35 skipped**. That result is NOISE, and the evidence for
saying so is concrete rather than a hunch:

1. **Another agent was editing this worktree throughout.** A build during the
   run failed on a half-written `src/core/store/membership-layout.ts`
   (`error TS18046: 'error' is of type 'unknown'`, line 171) — a child-3 file
   this change does not touch, which compiled a minute later. `find src test
   -newermt "-45 minutes"` listed ~20 files under
   `src/core/store/{workspace,layout-migration}`, `src/core/store/membership*`,
   and `src/commands/doctor.ts` being modified mid-run.
2. **The build race is visible in the log.** `dist/ was rebuilt by another
   process` appears repeatedly, and the recorded failure text includes
   `Error: Command failed (exit code 1): pnpm run build:if-stale` from
   `test/helpers/run-cli.ts:40`. The failing set is dominated by suites that
   spawn the CLI — which is precisely what a missing or half-written
   `dist/cli/index.js` breaks.
3. **Re-running the same files serially passes.** Every affected suite above,
   including the four CLI/API suites that appeared in the failing list, is green
   when the build is not being clobbered. One case (`archive-outcome-cli` →
   "not reachable") failed once under parallelism with `Could not parse JSON`
   and passed on the serial re-run and when run alone.

**One failure in that run was real, and it was this change's.** See §7.

The shipper should re-run `pnpm test` on a quiescent tree, remembering the five
environmental failures (`config.test.ts` ×1, `config-editor.test.ts` ×4) that
are not defects.

---

## 7. The one real full-suite failure — the token-surface gate

`test/vocabulary-sweep.test.ts` → *"keeps the deleted workspace/initiative token
surface from regrowing"*:

```
expected [ 'workspace_pair_unavailable' ] to deeply equal []
```

That sweep walks all of `src/` for `(workspace|initiative)_[a-z_]+` and compares
against a ledger enumerated one token at a time. This change's closed refusal
taxonomy adds `workspace_pair_unavailable`, and nobody extended the ledger — the
same class of miss the portfolio recorded for child 4, found by exactly the rule
that was written down for it: **grep the token, not the file you expect to own
it.** The focused suites could not have caught this; only the repository-wide
sweep does.

Fixed by ENUMERATING the one new token with its reason (Archive v2 requires a
verified `workspacePairId` on every record, so a finalization that cannot obtain
one refuses rather than minting a placeholder) and updating the file's
"a 32nd unexpected token still fails this gate" note to 33. The allow-list was
**not** relaxed to a `workspace_` prefix rule; the ledger's staleness half —
which fails if an allowed token disappears from `src/` — still holds.

---

## 8. Notes for the reviewer and the shipper

1. **Read `evidence/archive-preconditions.md`.** It records tasks 14.1–14.5,
   including the executed title/scenario comparison and the exact dependency on
   `store-layout-v2-migration` archiving first.
2. **Child 6 carries a task that is now false.**
   `rasen/changes/store-scoped-issues-management/tasks.md:129` still says
   archiving "still reports `store_v2_finalization_unavailable` by name while
   child 5 is unimplemented". That code no longer exists. Child 6's
   `management-http-api` delta also has to be refreshed to the post-this-change
   scenario set, or its own archive will be refused for scenario drift.
3. **The whitelist test was extended by enumeration.** `workflow-whitelist.test.ts`
   now pins fifteen bounded-cli ops instead of fourteen, with `finalize-change`
   listed individually and its reason recorded in the file's header comment. The
   exactness of that list is the gate; it was not relaxed.
4. **`finalize.ts` exports its argv builder on purpose.** `createFinalizationCliArgv`
   exists so the parity test drives the API's real commands rather than
   asserting something about a string the bridge builds privately. There is no
   second command builder behind the route.
5. **The module-cycle note in §3.6 deserves a look.** The import-order
   sensitivity between `workspace/module.ts` and `workspace/binding.ts` is
   production structure, and the test comment is a workaround, not a fix.
