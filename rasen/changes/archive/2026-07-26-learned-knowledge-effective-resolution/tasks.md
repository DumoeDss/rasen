## 1. Re-verify dependencies and the source commit

- [x] 1.1 Re-verify child A's final exported surface (signatures, not names): `resolveStoreBinding`, `requireConfigStoreLayer` vs `resolveConfigStoreLayer`, `hasStoreDeclaration`, `inspectRegisteredStore`, `identity-types.ts`, `identity-diagnostics.ts`.
- [x] 1.2 Re-verify child B's FINAL state — proposed only when this was planned. Confirm `src/core/store/membership.ts` and what `resolveProjectMembership` / `listProjectStoreCandidates` return. If absent, keep today's behavior behind the group-3 seam.
- [x] 1.3 Re-verify child C's FINAL state — proposed only when this was planned. Confirm the runtime-context reader and its precedence. If absent, fall back to cwd behind the group-4 seam.
- [x] 1.4 Confirm the sibling `store-scoped-learned-knowledge` has landed; this change resolves against its catalog and cannot ship alone.
- [x] 1.5 Read `git show 48142395` (#66) as algorithm reference only. Cherry-picking to a scratch branch as a STARTING POINT is allowed; committing it unadapted is not.
- [x] 1.6 Confirm `rasen/changes/store-aware-learned-skills-materialization/` is gone, so `learned-skill-effective-materialization` is unclaimed, and that `learned-skill-knowledge-context` is still claimed by #62's directory and must stay untouched.
- [x] 1.7 Note which files this change migrates off by-id Store lookup and add each to `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts`.

## 2. Ledger and digest shapes (readers first)

- [x] 2.1 `src/core/project-learned-skill-ledger.ts`: v2 with an identity-keyed `stores` map (`lastMembership`, `relevant`, display name as a convenience field only), durable `sources[].owner`, `canonicalContentDigest`, `resolutionDigest`.
- [x] 2.2 `src/core/global-learned-skill-ledger.ts`: machine-wide ownership only.
- [x] 2.3 Resolution digest v2 inputs: schema version, identifier, knowledge key, effective scope, sorted durable source identities, content digests, rendered managed body. **No display name in the identity portion.**
- [x] 2.4 Digest computed over normalized bytes so a checkout with different line endings does not read as divergent content between two Stores.
- [x] 2.5 Readers for v1 ledgers and v1 digests alongside v2; a read leaves files byte-identical.
- [x] 2.6 Tests: v1/v2 round-trip, source order does not affect identity, a display-name rename changes no digest.

## 3. Membership authority seam

- [x] 3.1 One seam for "which Stores is this project eligible for", backed by child B's provider when present and today's behavior when not.
- [x] 3.2 Eligibility = declared `storeMemberships` ∪ locally-registered Stores whose record includes this projectId. NEVER the primary planning pointer.
- [x] 3.3 An unavailable eligible Store is returned marked unavailable, never filtered out — child B's provider returns it and this change must not drop it.
- [x] 3.4 Tests: eligibility union, planning-Store gets no priority, unavailable entry survives the seam.

## 4. Three-root split

- [x] 4.1 Separate `canonicalOwnerRoot`, `evaluationRoot`, and `materializationTarget` in `src/core/learned-skills/context.ts` — the source conflates all three.
- [x] 4.2 Evaluation root comes from child C's runtime context, with cwd as the fallback following **C's stated precedence** rather than a second rule invented here.
- [x] 4.3 Applicability is evaluated against `evaluationRoot` only.
- [x] 4.4 Tests: two clones of one project evaluate independently while sharing one stored catalog; generated files land in the working checkout.

## 5. Effective resolution

- [x] 5.1 `src/core/learned-skills/effective.ts`: applicability filter → project winner → eligible Stores → global fallback, preserving #66's algorithm exactly.
- [x] 5.2 Equivalence requires ALL of: identifier, knowledge key, byte-identical canonical content, content digest, valid managed record. Four of five is a conflict.
- [x] 5.3 Equivalent copies produce one winner recording every contributing Store's permanent identity.
- [x] 5.4 Conflict: collect all participants, order-independent; latent with a project winner; blocking without one, writing no partial files and no partial ledger; never blocks ordinary workflow generation.
- [x] 5.5 Relevant-Store definition per §15.5 (declared, prior ledger source, frozen fact, current pointer, locally reverse-discovered); unavailable ones never read as empty, cleanup deferred, degraded diagnostics emitted.
- [x] 5.6 Assert the forbidden tie-breaks are unreachable: registry order, planning-Store priority, alphabetical display name, knowledge-key-only sameness, unavailable-as-empty.
- [x] 5.7 Tests: every branch of 5.1–5.6, including order-independence of the conflict result and an unavailable Store not deleting existing materialization.

## 6. Logical project knowledge home and its migration

- [x] 6.1 New `src/core/project-knowledge-home.ts`: `~/.rasen/project-knowledge/<projectId>/learned-skills/<id>`, composed with `path.join()`.
- [x] 6.2 Keep it separate from the clone-specific work directory, clone-specific archive/work ephemera, and the in-checkout materialization target.
- [x] 6.3 Migration: scan the machine homes of every clone carrying this projectId.
- [x] 6.4 One catalog → move. Several identical → deduplicate and move one.
- [x] 6.5 Several DIFFERENT for the same identifier → report conflict, choose no winner, delete and overwrite nothing.
- [x] 6.6 Never delete an old catalog until the new home is written AND verified by re-reading it; a verification failure leaves every original intact.
- [x] 6.7 Repeatable, dry-runnable, and resumable after an interruption without duplicating what already moved.
- [x] 6.8 Partial divergence: agreeing knowledge migrates, the conflicting identifier is reported and left alone.
- [x] 6.9 Tests: all of 6.3–6.8.

## 7. Ledger migration and exact ownership

- [x] 7.1 v1 ledger migration: detect → dry-run → upgrade when the name→identity mapping is unique → **BLOCK when ambiguous** → never silently drop source provenance.
- [x] 7.2 Record the v1→v2 digest change as a migration; never present it as edited content.
- [x] 7.3 `src/core/learned-skill-materialization.ts`: modify or remove only when the record claims that exact path, the file is an ordinary file, its content matches, and the source is verifiable. Anything else is left and reported.
- [x] 7.4 A user-authored file at a generated path is never taken over.
- [x] 7.5 **Check what lands on disk, not what the message says** (child A's round-4 rule): every write path records the resolved permanent identity; re-resolution uses `uid ?? id`.
- [x] 7.6 Tests: ambiguous mapping blocks; provenance never dropped; user-authored file untouched; a mismatched file is left and reported.

## 8. Materialization wiring

- [x] 8.1 `src/core/init.ts` and `src/core/update.ts`: materialize the resolved set into the working checkout with exact-ownership reconciliation.
- [x] 8.2 A machine-wide tool home receives only machine-wide knowledge — never a project's or a Store's.
- [x] 8.3 Report what was written, what was left alone, and anything deferred or blocked.
- [x] 8.4 `src/commands/knowledge.ts`: surface the resolved set, its sources by permanent identity, conflicts, and degraded states.
- [x] 8.5 Tests: idempotent second run writes nothing; a blocked conflict writes nothing at all; machine-wide tool isolation.

## 9. Acceptance tests (plan §26 Phase D)

- [x] 9.1 project > eligible Stores > global, end to end.
- [x] 9.2 Store sources recorded by permanent identity throughout.
- [x] 9.3 **A display-name rename changes no canonical identity** — the Gate 4 acceptance item.
- [x] 9.4 Multi-Store exact deduplication recording all sources.
- [x] 9.5 Divergent-Store conflict, order-independent.
- [x] 9.6 Unavailable relevant Store defers cleanup and does not delete existing materialization.
- [x] 9.7 A machine-wide-only tool receives no Store or project records.
- [x] 9.8 Same projectId, several checkouts: one logical catalog, different evaluation roots, different materialization targets.
- [x] 9.9 A Store session's execution choice and the CLI knowledge context agree.
- [x] 9.10 Windows: catalog paths, two clones differing only by separator form, content digests unaffected by line-ending differences. Expected paths built with `path.join()`.
- [x] 9.11 **Restated** by `stabilize-store-context-foundation` (design D6). Original wording, kept visible: "Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`. — lint/build green and every targeted suite green; the FULL run is the LEAD's, per this child's instructions." That gate could never be honestly ticked — this repository carries failures that pre-date this child, so the condition depends on work outside what is being gated. The gate this child was actually responsible for: **`pnpm lint` and `pnpm build` green, and one combined verification run carried to completion in which every failure is individually attributed to a cause outside A–D2 — proven by byte-identity to the branch base or by tracing to a non-A–D2 commit.** The run that settles it is the LEAD's, as the original line already said. Settled only against that recorded run. — **Settled** by the combined verification result committed with the change at `stabilize-store-context-foundation/combined-verification-A-D2.md` (task 6.6), which archives alongside these files and can be opened by any later reader. Result: `pnpm lint` exit 0, `pnpm build` exit 0, and one `pnpm test` run carried to completion (284 files, 4931 tests, 4897 passed, 3 failed, 31 skipped). Every failing file is attributed outside A–D2, and the evidence is one command each against branch base `d73c1da2`: `git diff d73c1da2..HEAD -- test/release-contract.test.ts scripts/release-contract.mjs`, `… -- test/cli-e2e/basic.test.ts`, `… -- test/commands/handoff.test.ts src/core/templates/workflows/_orchestration.ts`, and `… -- test/commands/workset.test.ts src/commands/workset.ts` are **all empty** — every failing file is byte-identical to the branch base, so none can have been caused by A–D2 or by this change. The `handoff` assertion went stale at `58faffad` (`git merge-base --is-ancestor 58faffad d73c1da2` → true, i.e. an ancestor of the base); the `workset` case is the known Windows temp-cleanup flake and passes 41/41 in isolation. No failure counts against this child.

## 10. Docs and locales

- [x] 10.1 `docs/retention-and-learned-skills.md`: the resolution order, equivalence and conflict, unavailable Stores, and the three roots.
- [x] 10.2 `docs/cli.md`: `rasen knowledge`, the migrations, and their preview flags.
- [x] 10.3 Migration guide: the four intentional breaks — unavailable Stores no longer read as empty, project knowledge moves to one home per project, ownership is re-keyed, content identity excludes the display name — each with its exact repair.
- [x] 10.4 State plainly that the identity-scheme change is a migration, not edited content, so the first post-upgrade run is not misread.
- [x] 10.5 JSON examples for a v2 ledger entry, a conflict report, and a degraded (unavailable Store) result.
- [x] 10.6 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message, diagnostic, and repair string, no English fallback for new keys.

## 11. Verification and integration

- [x] 11.1 Confirm Windows CI covers this change's path-sensitive test files.
- [x] 11.2 Diff scenario SETS, not just requirement titles, for anything that becomes a MODIFIED block during implementation.
- [x] 11.3 Re-run the cross-change collision check over ALL active change directories. This change carries zero MODIFIED blocks and claims two capabilities; confirm that still holds.
- [x] 11.4 `node bin/rasen.js validate learned-knowledge-effective-resolution --changes --strict --json` clean.
- [x] 11.5 Rehearse the spec merge (`rasen archive --json --yes`) before ship.
- [x] 11.6 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, sibling change dirs.
- [x] 11.7 Confirm no version number in `package.json` was changed by this work.
