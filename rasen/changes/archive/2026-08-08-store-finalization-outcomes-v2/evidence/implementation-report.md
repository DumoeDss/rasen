# store-finalization-outcomes-v2 — implementation report (implementer-1)

> **SUPERSEDED IN PART — read `implementation-report-2.md` next.** This report
> covers the first pass (sections 1–11 and task 12.1). The remaining 34 tasks,
> four production defects found while completing them, the mutation-verification
> evidence, and the final gate results are in
> `evidence/implementation-report-2.md`. The archive-ordering preconditions
> (§14) are in `evidence/archive-preconditions.md`. The change is now **101/101**.

Status: **production code complete for sections 1–11 and 12.1; test coverage
partial.** 67 of 101 tasks are ticked. Everything unticked is listed in §7 with
its reason, and `handoff/implementer-1.md` carries the working set for a
successor.

**The refusal is lifted and finalization works end to end through the real
CLI.** `test/commands/store-v2-workspace-journey.test.ts` now finalizes a bound
Store v2 Change as `abandoned`, publishes it under the project partition's
stable target-line Archive with an instance suffix, writes a validated Archive
v2 record carrying the verified workspace pair, and completes the association
inside the transaction. That is the strongest proof available and it passes.

---

## 1. What was built

### New modules

| Path | What it owns |
| --- | --- |
| `src/core/archive-accounting-v2.ts` | The Archive v2 accounting writer beside the v1 one: the record draft type, the identity preimages, evidence mapping, re-verification of both identities at write time, atomic write, verify-by-re-parse |
| `src/core/store/finalization/types.ts` | The Interface: outcome request, the outcome-discriminated `ImmutableFinalizationPlan`, token, result, and the closed error taxonomy |
| `src/core/store/finalization/diagnostics.ts` | `ChangeFinalizationError` + `finalizationRefusal`, which forces every taxonomy refusal to carry both disagreeing values and a repair |
| `src/core/store/finalization/dependencies.ts` | The read-only adapters. Filesystem/coordination/clock are reused from child 4; **Git is not** — this Module has its own adapter whose verb set (`rev-parse`, `for-each-ref`, `merge-base`, `show`, `status`, `symbolic-ref`) contains no writing verb at all, enforced at run time as well as by the source guard |
| `src/core/store/finalization/outcome.ts` | Request construction and every contradictory-combination refusal, all reachable with zero I/O. No second outcome parser: shape and scope go through child 1's `validateFinalizationOutcome` |
| `src/core/store/finalization/reachability.ts` | Commit resolution in fixed priority, the ancestry proof, and the four refusals — unresolved, unreachable, indeterminate, undeclared-implementation |
| `src/core/store/finalization/successor.ts` | Per-ref blob search across the Store's target-line refs including Archive entries, identity-only matching, unsearched-ref reporting, exactly-one requirement |
| `src/core/store/finalization/spec-actions.ts` | The create/update/delete digest mapping, the precondition blocks, and the `--skip-specs` conflict |
| `src/core/store/finalization/record.ts` | The layout-contract entry address, the frozen-target-line gate, the record draft, and the workspace-pair refusal |
| `src/core/store/finalization/association.ts` | The `association-finalized` phase: index upsert with fail-closed disagreement detection, and the execution-side `finalizedChange` write |
| `src/core/store/finalization/locks.ts` | The two keys taken (scope, change) in child 4's order, and the integration key published defined-and-unheld |
| `src/core/store/finalization/module.ts` | `ChangeFinalization`: `plan` / `apply` / `applyStoredPlan` / `describe`, the plan id, the token, and revalidation |

### Engine seams (four, each small and named)

| Seam | Extension |
| --- | --- |
| `CreateArchivePlanInput` / `ArchivePlan` | optional `finalization: { outcome, record, identity, destination, association, lockKeys }`. Absent for standalone and legacy archives, which behave exactly as today |
| `resolveArchiveTransactionPaths` | an explicit `finalPath` override, asserted to be a direct child of the archive parent so publication stays a same-volume rename from its sibling stage |
| accounting adapters | a v2 trio (`resolveArchiveV2Accounting` / `writeArchiveV2Json` / `verifyArchiveV2Accounting`) dispatched on the PRESENCE of the finalization block, never on file content |
| journal | one new phase, `association-finalized`, between `accounting-finalized` and `source-removed`, with the resume table renumbered and the source-removal region taught to persist the correct last-completed phase |

