# Review Report — converge-projectid-mint-with-registry

- **Reviewer:** reviewer-converge-1 (verify stage, dispatched report-only; independent of the implementer)
- **Date:** 2026-08-16
- **Mode:** dispatched (report-only) per `rasen-review` skill — no code edits, no fixes applied; all fix-class items below are for LEAD triage.
- **Scope reviewed:** the change's uncommitted diff over 8 files — `src/core/project-config.ts`, `src/core/project-home.ts`, `src/core/project-registry.ts`, `src/core/learned-skills/context.ts`, `test/core/project-config.test.ts`, `test/core/project-registry.test.ts`, `test/core/project-home.test.ts`, `test/core/init.test.ts` (770 changed lines). Unrelated dirty files in the working tree were ignored as instructed.
- **Gates relied on (LEAD-run, not re-run here):** combined 6 identity suites single-invocation at default timeouts — 6/6 files, 324/324 tests, 308s; lint exit 0; `pnpm run build` (tsc) exit 0. Full-core sweep deferred to PR CI per run-state.

## Verdict summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 1 |
| Trivial | 1 |

**No Blockers.** The implementation matches the design invariants (D1–D7) on every point I could trace; both round-1 perf fast paths are behavior-preserving and covered by existing outcome tests. The one Major is a spec-text-vs-consumer gap that needs an explicit LEAD decision, not a code defect inside the diff.

## Scope Check: CLEAN

Intent: registered paths adopt the registry identity at mint time; identity-asserting runs reconcile a diverged config toward the registry id; canonical-form-equal ids never rewritten; conflicted registries never silently resolved.
Delivered: exactly that, in the four source files the proposal's Impact section names, plus tests in exactly the four test files the proposal names. No out-of-scope files in the reviewed diff.

## Findings

### 1. [Major — Spec axis] Canonical-form identity agreement is not honored by the planning-space consumer; a case-differing id stays permanently broken there while the spec declares it "the same project"

