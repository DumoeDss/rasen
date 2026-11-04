# Pre-Landing Review: Project Issues Onboarding UI

- Mode: dispatched / report-only
- Branch: `feat/project-issue-onboarding`
- Base: `origin/dev/0.2.0`
- Reviewed HEAD: `8f6266525b3b32940780a94f0f3565aaeeaf06d1` plus the current uncommitted UI implementation
- Result: **CHANGES REQUIRED — 0 Blocker, 1 Major, 2 Minor, 0 Trivial**
- Greptile: no PR exists yet, so there were no comments to triage

## Scope Check

**CLEAN.** The implementation stays within the approved topology: Project navigation gains only a transitional `/p/:projectId/issues` onboarding route; Issue Board and Detail remain Store-owned; membership is established through the sibling two-identifier API; no Project→Store map, preferred Store, adoption, or planning rebind was added.

## Findings

### Major — Membership comparison contradicts the domain's case-insensitive Project identity

- Evidence: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:100-102` derives membership with `member.projectId === project.id`. The route intentionally preserves the Project token verbatim (`packages/ui/src/store/use-space.ts:5-11`, `:39-52`), while Store membership explicitly normalizes identity with trim + lowercase (`src/core/store/project-records.ts:54-81`; `src/core/store/membership.ts:759`). `handleSpaces()` returns the registry's original Project id at `src/core/management-api/spaces.ts:109-115` but returns the normalized membership-record id at `:180-191`. The real-CLI test exercises exactly this state with uppercase UUID `8A8B...` and only finds the returned member after lowercasing both sides (`test/core/management-api/create-space.integration.test.ts:91-98`, `:114-130`).
- Impact: an already-member Project whose configured/URL id contains uppercase characters is misclassified as having zero memberships. It does not auto-enter its sole Store, and multiple-member choices are also wrong; the user is instead offered a redundant Join flow even though the server correctly considers the membership present. This breaks the core zero/one/many routing requirement.
- Fix: compare canonical Project identities (trim + lowercase) only for membership equality while preserving the opaque route token for URLs and mutation input. Prefer one shared, explicit identity helper or normalize the catalog projection server-side. Amend design/spec wording that currently mandates raw-string “exact” equality, and add an uppercase-UUID regression covering Project row → Store member → automatic Store Issues navigation.
- Classification: **ASK** because the code, identity contract wording, and regression evidence must be changed together.

### Minor — Fixed Store creation exposes English-only copy in Japanese and Chinese onboarding

- Evidence: onboarding opens `CreateSpaceDialog` in fixed Store mode (`packages/ui/src/components/ProjectIssueOnboardingPage.tsx:302-309`), but the dialog still hardcodes the Store instructions, path label, Store-id label, validation message, cancel/action labels, and related accessible copy (`packages/ui/src/components/CreateSpaceDialog.tsx:62`, `:131`, `:161-190`, `:223-244`). Locale keys such as `spaces.create.kind_label`, `spaces.create.store`, `spaces.create.store_id`, `spaces.create.cancel`, `spaces.create.creating`, and `spaces.create.create` already exist in all three catalogs.
- Impact: the Japanese and Simplified Chinese onboarding path switches to English at the required “Create Store” step, violating `specs/project-issue-onboarding/spec.md:136-160` and the completed localization task 4.3.
- Fix: route all visible strings and accessible names in the dialog through locale keys, adding operation-specific keys where the existing generic keys are insufficient; add a non-English fixed-mode assertion.
- Classification: **AUTO-FIX** (mechanical localization plus focused test).

### Minor — Required interaction/identity boundaries are not fully regression-tested

- Evidence: the focused suite covers loading/failure, zero/one/many raw-equal memberships, first join, same-target retry, create-then-retry, route transition, and unmount (`packages/ui/test/components/project-issue-onboarding-page.test.tsx:153-370`). It does not exercise (a) canonical-equivalent ids with different casing, (b) a rapid second submit while join is pending, (c) selecting a different Store after a failed join (`spec.md:81-85`), (d) zero/one/many recomputation after an external catalog publication or retry supersession (`spec.md:53-57`), or (e) navigation from a returned Store id different from the preselected row (`spec.md:69-73`).
- Impact: the identity defect above passed all current tests, and attempt-ownership/returned-truth behavior can regress without failing the suite.
- Fix: add focused component cases for these five boundaries. The casing case is part of the Major fix; the remaining cases are ordinary unit/component coverage.
- Classification: **AUTO-FIX**.

## Standards Axis

- Route ownership is deep and correct: Project onboarding does not import or mount Store Issue read components.
- The membership mutation stays behind `addProjectToStore(projectId, storeId)` and uses the returned Store for publication/navigation.
- Async ownership guards prevent late create/join results from publishing or navigating after Project change/unmount.
- Styling uses existing tokens and the narrow layout retains textual relationship labels.
- **Major exception:** client identity comparison does not use the canonical equality already established by core.
- **Minor exception:** the controlled dialog is not fully localized in the new onboarding flow.

## Spec Axis

- Implemented: Project Issues discovery, exact transitional route boundary, Store-canonical Board/Detail, catalog gating, zero/one/many UI, explicit joining, returned-space publication before revalidation/navigation, partial-success retry, and Project-attempt ownership.
- Not correctly implemented: one/many membership routing for canonical-equivalent Project ids with different casing.
- Not completely implemented: all onboarding-visible and accessible dialog copy resolving from English, Japanese, and Simplified Chinese catalogs.
- Coverage is incomplete for several explicitly specified concurrency and retry scenarios listed above.

## Coverage Map

```text
CODE PATH COVERAGE
==================
[+] Route/navigation boundary
    ├── [★★★ TESTED] Project onboarding vs Store Board/Detail ownership
    └── [★★★ TESTED] canonical homes, deep-URL refusal, space switching
