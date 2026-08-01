## Context

The built-in catalog currently registers 18 experts. Six of those registrations do not justify an independent dispatch surface:

- `codebase-design`, `tdd`, and `prototype` are consulted by exactly one workflow each and already act as conditional methodology branches.
- `workflow-review` is the independent-review branch of `workflow-author`, not a separate user journey.
- `navigator` overlaps the richer `rasen-help` router.
- `qa-only` duplicates the QA methodology, sidecars, browser setup, severity mapping, and `qa-report.md` contract while differing primarily in its no-edit mode.

Built-in workflows can already ship lazy sidecars under `skills/workflows/<dirName>/`; `rasen-retain` uses this to keep mutually exclusive report/codify bodies out of the router prompt. Expert skills can likewise receive sidecars from `skills/experts/<id>/`. The existing copier uses Node path utilities and preserves nested directories across Windows, macOS, and Linux.

This change is intentionally a catalog consolidation, not a new runtime classification system. A skill remains a catalog expert when it needs its own dispatch identity or useful direct invocation. A method used only inside one host becomes a host-owned reference.

## Goals / Non-Goals

**Goals:**

- Reduce the built-in expert catalog from 18 to 12 and the quality-floor set from six to five without weakening review coverage.
- Preserve the full methodology content, attribution, conditional loading, role isolation, and durable report contracts of the consolidated experts.
- Give `rasen-qa` one explicit report-only/non-UI mode and route existing QA-only consumers through it.
- Make fresh generation and update converge: new installs never create retired skill directories, and existing installs remove the six exact retired directories even on an otherwise up-to-date update.
- Keep source templates, generated sidecars, catalog/profile metadata, pipeline stages, locales, docs, and tests in parity.

**Non-Goals:**

- Changing or consolidating `office-hours` or `office-hours-command`.
- Wiring `investigate` into `bug-fix`; it remains an opt-in standalone expert.
- Removing or embedding `review`, `cso`, `benchmark`, `design-review`, or `qa`; they remain independently dispatchable pipeline leaves.
- Removing `careful`, `chrome-use`, `codex`, `design-consultation`, `investigate`, or `workflow-author`; they remain opt-in standalone experts.
- Adding a general `public`/`dispatch-only`/`reference` registry schema. Removing registrations is sufficient for the five single-host methods and QA-only alias.
- Changing the canonical severity scale, report filenames, or author-not-verifier rules.

## Decisions

### 1. Host-owned references use the existing sidecar mechanism

Each retired single-host body moves to an explicitly named host tree:

| Retired identity | Host | Bundled reference tree |
|---|---|---|
| `rasen-codebase-design` | `rasen-propose` | `skills/workflows/rasen-propose/references/codebase-design/` |
| `rasen-tdd` | `rasen-apply-change` | `skills/workflows/rasen-apply-change/references/tdd/` |
| `rasen-prototype` | `rasen-explore` | `skills/workflows/rasen-explore/references/prototype/` |
| `rasen-workflow-review` | `rasen-workflow-author` | `skills/experts/workflow-author/references/workflow-review/` |
| `rasen-navigator` | `rasen-help` | `skills/workflows/rasen-help/references/navigator.md` |

Each methodology tree has one entry document containing the former template's substantive instructions and links to its existing deeper references. The host body names the trigger and reads only that entry document when the branch applies; the entry document may then direct a second lazy read of the specific deeper reference needed. MIT notices remain on every adapted file.

This uses `copySkillSidecars` and its current workflow/expert lookup rather than adding a reference registry. Built-in workflow digest/freshness coverage will include the shipped sidecar tree so a sidecar change is tracked as part of the generated skill contract, not invisible payload drift.

Alternative considered: inline all five bodies into their hosts. Rejected because it increases every invocation's prompt size and discards the progressive-disclosure benefit that motivated the consolidation.

Alternative considered: add `visibility: public | dispatch-only | reference` to the catalog. Rejected because these five references no longer need catalog identity, while the surviving review leaves already work with the existing `expert` kind.

### 2. The host router owns when a reference is loaded

- `rasen-propose` loads codebase design only for a new module, non-trivial interface, or comparable design-dense change, and records decisions in `design.md` or a change sidecar.
- `rasen-apply-change` loads TDD only when test-first work is selected; its independent `rasen-careful` consultation remains unchanged.
- `rasen-explore` loads prototype guidance only when running code is the bounded way to settle a stuck design question, and still requires deletion of throwaway code after capturing the answer.
- `rasen-workflow-author` loads workflow-review guidance after structural validation. With multi-agent support it gives the sidecar to a non-author reviewer; otherwise it performs a clearly separated second pass. The review remains read-only unless separately authorized.
- `rasen-help` loads the navigator reference for broad routing, scope-control, or expert-map questions while retaining its concise one-next-action response contract.

The deleted source-template getters and their export chain are not retained as compatibility aliases: retaining them would keep the same model-routing noise under another name.

### 3. QA-only becomes a mode, not an identity

`rasen-qa` becomes the sole QA expert and exposes two behavioral modes:

- Default standalone QA keeps the existing test/fix/verify loop.
- Report-only/non-UI QA performs the same browser-first, evidence-backed exploration and health assessment but never edits code, asks fix questions, commits, or enters the fix loop. A LEAD-dispatched QA stage is report-only under the existing dispatched-mode contract regardless of UI classification.

