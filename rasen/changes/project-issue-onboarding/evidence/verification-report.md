# Verification Report: `project-issue-onboarding` portfolio

- Verified: 2026-08-31 (Asia/Shanghai)
- Branch: `feat/project-issue-onboarding`
- HEAD: `46edbf77934e20fe6b360c0aa91047ca08914cfc`
- Tree: `2b8550ca6e949a829bfc866f823da3f199e0459f`
- Verification mode: fresh, read-only portfolio verifier; this report is the only verification write

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Summary scorecard

| Dimension | Status | Evidence |
|---|---|---|
| Completeness | CLEAN | `project-store-membership-api` 11/11 tasks; `project-issue-onboarding-ui` 21/21 tasks; 32/32 combined. All 8 child planning artifacts exist. All 10 delta requirements and 40 scenarios are mapped below. Parent portfolio has 2/2 children `done`. |
| Correctness | CLEAN | 10/10 requirements and 40/40 scenarios have implementation and verification evidence. Required final gates passed: root build, 102 focused Store/Management tests, 1,027 UI tests, UI production build, four strict validations, diff hygiene, encoding, and locale parity. |
| Coherence | CLEAN | The implementation follows the parent Store-owned-Issue decision and both child designs: no Project-local Issue truth, no implicit Store selection, no client path/alias/adoption/primary-binding option, and no Project-prefixed Issue read surface. Both post-QA fixes are present and covered. |

## Scope, CLI resolution, and portfolio state

The current built CLI was used through `node bin/rasen.js`. `store list --json` shows a registered Project id `rasen`, but that entry points to the original checkout `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code`, not this verification worktree. Passing `--project rasen` would therefore read the wrong tree. Status, instructions, and validation intentionally used the nearest local `rasen/` root; every CLI response reported:

`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-project-issue-onboarding`

Resolution results:

- `node bin/rasen.js status --change "project-store-membership-api" --json` and `instructions apply`: schema `spec-driven`, artifacts complete, 11/11 tasks, state `all_done`.
- `node bin/rasen.js status --change "project-issue-onboarding-ui" --json` and `instructions apply`: schema `spec-driven`, artifacts complete, 21/21 tasks, state `all_done`.
- The parent `project-issue-onboarding` is deliberately a portfolio/planning shell rather than a third implementation Change, so artifact status reports no proposal/spec/design/tasks. Its committed `planning-context.md` defines the product decision, decomposition, dependency, and verification scope.
- `.rasen/changes/project-issue-onboarding/ephemera/portfolio-run.json` names both children, keeps the UI dependent on the API child, and records both as `done`. Parent delivery remains `pending`, as expected before LEAD delivery.
- Child `auto-run.json` records apply/verify/review-loop/ship complete and archive pending. Child ship evidence is local-only, consistent with the parent rule that no partial portfolio is pushed.

Verification was risk-bounded as directed: the five affected Store/Management files plus the full UI suite were run; the entire root test suite was not run. The known 13 pre-existing UI Canvas typecheck diagnostics were not deliberately rerun. No Canvas source is changed by this branch, while the root build, full UI tests, and UI production build all pass.

## Completeness

| Change | Proposal | Design | Delta specs | Tasks | Checklist |
|---|---:|---:|---:|---:|---:|
| `project-store-membership-api` | present | present | 2 | present | 11/11 |
| `project-issue-onboarding-ui` | present | present | 2 | present | 21/21 |
| Combined | 2 | 2 | 4 | 2 | 32/32 |

Independent checkbox parsing found zero `- [ ]` items. CLI task parsing independently reported the same totals.

Delta inventory:

- API child: 3 requirements, 12 scenarios.
- UI child: 7 requirements, 28 scenarios.
- Portfolio total: 10 requirements, 40 scenarios.

## Requirement and scenario evidence

### Child: `project-store-membership-api`

#### 1. `management-http-api` — The spaces path admits explicit Project-to-Store membership under the management security posture

Implementation:

- Route admission and response/error forwarding: `src/core/management-api/router.ts:330`, `:633`, `:1761`.
- Root/UI request-response unions: `src/core/management-api/wire-types.ts:699`, `packages/ui/src/api/types.ts:915`.
- Typed two-id client seam: `packages/ui/src/api/client.ts:491`.
- Bounded whitelist row: `src/core/management-api/whitelist.ts:57`.

Scenario mapping:

- **Authorized membership request reaches the bounded bridge** → canonical and trailing-slash admission at `test/core/management-api/router.test.ts:375`; successful typed 200 bridge result at `test/core/management-api/create-space.test.ts:315`.
- **Membership request requires the launch token** → unauthenticated membership is 401 `unauthorized` before resolution at `test/core/management-api/router.test.ts:404`.
- **Unsupported methods remain read-only failures** → PUT/DELETE are 405 on both accepted path forms at `test/core/management-api/router.test.ts:420`.
- **UI client sends only the typed membership intent** → exact POST body contains only `op`, `projectId`, and `storeId` at `packages/ui/test/api/client.test.ts:398`; strict root/UI type equality probe at `test/core/management-api/space-creation-wire-mirror.test.ts:109`.

#### 2. `space-creation` — An existing Project can join an existing Store through an explicit space operation

Implementation:

- Strict request member and field validation: `src/core/management-api/create-space.ts:222`, `:245`.
- Fresh typed Project/Store catalog resolution and exact argv: `src/core/management-api/create-space.ts:370`, `:381`.
- Shell-free fixed-cwd spawn: `src/core/management-api/create-space.ts:519`.
- CLI identity/root correlation, fresh target-root lookup, exactly-one canonical Project member, and HTTP 200 typed result: `src/core/management-api/create-space.ts:431`, `:586`.
- The post-QA registered-Project identity precedence used by the invoked CLI is at `src/core/store/operations.ts:584` and is threaded into `storeAddProject()` at `src/core/store/operations.ts:1211`.

Scenario mapping:

- **Add the current Project to an empty Store** → exact argv/fresh pre-post result at `test/core/management-api/create-space.test.ts:315`; real CLI membership and unchanged planning Store at `test/core/management-api/create-space.integration.test.ts:129`.
- **Retry an already-established membership** → unit replay at `test/core/management-api/create-space.test.ts:359`; real CLI two-call replay with one member at `test/core/management-api/create-space.integration.test.ts:150`.
- **Multiple possible Stores never create an implicit choice** → resolver filters only the explicit Store id at `src/core/management-api/create-space.ts:403`; ambiguous same-id Stores fail closed at `test/core/management-api/create-space.test.ts:260`; UI explicit multi-Store selection is proven at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:205`.
- **Windows Project root remains one argv value** → metacharacter/space root is asserted as one exact argv token with `shell:false` behavior at `test/core/management-api/create-space.test.ts:315`.

#### 3. `space-creation` — Project-to-Store membership is validated, bounded, and observable

Implementation:

- Only documented fields; non-empty, capped, control-free identifiers: `src/core/management-api/create-space.ts:222`, `:245`.
- One shared in-flight slot and pre-read inside the slot: `src/core/management-api/create-space.ts:448`.
- 60-second bound, TERM→KILL escalation, and release only on close: `src/core/management-api/create-space.ts:547`.
- 422 CLI passthrough and fail-closed protocol/postcondition handling: `src/core/management-api/create-space.ts:586`, `:622`.

Scenario mapping:

- **Invalid or unresolved identifiers spawn nothing** → malformed/missing/cross-operation/path cases at `test/core/management-api/create-space.test.ts:103`; zero/wrong-type/ambiguous typed lookup at `test/core/management-api/create-space.test.ts:217`.
- **CLI refusal remains actionable** → 422 with exit code/message and no post-read at `test/core/management-api/create-space.test.ts:531`.
- **Successful exit without visible membership is a protocol error** → correlation/root mismatch and absent/duplicate postcondition cases at `test/core/management-api/create-space.test.ts:384`, `:404`, and `:454`.
- **Membership and creation serialize through one bridge** → overlapping request receives 409 and the first request is bounded by timeout at `test/core/management-api/create-space.test.ts:553`.

### Child: `project-issue-onboarding-ui`

#### 4. `issue-board-ui` — The Issue read surface is reachable from Store-space navigation

Implementation:

- Exact Project onboarding route plus Store-only Board/Detail routes: `packages/ui/src/app.tsx:114`.
- Namespace-specific Issues navigation: `packages/ui/src/components/Layout.tsx:74`.
- The onboarding module imports neither Issue Board nor Issue Detail: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:1`.

Scenario mapping:

- **A Store space navigates to its Board** → `packages/ui/test/app.test.tsx:260` and `:273`.
- **A deep link lands on the Detail** → direct Store Detail without Board mount at `packages/ui/test/app.test.tsx:265`.
- **A Project space offers no Issue read surface** → Project gets onboarding nav while Store retains read ownership at `packages/ui/test/app.test.tsx:281`.
- **A Project Issue URL never mounts the read surface** → exact onboarding-only route at `packages/ui/test/app.test.tsx:297`; Project-prefixed Detail refusal at `packages/ui/test/app.test.tsx:340`.

#### 5. `project-issue-onboarding` — Every Project exposes a transitional Issues onboarding surface

Implementation:

- Project-keyed route wrapper: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:34`.
- Project Issues nav and active state: `packages/ui/src/components/Layout.tsx:74`.
- Project home remains Board and Store home remains Issues: `packages/ui/src/store/use-space.ts` behavior pinned by `packages/ui/test/store/use-space.test.ts:131`.

Scenario mapping:

- **Project navigation opens onboarding** → `packages/ui/test/app.test.tsx:281` and `:297`; current Project/topology render at `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:159`.
- **Project Issues is not a read-surface alias** → no Board/Detail at `packages/ui/test/app.test.tsx:297`; canonical Project home remains Board at `packages/ui/test/store/use-space.test.ts:132`.
- **Store Issues remains canonical** → Store routes at `packages/ui/src/app.tsx:117`; Project deep Issue URL is refused at `packages/ui/test/app.test.tsx:340`; no Project-prefixed Detail route exists.

#### 6. `project-issue-onboarding` — Store membership routing is derived from the current spaces catalog

Implementation:

- Owned entry/retry refresh and successful-settle gate: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:53`, `:66`, `:88`.
- Render-time Store filtering and trim/lowercase Project equality only: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:21`, `:104`.
- Zero/one/many branches with replace navigation and no stored membership map: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:112`, `:117`, `:231`, `:237`, `:262`.

Scenario mapping:

- **One membership enters its Store automatically** → replace navigation at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:184`.
- **Canonical-equivalent Project ids resolve one membership** → uppercase route/lowercase member auto-route without mutation at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:193`.
- **Multiple memberships require an explicit choice** → remains on Project route until Store B is selected at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:205`.
- **Zero memberships offers joining paths** → unresolved-to-zero transition at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:153`; the selection/create controls are rendered at `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:262`.
- **Catalog failure does not guess a destination** → retained rows do not route and retry succeeds at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:167`.
- **Catalog change replaces the derived relationship** → shared publication recomputes membership and routes at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:323`.

#### 7. `project-issue-onboarding` — A Project with no membership can explicitly join an existing Store

Implementation:

- Only `addProjectToStore(project.id, store.id)` is called: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:122`.
- Success order is publish returned Store → start refresh → replace-route returned Store id: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:129`.
- Failure preserves target and re-enables controls: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:135`, `:273`.

Scenario mapping:

- **Join an empty Store** and **successful membership is visible during navigation** → exact ids and event order at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:217`.
- **Membership failure remains retryable** → same explicit target is retained/retried at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:251`.
- **A different Store can be selected after failure** → second request uses only Store B at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:294`.
- API-returned truth, rather than selected-row truth, drives publication/navigation at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:336`.

#### 8. `project-issue-onboarding` — Store creation hands off to recoverable membership establishment

Implementation:

- Minimal fixed-operation/onSuccess interface, dialog-owned validation/create/publish/refresh, and callback navigation suppression: `packages/ui/src/components/CreateSpaceDialog.tsx:18`, `:58`, `:85`, `:127`.
- Onboarding closes creation into the normal membership path and preserves partial success: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:144`, `:267`, `:326`.

Scenario mapping:

- **Create a Store and join it**, **creation succeeds but membership fails**, and **retry after partial success** → one creation, recoverable error, membership-only retry, and canonical success at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:371`.
- **Standalone space creation remains unchanged** → all three operations at `packages/ui/test/components/spaces-page.test.tsx:385`; default Project/Store create/register navigation remains covered at `:274`, `:356`, and `:535`; fixed callback/no-navigation at `:392`.

#### 9. `project-issue-onboarding` — Onboarding state and interactions belong to the current Project attempt

Implementation:

- Selector-keyed child, mount invalidation, monotonically increasing catalog/membership attempts, and imperative in-flight guard: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:38`, `:61`, `:66`, `:77`, `:122`.

Scenario mapping:

- **Project transition clears interaction state** → late Project A catalog result cannot affect Project B at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:402`.
- **Late success cannot navigate a newer owner** → late join, late creation, and whole-tree unmount cases at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:418`, `:439`, and `:464`.
- **Duplicate submission is bounded** → disabled pending submit plus imperative guard produces one request at `packages/ui/test/components/project-issue-onboarding-page.test.tsx:272`.

#### 10. `project-issue-onboarding` — Onboarding explains the Project-to-Store topology accessibly

Implementation:

- Semantic labelled relationship list with textual Project, membership, Store, canonical destination, and aria labels: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:159`.
- Native button/radio controls remain in document order; existing visible focus token is applied, including the selected Store label: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:237`, `:262`; `packages/ui/src/style.css:1120`.
- Token-only warm-editorial presentation, no onboarding animation, and a vertical 720px layout with textual relationships retained: `packages/ui/src/style.css:1063`, `:1135`.
- All onboarding and shared picker copy exists in English, Japanese, and Simplified Chinese: `packages/ui/src/i18n/locales/en.json:71`, `:804`; equivalent keys in `ja.json` and `zh-cn.json`.

Scenario mapping:

- **Topology communicates ownership** → semantic/textual rail above plus final browser QA's verified `Project → Store → Issues` behavior in `rasen/changes/project-issue-onboarding-ui/evidence/qa-report.md`.
- **Keyboard navigation remains visible** → native controls in DOM order and shared `:focus-visible`/onboarding `:focus-within` styling at `packages/ui/src/style.css:152`, `:214`, and `:1126`.
- **Narrow layout preserves the relationship** → vertical media-query contract at `packages/ui/src/style.css:1135`; relationship labels remain visible text and only the supplemental arrow is rotated.
- **Locale catalogs cover onboarding** → real Japanese and Simplified-Chinese fixed-dialog rendering at `packages/ui/test/components/spaces-page.test.tsx:440` and `:493`; catalog key parity/damage checks at `packages/ui/test/i18n/catalog.test.ts:20` and `:62`; final independent parity is 801/801/801 keys.

## Post-QA fixes

### Registered Project identity precedence

`store add-project` now resolves display identity in the canonical order: existing metadata → explicit `--as` → registered Project identity for the canonical root → folder basename. Canonical registry alias disagreement fails closed. The Management API continues to pass no alias.

- Implementation: `src/core/store/operations.ts:584`, `:598`, `:1211`; API argv at `src/core/management-api/create-space.ts:427` contains no `--as`.
- Canonical spec: `rasen/specs/store-add-project/spec.md:77`, with registered-identity, alias-conflict, fallback, and API-no-alias scenarios at `:84`, `:89`, `:94`, and `:99`.
- Tests: registered identity/non-kebab root, explicit/metadata precedence, alias conflict, dry-run, and Windows normalization at `test/commands/store-add-project.test.ts:85`, `:111`, `:140`, `:184`, `:225`, `:253`; real Management API/CLI replay at `test/core/management-api/create-space.integration.test.ts:129`.
- Final focused gate: all 19 `store-add-project` tests and all 3 real create-space integration tests passed.

### `create-store` layout v2

Management Store creation now invokes `store setup <id> --path <root> --layout 2 --json`, so a fresh Store has permanent identity/layout v2 and can serve an empty canonical Issue Board.

- Implementation: `src/core/management-api/create-space.ts:15`, `:326`.
- Canonical spec: `rasen/specs/space-creation/spec.md:12`, scenario at `:25`.
- Tests: exact argv at `test/core/management-api/create-space.test.ts:137`; real metadata plus empty Store aggregate Issue projection at `test/core/management-api/create-space.integration.test.ts:90`.
- Final focused gate: the exact argv test and real layout-v2/empty-projection test passed.

## Design and pattern coherence

- API D1-D6 are followed: one additive union member, fresh server-owned catalog lookup, existing bounded CLI bridge, no invented idempotency state, one root wire source plus exact UI mirror, and public-boundary tests.
- UI D1-D8 are followed: one transitional Project route, render-time catalog derivation, selector/attempt ownership, the two-id client seam, a minimal controlled Store-creation seam, recoverable partial success, one semantic topology rail, and route/dialog/onboarding tests.
- Existing patterns are reused (`SpaceCatalogProvider`, `spaceHref`, `PageHeader`, `CreateSpaceDialog`, Management error envelopes, bounded whitelist, Store CLI/core mutation). No new dependency, cache, membership index, preferred Store, planning rebind, adoption path, or Project-local Issue model was introduced.
- Parent decomposition is coherent: the API child supplies the contract first; the dependent UI child consumes it unchanged; both deliver in one parent branch.