`archiveDatePrefixedNameMatches` and `parseArchivedRef` now recognize the
`--<instanceShort>` suffix without breaking the un-suffixed form.

### Wired into existing code

- `src/core/store-planning/types.ts` + `internal/resolver.ts`: the
  `finalize-change` intent, `ChangeFinalizationScope`, the `archive-entry`
  typed address (layout contract for Store v2, flat name for standalone and
  legacy), and the authority gate that mirrors project mutation.
- `src/core/archive.ts`: both `store_v2_finalization_unavailable` gates removed,
  `planActivePathIsStorePartition` deleted with its path-substring heuristic,
  the stored-plan gate replaced by revalidation-and-apply, and a
  `runStoreV2Finalization` arm that formats and forwards. The command holds no
  outcome logic.
- `src/cli/index.ts`, `src/core/completions/command-registry.ts`, all three
  locale trees: `--outcome`, `--reason`, `--by`, `--by-target-line`, `--commit`.
- The four generated workflow gate paragraphs.

---

## 2. How the refusal was lifted, and which tests that touched

`store_v2_finalization_unavailable` no longer exists anywhere in `src/`. A
repository-wide grep now returns only the three places that DOCUMENT its
retirement (two comments and one negative assertion in the template guard).

**The grep found a fourth live assertion the task list did not name.** Task 11.5
enumerates three journeys; `test/commands/store-v2-workspace-journey.test.ts:549`
was child 4's task-12.7 proof that finalization stayed closed, and only the
token sweep the portfolio's "one surface is never proof" rule mandates found it.
That site turned out to be the best available fixture — it builds a real Store
v2 pair with real Git on both sides — so it became the real finalization proof
rather than a code rename.

| File | What it asserts now |
| --- | --- |
| `test/commands/store-v2-workspace-journey.test.ts` | The missing-outcome refusal, then a REAL `--outcome abandoned` finalization: the target-line-scoped entry address, the instance suffix, the Archive v2 record's outcome/spec-sync/`workspacePairId`, and the execution association's `finalizedChange` block |
| `test/cli-e2e/store-lifecycle.test.ts` (2 cases) | A migrated Store's archiving requires one explicitly declared outcome, and the refusal names all four; the partition is untouched and no flat namespace reappears |
| `test/cli-e2e/capstone-journeys.test.ts` journey 3 | Same gate reached without any selector |
| `test/commands/store-v2-planning-scope-journey.test.ts` | The missing-outcome refusal AND that a declared outcome does not buy past the identity requirement — this journey's execution side is deliberately not a Git worktree, so `workspace_pair_unavailable` fires and nothing is written |
| `test/core/templates/legacy-store-gate-guard.test.ts` | The legacy refusal survives; the retired deferral is ABSENT; and each finalizing template states its own half of the outcome rule, enumerated per template with its reason |
| `test/commands/store-root-selection.test.ts` | Two comment references updated |

**Judgment call, flagged.** Task 11.5 asks each of the three named journeys to
finalize and assert the record. Two of them cannot without changing what they
are about: `store-lifecycle` and `store-v2-planning-scope-journey` both assert
that the execution checkout is byte-identical after the run, and a successful
finalization deliberately writes the execution-side binding. Rather than weaken
those invariants, the finalize-and-assert-the-record work lives in the workspace
journey (which already has the right fixture and no such invariant), and each
rewritten journey says in a comment where the complete proof lives. Task 13.1's
dedicated journey is not written — see §7.

---

## 3. Two production behaviours the real CLI found

Both were invisible until a journey executed the path, which is the same lesson
children 3 and 4 recorded.

1. **The outcome refusal was unreachable from a planning checkout.** Archiving
   from a Store planning root hit `execution_authority_required` first, so a
   user who had also forgotten `--outcome` was told about the wrong thing and
   the spec's "refuses before any access" scenario could not be satisfied from
   that surface. The outcome request is a pure function of the flags, so it is
   now decided FIRST in a Store v2 scope, before every other precondition
   (`declaredOutcomeDiagnostic` in `src/core/archive.ts`). Found by
   `store-lifecycle.test.ts`, both cases.
