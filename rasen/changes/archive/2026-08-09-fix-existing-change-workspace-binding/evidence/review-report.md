# Pre-Landing Review — `fix-existing-change-workspace-binding`

## Verdict

**CLEAN — Round 1 re-review passed.** The original **Major** identity-drift defect (`ST-1` / `SP-1`) is non-author-confirmed resolved. The separate **Minor** repository-wide-suite uncertainty remains accepted-known; it does not raise the current gate to Blocker/Major because the supplied post-fix bounded gate passed and no repository-wide attempt reported an assertion failure.

Pre-Landing Review: **1 open issue (0 critical/correctness, 1 informational/accepted-known)**

Current canonical severity ledger: **Blocker 0 · Major 0 · Minor 1 · Trivial 0**. `ST-1` and `SP-1` are closed as the same resolved implementation defect viewed on the two required axes; `AK-1` is the sole open accepted-known item.

## Round 1 re-review — current

- Mode: dispatched, report-only bounded delta re-review; no implementation/test edits, test reruns, external adversarial passes, commits, pushes, PR actions, or run-state changes.
- Base: `origin/dev/0.1.7` exactly. No PR exists, so Greptile triage was skipped.
- **Author != verifier: CONFIRMED.** The fixer delta was authored by another worker; this re-review was performed independently by the non-author reviewer `/root/identity_drift_reviewer`.
- Scope: the prior report, the create-side revalidation delta in `src/core/store/workspace/apply.ts`, the matching regression in `test/core/store/workspace-apply.test.ts`, and the originating retry/drift requirements.

### ST-1 / SP-1 resolution

**RESOLVED (non-author confirmed).** `applyWorkspacePlan()` now reads the existing entry for this Change and passes it into revalidation before any phase/carrier/index write (`src/core/store/workspace/apply.ts:283-290`). For each side originally planned as `create`, revalidation selects the recorded planning or execution `worktreeInstanceId` and raises `workspace_plan_stale` when the live identity differs (`src/core/store/workspace/apply.ts:154-180`). The guard remains symmetric across planning and execution sides and retains the expected-ref check.

The new regression starts with an execution side whose disposition is explicitly `create`, completes the first apply as `bound`, and snapshots both carriers plus the index (`test/core/store/workspace-apply.test.ts:333-354`). It then replaces that worktree with a different clone at the same path and expected branch, restores the original carrier bytes, retries the old token, expects `workspace_plan_stale`, and proves both carriers and the index remain byte-identical (`test/core/store/workspace-apply.test.ts:356-377`). This directly covers the original same-path/same-ref replacement failure and the spec's stable-retry and fail-closed carrier requirements (`specs/store-planning-worktree-bindings/spec.md:19-23,31-35`).

Independent gate evidence supplied by the LEAD after the fixer delta (not rerun by this reviewer):

```text
pnpm exec vitest run test/core/store/workspace-apply.test.ts test/commands/store-v2-workspace-journey.test.ts
PASS — 2 files, 21 tests, 21 passed; Vitest duration 153.45 s
```

No new or remaining Blocker/Major finding was found in this bounded delta. `AK-1` remains **Minor accepted-known** because `tasks.md:25` still leaves the repository-wide `pnpm test` run incomplete; the supplied focused gate does not change that repository-wide evidence boundary.

## Initial review identity and scope (historical)

- Mode: dispatched, report-only; no fixes, questions, commits, subagents, or external adversarial passes.
- Rasen Change: `fix-existing-change-workspace-binding`.
- Authoritative base: `origin/dev/0.1.7@d2cafbf28cfd62b3eddd8145f89ee9aea78847bb`.
- Reviewed branch/HEAD: `fix/existing-change-workspace-binding@d2cafbf28cfd62b3eddd8145f89ee9aea78847bb`; the implementation is an uncommitted working-tree diff on that base.
- Tracked diff: 4 files, 554 insertions, 3 deletions: `src/core/store/workspace/apply.ts`, `src/core/store/workspace/module.ts`, `test/core/store/workspace-apply.test.ts`, and `test/commands/store-v2-workspace-journey.test.ts`.
- Spec-axis sources were limited to the concrete paths returned by `node bin/rasen.js status --change fix-existing-change-workspace-binding --json`: `proposal.md`, `design.md`, `specs/store-planning-worktree-bindings/spec.md`, and `tasks.md`.

