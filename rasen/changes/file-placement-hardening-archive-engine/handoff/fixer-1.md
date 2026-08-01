# Fixer handoff 1: archive-engine round 1 remediation

Date: 2026-07-31
Role: FIXER, round 1
Canonical review: `evidence/review-report.md` (unchanged)
Planner decision record: `handoff/review-remediation-1.md`

## Outcome

All 14 canonical findings are addressed in archive-owned implementation,
generated consumers, tests, and evidence. New archive plans and recovery
journals are version 2. The only open change task remains closure-owned native
Windows/macOS/Linux matrix task 7.6; no native macOS/Linux result is claimed.

No commit, push, archive, or run-state/portfolio mutation was performed.

## Finding-to-regression map

| # | Remediation | Primary regression |
| --- | --- | --- |
| 1 | Portable payload fingerprint is separated from root/entry deletion authority. Stable reads bind filesystem objects. Source is atomically claimed into a sibling transaction quarantine and deleted bottom-up with an identity check before each unlink/rmdir; active is never recursively removed. | `archive-fault-matrix`: same-byte file replacement, same-byte whole-root replacement, and post-claim same-byte child replacement |
| 2 | Final target is atomically reserved with non-recursive `mkdir`. Payload entries are copied exclusively and rehashed. A same-directory hard-link primitive publishes the no-replace logical marker. | `archive-fault-matrix`: target created at reservation boundary plus marker `EXDEV`/`EPERM`/`EACCES`/`EIO`/`ENOSPC` recovery matrix |
| 3 | Spec create uses no-replace publication; update claims the planned object into an exclusive transaction container, verifies it, and publishes without replacement; delete claims and verifies the complete capability tree before guarded removal. | `archive-engine`: concurrent create, concurrent update after claim, and delete child-swap cases |
| 4 | Cleaner progress is `pending -> delete-intent -> deleted`; intent is durably flushed before deletion. An absent retry after durable intent becomes `deleted-after-intent` and is counted. | `archive-fault-matrix`: crash after unlink and before result journal |
| 5 | Journal v2 carries per-action spec progress. Public totals and `specsUpdated` derive only from `complete` actions on success and failure. | `archive-engine`: two-action fault reports exactly the first completed action, then resumes at the second |
| 6 | Stage, handoff, evidence, final reservation, and accounting transforms carry durable before/expected/observed fingerprints. Resume rehashes current payload and reconciles intent only when it equals before or expected. | `archive-fault-matrix`: transformed-stage corruption and published-payload corruption |
| 7 | Directory mode and allocation size are absent from payload identity. File size/content/executable semantics and symlink target remain semantic; object identity remains local deletion authority. | `archive-engine`: POSIX `0711` directory plus executable file; path semantics remain explicit |
| 8 | Apply compares planning `treeState` as well as planning state/branch and execution facts. Recovery filters engine-owned transaction paths from Git status. | `archive-fault-matrix`: clean-to-dirty and dirty-to-clean drift |
| 9 | Ship-log finalization appends without trimming or normalizing the existing prefix. | `archive-engine`: CRLF/trailing spaces/multiple-newline byte-prefix case |
| 10 | Saved preview writes one canonical plan envelope in the global transaction store and returns an opaque content-addressed token. `--apply-plan` loads once, bypasses planning, and is the resume command. | `archive.test`: saved preview/apply with late ephemera; `archive-engine`: token round-trip and one-byte tamper |
| 11 | Generated consumers contain no external spec-sync call; omission/presence of `--skip-specs` is frozen in the saved plan and the engine owns all spec mutation. | generated-source guards plus consumer integration |
| 12 | Target, validation, task, timing, sidecar, cleaner, Git, evidence, and spec-preparation failures are plan blockers. Blocked preview exits nonzero. Recoverable JSON retains the full engine result and same-token recovery command. | `archive.test`: blocked preview and structured recoverable JSON |
| 13 | CLI exposes mutation-free intent-template and strict external intent. Single, bulk, and in-ship all execute intent-template -> complete intent -> saved preview -> token apply. | `archive-consumer-integration`: each generated label executes all four real command-controller modes; template golden guards |
| 14 | Bulk completion text names recorded ship commit when known, archive path/timestamp/outcome/transaction, and verified accounting; it does not claim a self-referential commit in hashed evidence. | `archive-engine-consumers` bulk golden assertion |

## Main implementation surfaces

- `src/core/archive-engine.ts`
  - canonical plan store/load and token validation;
  - portable payload and deletion-authority fingerprints;
  - journal v2 phase/spec/cleaner/source state;
  - no-replace file publication and final reservation marker;
  - guarded source/spec claims and deletion;
  - transformed-payload intent/reconciliation.
