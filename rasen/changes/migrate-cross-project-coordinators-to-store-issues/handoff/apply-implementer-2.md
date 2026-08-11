# Apply handoff — implementer 2

## Status

HANDOFF after a verified 20-task slice. The Change is at 20/60; no commit, push, PR, or `.rasen/**` edit was made by this worker.

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-store-coordinator-migration-017`

Branch: `feat/store-owned-coordinator-migration-0.1.7`

## Tasks completed

- 1.1–1.4: compatibility fixtures, mapping-v1 canonical characterization, receipt-v1 compatibility coverage, and public Issue/runtime schema guards.
- 2.1–2.5: strict mapping v2 unions, normalized disposition types, E1 binding with v2 E2/E3 override behavior, diagnostics, and mapping coverage.
- 3.1–3.3, 3.5–3.6: tracked strict plan-input reader, closed migration-only node union, `sourceChange` compilation, digest/token/apply revalidation, and the focused input matrix.
- 4.1–4.5: pure standard Issue compiler, strict resource-only output, compiler tests, and post-publication normal list/show/plan/state/query behavior with receipt state remaining historical.
- 5.7: canonical Issue-lock batch acquisition/release helper and focused tests.

Task 3.4 deliberately remains unchecked. The current code now refuses a direct canonical `changeInstanceId` unless it has exactly one `minted: false` identity in the current flat inventory, and it rejects newly minted or duplicate current-source identities. It still needs to reuse the full existing Store reference-evidence path across readable refs/workspace evidence, including unreadable/foreign/scope-conflict diagnostics, rather than treating only the current flat inventory as the complete evidence base.

## Important fixes made in this relay

1. `revalidatePlan` no longer applies the generic source digest check to membership records after their planned v2 catalog was already written. The dedicated catalog-upgrade check now owns the allowed original/planned two-state contract, so after-rename restart recovery works.
2. Mapping v2 `project-change` assertions now override lower-priority E2/E3 while preserving those derived entries plus E4 assertion evidence; mapping v1 behavior and E1 binding stay unchanged.
3. Direct canonical plan nodes can no longer bind a same-migration newly minted identity or silently choose the first duplicate claimant; operators must use `sourceChange` for a newly minted identity.
4. Human and JSON migration previews now carry the same stable `migration_issue_plan_absent` continuation and existing Issue plan command.
5. Generated Issue integration now proves existing query/mutation surfaces consume the published tree and that a later canonical state change is not overwritten by receipt history.

## Verification evidence

Passing in this relay:

- `pnpm run build`
- `pnpm exec vitest run test/core/store/store-issue-migration-compiler.test.ts --reporter=verbose --pool=forks --poolOptions.forks.maxForks=1` — 4/4
- `pnpm exec vitest run test/core/store/store-issue-locks.test.ts --reporter=dot` — 18/18
- selected mapping normalization tests — 3/3
- selected canonical identity test — 1/1
- selected sourceChange refusal matrix — 1/1
- selected unsafe plan-input matrix — 1/1
- selected generated Issue publication/integration test — 1/1
- selected after-rename fresh-process recovery test — 1/1
- selected no-plan CLI parity test — 1/1

The complete mapping/apply files, full suite, lint, release checks, and strict final encoding/scope audit have not been run after the latest additions. Use `--pool=forks --poolOptions.forks.maxForks=1` for focused Vitest runs if the machine is busy; unrelated worktrees were running many Vitest workers during this relay.

## Next implementation order

1. Finish task 3.4 by extracting/reusing the Issue module's Store reference verification rather than duplicating it. Preserve the exception: `sourceChange` may use one frozen same-migration project Change, while a direct canonical id must be proven by existing Store evidence. Add ref-unreadable, ambiguous, foreign-Store, and scope-conflict vectors.
2. Audit and finish task 5.1. `readImmutableMigrationPlan` is currently only a shallow version check plus canonical-id check; replace it with strict closed v1/v2 validation that rejects all cross-version/unknown fields without altering any v1 canonical bytes.
3. Continue 5.2–5.6 and 5.8. Generated staging/publication already exists, but no-clobber coverage and deterministic publication-barrier interleavings are far from complete.
4. Continue 6.1–6.7. Recovery operations and after-rename reconciliation are partially present. In particular, the current recovery `runId` is the plan id, not a distinct publication-run identity; audit this against the design before expanding fault tests. Source reparse-point/non-Git enumeration and rollback proof cases remain incomplete.
5. Treat receipt/archive work in 7.x/8.x as partial scaffolding only. `readMigrationReceipt` is not yet a deep strict schema parser, and archive compatibility has no comprehensive precedence/non-mutation test matrix.
6. Then implement cross-platform/encoding, real scene-bridge fixture/E2E, docs, and all final verification tasks.

## Working-tree cautions

- Preserve all existing shared-worktree edits; they include the previous implementer's partial sections 5–8 plus this relay.
- `.rasen/` is process ephemera and must never be committed.
- Do not mark any remaining task from source presence alone; much of sections 5–8 is scaffolding without the required fault/interleaving/strictness evidence.
- `pnpm run build` updates ignored `dist/`; it is not part of the source diff.