2. **A hand-assembled pair cannot finalize, and that is correct.** Archive v2
   requires a verified `workspacePairId` on EVERY record, and the pair is
   derived from the Change instance plus BOTH worktree identities. A fixture
   whose execution root is not a Git work tree has no derivable execution
   identity, so `workspace_pair_unavailable` fires. This is design §11's stated
   tension behaving as specified — refuse, never mint — and it is now pinned by
   the scope journey rather than discovered later.

---

## 4. Gate results

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm exec eslint src test` | clean |
| `pnpm run build` | clean |
| `test/core/store/**`, `test/core/store-planning/**`, `test/core/completions/**` | 67 files, 1193 passed, 15 skipped, **0 failed** |
| `test/core/templates/**` | 11 files, 63 passed |
| `test/core/archive-engine.test.ts`, `archive-consumer-integration.test.ts`, `templates/archive-engine-consumers.test.ts` | 35 passed, 1 skipped |
| `test/cli-e2e/store-lifecycle.test.ts` | 10 passed |
| `test/commands/store-v2-workspace-journey.test.ts` | 2 passed (includes the real finalization) |
| `test/commands/store-v2-planning-scope-journey.test.ts` | 1 passed |
| `git diff --check` | clean |
| Encoding audit (locales) | `ja.json` 3 and `zh-cn.json` 4 U+FFFD, byte-identical counts to `HEAD` — pre-existing, none introduced |

`rasen validate store-finalization-outcomes-v2 --strict` and the full suite were
NOT run by this implementer.

### Pinned template hashes: re-baselined, and the delta proven

`skill-templates-parity.test.ts` pins a SHA-256 per template payload and per
generated skill file. Eight of them moved. Rather than accept the new numbers,
the OLD gate paragraph was substituted back into the CURRENT payload and hashed:
all eight reproduce their OLD pinned hash exactly, which proves the only delta
is the paragraph this change rewrote and nothing else drifted.

```
rasen-archive-change:      payload REPRODUCES old hash; content REPRODUCES old hash
rasen-bulk-archive-change: payload REPRODUCES old hash; content REPRODUCES old hash
rasen-ship:                payload REPRODUCES old hash; content REPRODUCES old hash
rasen-sync-specs:          payload REPRODUCES old hash; content REPRODUCES old hash
```

---

## 5. Judgment calls

1. **The record DRAFT omits `evidence` and `missing`.** The transaction appends
   an `## Archive` section to the staged ship log and captures quality inputs,
   so the published evidence is not the active Change's evidence: any digest
   computed at plan time would be a digest the entry does not have. The plan
   therefore carries a draft plus an `evidenceInventory` of expected PATHS, and
   the writer hashes the published tree and validates the complete record
   immediately before writing. `validateArchiveV2Draft` validates every other
   field at plan time, so "an inconsistent draft produces no file" still holds.
2. **Identity is re-verified at write time, not carried as a brand.** TypeScript
   brands do not survive the plan's serialization, so the finalization block
   carries the portable derivation PREIMAGES (planning scope id, instance seed,
   both worktree instance ids) and `archive-accounting-v2.ts` re-derives both
   identities immediately before serializing. A record whose ids no longer
   derive produces no file. This is stronger than a cast would have been.
3. **`planId` excludes the transaction's instance fields.** The identifier
   covers both halves of the DECISION, but not the random transaction id, the
   engine's own hash, or the stage/journal paths derived from that id —
   otherwise "equal inputs produce an identical plan" would be false for every
   re-plan, which is child 4's defect 1 in a different costume. The token
   additionally carries `archivePlanToken`, which pins the exact transaction.
4. **Target-line facts are resolved locally, not through child 4's
   `StoreTargetLines.resolve`.** This is the fallback design §11 names, taken
   unconditionally: `resolve` looks the code repository up in the machine
   project registry, while the archive plan already names the verified execution
   root. Using the plan's own root avoids a second source of truth for a
   repository the operation is standing in.
5. **`finalization_already_complete` finds the entry by listing the Archive
   line, then decides from the RECORD.** The destination name carries the
   archive date, so a re-run on another day computes a different path; the
   listing is only how the candidate is found, and whether it is this Change's
   entry is decided from `changeInstanceId` inside its `archive.json`. A v1
   record inside a v2 partition is skipped as a relocated legacy entry — never
   read as a variant, never upgraded.
6. **The engine's default association adapter THROWS.** The engine cannot reach
   the machine workspace index without importing the finalization Module, which
   imports the engine. So the default adapter refuses whenever a plan carries a
   non-no-op association, and the Module supplies the real implementation. A v2
   plan applied through the bare engine fails closed instead of silently
   skipping the phase.
7. **`--by-target-line` is validated as superseded-only.** It narrows the ref
   set and nothing else; supplying it with another outcome is refused rather
   than ignored, for the same reason `--outcome` is refused outside a Store v2
   scope.

---

## 6. Something wrong in the plan, stated rather than worked around

Task 11.5 names three journeys to rewrite into journeys that finalize. Two of
them assert, as their central invariant, that the execution checkout is
byte-identical after the run — and design §8.2 requires a successful
finalization to write the execution-side binding. Those two requirements are
incompatible in one test. The resolution taken is in §2; it does not weaken
either journey, and it does leave task 13.1's dedicated journey as the place the
full four-outcome matrix belongs.

Separately, the task list's §12 assumes a management endpoint and a four-way
parity test that this implementer did not reach; see §7.

---

## 7. What is NOT done

Production code is complete for sections 1–11 and task 12.1. What is missing is
the rest of section 12, section 13, and most of the named unit suites.

- **1.2** — no `test/core/archive-standalone-baseline.test.ts`. The standalone
  and legacy paths were kept inert by construction (the finalization block is
  absent) and are covered by the existing archive suites passing unchanged, but
  no dedicated before-snapshot exists.
- **1.4** — the type-level test proving the passive plan variants are not
  assignable to a shape carrying `specActions`. The union is written that way in
  `types.ts`; nothing asserts it.
- **2.4, 2.6** — `finalize-scope.test.ts` and the archive-line containment proof.
- **3.8, 4.8, 5.7, 6.8, 7.7, 8.8, 9.8, 10.7** — the eight named unit suites.
  None exist. `finalization-git-verb-guard.test.ts` (tasks 1.7 + 1.8) and the
  rewritten journeys are the only new tests.
- **6.7** — the byte-identity fixture for a passive outcome. The scope journey
  proves no Archive line is created on a refusal; nothing yet hashes every
  canonical spec across a completed passive finalization.
- **9.6, 9.7** — the concurrency proof and the bounded-retry assertion. The keys
  and the fixed order are child 4's and are exercised by its suites.
- **12.2–12.8** — `--json` finalization reporting is implemented and exercised
  by the workspace journey, but the bulk/ship argv consumers
  (`createGeneratedArchiveConsumerArgv` still has no outcome options), the
  management finalize endpoint and its whitelist entry, the four-way parity
  test, and `archive-outcome-cli.test.ts` are all unstarted. The four workflow
  TEMPLATES are updated; the argv builder and the HTTP route are not.
- **13.1–13.5** — the dedicated finalization journey, the Windows/POSIX
  destination fixtures, the recovery matrix, the legacy-untouched proof, and the
  no-replay proof.
- **14.x** — the archive-ordering preconditions, which belong to the shipper.

Nothing above is blocked; §7 of `handoff/implementer-1.md` names the working set
for each.

## 8. Notes for the reviewer

- The engine edit was made with a patch script that took a wrong slice bound and
  duplicated ~23 KB of `archive-engine.ts`. It was detected immediately by
  marker counts, repaired programmatically, and verified: the file's deletions
  in `git diff` are exactly the twelve intended lines. Worth a reviewer's eye on
  that diff anyway.
- `defaultArchiveEngineAdapters` gained four members. Any test constructing an
  adapter object literally (rather than spreading the default) will need them.
- The finalization Module reuses child 4's `WorkspaceFileSystem` and
  `WorkspaceCoordination` types and their node implementations. It does NOT
  reuse child 4's Git adapter, on purpose: that one can create and remove
  worktrees.