- **Where:** `src/core/config-api/project-addressing.ts:161-165` (not in the diff — the consumer the new spec text now contradicts).
- **Claim:** The spec delta's requirement sentence — "Identity agreement SHALL be judged in the identity's canonical form (trimmed, case-insensitive): a config identity that differs from the registered one only in case or surrounding whitespace is the same project" (`specs/project-registry/spec.md`, paragraph 3) — is implemented on the establishing side (`sameProjectIdentity` in `resolveProjectHome` at `project-home.ts:155` and in learned-skills at `learned-skills/context.ts:565`), but `projectPlanningSpace` still compares raw strings: `scopeProjectId !== resolved.ref.projectId` at `project-addressing.ts:164`.
- **Concrete failure scenario:** registry records `aaaaaaaa-…`, config records `AAAAAAAA-…` (a hand-edited uppercase UUID — exactly the shape `sameProjectIdentity`'s own docstring anticipates, and hand-editing is this change's documented escape hatch). `rasen init` correctly leaves the file byte-identical (spec-required no-op), learned-skills owner resolution correctly passes (canonical compare) — but every planning-space command (`project:<id>` addressing) throws `planning_selection_conflict` forever. init can never repair it, because canonical-form-equal ids are never rewritten. This is a surviving variant of the exact livelock class the change exists to eliminate ("consumers assume the two agree and fail permanently"). Not a regression — the raw compare pre-dates this change — but the spec text this change ships is broader than the behavior it delivers, and the design's "No consumer-side tolerance" non-goal only covers *genuine* divergence, which the spec explicitly says this is not.
- **Decision for LEAD:** either compare via `sameProjectIdentity(scopeProjectId, resolved.ref.projectId)` in `projectPlanningSpace` (small, but touches a file outside this change's diff — scope call), or narrow the spec sentence to identity-establishing surfaces before archive. Fix-class: ASK.

### 2. [Minor — Test gap] Adoption lookup never tested against a multi-entry registry where the root IS registered

- **Where:** `test/core/project-registry.test.ts:680-732` (new `findAdoptableProjectIdentity` describe) and `test/core/project-config.test.ts:1738-1762`.
- **Claim:** Every new adoption test uses a registry whose only entry is the root itself (or the worktree case, also single-entry). The 'unregistered' test does use a two-entry registry, but only pins the no-match outcome. No test pins the slow-path **match** shape — root registered alongside one or more unrelated live projects — which is precisely the shape where the single-direct-entry fast path cannot fire and `canonicalProjectClaimants` grouping + `primary` matching must return *this root's* id rather than the other project's. A claimant-matching regression there (adopting the wrong project's id into a tracked config) would pass the entire current suite.
- **Concrete failure scenario (hypothetical regression this gap would hide):** a future edit to the `primary` matcher drops the `aliases.some(...)` clause or matches by group order; with two registered projects, a first-run mint in project X silently writes project Y's identity into X's committed `config.yaml`, and every subsequent convergence step then actively defends the wrong id (the registry is the winner by design). Nothing in the suite fails.
- **Related smaller gaps in the same block** (same severity bucket): (a) no new test for the spec scenario "Path casing does not fork identity on case-insensitive filesystems" *through the adoption path* — the fast path's win32 claim-key lowercasing at `project-registry.ts:843-848` is new code, currently pinned only indirectly by pre-existing canonicalization tests of the shared machinery; (b) no end-to-end ensure-path test of worktree adoption writing the main's id into the *worktree's* config (both halves are tested separately: lookup-level worktree adoption, and registration-level no-separate-entry). Fix-class: AUTO-FIX-able test additions (mirror the existing harness), routed to the non-author fixer per dispatched rules.

### 3. [Trivial] Duplicate-key inconsistency between the rewrite splicer and the reader

- **Where:** `src/core/project-config.ts:2867-2878` (`replaceProjectIdFieldValue`) vs `src/core/project-config.ts:2833-2845` (`extractProjectIdField`).
- **Claim:** The splicer replaces the value of the **first** top-level `projectId` pair, while the reader (`parseYaml` semantics) resolves duplicate top-level keys **last**-wins. With duplicate `projectId:` keys, a reconcile rewrites the first occurrence, the verify read still returns the last, validation fails, the file is reverted, and the manual-repair error is thrown. Failure is safe (no corruption — the verify-and-revert at `project-config.ts:2210-2220` catches it), so this is a latent inconsistency note only, not a defect. No action required; recorded so the behavior is known if it ever surfaces.

## Standards axis — verified safe (with citations)

- **Concurrency / lock ordering:** all three config writers (mint, reconcile) and the registry writer serialize under `withProjectRegistryLock` (`project-config.ts:2087`, `project-config.ts:2183` via the helper, `project-registry.ts:366`). The adoption lookup called *inside* the mint's lock (`project-config.ts:2105`) takes no lock itself (`readProjectRegistryState` at `project-registry.ts:155-163` is a plain read; `findAdoptableProjectIdentity` acquires nothing) — no nested lock, no deadlock. `reconcileProjectIdInConfig` is only ever called from `resolveProjectHome` *after* `registerProject`'s lock is released (`project-home.ts:144-157`); concurrent convergence is idempotent because every writer targets the registry id.
- **Git-spawn cost contract (round-1 perf fix):** the empty-registry early exit (`project-registry.ts:831-836`) returns before `canonicalizeExistingPath`, piercing, or claimant grouping; the single-direct-entry fast path (`project-registry.ts:843-848`) answers via claim-key comparison (`projectClaimPathKey`, `path.resolve` + win32 lowercase, no spawn — `project-registry.ts:588-593`). Equivalence argument holds: `canonicalProjectClaimants` (`project-registry.ts:599-652`) builds aliases **only from registry entries**, so a one-entry registry yields a one-alias group and `fixedMetadataConflict` (live-fixed-metadata set size > 1) is unreachable for it; the fast path therefore cannot adopt through a conflict or a worktree shape it didn't pierce (a worktree path never claim-equals the main's key, so it correctly falls through to the machinery). Multi-entry registries pay the full machinery once per mint — same cost class as the `registerProject` that immediately follows in every caller (design risk row 4). LEAD's 308s / default-timeout gate run confirms the timeout regression is gone.
- **Error swallowing:** the mint's blanket `catch` around the adoption lookup (`project-config.ts:2104-2109`) is by contract ("never throws for registry reasons"); the corrupted-registry shape is pinned by a dedicated test (`project-config.test.ts`, "still mints a fresh UUID … when the machine registry cannot be read"), and the subsequent registration surfaces real registry errors (corrupt registry → `invalid_project_registry` from `parseProjectRegistryState` at `project-registry.ts:126-140`).
- **Config-file write discipline:** mint and reconcile share one append helper (`appendProjectIdLine`, `project-config.ts:2854-2857` — byte-identical extraction of the previous inline mint code); reconcile locates the field through the parsed YAML document and splices exactly the scalar's source range (`project-config.ts:2867-2878`), preserving comments and all other bytes (pinned by an exact-full-content assertion including a trailing `# identity note` comment); both verify after write and revert on failure; `.yml`/`.yaml` precedence honored via `resolveConfigFilePath` (`project-config.ts:1977-1984`, pinned by test). CRLF files: the range splice is index-based on the original content, and the append's `\n+$` trim reconstitutes the existing CRLF — unchanged pre-existing discipline.
- **Cross-platform:** no hardcoded separators anywhere in the diff; new tests use `path.join` throughout; the fast path's claim-key comparison lowercases only on win32; worktree fixtures are real `git worktree add` runs (not mocks), exercised on this Windows host in the LEAD's gate.
- **Enum/value completeness:** the new `AdoptableProjectIdentity` union (`project-registry.ts:792-794`) has exactly one consumer (`project-config.ts:2110`, discriminates `.adoptable`) plus discriminating tests; no switch/allowlist anywhere else to miss the new `reason` values.
- **Module cycles:** `project-config.ts`'s new import of `store/project-records.js` is cycle-safe — none of project-records' transitive imports (`foundation`, `errors`, `remote`, `planning-validation`, `identity-diagnostics`, `file-state`, `id`, `zod-issues`, `utils/file-system`) import back into `project-config.js` (verified by grep; the store files that do import it — `bootstrap`, `membership`, `operations`, `migration-ops`, `upgrade-identity`, `identity-migration` — are not in that closure). tsc exit 0 corroborates.
- **Caller sweep (assumption breaks):** all `ensureProjectIdInConfig` callers audited — `project-home.ts:143` (the funnel), `store/operations.ts:1216` and `store/migration-ops.ts:1034,1162` (store add-project / migration destinations — adoption there is the designed convergence), and the migration **dry-run reads only** (`migration-ops.ts:483-485` uses `readProjectConfig`, never mints — unchanged). `resolveProjectHome` `ensure:true` callers (init, pipeline resume, UI launch, change-work, update, item-discovery, root-selection, learned-skills stores) all gain repair-on-divergence — which is the spec'd behavior, not an assumption break. Probe callers are untouched.
- **Hint truthfulness (D6):** the extended `knowledge_owner_stale` message's new clause "(init will name them)" is truthful — in the conflicted-registry state, init's `registerMachineHome` catches the `project_registry_alias_conflict` error and surfaces its full alias inventory in the warning (`init.ts:383-394`; the error message carries the per-alias inventory, `project-registry.ts:666-683`). No test anywhere asserts the old exact message text (all pins are on the `code`), so the wording change is test-safe.

## Spec axis — tasks.md coverage map

| Task | Pinned by | Assessment |
|---|---|---|
| 1.1 lookup: registered / unregistered / no-registry-creates-no-file / worktree | `project-registry.test.ts:681-735` | Real pins; no-registry test also asserts no file created; worktree uses real git |
| 1.2 conflicted → "not adoptable" (discriminated) | `project-registry.test.ts:737-780` | Asserts `{ adoptable: false, reason: 'fixedMetadataConflict' }` — discriminated outcome, not just `adoptable: false`; live conflicting worktree alias via real fixture |
| 2.1 adopt-at-mint + no second identity | `project-config.test.ts:1738-1762` | Asserts exact config line + registry holds exactly the one id |
| 2.2 conflicted → fresh UUID, never throws | `project-config.test.ts:1764-1815` (+ corrupt-registry variant `:1817-1840`) | Also asserts minted id absent from registry; catch path covered |
| 3.1 reconcile helper: byte-preserve / append+precedence / revert / canonical no-op | `project-config.test.ts:1852-1923` | Exact-full-content and byte-identical assertions; revert via writeFile spy; `.yml` left untouched — strong, not guard-shaped |
| 4.1 repair + idempotence | `project-home.test.ts:139-167` | Second ensure asserted byte-identical |
| 4.2 adoption end-to-end, registry entry unchanged | `project-home.test.ts:169-191` | Asserts entry `projectId` AND `home` unchanged |
| 4.3 canonical-form byte-identical | `project-home.test.ts:193-206` | Byte-identical assertion |
| 4.4 conflict propagates, no rewrite | `project-home.test.ts:208-250` | Config stays byte-identical AND registry file byte-identical before/after |
| 5.1/5.2 init e2e repair + mint arms | `init.test.ts:1026-1090` | Full loop incl. probe resolves and learned-skill owner resolution succeeds with the registered id — the hint-truthfulness check is real, end-to-end |
| 6.1–6.3 gates | LEAD-run (308s suites, lint, tsc); PR CI leg pending | Relied on per dispatch; not re-run |

No requirement from proposal.md is missing; no scope creep found. Gaps that remain are Finding 2's test shapes and the spec/finding-1 consumer tension.

## Adversarial pass note

Codex CLI is installed but its Windows sandbox setup helper failed on every file read (`orchestrator_helper_launch_canceled: ShellExecuteExW failed`, exit path captured) — the external adversarial challenge could not run; per the skill this is non-blocking. Dispatched mode forbids the Claude subagent fallback. The adversarial reasoning was instead performed inline and is reflected above: YAML edges (quotes, duplicate keys, anchors, CRLF, flow maps — all fail safe through verify-and-revert), races (three lock acquisitions in the ensure funnel re-read fresh state; convergence is idempotent), wrong-id adoption (single-entry fast-path equivalence proven against the claimant machinery), clone/move/worktree matrix traced through `registerProjectWithPolicy`, and the case-differing consumer hole (Finding 1).

## Fix routing (for LEAD)

- Finding 1 (Major): ASK — decision between a one-line consumer fix (out-of-diff scope) vs narrowing the spec sentence; either is shippable, but they must agree.
- Finding 2 (Minor): test additions, non-author fixer, mirror existing harness.
- Finding 3 (Trivial): no action; documented.
