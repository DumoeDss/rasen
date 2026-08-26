# Triage — rehearse-legacy-store-layout-migration

Every observation the rehearsal surfaced, classified against the criteria design
D4 fixed **before** any evidence existed:

- **(a) defect** — behavior contradicts design SS11/SS15/SS16 or this change's
  spec deltas. Fix + guard here, unless sibling-owned.
- **(b) correct-but-illegible** — the refusal is right, but the message does not
  name the item, the reason, or a workable repair. Message/diagnostic fix only.
- **(c) correct-and-legible** — recorded as passing evidence.
- **(d) out-of-scope-real** — a real defect in a sibling-owned seam or a deeper
  design gap. Recorded and handed over, never fixed here.

A refusal is never "gotten past" by weakening a gate. Every category-(a) fix must
keep every existing fail-closed test green.

## Table

| # | Observation | Evidence | Class |
|---|---|---|---|
| O1 | An empty legacy flat store plans to zero items, so `applicable = blockers.length === 0 && frozenItems.length > 0` (plan.ts:1048) is false with **zero blockers**, and the human preview prints the self-contradictory `Not applicable: 0 item(s) unresolved or blocked`. | `01-pristine/01-preview-human.txt`, `02-preview-json.txt` | **(a)** |
| O2 | `--apply` on that store re-renders the same preview and exits 1 with **no error, no code, no diagnostic** — `store-migrate-layout.ts:278-283` handles a missing token by re-printing the plan. | `01-pristine/05-apply-attempt.txt` | **(a)** (same seam as O1) |
| O3 | No plan file is persisted for an inapplicable plan (`module.ts:159-167` writes only when a token exists), so `--apply` can never consume one. Mechanism, correctly implemented. | `01-pristine/10-write-surface.txt` | (c) |
| O4 | A partition write is refused with `legacy_flat_store_requires_migration`, whose fix says to run `rasen store migrate-layout rasen-store` and retry — and that command is itself refused (O1). A closed repair loop: the store cannot leave the legacy layout by any supported route. | `01-pristine/08-partition-write-probe.txt` + `01-preview-human.txt` | **(a)** |
| O5 | The **human** path of `store adopt` prints a raw Node stack trace and an unhandled-rejection dump instead of the formatted `code: message / fix:` the `--json` path renders. `runAdopt` rethrows in the non-JSON branch (`store-migration.ts:136`, also :343 and :397) and `bin/rasen.js` calls `runCli()` with no top-level catch. | `01-pristine/08-partition-write-probe.txt` vs `09-partition-write-probe-json.txt` | **(b)** |
| O6 | `--retire-flat` and `--rollback` with no recorded run refuse with `migration_run_missing`, whose fix points at `rasen store migrate-layout <store-id>` — a dead-end pointer for exactly the store shape that cannot plan (O1). Collapses once O1 is fixed. | `01-pristine/06-retire-flat-attempt.txt`, `07-rollback-attempt.txt` | **(b)** |
| O7 | Fail-closed attribution works exactly as designed: `unknown-owner`, `evidence-conflict` (E2 adoption list vs E3 machine association, both projects listed), `non-member-owner`, `missing-target-line`, `dirty-source` and `shared-spec` each block apply, and each names the item, the reason class, and the exact mapping key. | `02-enriched/02-preview-human.txt`, `03-preview-json.txt` | (c) |
| O8 | The `non-member-owner` repair — "Declare changes.<name>.project in the mapping file" — is **refused by the mapping validator** when the item records an identity: `mapping-contradicts-recorded-identity`. The only repair that works (make the recorded project a member) is never named. | `02-enriched/07-mapping-repairs-non-member.txt` then `08-add-project-gamma-the-real-repair.txt` | **(a)** |
| O9 | A non-kebab UTF-8 **Change directory name** is reported as `unrecordable-identity` — "the named project id fails the v2 portable identifier contract" — but the project id is portable; `parseChangeId` rejects the directory name. Half the offered repair ("declare a portable owner in the mapping file") cannot work. It is also masked until a target line is declared, because the target-line check runs first. | `02-enriched/09-replan-with-mapping.txt`, `10-rename-unrecordable-item.txt` | **(b)** |
| O10 | A legacy **archive entry** has no E2/E3 route at all: `adoption.changes` name lists push evidence under `change:<name>` only (`evidence.ts:180-188`), so an archive entry resolves only via its own `archive.json` (E1) or the mapping (E4). Design-consistent, undocumented. | `02-enriched/02-preview-human.txt` (the `2026-01-02-archive-bare` row resolves to unknown-owner) | (c) + note |
| O11 | Mapping refusals are whole-file and precise: contradicts-recorded-identity, names-an-item-the-inventory-does-not-contain, outside-the-worktree, file-missing. | `02-enriched/04-mapping-contradicts-recorded-identity.txt`, `05-mapping-outside-worktree.txt`, `06-mapping-names-absent-item.txt`; `03-clone/09b-preview-silent-identity-hole.txt` (first run) | (c) |
| O12 | Apply publishes 15 paths, writes the receipt, flips `layoutVersion: 2` **last**, prints a pathspec-scoped commit suggestion and never touches the git index. Published partitions are byte-identical to their flat sources, and UTF-8 (Chinese) capability and file names survive to the partition destinations unchanged. | `02-enriched/12-apply.txt`, `15-publication-verification.txt` | (c) |
| O13 | The recovery manifest is machine-local, version 2, `runId != planId`, and carries 15 `createdPaths`, 4 `replacedFiles` (verbatim previous bytes) and a 15-entry operations ledger; `--status` renders it. | `02-enriched/15-publication-verification.txt`, `13-status-after-apply.txt`, `14-status-after-apply-json.txt` | (c) |
| O14 | `--retire-flat` succeeds while the publication is still **uncommitted**, although `migration_retire_without_publication` instructs "Publish first ..., commit it, then retire". The gate is `manifest.phase === 'published'` plus the receipt file existing (`module.ts:428-441`); nothing checks the commit. The message states an order the flow does not enforce. | `02-enriched/16-retire-before-commit.txt` | **(b)** |
| O15 | Retirement is idempotent: the second run completes and re-prints the commit suggestion. | `02-enriched/17-retire-again-idempotence.txt` | (c) |
| O16 | Rollback after retirement refuses with `migration_rollback_after_retirement` and names Git as the recovery path. | `02-enriched/18-rollback-after-retirement.txt` | (c) |
| O17 | Rollback before retirement removes exactly what the run created and restores every overwritten file byte-for-byte — `git status --porcelain` is clean afterwards and the store reads as a legacy flat store again. | `02-enriched/25-rollback-before-retirement.txt`, `26-post-rollback-state.txt` | (c) |
| O18 | After a completed `--rollback`, `--resume` is wedged: `migration_recovery_ambiguous` — "Completed operation .rasen-store/target-lines/main.yaml no longer has exactly one destination copy", fix "Leave the paths untouched and inspect the recovery manifest". The manifest keeps its completed-operations ledger with phase `rolled-back`, and the ownership verifier reads the rollback's own deletions as ambiguity. A fresh `--apply` recovers, so nothing is lost — but the repair text leads nowhere. | `02-enriched/27-plan-stale-on-resume.txt`, `28-recovery-after-wedged-resume.txt` | **(b)** |
| O19 | `migration_plan_stale` is **not reachable through the shipped CLI's normal flow**: `--apply` re-plans in the same process, so an edit "between plan and apply" is either seen by the fresh plan as `dirty-source` (uncommitted) or silently absorbed (committed). The digest revalidation that raises staleness runs only on the recovery path, which is gated earlier by O18 or `migration_run_missing`. The protection is real in code and fixture-covered with injected faults; no operator meets it. | `02-enriched/23-stale-uncommitted-edit.txt`, `27-plan-stale-on-resume.txt` | (c) + coverage statement |
| O20 | Rollback and retirement leave empty directory scaffolding in the Store worktree (`rasen/projects/<id>/...`, `.rasen-store/target-lines/`, `.rasen-store/migration/receipts/`, `.rasen/migration/staging/`). Git ignores empty directories, so nothing is committed and no gate is affected. | `02-enriched/21-post-retirement-tree-and-receipt.txt`, `26-post-rollback-state.txt` | (c) cosmetic |
| O21 | Remote-tracking refs are surveyed and classified `flat`, but `otherFlatRefs` filters to `kind === 'local-branch'` (`plan.ts:1063`), so three flat `refs/remotes/origin/*` refs were surveyed and **none was reported**; the human preview printed no "other refs" section at all. `inventory.refs` carries them, but only in `--json`. | `03-clone/11-remote-tracking-ref-reporting.txt` | **(b)** |
| O22 | Registering an identity-less store emits an INFO `store_registry_rekey_blocked` diagnostic naming the exact repair. | `03-clone/00a-register-no-yes.txt` | (c) |
| O23 | An **empty** identity-less store never reports the identity problem at all — the blocker attaches only to items of kind `change` (`plan.ts:707-718`) — and after following `upgrade-identity --apply` to completion it still dead-ends on O1. | `03-clone/01-preview.txt`, `03-upgrade-identity-apply.txt`, `04-replan-after-identity.txt` | **(a)** (same seam as O1) |
| O24 | A legacy flat store with real content, **no active changes**, and no permanent identity reports `applicable: true`, `token: null`, prints "Ready to apply. Re-run with --apply." and exits 0; `--apply` prints the identical text and exits 1 with no diagnostic. The preview affirmatively states the opposite of the truth. | `03-clone/09b-preview-silent-identity-hole.txt`, `09c-apply-attempt-silent-identity-hole.txt`, `09d-preview-json-silent-identity-hole.txt`, `10-identity-hole-analysis.txt` | **(a)** sharpest finding |
| O25 | With active changes present, `store-identity-missing` blocks each of them with the exact repair, and following it makes the plan applicable. The designed path works. | `03-clone/06-preview-store-identity-missing.txt`, `07-upgrade-identity-apply.txt`, `08-replan-after-identity.txt` | (c) |
| O26 | `store upgrade-identity` **preview** prints a candidate uuid that is not the uuid `--apply` mints (`40ff165f-...` previewed, `7ec12a39-...` applied). A reader could reasonably record the previewed value. | `03-clone/02-upgrade-identity-preview.txt` vs `03-upgrade-identity-apply.txt` | **(d)** sibling A seam |