## Findings by canonical severity

### Blocker

None.

### Major

None.

### Minor

None.

### Trivial

None.

Strict validation emitted informational long-requirement suggestions for 7 existing `store-add-project` requirements and 3 existing `space-creation` requirements. Both specs remained valid; these INFO messages do not describe a behavior, coherence, or gate defect and are not canonical findings.

## Final gates

| Command | Result |
|---|---|
| `pnpm run build` | PASS, exit 0; TypeScript compiled and ProcessCapsule `win32-x64` built. |
| `pnpm exec vitest run test/commands/store-add-project.test.ts test/core/store/membership-operations.test.ts test/commands/store-membership-cli.test.ts test/core/management-api/create-space.test.ts test/core/management-api/create-space.integration.test.ts` | PASS, 5/5 files, 102/102 tests. |
| `pnpm --dir packages/ui run test` | PASS, 75/75 files, 1,027/1,027 tests. Non-failing jsdom `scrollTo`/navigation diagnostics are existing harness noise. |
| `pnpm --dir packages/ui run build` | PASS, exit 0; Vite transformed 567 modules and emitted production assets. |
| `node bin/rasen.js validate "project-store-membership-api" --type change --strict --json` | PASS, 1/1 item, 0 failed, 0 issues. |
| `node bin/rasen.js validate "project-issue-onboarding-ui" --type change --strict --json` | PASS, 1/1 item, 0 failed, 0 issues. |
| `node bin/rasen.js validate "store-add-project" --type spec --strict --json` | PASS, 1/1 item, 0 failed; 7 INFO long-text suggestions. |
| `node bin/rasen.js validate "space-creation" --type spec --strict --json` | PASS, 1/1 item, 0 failed; 3 INFO long-text suggestions. |
| `git diff --check origin/dev/0.2.0...HEAD` | PASS, exit 0, no output. |
| PowerShell strict UTF-8/BOM/U+FFFD/mojibake scan over `git diff --name-only --diff-filter=ACMRT origin/dev/0.2.0...HEAD` | PASS; 67 changed files, 59 text files decoded strictly, 8 PNG files skipped as binary, 0 violations. |
| Node recursive locale-key parity check over `en.json`, `ja.json`, and `zh-cn.json` | PASS; 801 leaf keys per locale, 0 missing, 0 extra. |

The encoding scan used `System.Text.UTF8Encoding(false, true)`, rejected UTF-8 BOM, checked U+FFFD, and scanned the repository-mandated typical mojibake signatures. Locale JSON syntax was also exercised by the full UI suite and production build.

## Test evidence

TEST EVIDENCE
- scope: focused Store/Management branch tests plus the complete UI package suite, root build, UI production build, strict child/canonical validation, diff hygiene, strict changed-text encoding, and locale parity
- rationale: the branch changes the Store membership CLI/Management bridge and Project onboarding UI; the selected five backend/Store files exercise those bounded modules including real CLI integration and both post-QA fixes, while the complete UI suite covers all UI routes/components/catalogs. The entire root suite and the known-failing standalone UI typecheck were intentionally excluded per the verification brief.
- command: `pnpm run build`; `pnpm exec vitest run test/commands/store-add-project.test.ts test/core/store/membership-operations.test.ts test/commands/store-membership-cli.test.ts test/core/management-api/create-space.test.ts test/core/management-api/create-space.integration.test.ts`; `pnpm --dir packages/ui run test`; `pnpm --dir packages/ui run build`; four strict `node bin/rasen.js validate ... --json` commands listed above; `git diff --check origin/dev/0.2.0...HEAD`; strict PowerShell changed-text scan; Node locale parity scan
- result: pass
- tree: `2b8550ca6e949a829bfc866f823da3f199e0459f`

## Final assessment

All child tasks, delta requirements, scenarios, design decisions, parent portfolio constraints, and required gates are satisfied. The two QA-discovered product gaps are fixed in the current HEAD and exercised in the final gate. The portfolio is verification-clean and ready for the LEAD's parent-level delivery step; it has not been archived, pushed, merged, or otherwise delivered by this verifier.