- `src/core/archive.ts`
  - `--intent-template`, `--intent-file`, `--save-plan`, and `--apply-plan`;
  - complete blocker projection, nonzero blocked previews, and structured
    blocked/recoverable JSON.
- `src/core/archive-accounting.ts`
  - deterministic accounting serialization used by the accounting transform.
- `src/core/templates/workflows/{archive-change,bulk-archive-change,ship}.ts`
  - one intent/save/token consumer flow and engine-owned spec application.
- `src/cli/index.ts` and `src/core/completions/command-registry.ts`
  - narrow archive flag registration only.

## Verification

Focused round 1 command:

```text
pnpm exec vitest run test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/ephemera-cleaner.test.ts test/core/archive.test.ts test/core/templates/archive-engine-consumers.test.ts test/core/templates/skill-templates-parity.test.ts
```

Result: PASS, 10 files, 155 passed, 1 POSIX-only test skipped on Windows.

Complete affected run:

```text
pnpm exec vitest run test/core/archive.test.ts test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/ephemera-cleaner.test.ts test/core/templates test/commands/ship.test.ts test/commands/work.test.ts test/core/management-api/archive.test.ts test/core/management-api/archive-api.test.ts
```

Result: PASS, 21 files, 236 passed, 1 POSIX-only test skipped on Windows.

### Resolved CLI presentation integration failure

The first complete affected run exposed an archive-owned startup defect. The
five in-process `work migrate` tests passed:

- `keeps an explicitly project-selected root as planning, execution, and legacy owner`
- `passes the exact previewed plan to apply and reports source drift without replanning`
- `the registered command confirms and applies the exact previewed plan after drift`
- `JSON previews surface typed blockers and --yes fails without applying`
- `human --yes prints blocker operation, path, and code then fails closed`

All 15 tests that spawned the built CLI failed before command dispatch:

- `--dry-run previews without moving files`
- `--json without --yes previews without moving files`
- `--json --yes executes and moves the file`
- `a second --yes run reports nothing to migrate (idempotent)`
- `--change scopes migration to a single change`
- `--change matching nothing exits non-zero with a diagnostic`
- `human mode --dry-run prints the preview and exits 0`
- `human cancellation leaves the previewed source in place`
- `--discard-absorbed-conclusions applies the previewed destructive action`
- `M1: --dry-run on an unregistered project never mints identity (config.yaml and registry untouched)`
- `--json --yes does not mint identity or replan when the preview has no machine home`
- `routes Store planning artifacts to the Store and terminal state to the invocation member`
- `freezes main and linked worktrees independently across consecutive Store migrations`
- `rejects mutually exclusive Store and project selectors before planning`
- `M2: the inverted migrator does not depend on git (corrupted index does not block migration)`

The first test reported `expected 1 to be +0` at
`test/commands/work.test.ts:131`; JSON cases that expected a diagnostic also
reported `Unexpected end of JSON input` because the child produced no stdout.
Direct reproduction exposed the child stack:

```text
CliPresentationError: Missing English CLI presentation copy
(cli.root.commands.archive.options.save-plan.description)
  at semanticError (dist/core/completions/cli-presentation.js:19:11)
  at resolveCopy (dist/core/completions/cli-presentation.js:31:9)
  at resolveOption (dist/core/completions/cli-presentation.js:88:22)
  at resolveCommand (dist/core/completions/cli-presentation.js:102:36)
  at resolveCliPresentation (dist/core/completions/cli-presentation.js)
```

Cause: the archive-owned registry added `save-plan`, `apply-plan`,
`intent-template`, and `intent-file`, but those flags had no presentation copy.
Global CLI presentation resolution therefore failed before *every* command,
including `work migrate`. This was not an archive-engine import side effect,
mutable global test state, or a work-migration defect; it was archive-owned
registry/locale/build wiring. English, Japanese, and Simplified Chinese copy
was added for all four flags, with a focused locale/presentation golden.

After rebuilding:

- `node bin/rasen.js --help`: PASS, exit 0.
- `node bin/rasen.js archive --help`: PASS, exit 0 and all four flags shown.
- `node bin/rasen.js work migrate --help`: PASS, exit 0.
- `pnpm exec vitest run test/commands/work.test.ts`: PASS, 20/20.
- Post-fix archive-focused suite plus `test/commands/work.test.ts`: PASS,
  11 files, 175 passed, 1 POSIX-only test skipped on Windows.

Other gates:

- TypeScript no-emit: PASS.
- ESLint: PASS.
- Build: PASS.
- Change validation: PASS, 1/1.
- `git diff --check`: PASS with line-ending conversion warnings only.

The canonical report remains a historical round 1 input and was not edited or
softened. `tasks.md` and `evidence/implementation-verification.md` record the
new remediation evidence without checking closure-owned task 7.6.