### Scope Check: REQUIREMENTS MISSING

Intent: complete and verify an already-created Change's workspace pair during token-only apply while retaining fail-closed drift, prepared-state, retry, and cleanup behavior (`proposal.md:3-11`).

Delivered: the diff adds canonical completion at the locked `StoreWorkspace.apply()` boundary, reused-worktree/carrier revalidation, and focused unit plus real-CLI lifecycle regressions.

Missing: `tasks.md:25` leaves the full `pnpm test` verification unchecked. This is recorded as accepted-known `AK-1`, not as evidence that an assertion fails. No unrelated product feature or dependency change was found.

## Initial review — Standards axis (historical)

_The sections below preserve the initial-round report. Their code/line references and present-tense wording describe the pre-fix delta; `ST-1` / `SP-1` are no longer open. The current disposition and current line evidence are in the Round 1 section above._

### ST-1 — [RESOLVED IN ROUND 1; historical Major] A create-disposition token accepted a different repository/worktree when its ref text matched

`revalidateWorkspacePlan()` handles `side.disposition === 'create'` by rejecting only an existing worktree whose `live.ref` differs, then immediately continues (`src/core/store/workspace/apply.ts:153-164`). The new frozen identity comparison is below that branch and therefore applies only to `reuse` (`src/core/store/workspace/apply.ts:166-195`). Consequently, after an existing-Change create plan has bound successfully, replacing either created worktree with a clone at the same path and expected ref lets a retry of the old token pass. `applyWorkspacePlan()` then records the replacement's live identity (`src/core/store/workspace/apply.ts:282-312,324-386`), and the canonical completion derives and persists a pair from those current identities (`src/core/store/workspace/module.ts:672-790`). The existing canonical pairing test confirms that, once admitted, a replacement identity produces a different pair (`test/core/store/workspace-pairing.test.ts:420-485`).

This is a stale-plan/concurrency correctness failure on a plausible recovery path: the same token can silently bind a different repository identity instead of refusing. It maps from Standards `CRITICAL` correctness to canonical **Major**, not Blocker: it requires destination replacement with a matching ref and has no demonstrated common-path data loss.

Recommended fix: when a create-side destination already exists, prove it belongs to the planned repository and, when this plan's index entry already records a non-empty side identity, require the live `worktreeInstanceId` to match before any phase/carrier/index write. Otherwise raise `workspace_plan_stale`. Add a regression: create-plan → bound apply → replace one side with a clone at the same path/ref → retry must refuse and leave both carriers and the index byte-identical.

Standards summary: **1 finding; worst Major**. No SQL/data-write, LLM trust-boundary, enum/value, frontend/design, dependency/bundle, documentation-staleness, or Fowler-smell finding applies to this diff. Design review was skipped because no frontend file changed.

## Initial review — Spec axis (historical)

### SP-1 — [RESOLVED IN ROUND 1; historical Major] Retry and drift guarantees were not met for a worktree originally planned as `create`

The spec requires a re-apply to return the same pair and leave recorded identities unchanged (`specs/store-planning-worktree-bindings/spec.md:19-23`), and requires any worktree-identity disagreement to refuse without rewriting carriers (`specs/store-planning-worktree-bindings/spec.md:31-35`). The create-branch bypass described in `ST-1` can instead overwrite the recorded identity and derive a new pair. This also falls short of the proposal's idempotence/drift guarantee (`proposal.md:9-11`) even though task 1.3's narrower reused-worktree case is implemented (`tasks.md:5`).

Recommended fix and regression: same as `ST-1`; the regression must start from a plan whose side disposition is `create`, because the new test at `test/core/store/workspace-apply.test.ts:333-369` covers only a later plan whose execution side is `reuse`.

### AK-1 — [Minor] [ACCEPTED-KNOWN] Repository-wide suite completion remains unproven

