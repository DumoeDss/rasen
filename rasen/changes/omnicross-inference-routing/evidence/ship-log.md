# Ship log — omnicross-inference-routing

## Delivery

| Field | Value |
| --- | --- |
| Mode | pr (user-selected: single PR to `dev/0.2.0`) |
| Branch | `feat/omnicross-inference-routing` |
| Commit | `0a32156a` |
| Base at branch point | `75c3366a` |
| PR | https://github.com/DumoeDss/rasen/pull/156 (**draft**) |
| Diff | 155 files, +12196 / -700 (includes the change directory and docs) |
| Archive | pending merge, per the project's archive-on-merge convention |

Committed with an explicit pathspec excluding `.rasen/`, so LEAD ephemera
(run-state, reviewer prompts and receipts) stayed out of the PR.

## Why the PR is a draft

The branch cannot merge as-is. It branched from `75c3366a`; `origin/dev/0.2.0`
has since advanced **28 commits**, and **43 files overlap** with this change,
including:

- `src/core/change-run/internal/facade-runtime.ts`, `contracts.ts`, `actions.ts`,
  `runtime-context.ts`
- `src/core/frozen-action-executor/executor.ts`, `production-executor.ts`
- the shipped pipeline YAMLs, `src/locales/*.json`,
  `src/core/templates/workflows/_orchestration.ts`
- `test/core/pipeline-registry/builtin-v2-package-audit.test.ts`

The capability-digest and skill-hash pin tables are lockstep-sensitive to the
pipeline YAMLs, locales and shared skill templates, all of which moved on the
base. They will need rebaselining from the production generators
(`loadWorkflowCatalog` + `computeBuiltInWorkflowDigest`) after the rebase, not
hand-copied from `.claude/skills/` output.

**A rebase changes the same files the five review rounds verified.** The
authority properties confirmed in rounds 1-5 were established against the
pre-rebase code in `facade-runtime.ts`, `executor.ts` and `contracts.ts`; they
should be re-checked against the rebased tree rather than assumed to carry over.
That re-verification is deliberately not claimed here.

## Verification state at ship

| Check | Result |
| --- | --- |
| Full suite | 8176 passed / 59 skipped / 1 failed |
| Sole failure | `capstone-journeys` journey 3 — 30s timeout + EPERM cleanup under parallel load; passes in isolation |
| `test/core/change-run/` | 73 files / 714 tests green, on the final tree |
| `tsc --noEmit` | exit 0 |
| `git diff --check` (staged) | clean, after fixing 7 pre-existing violations |
| Review loop | 5 rounds; exit condition met (no Blocker, no Major) |

Seven whitespace-gate violations were found in the staged diff at ship time and
fixed byte-safely (trailing whitespace in a file containing Chinese text, and
blank lines at EOF in five files). Verified afterwards that the file still
contains zero U+FFFD sequences.

## Carried forward

- **N1, N2, N3** — accepted-known non-blocking Minors on the publication path,
  with follow-ups in `evidence/review-report.md`. N1 was *introduced* by this
  change's adoption of `link(2)` without the EvidenceStore's `nlink === 1`
  assertion, not merely surfaced by it.
- **Q6 mutation discrimination** was measured by the author and independently
  derived by the reviewer with identical results, but never verifier-executed;
  the test runner is refused at the permission layer in dispatched workers. This
  is a standing verification limitation, not a receipt.
- `capstone-journeys` journey 3 sits close enough to its 30s per-test timeout to
  be fragile under load; worth a timeout bump or a split independent of this
  change.