[+] Catalog-derived membership
    ├── [★★★ TESTED] unresolved, failed+retry, zero, one, many (raw-equal ids)
    ├── [GAP]         canonical-equivalent ids with different casing
    └── [GAP]         external publication/retry supersession recomputation
[+] Existing-Store membership
    ├── [★★★ TESTED] exact request ids, publish → refresh → replace route
    ├── [★★★ TESTED] failure and same-target idempotent retry
    ├── [GAP]         duplicate submit while the promise is pending
    ├── [GAP]         choose another Store after failure
    └── [GAP]         returned Store id differs from selected row
[+] Store creation handoff
    ├── [★★★ TESTED] fixed operation, callback, no default navigation
    └── [★★★ TESTED] create success + join failure + membership-only retry

USER FLOW COVERAGE
==================
[+] [★★★ TESTED] Project nav → onboarding; Store nav → canonical Issues
[+] [★★★ TESTED] sole membership auto-entry and multi-membership choice
[+] [★★★ TESTED] join existing Store and create-then-join Store
[+] [★★★ TESTED] Project transition/unmount rejects late async completion
[!] [DEFECT]      uppercase UUID member is presented as zero membership
[!] [DEFECT]      Japanese/Chinese create-Store step contains English copy
[ ] [GAP]         double-click, alternate Store after failure, live publication