The `full-feature` pipeline keeps six fan-out members so its reconciler shape and coverage remain stable. Its non-UI member is renamed from `qa-only` to `qa-report-only`, points to `skill: rasen-qa`, retains `condition: non-ui`, and is named in the review-loop join dependencies. The UI member continues to point to `rasen-qa`. The LEAD dispatch guidance treats `qa-report-only` as an explicit mode instruction, and both mutually exclusive branches write the same canonical `qa-report.md`.

`rasen-verify-enhanced` standard verification likewise invokes `rasen-qa` in report-only/non-UI mode. Its catalog dependency list contains `rasen-qa` once. The shared PREAMBLE, severity table, auto output, docs, and source-reading rules refer to QA modes rather than a second expert.

Alternative considered: reduce full-feature to five fan-out members and let one conditional QA stage infer UI/non-UI behavior. Rejected because the v1 pipeline condition field expresses one label per stage; keeping two mutually exclusive stage nodes preserves explicit coverage and the six-member reconciler contract without inventing condition expressions.

### 4. Retirement is explicit and exact-name based

The six retired template files, exports, catalog definitions, source sidecar directories, picker locale entries, profile defaults, fixtures, and parity entries are removed. A single tracked constant lists exactly these installed directory names:

- `rasen-codebase-design`
- `rasen-tdd`
- `rasen-prototype`
- `rasen-navigator`
- `rasen-workflow-review`
- `rasen-qa-only`

Init/update prune only those exact directory names with `path.join`, before update's up-to-date short circuit, following the existing retired-workflow/edit-boundary cleanup pattern. No prefix, glob, regex, or directory-content inference is used. Similar names and unrelated/user-owned directories remain untouched. Persisted custom selections already flow through the catalog's unknown-id tolerance and warning; no new config schema or alias is added.

### 5. The surviving public expert roster is the source of truth

`getExpertSkillDefinitions()` remains the source for `ALL_EXPERTS`, catalog enumeration, full-profile defaults, and localized metadata parity. After consolidation the 12 experts are:

- Quality/dispatch: `review`, `cso`, `benchmark`, `design-review`, `qa`.
- Opt-in standalone: `careful`, `chrome-use`, `codex`, `design-consultation`, `investigate`, `workflow-author`.
- Unchanged standalone: `office-hours`.

`QUALITY_FLOOR_EXPERTS` becomes `review`, `cso`, `qa`, `benchmark`, and `design-review`. Profile and locale tests derive or assert against these explicit lists; removed entries do not remain as hidden picker choices.

### 6. Verification covers contracts rather than only counts

Tests will cover:

- Catalog, fixture, profile, locale-key, dependency-graph, and expert-count parity for the 12/5 roster.
- Sidecar source presence, init/update copy behavior, nested paths built with `path.join`, and freshness/digest changes when a host sidecar changes.
- Exact-name removal of all six retired installed directories during init and update, including an up-to-date run, with similarly named directories preserved.
- Host routers naming their lazy references and not inlining substantive bodies.
- QA mode no-edit wording, canonical severity/report behavior, `full-feature` six-member normalization and renamed non-UI member, and verify-enhanced's single QA dependency.
- Removal of live retired identities from generated templates, docs, locales, fixtures, profile selections, and package output, while historical archived changes remain untouched.
- Template parity hashes only for surviving templates whose generated content changes.

## Risks / Trade-offs

- **[Breaking direct invocations]** Existing prompts or saved profiles may name one of the six retired skills. → Document the host replacement, let stored custom selections use existing unknown-id diagnostics, and remove stale installed directories deterministically on update.
- **[Reference file omitted from an installed skill]** A shallow host router could point at a file that packaging or update did not copy. → Use the existing packaged sidecar tree, add install/update and Windows-path tests, and include sidecar presence in freshness checks.
- **[Sidecar edits become invisible to drift detection]** Built-in workflow digests historically covered the inline template only. → Include the host sidecar tree in the built-in workflow generation/digest contract and test that its digest changes with sidecar content.
- **[QA mode ambiguity]** A worker might run the mutating standalone loop for a non-UI review. → Name the pipeline stage `qa-report-only`, state the mode in orchestration dispatch guidance, and make report-only mode's prohibited actions explicit in the unified QA template.
- **[Fan-out rename breaks joins or resume fixtures]** Reconciler paths and dogfood tests currently name `qa-only`. → Change the stage id, review-loop requirement, fixtures, resume/status expectations, and six-member contract together.
- **[Attribution loss while moving adapted content]** Moving methodology files could detach MIT notices. → Preserve notices in the entry and deeper sidecars and assert them in source/install tests.

## Migration Plan

1. Add host-owned reference trees and convert the five host templates into shallow conditional routers; verify sidecar materialization and digest/freshness behavior.
2. Merge QA-only rules into `rasen-qa`, then switch `full-feature`, verify-enhanced, auto/orchestration wording, and report/severity consumers to the unified identity.
3. Remove the six retired templates, exports, catalog registrations, old source directories, locale/profile entries, and fixtures; add the exact installed-directory retirement constant and invoke it from init/update before short circuits.
4. Update live specifications, user documentation, package guidance, parity hashes, and focused tests; run build, lint/type checks, unit suites, and the full-feature dogfood path on the supported CI matrix including Windows.
5. Users receive the new roster on `rasen update`; old exact managed directories are removed and the host skill directories are regenerated with their references.

Rollback restores the six catalog/template registrations and old pipeline/profile references, then regenerates installs with the prior version. Removed installed directories contain generated artifacts only and can be recreated from source; no user data or change artifacts are migrated.

## Open Questions

None. The scope deliberately uses the existing sidecar and retirement mechanisms and leaves office-hours and investigate routing unchanged.