`tasks.md:25` is unchecked. Prior repository-wide attempts reportedly ended through timeout, IPC/orphaned-process behavior, or termination caused by overlapping runs; no assertion failure was reported. The independent bounded gate below passes all 20 tests in both changed files, including the real CLI archive/cleanup lifecycle, while the implementer's separately reported 46/46 focused tests plus build/lint success are supporting prior evidence only. Given the narrow diff and high-fidelity focused coverage, the unresolved full-suite signal is **Minor accepted-known**, not Blocker/Major. A clean, serialized repository-wide run remains desirable in a later integration/review cycle, but this reviewer intentionally did not run `pnpm test` or any unqualified suite command.

Spec summary: **2 findings (1 Major, 1 Minor accepted-known); worst Major**. Apart from `SP-1`, canonical completion reuse, frozen-plan inputs, normal returned-state projection, missing-execution prepared state, target-line/carrier refusal, workspace inspection, real archive dry-run consumption, and cleanup isolation are present and exercised.

## Initial claim audit (historical)

- **Canonical completion reuse:** `StoreWorkspace.apply()` calls `completeChangeBinding()` directly rather than deriving a pair locally (`src/core/store/workspace/module.ts:161-215`); the authority derives from Change plus both live worktree identities (`src/core/store/workspace/module.ts:672-790`).
- **Lock scope/order:** low-level apply and completion run in one callback while holding scope and provisional-workspace locks (`src/core/store/workspace/module.ts:161-216`). Lock order is fixed as scope → workspace and release is reverse-order (`src/core/store/workspace/locks.ts:43-49,219-254`). The shared scope lock also serializes cleanup while the provisional key transitions to the bound pair key (`src/core/store/workspace/module.ts:314-366`).
- **Token-only/frozen apply:** `apply()` accepts only `WorkspacePlanToken`, loads the stored immutable plan, and supplies plan scope/roots/path flavor to completion (`src/core/store/workspace/module.ts:161-199,413-447`). No cwd or selector is re-resolved.
- **Returned state projection:** normal bound/prepared results replace the low-level binding fields with the canonical completion state, Change identity, and pair identity (`src/core/store/workspace/module.ts:200-214`); result/index/show parity is asserted at `test/core/store/workspace-apply.test.ts:227-288` and `test/commands/store-v2-workspace-journey.test.ts:292-336`.
- **Missing execution:** canonical completion derives no pair and records `prepared` when execution identity is unavailable (`src/core/store/workspace/module.ts:724-788`); the apply regression asserts no pair in result/index (`test/core/store/workspace-apply.test.ts:291-331`).
- **Frozen/live reuse drift:** both planning and execution loop through the new worktree identity comparison (`src/core/store/workspace/apply.ts:140-195`); the execution replacement regression proves pre-write refusal and byte preservation (`test/core/store/workspace-apply.test.ts:333-369`). `ST-1` identifies the unprotected create-disposition complement.
- **Carrier and target-line conflict:** apply reads both carriers, checks each scope, then checks mutual pairing before writing (`src/core/store/workspace/apply.ts:198-231`). Apply-level marker refusal is covered at `test/core/store/workspace-apply.test.ts:371-401`; all carrier disagreement axes are covered directly against the canonical helpers at `test/core/store/workspace-binding.test.ts:193-286`.
- **Idempotence:** the normal existing-Change retry keeps pair and Change identities stable, creates no extra worktree, and preserves carrier bytes (`test/core/store/workspace-apply.test.ts:227-288`); the CLI retry also observes no new worktrees (`test/commands/store-v2-workspace-journey.test.ts:338-353`). This evidence does not cover the replacement retry in `ST-1`.
- **Archive dry-run is real, not mocked:** the journey calls `runCLI(['archive', ... '--dry-run', '--json'])` and inspects `archive.finalizationPlan.blockers` (`test/commands/store-v2-workspace-journey.test.ts:355-375`). `runCLI` executes the built `dist/cli/index.js` child process after a freshness check (`test/helpers/run-cli.ts:118-199`), and the fixture uses real temporary Git repositories/worktrees.
- **Cleanup/path isolation:** the journey removes only the completed pair and its index entry, preserves an unrelated pair/index, the Change metadata, both branches, and both main checkouts (`test/commands/store-v2-workspace-journey.test.ts:377-483`). New path assertions are built with `node:path`; the independent gate ran on Windows.

