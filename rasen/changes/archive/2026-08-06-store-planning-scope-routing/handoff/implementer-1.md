# Implementer handoff

Date: 2026-08-06

Change: `store-planning-scope-routing`

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-store-project-planning-v2`

Branch: `feat/store-project-partitions-planning-worktrees`

Schema/progress: `spec-driven`, `0/56` tasks checked. Keep this truthful until the remaining durable verification is complete; do not batch-check tasks from this handoff alone.

## Completed in this continuation

- Re-read the complete `rasen-apply-change` instructions plus every status-reported context file. No run-state, commit, push, archive, or original-worktree mutation was performed.
- Re-ran the generated planning-scope guidance and Direction guards, corrected the earlier negative-wording failures, and refreshed both parity hash maps to the current template output. The parity file retains its pre-existing UTF-8 BOM and LF line endings; its pre-existing mojibake comment was not rewritten.
- Replaced two obsolete management assertions that expected `store:<id>` to read or mutate flat project content. They now pin 400 `project_scope_required` and zero writes.
- Replaced legacy Store E2E assertions that expected `new change --store <id>` to write a flat Change. They now pin `legacy_flat_store_requires_migration`. The no-selector case continues to scaffold an independent standalone cwd without implicitly selecting an unrelated registered Store.
- Fixed Store v2 Change creation schema validation to consume the scope-owned `project-schemas` collection. Added a regression proving a custom schema in `rasen/projects/<project>/schemas` is accepted even though it is absent from the execution checkout.
- Expanded StorePlanning authoring coverage from 8 to 13 tests: stale scope, duplicate preservation, invalid schema, caller-controlled identity rejection, interrupted publication cleanup, and Windows `EPERM` rename collision cleanup are now pinned.
- Reconfirmed the production caller inventory/source guard after the schema-routing changes. The existing inventory remains the durable classification source.

## Files changed in this continuation

- `src/core/store-planning/internal/resolver.ts`
- `test/core/store-planning/store-planning.test.ts`
- `test/commands/store-root-selection.test.ts`
- `test/core/management-api/space-scoping.test.ts`
- `test/core/templates/skill-templates-parity.test.ts`
- this handoff

## Verification evidence

Passed on the current source unless noted otherwise:

- `pnpm exec tsc --noEmit`
- `git diff --check`
- planning path source guard: 2/2
- template planning-scope guidance + Direction: 13/13
- generated template parity: 8/8
- StorePlanning: 13/13
- focused management scope/session coverage: 64/64 after correcting the two obsolete flat-Store assertions
- Archive core, management, API, and template consumers: 73/73
- root-selection/pipeline/completion/project-addressing cluster excluding the stale Store-root E2E assertions: 112/112
- corrected Store-root E2E assertions on rebuilt `dist`: 3/3 targeted
- workflow/read consumers (artifact workflow, instruction loader, workflow integration, list, discovery, task progress, references): 193/193
- broader management consumers (changes, runs, task detail/API, submit, workflow submit, router, registry/sessions, spaces membership): 150/150
- `pnpm run build` passed after the production schema-routing fix; only tests and this handoff changed afterward.

Important test-run note: `test/helpers/run-cli.ts` reuses an existing `dist/cli/index.js`. One earlier broad Store-root run therefore exercised stale dist. A build was run, then the three affected assertions were rerun against current dist and passed. The full Store-root file still needs one current-dist rerun.

## Remaining work

1. Add the combined Store v2 CLI E2E journey required by task 10.2. It should prove list/show/validate/status/instructions/new/context agree on one Store/project/target-line partition, preserve complete follow-up selectors, create verified v2 identity in a linked planning worktree, and write nothing to root-level Store planning or another partition. Pipeline v2 lookup already has focused coverage but should be included in the final evidence matrix.
2. Rerun the complete `test/commands/store-root-selection.test.ts` against current dist. Then run the remaining affected lifecycle compatibility suites, especially context, doctor, work, retain, general pipeline/pipeline-library, session-runtime context, and Change status/action-context.
3. Run the Foundation planning validation/layout/identity/consumer suites as the explicit cross-platform evidence for tasks 1.1, 4.1, 4.5, and 10.4. The archived Foundation tests exist but were not rerun in this continuation.
4. Review the publication contract one final time. Current creation uses an exclusive sibling lock, sibling stage, rename, read-back verification, and cleanup; tests now cover duplicate, interruption, and Windows `EPERM`. POSIX `rename` can replace an existing empty directory, so decide whether the exclusive module lock is sufficient for the stated no-clobber contract or whether a platform-specific no-replace primitive/additional guard is required.
5. Decide whether `rasen schemas` and `rasen templates` are intentionally standalone-only. They are not listed as Store-capable commands in the generated Store-selection contract, while scoped workflow consumers now receive `project-schemas`. If they are meant to be Store-capable, they still need selectors and typed schema collection routing.
6. Run final gates after any remaining edits: focused delta tests, TypeScript, lint, one clean build, strict `rasen validate store-planning-scope-routing`, caller inventory/source guard, and `git diff --check`.
7. Strictly decode every changed text file as UTF-8 and compare BOM/newline style with `HEAD`. Audit new `U+FFFD` and typical mojibake signatures. `src/locales/ja.json` (3 replacements), `src/locales/zh-cn.json` (4), and the parity-test comment contain pre-existing encoding defects; do not attribute them to this change or rewrite them incidentally.
8. Reconcile all 56 task checkboxes against concrete code plus final test evidence. Check only tasks whose full wording is proved; leave partial cluster tasks unchecked and document why.

## Constraints to preserve

- Do not commit, push, archive, modify run-state, or touch the original source worktree.
- Preserve unrelated dirty-worktree changes and the existing portfolio Change directories.
- Use `--configLoader runner --maxWorkers=1` for focused Vitest runs.
- Build before spawned-CLI E2E tests whenever source changed; existing `dist` suppresses the helper's automatic build.
