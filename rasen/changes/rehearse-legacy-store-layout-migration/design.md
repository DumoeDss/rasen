# Design: rehearse-legacy-store-layout-migration

## Context

### What the flow actually does today (verified against code, dev/0.2.0 2026-08-26)

One command drives everything: `rasen store migrate-layout <store-id>` (`src/commands/store-migrate-layout.ts:229`). Default is preview: `inventory()` then `plan()`; `--apply` consumes the plan token; `--status` / `--resume` / `--rollback` / `--retire-flat` route to `status()` / `recover()`; `--mapping`, `--default-target-line`, `--include-untracked`, `--json` shape the plan. The command formats only; every decision lives in `StoreLayoutMigration` (`src/core/store/layout-migration/module.ts:115`).

- **Inventory** (`inventory.ts:166`): surveys EVERY local and remote-tracking ref by reading `git show <ref>:.rasen-store/store.yaml` without checkout (`surveyRefs`, `inventory.ts:74`), classifying each as `layout-v2` / `flat` / `no-store-metadata` / `unreadable`; then enumerates the checked-out working tree's flat collections (specs/changes/archive/design-docs/membership records — directories only, so `.gitkeep` files are invisible, `flat-source.ts:185-207`) and folds everything into a single sha256 `fingerprint`. Unreadable items are recorded as failures, never fatal.
- **Plan** (`plan.ts:177`): must be invoked from inside the Store worktree (`module.ts:607`). Builds a pure, content-addressed plan (`planId = sha256(canonicalJson)`, `plan.ts:1119`) and stores it in the machine coordination root (`module.ts:159-167`), never in either repository. The apply gate is `applicable = blockers.length === 0 && frozenItems.length > 0` (`plan.ts:1048`) — note the second conjunct; it matters below.
- **Apply** (`module.ts:171`): loads the plan by `planId` + `inventoryFingerprint`, takes an owner-aware machine lock keyed by storeUid+ref (`module.ts:205`), re-validates everything (`apply.ts:271`: metadata reparses and does not already declare layout 2, ref and HEAD unchanged, per-item source digests, destinations still absent, mapping digest), stages copies into `.rasen/migration/staging/<planId>` inside the Store (same volume, so publication renames are atomic), verifies the staged tree, then publishes in order (`apply.ts:1032`): project-catalog in-place upgrades with previous bytes saved into the manifest -> target-line catalogs -> items -> generated Issue trees -> receipt, each step a durable prepared-operation manifest write, rename, digest re-verify, completed-operation write. The `layoutVersion: 2` flip is written LAST (`apply.ts:1220-1242`) as the single linearization point. Nothing ever touches the git index; the command prints pathspec-scoped commit suggestions (`apply.ts:1342`).
- **Retirement** is a separate, idempotent action (`module.ts:424`; `retireFlatTree` `apply.ts:1264`): requires a recorded publication and the committed receipt, removes the retirement set plus the adoptions manifest, and stamps the receipt `retired`.

### How attribution decides a projectId (the sharp edge)