## Initial review coverage diagram (historical)

```text
CODE PATH COVERAGE
==================
[+] StoreWorkspace.apply(token)
    ├── [★★★ TESTED] scope + provisional-workspace lock wraps apply and completion
    ├── [★★★ TESTED] default new-Change plan -> prepared, no pair
    └── plan.changeInstanceId present
        ├── revalidateWorkspacePlan()
        │   ├── [★★★ TESTED] absent create destinations -> create both sides
        │   ├── [★★★ TESTED] valid same-token retry -> reuse existing sides
        │   ├── [★★★ TESTED] reuse identity drift -> stale refusal, no writes
        │   ├── [★★★ TESTED] marker target-line conflict -> refusal, carriers unchanged
        │   ├── [★★ TESTED] carrier pair/scope conflicts -> direct canonical-helper tests
        │   └── [GAP / MAJOR] create destination exists on expected ref but has a
        │       different repository/recorded identity -> accepted and rebound (ST-1/SP-1)
        ├── applyWorkspacePlan() -> worktrees -> carriers -> prepared index
        └── completeChangeBinding()
            ├── [★★★ TESTED] both identities -> bound + reproducible pair
            ├── [★★★ TESTED] execution identity unavailable -> prepared + no pair
            └── [★★★ TESTED] result/index/show projection and ordinary retry stability

USER FLOW COVERAGE
==================
[+] Existing-Change Store v2 lifecycle (real CLI)
    ├── [★★★ TESTED] plan --existing-change -> apply -> workspace show
    ├── [★★★ TESTED] retry -> same pair, no extra worktrees
    ├── [★★★ TESTED] archive --dry-run -> no workspace_pair_unavailable
    └── [★★★ TESTED] cleanup -> only target pair/index removed
[+] Drift/recovery
    ├── [★★★ TESTED] reused identity drift and marker conflict
    └── [GAP / MAJOR] originally-created side replaced by same-ref clone before retry

Coverage: 14/15 enumerated changed/relevant paths exercised; the one gap is the
behavioral defect ST-1/SP-1, not merely a missing assertion. E2E/eval additions: none.
```

## Initial independent verification gate (historical)

Exact command:

```text
pnpm exec vitest run test/core/store/workspace-apply.test.ts test/commands/store-v2-workspace-journey.test.ts
```

Result: **PASS — 2 files, 20 tests, 20 passed**. Vitest duration: **213.27 s**; outer measured duration: **214,813 ms**. The CLI freshness hook reported `dist/ matches the current sources; skipping build.` The command was bounded by a 480,000 ms outer timeout; neither file exceeded its own bounded test limits.

Prior evidence only (not independently rerun here): implementer reported **46/46 focused tests passed** and **build/lint passed**. Repository-wide attempts did not complete for process/timeout reasons and reported no assertion failure; see `AK-1`.

## Current follow-up

1. No Blocker/Major action remains; `ST-1/SP-1` is closed by the implementation guard, regression, and supplied post-fix gate.
2. Keep `AK-1` explicit until a clean serialized full-suite run completes; do not reinterpret the failed-to-complete attempts as assertion failures.

## Durable findings

- A stored create-disposition token needs recorded repository/worktree identity revalidation on retry; the Round 1 fix now enforces it before writes, because matching ref text is not identity.
- Keep archive eligibility coverage through the real CLI: the current dry-run test genuinely reaches finalization preflight and should remain.
- Treat the incomplete repository-wide runs as Minor accepted-known process uncertainty unless a reproducible assertion failure appears.

## CI-fix addendum

### Verdict

**CLEAN.** Independent non-author review of the PR #149 CI-fix delta found no new or remaining Blocker/Major issue. The current canonical severity ledger remains **Blocker 0 · Major 0 · Minor 1 · Trivial 0**; `AK-1` is preserved as the sole **Minor accepted-known** item.