## Class counts

| Class | Count | Ids |
|---|---|---|
| (a) defect | 6 | O1, O2, O4, O8, O23, O24 |
| (b) correct-but-illegible | 6 | O5, O6, O9, O14, O18, O21 |
| (c) correct-and-legible | 13 | O3, O7, O10, O11, O12, O13, O15, O16, O17, O19, O20, O22, O25 |
| (d) out-of-scope-real | 1 | O26 |

O1/O2/O23/O24 are one seam, not four: `applicable` was computed from item
blockers alone (`plan.ts:1048`), while the apply token carried a second,
unreported precondition (`storeUid !== undefined`, `plan.ts:1096-1105`), and both
store-level blocks were implemented by stamping a reason onto items that may not
exist (`plan.ts:695-718`). One fix closes all four; O4 and O6 collapse with them.

**O24 is worse than O1, and the severity order matters.** The empty-store dead
end (O1) refuses loudly: annoying, but safe and diagnosable — the operator knows
something is wrong and can see what the tool claims. O24 prints a SUCCESS message
on a failure path and names nothing: `Ready to apply. Re-run with --apply.` at
exit 0, then the identical text at exit 1, with no code, no message, and no fix
anywhere in the output. An operator following the tool's own instructions has no
way to learn what is wrong. A loud refusal is a bug; a success message on a
failure path is a trap.