QUALITY: core happy/error flows are strong; identity and locale boundaries are not.
```

## Verification Evidence

- API bridge/wire/whitelist: 51/51 passed.
- Management router: 46/46 passed.
- UI onboarding component suite: 11/11 passed.
- UI route/dialog/switch matrix: 70/70 passed.
- UI client/fixtures: 46/46 passed.
- Real CLI membership integration: 2/2 passed, including idempotent replay, unique membership, and unchanged Project planning Store.
- Isolated i18n checks: 12/12 passed; these check catalogs/keys but do not detect the dialog's hardcoded English literals.
- Root `tsc --noEmit`: passed.
- Both Change artifacts: strict validation passed.
- `git diff --check origin/dev/0.2.0`: passed.
- Strict UTF-8 decode, no-BOM/replacement/mojibake/trailing-whitespace checks over all changed files, plus JSON parsing: passed before this report.
- UI global typecheck remains blocked by 13 pre-existing Canvas diagnostics outside this diff.
- The full UI test run reached passing functional suites but its aggregate gate failed when `build-split.test.ts` hit `ENOSPC`; the concurrent i18n scan timed out and passed 12/12 in isolation. E: currently has about 0.11 GB free, so UI/root production builds were not rerun.

## Verdict

**NOT REVIEW-CLEAN.** Route the Major identity mismatch and both Minor items to a non-author fixer, then require a fresh independent re-review. Shipping must not proceed while the Major remains.

## Registered Project identity QA fix re-review

- Mode: dispatched / report-only / fresh non-author re-review
- Branch: `feat/project-issue-onboarding`
- Scope: current uncommitted delta in `src/core/store/operations.ts`, `test/commands/store-add-project.test.ts`, and `test/core/management-api/create-space.integration.test.ts`
- Result: **PASS WITH ONE MINOR — 0 Blocker, 0 Major, 1 Minor, 0 Trivial**
- Original QA Major: **independently resolved**
- Greptile: `gh pr view` found no PR for this branch, so there were no comments to triage

### Scope Check

**CLEAN under the explicit QA remediation.** The delta adds one read-only identity-resolution step inside the existing `storeAddProject` mutation and regression coverage. The Management API implementation remains unchanged and still emits exactly `store add-project <resolved-project-root> --to <storeId> --json`; no `--as`, `--set-primary`, `--dry-run`, `store adopt`, Project→Store map, cache, or new membership authority was added (`src/core/management-api/create-space.ts:427`; `test/core/management-api/create-space.test.ts:338-356`).

### Findings

#### Blocker

- None.

#### Major

- None. The reported Project `8943c3a4-9b59-401a-aea2-4d72b45e98b8` at a `rasen-2.0-test` root now bypasses the invalid basename fallback by reusing the machine Project registry identity (`src/core/store/operations.ts:598-625,1214-1230,1293-1301`; `test/commands/store-add-project.test.ts:85-109`). The real Management API/CLI integration now exercises that non-kebab root, succeeds twice without duplicate membership, and proves the Project planning pointer is unchanged (`test/core/management-api/create-space.integration.test.ts:85-138`).

#### Minor

1. **Canonical `store-add-project` identity-precedence documentation is stale.** `rasen/specs/store-add-project/spec.md:77-87` still specifies only metadata → explicit `--as` → directory basename. The implementation now intentionally inserts registered Project identity for the same canonical root before basename fallback (`src/core/store/operations.ts:1214-1230`). Update the requirement and scenarios so the shipped spec describes the compatibility behavior this QA fix adds. Classification: **AUTO-FIX** (documentation-only; does not reopen the behavior gate).

#### Trivial

- None.

### Standards Axis

- The new helper is narrow and read-only; it reuses `findAdoptableProjectIdentity` rather than adding a second path/worktree resolver (`src/core/store/operations.ts:598-625`; `src/core/project-registry.ts:824-875`).
- Existing metadata remains highest priority. Explicit `--as` remains ahead of registry fallback when metadata is absent, while metadata/`--as` mismatch still reaches the established refusal (`src/core/store/operations.ts:601-605,1219-1227,1293-1301`; focused tests at `test/commands/store-add-project.test.ts:111-182`).
- Canonical alias disagreement fails closed before either repository is mutated (`src/core/store/operations.ts:610-620`; `test/commands/store-add-project.test.ts:184-223`).
- Windows case normalization is covered at the CLI boundary, and the reused resolver's linked-worktree piercing and conflict behavior remain covered directly (`test/commands/store-add-project.test.ts:253-273`; `test/core/project-registry.test.ts:680-810`).
- Dry-run remains zero-write across the complete isolated fixture tree while reporting the registered Project display identity (`test/commands/store-add-project.test.ts:225-251`).

### Spec Axis

- **Satisfied:** reuse the already registered Project identity for the same canonical root without requiring the Management API to synthesize `--as`.
- **Satisfied:** no planning-primary inference or adoption path; the real integration compares `readStorePointer(projectRoot)` before/after and passes.
- **Satisfied:** retry remains idempotent and the fresh Store catalog contains the Project identity exactly once.
- **Minor drift only:** the canonical `store-add-project` precedence text has not yet been synchronized with the required remediation.

### Focused coverage

```text
resolveAddProjectDisplayId
├── existing metadata              [TESTED: preserved mismatch/metadata path]
├── explicit --as                  [TESTED]
├── registered canonical identity  [TESTED: reported UUID + real API/CLI]
│   ├── Windows case-equivalent    [TESTED on Windows]
│   └── linked worktree → main     [TESTED in reused resolver]
├── conflicting canonical aliases  [TESTED: fail closed + zero writes]
└── unregistered → basename        [existing store-add-project coverage]