- Review mode: dispatched, report-only, ONE_SHOT.
- Base/head: `dev/0.1.7` → `fix/existing-change-workspace-binding` (PR #149).
- Author != verifier: **CONFIRMED.** This addendum was produced by an independent reviewer who did not author the CI-fix delta.
- Reviewed scope: only `git diff HEAD -- src/core/store/layout-migration/evidence.ts` (nine changed lines replacing the `record.id ?? record.projectId` key with `record.projectId` and correcting its contract comment).
- Scope check: **CLEAN.** No product/test file was edited by this reviewer; unrelated untracked `.rasen/` and `evidence/ship-log.md` were excluded. No frontend/design surface or dependency change is present.
- Greptile: PR #149 has no Greptile comments to triage.
- Adversarial pass: skipped for this small bounded delta, as directed.

### Identity and mapping review

The fix restores the documented identity boundary. A v1 membership record's `projectId` is “the authority for which project this record describes,” while `id` is a display name that “Never keys anything” (`src/core/store/project-records.ts:183-187`). V2 preserves the same contract: `projectId` is the identity and the display name is never an identifier or path segment (`src/core/store/planning-catalogs.ts:29-37`). The normative membership spec likewise requires permanent identity to name membership and treats the display id as reading-only; it explicitly permits human labels such as `Elftia` (`rasen/changes/archive/2026-08-08-store-layout-v2-migration/specs/store-project-membership/spec.md:3-9,13-15,53-57`). Permanent project identities may validly be UUIDs or portable kebab ids, so the earlier assumption that every v1 `projectId` was a UUID was unsound.

The changed `projectKey` now remains canonical across every record-derived consumer: the `members` inventory, adoption lists, E2 spec/Change ownership evidence (`src/core/store/layout-migration/evidence.ts:160-188`), and the E3 registry-membership filter (`src/core/store/layout-migration/evidence.ts:232-249`). Mapping project values are validated as project identities and then checked against that member inventory (`src/core/store/layout-migration/mapping.ts:165-215,245-315`). Consequently, an operator mapping must name the permanent `projectId`—UUID or kebab—not the human display alias. Keying these paths by `id` would permit display-name collision/ambiguity and would contradict both schemas' permanent-identity contract.

The two CI failures were at exactly this boundary. Both fixtures distinguish `projectId: elftia` from `id: Elftia` and map ownership to the permanent identity `elftia` (`test/core/store/layout-migration-catalog-receipt.test.ts:132-174,206-233`). Using the display value made the mapping appear to name a non-member; restoring `projectId` makes the membership comparison correct without weakening the stricter remote-field or human-display-name behaviors those tests pin.

### Coverage and supplied verification

```text
v1 membership record
├── projectId (permanent UUID or kebab identity)
│   └── projectKey
│       ├── members ───────────────> mapping membership validation
│       ├── adoption lists ────────> E2 spec/Change ownership evidence
│       └── member set ────────────> E3 project-registry association filter
└── id (human display label) ──────> carried for reading only; never keys above

Regression seam: projectId `elftia` + display id `Elftia` + mapping `elftia`
                  └── both previously failing catalog-receipt cases now pass
```

Verification evidence was supplied by the CI-fix implementer/LEAD and was **not rerun by this reviewer**, per dispatch constraints:

- Each previously failing catalog-receipt case: **1/1 passed**.
- Full `layout-migration-catalog-receipt` file: **8/8 passed**.
- Layout-migration provenance tests: **10/10 passed**.
- Lint: **passed**.

This is sufficient coverage for the bounded identity-key correction. `AK-1` remains Minor accepted-known because this supplied focused evidence does not change the earlier repository-wide-suite evidence boundary.

### CI-fix durable findings

- Membership, ownership evidence, mapping assertions, and machine associations must all compare the permanent `projectId`; a display label is never a safe join key.
- Do not infer identity format from schema generation: both UUID and portable kebab project identities are canonical.
- Keep at least one regression fixture where permanent identity and display name differ in spelling/case; it exposes accidental alias-keying at the mapping-membership boundary.