## Handovers

- **O26 -> sibling A (`fix-store-retention-scope-resolution`)**: `rasen store
  upgrade-identity` previews one uuid (`40ff165f-37dc-4bf6-86f3-0e6ef12bd62a`)
  and applies another (`7ec12a39-294f-4fcd-be0f-c68e05b19829`). The minting lives
  in `src/core/store/identity.ts`, which this change must not edit. Written up in
  full — reproduction, both uuids, evidence paths, and why the mismatch matters
  for anything keyed by the Store identity — in
  `handoff/to-sibling-a-upgrade-identity-uuid-mismatch.md`.
- No finding implicated `src/core/store-planning/internal/resolver.ts`,
  `src/core/store/workspace/plan.ts`, or `src/core/store/workspace/apply.ts`.
- **Characterization only, not a fix target**: the real store's committed
  `rasen/config.yaml` carries the orphan root projectId
  `865e2da5-4cc2-4411-bc53-73ac49e01e13`, which appears in no v2 catalog. This is
  the third instance of the pattern on this machine and is sibling A's D1 seam.
  The migration flow never reads it, and the rehearsal never touched it.

## Ship summary: what the SS15 migration rows honestly carry now

"Real" below means: the shipped CLI binary, resolved through the machine store
registry by store id, on the real Windows host, against a disposable copy of the
user's actual legacy flat store. It does NOT mean real content — the stage-2
content is authored (design D2 states this), so a row marked real is claiming
CLI + registry + host + lineage realism, which no existing suite has at all.