storeAddProject continuation
├── --dry-run                      [TESTED: whole-tree snapshot unchanged]
└── apply + replay                 [TESTED: unique membership, planning unchanged]
```

### Verification evidence

- `pnpm exec vitest run test/commands/store-add-project.test.ts -t "registered Project identity|explicit --as|metadata-vs---as|canonical Project registry aliases|previews the registered|Windows path case" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **6 passed, 13 skipped**.
- `pnpm exec vitest run test/core/management-api/create-space.integration.test.ts -t "establishes and replays real membership once without changing the Project planning Store" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **1 passed, 1 skipped**.
- `pnpm exec vitest run test/core/project-registry.test.ts -t "findAdoptableProjectIdentity" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **6 passed, 44 skipped**, including Windows case, linked-worktree piercing, and alias-conflict refusal.
- `pnpm exec vitest run test/core/management-api/create-space.test.ts -t "uses exact inert argv, fresh pre/post reads, normalized Project identity, and a typed 200 Store result" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **1 passed, 39 skipped**; exact argv contains none of `--as`, `--set-primary`, `--dry-run`, or `adopt`.
- `git diff --check -- <three reviewed files>` — **passed** (Git emitted only its existing LF→CRLF checkout warnings).
- Strict UTF-8 decode of all three reviewed files — **passed**, UTF-8 without BOM.
- An initial unfiltered `pnpm exec vitest run test/commands/store-add-project.test.ts` exceeded the 120-second command bound before producing a result; it was not counted as evidence and was replaced by the focused branch-complete selection above.

### Verdict

**BEHAVIOR REVIEW-CLEAN.** The original Major is independently resolved with 0 open Blocker/Major. The one open Minor is documentation synchronization: update the canonical `store-add-project` precedence requirement to include registered Project identity before basename fallback.

### Documentation fix re-review

- Prior Minor: **RESOLVED.** `rasen/specs/store-add-project/spec.md:77-102` now documents metadata → explicit `--as` → normalized registered Project identity → basename fallback, fail-closed canonical-alias conflict, and the Management API's no-`--as` boundary.
- Semantic verdict: **PASS.** The wording matches `resolveAddProjectDisplayId` (`src/core/store/operations.ts:598-625`), `findAdoptableProjectIdentity` (`src/core/project-registry.ts:824-875`), and the exact API argv (`src/core/management-api/create-space.ts:427`). It adds no primary/adopt/map/cache promise. The registered identity remains subject to the existing id grammar, the ambiguity scenario is scoped to live aliases, and the fallback correctly says raw basename rather than promising kebab conversion the implementation does not perform.
- Format verdict: `node bin/rasen.js validate store-add-project --type spec --strict --json --no-interactive` passed **1/1** with only the file's informational long-requirement notices. `git diff --check` passed.
- Encoding verdict: strict UTF-8 decode passed, with no BOM or replacement character.

#### Final open findings after documentation re-review

- Blocker: **0**
- Major: **0**
- Minor: **1**
- Trivial: **0**

##### Minor — The documentation edit leaves mixed line endings

- Evidence: the amended file currently contains **176 CRLF** endings and **20 bare LF** endings; the documentation diff is **19 insertions / 4 deletions**, and Git warns that LF will be replaced by CRLF on the next write. The inserted hunk therefore breaks the file's established CRLF style even though Markdown validation and `git diff --check` pass.
- Impact: the next normal Windows rewrite can create avoidable line-ending churn or a misleading whole-file diff.
- Fix: normalize only `rasen/specs/store-add-project/spec.md` back to its established CRLF style without changing text, then rerun strict UTF-8 and `git diff --check` verification.
- Classification: **AUTO-FIX** (file-format-only; the specification contract itself is resolved).

#### Final verdict

**SEMANTICALLY REVIEW-CLEAN; NOT FILE-HYGIENE CLEAN.** The original documentation Minor is resolved and there are 0 open Blocker/Major. One new Minor remains solely for mixed line endings in the amended spec.

### Final newline-hygiene re-review

- Prior newline Minor: **RESOLVED.** `rasen/specs/store-add-project/spec.md` is now uniformly CRLF: **196 CRLF**, **0 bare LF**, **0 bare CR**.
- Encoding: strict UTF-8 decode passed; **no BOM** and **no U+FFFD replacement character**.
- Semantic stability: the text diff remains the previously approved **19 insertions / 4 deletions** documenting registered Project identity precedence, fail-closed live canonical-alias conflicts, raw basename fallback, and Management API no-`--as` behavior. No semantic text drift was introduced by newline normalization.
- Spec gate: `node bin/rasen.js validate store-add-project --type spec --strict --json --no-interactive` passed **1/1** with only informational long-requirement notices.
- Diff gate: `git diff --check -- rasen/specs/store-add-project/spec.md` passed.

#### Final open findings

- Blocker: **0**
- Major: **0**
- Minor: **0**
- Trivial: **0**

#### Final verdict after newline fix

**REVIEW-CLEAN.** The registered-Project identity QA fix, its canonical specification update, and the newline-hygiene remediation have no open findings.

## Created Store layout-v2 QA fix re-review

- Mode: dispatched / report-only / fresh non-author re-review
- Branch: `feat/project-issue-onboarding`
- Scope: the layout-v2 QA remediation in `src/core/management-api/create-space.ts`, `test/core/management-api/create-space.test.ts`, `test/core/management-api/create-space.integration.test.ts`, and `rasen/specs/space-creation/spec.md`
- Result: **PASS WITH ONE MINOR — 0 Blocker, 0 Major, 1 Minor, 0 Trivial**
- Original QA Major (`ISSUE-002`): **independently resolved**

### Scope Check

**CLEAN under the explicit QA remediation.** Store creation adds only the CLI's existing explicit `--layout 2` request, in the required position before `--json`. Registration, Project creation, membership argv, primary-planning selection, adoption, maps, and caches are untouched. The nearby membership integration edits belong to the already reviewed registered-Project identity remediation and do not expand this fix.

### Findings

#### Blocker

- None.

#### Major

- None. The Store created by the Management API now carries the exact metadata the canonical Store Issue consumer requires: metadata schema version 2, a minted permanent UID, and `layoutVersion: 2`. The real-CLI integration crosses the UID-addressed Management API query path and receives HTTP-equivalent status 200 with an empty Issue projection instead of `issue_scope_required`.

#### Minor

1. **The four reviewed files have mixed line endings at the changed hunks.** Strict byte inspection found `src/core/management-api/create-space.ts` at **676 CRLF / 7 bare LF**, `test/core/management-api/create-space.test.ts` at **402 CRLF / 176 bare LF**, `test/core/management-api/create-space.integration.test.ts` at **121 CRLF / 63 bare LF**, and `rasen/specs/space-creation/spec.md` at **100 CRLF / 4 bare LF**. The layout-v2 source, assertion, integration, and spec hunks are among the bare-LF ranges, and Git warns that LF will be replaced by CRLF on the next write. Impact: a normal Windows rewrite can create avoidable newline churn or a misleading larger diff. Fix: normalize only these four files back to their established CRLF working-tree style without changing text, then rerun strict UTF-8 and diff checks. Classification: **AUTO-FIX** (file-format-only; suppressed in report-only mode).

#### Trivial

- None.

### Standards Axis

- Exact producer argv is `store setup <id> --path <joined-root> --layout 2 --json`; the unit assertion pins the complete ordered array (`src/core/management-api/create-space.ts:335`; `test/core/management-api/create-space.test.ts:152-154`).
- CLI parsing accepts only literal layout value `2`, threads it through prepare/execute, writes `layoutVersion: 2` only while minting fresh metadata, and refuses existing legacy metadata with `store_setup_layout_existing_metadata` rather than migrating it (`src/commands/store.ts:707-735`; `src/core/store/operations.ts:761-788,838-868,923-946`).
- Membership behavior is unchanged. Its schema dispatch reads the Store's declared layout and a layout-v2 Store writes a v2 project catalog; it neither downgrades the Store nor performs a migration (`src/core/store/membership-layout.ts:65-120,181-209`; `src/core/store/membership.ts:835-849,886-921`).
- Existing validation, subprocess timeout/error passthrough, post-listing correlation, and partial-success semantics in `createSpaceCreator` are unchanged outside the one create-store argv literal.

### Spec Axis and consumer-boundary proof

- **Satisfied:** `space-creation` now requires fresh Store setup with `--layout 2`, permanent identity, and a readable empty aggregate Issue result (`rasen/specs/space-creation/spec.md:12,25-29`).
- **Satisfied:** the integration invokes the real built CLI, reads the resulting committed Store metadata, verifies version/id/layout plus UUID-shaped UID, then calls `handleStoreIssueProjections` and asserts status 200 with `issues: []` (`test/core/management-api/create-space.integration.test.ts:90-127`).
- **Actual consumer boundary:** `handleStoreIssueProjections` delegates to `composeIssueProjectionList`; its singleton query was created by `createStoreQueryByUid`, so `open()` resolves the new Store through the machine registry by UID and `finishStoreResolution` enforces both permanent UID and `layoutVersion === 2` before listing Issues (`src/core/management-api/stores.ts:236,316-332`; `src/core/store/query/module.ts:157-209,595-603,861-865`; `src/core/store/query/refs.ts:105-160`; `src/core/issue-read/composition.ts:287-316`).
- **Pre-fix failure is locked:** the removed production argv had no `--layout`, while the existing no-flag CLI regression proves setup intentionally omits the layout declaration by default. That state fails the exact `finishStoreResolution` gate above, so the new integration would fail both its metadata assertion and its Issue read before this one argv change.
- **No migration/downgrade:** focused existing tests prove a fresh explicit layout-v2 Store accepts immediate `add-project` with no mixed residue, a legacy Store refuses an attempted setup upgrade, and a layout-v2 rerun is a no-op.

### Verification evidence

- `pnpm exec vitest run test/core/management-api/create-space.test.ts -t "joins parent plus validated id and locates setup success by child root" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **1 passed, 39 skipped**; exact ordered argv is pinned.
- `pnpm exec vitest run test/core/management-api/create-space.integration.test.ts -t "creates a real layout-v2 Store whose empty Issue projection is readable|establishes and replays real membership once without changing the Project planning Store" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **2 passed, 1 skipped**. The membership case emitted its pre-existing legacy display-name hint warning but passed.
- `pnpm exec vitest run test/commands/store-setup-layout-cli.test.ts -t "authors the layout-2 declaration|passes an immediate add-project|refuses --layout 2 against an existing legacy store|treats a rerun against a store already declaring layout 2" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **4 passed, 3 skipped**.
- `pnpm exec vitest run test/commands/store-setup-layout-cli.test.ts -t "keeps the no-flag default exactly as setup creates it today" --reporter=verbose --maxWorkers=1 --minWorkers=1` — **1 passed, 6 skipped**; supplies the pre-fix counterfactual.
- `node bin/rasen.js validate space-creation --type spec --strict --json --no-interactive` — **1/1 passed**; only three informational long-requirement notices.
- `git diff --check -- <four reviewed files>` — **passed**, with LF→CRLF warnings for all four files.
- Strict UTF-8 decode — **passed for all four files**, UTF-8 without BOM or U+FFFD; newline counts are recorded in the Minor above.