Evidence classes (`evidence.ts:50`): E1 recorded identity (the Change's own `.openspec.yaml identity.projectId`, or `archive.json` with `schemaVersion: 2`), E2 store records (`.rasen-store/projects/*.yaml` adoption name lists and `.rasen-store/adoptions.yaml`), E3 machine association (project-home `changes/<name>/` directories, admitted only when the project is a member of this Store), E4 the explicit mapping file. The reducer (`reduceOwnership`, `evidence.ts:323`): E1 binds and is never overridden (two disagreeing E1s -> `evidence-conflict`); otherwise E2 and E3 together must name exactly one project (disagreement -> `evidence-conflict`, none -> `unknown-owner`); the winner then passes the portable-id gate (`unrecordable-identity`) and the membership gate (`non-member-owner`). Mapping v1 resolves only unknown/conflict; mapping v2 may override E2/E3 but never E1 — `validateMappingAgainstInventory` (`mapping.ts:446`) rejects any mapping entry that contradicts a recorded identity, names an item the inventory does not contain, or names a project that is not a member. Target lines are never derived from a branch or ref (`plan.ts:168`); a missing declaration is `missing-target-line`. Canonical specs are attributed through a bipartite provenance graph over every active and archived Change delta (`buildSpecProvenance`, `evidence.ts:409`); an unresolved contributor propagates as unknown, and more than one contributor is `shared-spec` until the mapping declares `owner` or `split`. Excluded heuristics (name prefix, branch name, adjacency) are asserted excluded by `layout-migration-provenance.test.ts`.

### What the recovery manifest covers

Machine-local JSON at `<coordination>/<storeUid>/<refSlug>/manifest.json` (`apply.ts:240`). Version 2 carries: a `runId` distinct from the plan id (enforced, `apply.ts:198`), phase (`staged/verified/publishing/published/retired/rolled-back/failed`), `createdPaths`, `replacedFiles` (verbatim previous bytes of every overwritten file), and an `operations` ledger (prepared/completed, expected digest, staged + destination paths, all containment-checked). A mid-apply failure writes the LATEST accumulated manifest with phase `failed` (`module.ts:291-331` — the accumulation bug there was already found and fixed once); the staging directory survives; because the flip is last, readers still see an intact flat store. `--status` reports it; `--resume` re-stages, verifies operation ownership by runId+digest (`apply.ts:547`), and continues; `--rollback` removes only digest-verified created paths in reverse order and restores `replacedFiles` (`apply.ts:1295`); rollback after retirement refuses and names Git as the recovery path (`module.ts:395`).

### SS15 migration-row coverage today: all six rows have tests, none has real-store evidence

| SS15 row | Existing coverage | Nature |
|---|---|---|
| adoption journal uniquely recovers projectId | `layout-migration-provenance.test.ts` (E2 adoption list) | synthetic fixture |
| two projects' same-name Change no-clobber | `layout-migration-plan-gates.test.ts` (destination-exists) + `layout-migration-windows-paths.test.ts` (case-fold) | synthetic fixture |
| unknown / conflict / shared-spec block apply | provenance + module tests ("one gate with no override") | synthetic fixture |
| Windows case/drive, UTF-8 names, long paths | `layout-migration-windows-paths.test.ts` (mixed-case drive letters, non-ASCII store path and capability, MAX_PATH crossing, reserved device names) | synthetic fixture |
| recoverable failure at any copy/rename/manifest step | `layout-migration-apply-recovery.test.ts` (failed copy, failed mid-publication rename, failed layout flip, failed retirement, fresh-process reconcile, legacy-v1 upgrade) | synthetic fixture with injected faults |
| multiple flat refs fully reported | `layout-migration-module.test.ts` + inventory tests | synthetic fixture |

Every suite seeds its own temp git store; none runs the shipped CLI against a registered store through the machine registry, and none has ever seen a store produced by real usage. That is the gap this change closes — the fixtures are good (they even build real git repos), but they only encode shapes their authors imagined.

### The real material, characterized (read-only, 2026-08-26)

`E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/rasen-store` (registered uid `f35acc7d-e088-4186-9ad6-b4b770649b0b`): ONE commit ("Initialize Rasen store rasen-store"), single branch `master`, no remote, single worktree. `rasen/specs/` and `rasen/changes/archive/` hold only `.gitkeep`; there are no active changes, no design docs, no `.rasen-store/projects/`, no adoptions manifest. The COMMITTED metadata is `version: 1, id: rasen-store` (no uid); the WORKING TREE has two uncommitted modifications: `store.yaml` upgraded to `version: 2` + `uid` (an `upgrade-identity` that was never committed) and `rasen/config.yaml` gaining `tools: []` beside an orphan root `projectId: 865e2da5-...` (the exact minted-projectId seam sibling A's D1 removes from fact selection). Files are LF with autocrlf rewrite warnings — a genuine Windows-host shape.

Consequences that drive this design:
1. **The store is wedged today, and migration cannot unwedge it.** Zero inventoried items means zero plan items, and `plan.ts:1048` requires `frozenItems.length > 0`, so the plan is never applicable; meanwhile partition writes refuse with `legacy_flat_store_requires_migration` (`layout-write-guard.ts:246`), whose fix text says to run exactly the migration that cannot complete. An empty legacy flat store is a dead end by construction. This is the one defect already admitted to the fix scope before the rehearsal runs.
2. **Copy and clone are materially different rehearsal materials.** A `git clone` drops the uncommitted metadata upgrade and yields the committed `version: 1`, no-uid shape; a directory copy preserves the live drift (v2+uid metadata, dirty tracked files, orphan config projectId). Both shapes are real; both get rehearsed.
3. **The copy carries the REAL store's uid.** Registering it against the real machine registry would collide with / repoint the real `rasen-store` registration. Full environment redirection is a correctness requirement here, not just hygiene.

## SAFETY — the hard constraint (implementer: read this first)

The real store at `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/rasen-store` is the user's LIVE planning store for another project.

- You may READ it: `ls`, `git -C <path> log/show/diff/worktree list`, `cat` of metadata. Nothing else.
- You MUST NOT: run `rasen store migrate-layout` (any mode, including `--status` or preview) with the real registry resolving to it; register, unregister, adopt, add-project, upgrade-identity, or issue any non-read git command (`add`, `commit`, `checkout`, `worktree add`, `gc`, ...) against it; write, create, or delete any file under it; or "fix" its dirty working tree.
- Every rehearsal action runs against a disposable copy in a temp root, under a redirected environment: `RASEN_HOME=<temp>/rasen-home` (XDG_DATA_HOME is only a compatibility alias — set `RASEN_HOME`), `GIT_CONFIG_GLOBAL=<temp>/gitconfig` (with a committed identity — commits fail without one), real built CLI `node <repo>/bin/rasen.js`. Before ANY mutating command, verify `rasen store list --json` under the redirected env resolves the store id to the COPY's path.
- Preview (`migrate-layout` with no `--apply`) writes plan state into the machine coordination root — under redirection that is the temp root, which is why even "dry-run" commands must run redirected.
- Teardown: unregister the copy in the redirected registry, then delete the temp root. EBUSY on Windows rmdir is a known local hazard; retry, and never fall back to deleting anything outside the temp root.

## Goals / Non-Goals

**Goals:**

- Rehearse the complete official migration flow (inventory -> plan -> mapping -> re-plan -> apply -> status -> retire-flat, plus refusal and staleness paths) against disposable copies of the real legacy store, through the real CLI and the real machine registry (redirected), on the real Windows host.
- Capture the evidence — plan JSON, refusal texts with codes and fixes, receipts, recovery manifests, registry states — under this change's `evidence/` directory, in a form a later reader can audit without re-running anything.
- Triage everything surfaced against recorded criteria; fix and guard each admitted defect; record accepted-knowns with reasons.
- Land the missing `store-layout-migration` capability spec so the flow's contract survives archive.
- Close the empty-store dead end (pre-admitted defect).

**Non-Goals:**

- Migrating, mutating, or registering the real `rasen-store` (see SAFETY).
- Fixing anything in sibling-owned files: `src/core/store-planning/internal/resolver.ts`, `src/core/store/identity.ts` (sibling A), `src/core/store/workspace/plan.ts`, `src/core/store/workspace/apply.ts` (sibling B). Findings that implicate them are recorded in the triage table and handed over, not fixed here. (The orphan `rasen/config.yaml` projectId in the real store is already known to sibling A's scope — D1 — and is characterization material here, not a fix target.)
- Redesigning attribution, the mapping format, or the publication protocol. Fail-closed refusals are the design; the rehearsal asks "is this refusal correct and legible?", never "how do we get past it".
- Long-path (>= ~247 char) coverage through real `git init`/`git -C` — impossible on this host regardless of `core.longpaths` (git chdirs before reading the setting); stays fixture-only and is stated as such in the acceptance summary.
- Store-issue conversion rehearsal (`kind: store-issue` mapping dispositions) beyond what the enriched variant naturally exercises; the migration-compiler seam has its own suites.

## Decisions

### D1 — Two disposable variants: working-tree copy (primary) and git clone (secondary)

The rehearsal uses BOTH, because they are different real shapes (Context, consequence 2). The copy (plain recursive directory copy of the whole store, `.git` included; on Windows `robocopy /E` — exit codes 0-7 are success, >= 8 is failure) preserves the uncommitted metadata upgrade, the dirty tracked files, and the uid — the store as it actually exists. The clone preserves only committed truth — `version: 1`, no uid — and exercises the `store register` -> `upgrade-identity` -> migrate chain plus the `store-identity-missing` block (`plan.ts:113`). *Alternative considered:* clone-only (cleaner, git-native) — rejected: it silently discards exactly the drift (uncommitted identity upgrade, dirty worktree) that makes this store real material.

### D2 — Three rehearsal stages, each with its own claim

1. **Pristine-copy rehearsal** (the store as it is): registration of the copy under the redirected registry, inventory/plan/status against an EMPTY legacy store, the wedge reproduction (partition write refusal + inapplicable empty plan + `--apply` exit path + `--retire-flat` refusal), refusal legibility. This is the only stage that speaks for the real store itself.
2. **Enriched-copy rehearsal**: layer realistic flat content ONTO a copy (committed via the redirected git identity): active changes with and without recorded identity, an archive entry with and without `archive.json`, one canonical spec touched by two archived changes (shared-spec), one UTF-8 Chinese-named change and spec, membership records for two projects (one with adoption lists), a second local branch also carrying flat content, and a deliberately dirty tracked file under one change. Then the full flow: plan (expect the enumerated refusals), author the mapping file, re-plan, `--apply`, `--status`, `--retire-flat`, plus one staleness rehearsal (edit a source between plan and apply; expect `migration_plan_stale` naming the item). Honesty note recorded in the evidence: enriched content is authored, so these checks are "real CLI + real registry + real Windows host + real store lineage", not "real content"; that is still strictly more than any existing test does (none goes through the registry or the shipped binary).
3. **Clone rehearsal**: register the clone, walk the identity chain (`store-identity-missing` block -> `upgrade-identity` -> re-plan), confirming the repair text actually leads out.

*Alternative considered:* a single all-in-one enriched rehearsal — rejected: it would bury the pristine empty-store findings (the real store's actual state) under authored content, and the wedge claim must be made against the unmodified shape.

### D3 — Pre-enumerated checks the rehearsal MUST make (the checklist is part of tasks.md, not left to discretion)

(1) attribution fail-closed: no evidence -> `unknown-owner`, E2/E3 disagreement -> `evidence-conflict`, non-member -> `non-member-owner`, each blocking apply with a repair naming the exact mapping key; (2) mapping-contradicts-recorded-identity refused as a mapping-file error; (3) shared-spec provenance blocks until `owner`/`split` declared; (4) recovery manifest exists, is machine-local, carries runId != planId, and `--status` renders it; (5) retired old paths: post-`--retire-flat` the flat tree is gone, the receipt is stamped, re-run is idempotent, rollback-after-retirement refuses toward Git; (6) multiple stale refs: the second flat branch appears in `otherFlatRefs` with a per-ref migrate command and the "does not migrate the others" statement; (7) Windows path shapes: mixed-case drive spelling in the registered path, UTF-8 Chinese item names surviving to partition destinations byte-identically; (8) empty-store outcome (stage 1); (9) refusal legibility scored for every refusal encountered: does the message name the exact item, the reason, and a copy-pasteable repair that works?

### D4 — Triage criteria (recorded before evidence exists, so the triage cannot be steered by it)

Each surfaced observation is classified: **(a) defect** — behavior contradicts design SS11/SS15/SS16 or the new spec deltas (fix + guard in this change, unless sibling-owned -> handover note); **(b) correct-but-illegible** — the refusal is right, but the message does not name the item, reason, or a workable repair (fix = message/diagnostic only); **(c) correct-and-legible** — recorded as passing evidence; **(d) out-of-scope-real** — real defect in a sibling seam or deeper design gap (recorded, handed over, explicitly listed in the ship summary as NOT fixed here). A refusal is never "gotten past" by weakening a gate; category (a) fixes must keep every existing fail-closed test green.

### D5 — The empty-store fix (pre-admitted category-(a) defect)

An empty legacy flat store (zero items, zero blockers) becomes a trivial but complete migration: apply publishes the receipt and flips `layoutVersion: 2` (there are no items to stage and no partitions to create), with the usual commit suggestion; retirement then has nothing to remove beyond the empty flat directories in the retirement set. Implementation seam: the `applicable` conjunct at `plan.ts:1048` and a token-issuance path for the empty case — NOT a bypass of blockers (a plan with zero items and zero blockers is vacuously all-resolved, which is exactly SS11.3's "所有条目已解析后才允许 apply"). Guard: a real-git test that reproduces today's dead end first (must fail pre-fix), then asserts the trivial migration completes and the store accepts partition writes afterwards. *Alternative considered:* keep the refusal but reword it to point at a manual metadata edit — rejected: hand-editing `store.yaml` is precisely the un-receipted, un-journaled mutation the whole module exists to prevent.

### D6 — Evidence capture format

Everything lands under `rasen/changes/rehearse-legacy-store-layout-migration/evidence/rehearsal/`: `01-pristine/`, `02-enriched/`, `03-clone/`, each holding numbered step files (`NN-<command-slug>.json` for `--json` outputs, `NN-<command-slug>.txt` for human output and stderr, exit codes recorded in a per-stage `steps.md` index), plus copies of the recovery manifest and receipt, and `triage.md` (the classified table per D4). Raw scratch (full console scrollback, temp listings) goes to the ephemera dir's `research/`, never committed. Rationale: the numbered-step form lets a reviewer replay the claim chain without trusting prose; JSON+human pairs pin the CLI parity claim for free.

### D7 — New tests are rehearsal-shaped, not more fixtures of the same shape

The guards added by this change assert what the rehearsal actually surfaced: (t1) empty-store trivial migration (D5, pre-fix-failing); (t2) a registered-store end-to-end through the machine registry: register temp store -> migrate-layout via store id -> apply -> retire (the seam no existing suite crosses — they all construct `StoreLayoutMigration` or call `runStoreMigrateLayout` in-process with a pre-resolved root); (t3) any further guard admitted by triage, each demonstrated to fail against pre-fix behavior before it counts. All real-git tests carry explicit per-test timeouts (30s default passes solo and fails in parallel full runs); Windows EBUSY cleanup uses retry; suites must be run alongside heavyweight neighbors before being called verified.

## Risks / Trade-offs

- [Any rehearsal command accidentally resolves the real store] → the SAFETY section's pre-flight check (`store list --json` under redirected env must show the copy's path) is a mandatory recorded step in every stage; the copy's shared uid makes this the single highest-consequence mistake, which is why it is checked per stage, not once.
- [Enriched content re-imports the fixture-blindness problem] → stated honestly in evidence (D2); the claim made is CLI/registry/host/lineage realism, not content realism; content is authored to hit the pre-enumerated checks, several of which (registry seam, empty store, metadata drift) no fixture ever encoded.
- [Fix scope balloons mid-change] → D4's category (d) exists precisely to park real-but-foreign findings; the ship gate is "every category (a)/(b) item fixed+guarded or explicitly re-classified with reason", not "everything found is fixed".
- [Temp-root teardown flakiness (Windows EBUSY, leftover fixtures)] → teardown is a recorded step with retry; a leaked temp root is a cleanup item, never a reason to touch anything outside the temp root; E: drive space is a known hazard (pnpm store once filled it) so temp roots live under the system temp, not the repo.
- [Spec delta could ossify pre-triage guesses] → the delta written at propose time covers only contracts verified by code reading (attribution, provenance, recovery, refs, legibility) plus D5; a task re-opens the delta after triage to add/adjust requirements the evidence actually supports, then re-validates before apply completes.
- [`--status`/preview writes coordination state] → all stages run fully redirected from the first command; there is no "just a quick peek" against the real registry.

## Migration Plan

No deployment surface: the deliverables are evidence, fixes inside `src/core/store/layout-migration/` + `src/commands/store-migrate-layout.ts`, tests, and the new spec. Rollback is a plain revert. After landing, the operator (not this change) may choose to migrate the real `rasen-store` using the now-rehearsed flow; the evidence directory doubles as the runbook for that decision.

## Open Questions

- None blocking. (Whether the real `rasen-store`'s uncommitted identity upgrade should be committed before the operator ever migrates it for real is an operator decision the evidence will inform; whether `layout-write-guard`'s fix text should mention the empty-store path is settled by D5 making the pointed-at command actually work.)