| SS15 migration row | Coverage after this change | Evidence |
|---|---|---|
| adoption journal uniquely recovers projectId | **Real.** An `adoption.specs` name list resolved a capability, and an adoption list disagreeing with a machine association produced `evidence-conflict` naming both projects. | `02-enriched/02-preview-human.txt`, `09-replan-with-mapping.txt` |
| two projects' same-name Change no-clobber | **Fixture only.** The rehearsal never produced two same-named Changes in different projects; `destination-exists` and the case-fold check stay fixture-covered. | `layout-migration-plan-gates.test.ts`, `layout-migration-windows-paths.test.ts` |
| unknown / conflict / shared-spec block apply | **Real.** All three fired against the real CLI and each blocked apply with a named repair; the mapping resolved them and the re-plan became applicable. | `02-enriched/02-preview-human.txt`, `03-preview-json.txt`, `09-replan-with-mapping.txt`, `11-replan-applicable.txt` |
| Windows case/drive, UTF-8 names, long paths | **Split.** UTF-8 is real: a Chinese capability directory and a Chinese file name inside a Change published byte-identically to their partition destinations, and a non-kebab Chinese Change name refused with a message this change had to fix. Mixed-case drive spelling and MAX_PATH crossing stay fixture-only; long paths cannot be exercised through real `git init` / `git -C` on this host at all, because git chdirs before reading `core.longpaths` (design Non-Goals). | `02-enriched/15-publication-verification.txt`, `10-rename-unrecordable-item.txt` |
| recoverable failure at any copy/rename/manifest step | **Fixture only for the FAILURE.** A mid-apply fault cannot be induced through the shipped CLI, so injected-fault coverage remains the only source. What is real: the recovery manifest itself (machine-local, version 2, `runId != planId`, 15 createdPaths, 4 verbatim `replacedFiles`, a 15-entry operations ledger), `--status`, a full `--rollback` that restored every overwritten file byte-for-byte, idempotent retirement, and rollback-after-retirement refusing toward Git. | `02-enriched/13-status-after-apply.txt` through `18-rollback-after-retirement.txt`, plus `25-rollback-before-retirement.txt` and `26-post-rollback-state.txt` |
| multiple flat refs fully reported | **Real, and it was incomplete.** A second local branch was always reported with its per-ref command. Three surveyed `refs/remotes/origin/*` refs carrying the flat layout were reported nowhere in the human output; this change reports them. | `03-clone/11-remote-tracking-ref-reporting.txt`, `04-postfix/10-identity-hole-preview.txt` |

## Accepted knowns (recorded, not fixed)

- **O19 — `migration_plan_stale` is unreachable through the CLI.** `--apply`
  re-plans in the same process, so an edit "between plan and apply" is seen by
  the fresh plan as `dirty-source` or absorbed silently. The digest
  revalidation exists and is fixture-covered; no operator meets it. Making it
  reachable would mean changing the command's plan-then-apply shape, which is a
  design decision, not a defect fix.
- **O10 — legacy archive entries have no E2/E3 route.** `adoption.changes`
  name lists key evidence as `change:<name>` only, so an archive entry resolves
  from its own `archive.json` or the mapping file, never from an adoption list.
  Design-consistent; recorded because the design does not say it anywhere.
- **O20 — empty directory scaffolding survives rollback and retirement**
  (`rasen/projects/<id>/...`, `.rasen-store/target-lines/`,
  `.rasen-store/migration/receipts/`, `.rasen/migration/staging/`). Git ignores
  empty directories, so nothing is committed and no gate is affected.

## Fixed by this change