### Verdict

**SEMANTICALLY REVIEW-CLEAN; NOT FILE-HYGIENE CLEAN.** The original QA Major is independently resolved: the producer emits the exact flag, the real CLI creates layout-v2 metadata with a permanent identity, and the real UID-addressed Issue consumer returns an empty usable projection. There are no open Blocker/Major findings. One Minor remains for mixed line endings in the four reviewed files.

### Durable findings

- Open: normalize the four reviewed files to CRLF without semantic edits and re-run UTF-8 plus `git diff --check` verification.
- Observed but non-blocking: the established membership integration prints the existing legacy display-name hint warning; it passed and is outside this remediation.

### Final newline-hygiene re-review

- Prior newline Minor: **RESOLVED.** All four reviewed files are uniformly CRLF: `src/core/management-api/create-space.ts` **683 CRLF / 0 bare LF / 0 bare CR**; `test/core/management-api/create-space.test.ts` **578 / 0 / 0**; `test/core/management-api/create-space.integration.test.ts` **184 / 0 / 0**; and `rasen/specs/space-creation/spec.md` **104 / 0 / 0**.
- Encoding: strict UTF-8 decode passed for every file; **no BOM** and **no U+FFFD replacement character**.
- Semantic stability: the four-file diff remains the previously reviewed **58 insertions / 7 deletions**, distributed exactly as before: space-creation spec **3/2**, create-space source **2/2**, real-CLI integration **52/2**, and exact-argv unit test **1/1**. The semantic hunks still contain only the approved `--layout 2` producer/spec/assertion changes, the empty Issue consumer proof, and the already-reviewed registered-Project integration edits; newline normalization introduced no text drift.
- Focused behavior gate: `pnpm exec vitest run test/core/management-api/create-space.test.ts test/core/management-api/create-space.integration.test.ts test/commands/store-setup-layout-cli.test.ts -t "joins parent plus validated id and locates setup success by child root|creates a real layout-v2 Store whose empty Issue projection is readable|authors the layout-2 declaration|keeps the no-flag default exactly as setup creates it today|passes an immediate add-project|refuses --layout 2 against an existing legacy store|treats a rerun against a store already declaring layout 2" --reporter=verbose --maxWorkers=1 --minWorkers=1` passed **3 files / 7 tests**, with **43 skipped**.
- Spec gate: `node bin/rasen.js validate space-creation --type spec --strict --json --no-interactive` passed **1/1** with only the same three informational long-requirement notices.
- Diff gate: `git diff --check -- <four reviewed files>` passed with no output or line-ending warning.

#### Final open findings

- Blocker: **0**
- Major: **0**
- Minor: **0**
- Trivial: **0**

#### Final verdict after newline fix

**REVIEW-CLEAN.** The created Store layout-v2 QA fix, real CLI/Issue-consumer regression proof, canonical specification update, and newline-hygiene remediation have no open findings. The original QA Major and the follow-up newline Minor are both resolved.
