## 1. Re-verify dependencies and the source commit

- [x] 1.1 Re-verify child A's final exported surface (signatures, not names): `resolveStoreBinding`, `requireConfigStoreLayer` vs `resolveConfigStoreLayer`, `hasStoreDeclaration`, `inspectRegisteredStore`, `identity-types.ts`, `identity-diagnostics.ts`.
- [x] 1.2 Re-verify child B's FINAL state — proposed only when this was planned. Confirm whether `src/core/store/membership.ts` exists and what `resolveProjectMembership` returns. If absent, keep today's behavior behind the group-4 seam and do not block.
- [x] 1.3 Read `git show 5fa32300` (#65) as algorithm reference only. Cherry-picking to a scratch branch as a STARTING POINT is allowed; committing it unadapted is not.
- [x] 1.4 Confirm `rasen/changes/store-aware-learned-skills-scope/` is gone, so `store-scoped-learned-skills` is unclaimed.
- [x] 1.5 Confirm `learned-skill-knowledge-context` is still claimed by the unarchived `store-aware-learned-skills-context` (#62) directory, and leave it untouched.
- [x] 1.6 Note which files this change migrates off by-id Store lookup and add each to `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts`.

## 2. Identity and schema foundations (readers first)

- [x] 2.1 `src/core/learned-skills/types.ts`: durable source refs keyed on permanent Store identity, importing child A's `identity-types.ts` rather than redeclaring.
- [x] 2.2 `src/core/learned-skills/schema.ts`: versioned Store record schema plus its serializer, following the `.strict()` convention — a new key needs the schema AND the serializer, not just the interface.
- [x] 2.3 Reader for earlier-version records; assert a read leaves files byte-identical.
- [x] 2.4 Sorting helper keyed on permanent identity or a stable canonical serialization — never the display name.
- [x] 2.5 Tests: version round-trip, strictness, older records readable, sort stability across a display-name rename.

## 3. Store catalog

- [x] 3.1 `src/core/learned-skills/stores.ts`: the Store canonical catalog, reached only through `resolveStoreBinding` / the tri-state — never `listRegisteredStores().find(id)`.
- [x] 3.2 Catalog paths composed with `path.join()` under the Store's metadata directory.
- [x] 3.3 Two Stores sharing a display name keep distinct, separately attributable records.
- [x] 3.4 Tests: catalog read/write round-trip, same-display-name Stores stay distinct, reads never rewrite.

## 4. Membership authority seam

- [x] 4.1 One seam for "is this project a member of this Store", backed by child B's `resolveProjectMembership` when present and today's behavior when not.
- [x] 4.2 Membership comes from the Store's own records — NEVER the project's primary planning pointer.
- [x] 4.3 Tests: a member counts, a non-member does not, and the planning pointer confers nothing.

## 5. Evidence and approval

- [x] 5.1 `src/core/learned-skills/authority.ts`: publication evidence from the Store's member projects, counted per distinct project.
- [x] 5.2 Repeated evidence from one project counts once.
- [x] 5.3 Evidence from a non-member does not count; the refusal names the missing membership and the command that adds it.
- [x] 5.4 Promotion evidence: more than one distinct project, homogeneous sources; a shared identifier alone is not proof of sameness.
- [x] 5.5 Approval is explicit and scope-bound; never inferred from a narrower approval, from silence, or from existence at a narrower scope.
- [x] 5.6 A refused publication or promotion writes nothing at all — no record, file, or ownership entry.
- [x] 5.7 Tests: every branch of 5.1–5.6, including that a refusal leaves the Store byte-identical.

## 6. Mutation safety

- [x] 6.1 `src/core/learned-skills/mutate.ts`: modify only records the catalog declares it owns.
- [x] 6.2 Never modify or delete a user-authored file at a catalog path.
- [x] 6.3 Atomic temp-then-rename writes; an interruption leaves no partial record and the catalog reads exactly as before.
- [x] 6.4 Never stage, commit, or push; print the files the user needs to commit.
- [x] 6.5 **Check what lands on disk, not what the message says** (child A's round-4 rule): every write path records the resolved permanent identity; re-resolution uses `uid ?? id`. A raw selector reaching a Git-tracked write was A's most expensive defect.
- [x] 6.6 Tests: exact ownership, user-authored file untouched, interrupted mutation leaves no partial record, no git index write.

## 7. Command surface

- [x] 7.1 `src/commands/knowledge.ts`: publish into a Store, request promotion, and record approval — each reporting the Store by its resolved name with the permanent identity available.
- [x] 7.2 Report evidence held and evidence missing on a refusal, with a copy-pasteable next command.
- [x] 7.3 Tests: human and JSON output report the same facts and the same next command.

## 8. Acceptance tests

- [x] 8.1 **A display-name rename changes no record** — the acceptance item the sibling change's content identity depends on.
- [x] 8.2 Ordering never changes when a display name is renamed.
- [x] 8.3 A Store can hold and publish knowledge with nothing consuming it — the independent-shippability proof for this half of the split.
- [x] 8.4 Windows: catalog write-and-read-back under a Windows Store root; expected paths built with `path.join()`; content digests unaffected by line-ending differences.
- [x] 8.5 **Restated** by `stabilize-store-context-foundation` (design D6). Original wording, kept visible: "Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`. — `pnpm lint` and `pnpm build` are clean. The LEAD reserved the full `pnpm test` run for itself before ship (two concurrent vitest batches produced spurious timeouts for another worker), so this stays open by instruction; a broadened targeted sweep of every affected area is green." That gate could never be honestly ticked — this repository carries failures that pre-date this child, so the condition depends on work outside what is being gated. The gate this child was actually responsible for: **`pnpm lint` and `pnpm build` green, and one combined verification run carried to completion in which every failure is individually attributed to a cause outside A–D2 — proven by byte-identity to the branch base or by tracing to a non-A–D2 commit.** The run that settles it is the LEAD's, as the original line already said. Settled only against that recorded run. — **Settled** by the combined verification result committed with the change at `stabilize-store-context-foundation/combined-verification-A-D2.md` (task 6.6), which archives alongside these files and can be opened by any later reader. Result: `pnpm lint` exit 0, `pnpm build` exit 0, and one `pnpm test` run carried to completion (284 files, 4931 tests, 4897 passed, 3 failed, 31 skipped). Every failing file is attributed outside A–D2, and the evidence is one command each against branch base `d73c1da2`: `git diff d73c1da2..HEAD -- test/release-contract.test.ts scripts/release-contract.mjs`, `… -- test/cli-e2e/basic.test.ts`, `… -- test/commands/handoff.test.ts src/core/templates/workflows/_orchestration.ts`, and `… -- test/commands/workset.test.ts src/commands/workset.ts` are **all empty** — every failing file is byte-identical to the branch base, so none can have been caused by A–D2 or by this change. The `handoff` assertion went stale at `58faffad` (`git merge-base --is-ancestor 58faffad d73c1da2` → true, i.e. an ancestor of the base); the `workset` case is the known Windows temp-cleanup flake and passes 41/41 in isolation. No failure counts against this child.

## 9. Docs and locales

- [x] 9.1 `docs/retention-and-learned-skills.md`: what a Store catalog is, what may be published into it, and the evidence and approval rules.
- [x] 9.2 `docs/cli.md`: the `rasen knowledge` publication, promotion, and approval surface.
- [x] 9.3 JSON examples for a Store catalog record and a refusal report.
- [x] 9.4 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message and refusal string, no English fallback for new keys.

## 10. Verification and integration

- [x] 10.1 Confirm Windows CI covers this change's path-sensitive test files. — `.github/workflows/ci.yml` `test_matrix` includes `windows-latest` (`windows-pwsh`) and runs `pnpm test`, so every new file is covered without a per-file listing to keep in sync.
- [x] 10.2 Diff scenario SETS, not just requirement titles, for anything that becomes a MODIFIED block during implementation. — no MODIFIED block was added; the check is vacuous and was re-confirmed mechanically.
- [x] 10.3 Re-run the cross-change collision check over ALL active change directories. This change carries zero MODIFIED blocks and claims one capability; confirm that still holds.
- [x] 10.4 `node bin/rasen.js validate store-scoped-learned-knowledge --changes --strict --json` clean.
- [x] 10.5 **Restated** by `stabilize-store-context-foundation` (design D6, review round 1). Original wording, kept visible: "Rehearse the spec merge (`rasen archive --json --yes`) before ship. — deliberately not run: archive MOVES change directories and this worker was instructed not to commit or stage. The merge is a pure addition (one NEW capability, zero MODIFIED, unclaimed in `rasen/specs/` and in all 22 active change dirs with specs), so nothing can be clobbered; the LEAD runs the rehearsal at ship." **The rehearsal this gate names was never performed**, so it cannot be ticked as written. The gate this child was actually responsible for: **the spec merge for this change is proven to succeed.** Settled by the archive that actually ran — `04a0eed7` ("archive store-scoped-learned-knowledge and sync the Store catalog into main specs") — which performed the very merge the rehearsal was a proxy for, and succeeded. A completed merge is strictly stronger evidence than a rehearsal of it; recording the substitution here rather than ticking silently is the point. The completed merge also confirms the pure-addition prediction the original line makes.
- [x] 10.6 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, sibling change dirs.
- [x] 10.7 Confirm no version number in `package.json` was changed by this work.