The primary fix is **one seam, not a set of patches**. `applicable` was computed
from item blockers alone, while the apply token separately required a Store
identity, a checked-out ref, and a commit -- and nothing reconciled the two.
Every apply-token precondition is now enumerated in one place and reported as a
named blocked item on the Store's own metadata (a new `store-metadata`
`MigrationItemKind`), so "this plan is applicable" and "a token can be minted for
this plan" are the same statement for every Store shape. A runtime invariant
(`migration_plan_gate_desync`) fails loudly if a precondition is added to the
token later without a matching blocker, so the defect CLASS is closed rather than
its two instances.

| Triage | Fix | Guard (red against the pinned committed tree first) |
|---|---|---|
| O1, O2, O4, O6, O23, O24 | The seam, above: `applicable = blockers.length === 0`, every token precondition reported as a blocker, the invariant asserted, readiness read from the token, and `--apply` reporting a diagnostic instead of reprinting the plan. | `reproduces the dead end and then completes a trivial migration`; `retires the empty flat tree once published, idempotently`; `refuses and names the identity repair when nothing but Changes could carry the block`; `names the missing identity even when the Store is completely empty`; `reports a refusal instead of "Ready to apply" when the plan cannot be applied`; and the five-shape invariant table `never reports readiness it cannot back` |
| O5 | `runAdopt` / `runRelocate` / `runHomePrune` render the diagnostic through the shared failure contract in BOTH modes, exactly as the neighbouring `runEject` already did. Adapter-level only: no global catch, no behavior change, no other command's error contract touched. | `names the legacy-layout refusal and its fix instead of throwing to the top level` |
| O8 | A non-member owner the item ITSELF recorded is repaired by membership, not by a mapping entry the validator refuses. | `sends a non-member RECORDED owner to membership, not to the mapping file that refuses it` |
| O9 | `unrecordable-identity` names which id failed -- the owner project id or the item name -- and offers the repair that matches. | `blames the item name, not the project id, when the name cannot address a v2 destination` |
| O21 | Surveyed flat refs that are not local branches are reported under their own heading, stating they are migrated where they live. Migration still acts only on the checked-out ref. | `lists a remote-tracking ref that still carries the flat layout, and says it is migrated elsewhere` |
| (introduced by the seam fix) | `planGateError`'s fix text no longer calls the mapping file "the only escape hatch" when a blocker is `blocked` rather than `unresolved` -- the Store-identity block is. | `does not offer the mapping file as the escape hatch for a blocked item` |

Two invariants are asserted directly, across five Store shapes rather than
through any single one, because they are what would have caught both halves of
the seam: **no plan renders "Ready to apply" while its token is undefined**, and
**exit code and rendered text agree about success -- a non-zero exit names a
reason.**

Four tests are green on BOTH sides on purpose: the two deliberate regression
guards (`still refuses an empty-blocker gate it should refuse`, `keeps blocking
every active Change when the Store has no identity`) and the two invariant shapes
that already held before the fix. They assert that nothing fail-closed was
weakened, which is the constraint the whole fix had to satisfy. Pre-fix the suite
is 15 failed / 4 passed; post-fix 19 passed.

## Deferred, with reason

- **O14 (b)** -- `--retire-flat` succeeds while the publication is still
  uncommitted, though its refusal text instructs "commit it, then retire". Real,
  but not on the wedge path, and recoverable: the publication and the retirement
  land in the same working tree and the operator commits both.
- **O18 (b)** -- after a completed `--rollback`, `--resume` is wedged with
  `migration_recovery_ambiguous` whose repair leads nowhere. A fresh `--apply`
  re-plans and republishes, so nothing is lost; the cost is a confusing message
  on a path the operator can leave.

Both are recorded here so they stay findable, and both are named in this change's
completion report for the G2 tranche plan.

## Operator-facing note

The real `rasen-store` is **unmigrated**, by design. Nothing in this change
touched it: `git -C <real-store> status --porcelain`, its HEAD, both file
digests, and the real machine registry all match the baseline recorded before
the first rehearsal step (`00-harness/05-teardown-and-real-store-untouched.txt`).
`04-postfix/` is the runbook for migrating it when the operator chooses to: the
same commands, in order, against a copy of the same store, with their real
output. Its committed metadata is still `version: 1` with no permanent identity,
so the first step there is `rasen store upgrade-identity rasen-store --apply`
followed by a commit — otherwise the migration refuses, which after this change
it now says out loud.
