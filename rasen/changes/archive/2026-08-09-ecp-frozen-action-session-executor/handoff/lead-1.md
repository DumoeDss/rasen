# Handoff: ECP-7 close-out — LEAD #2 (executor verified-clean, ready for ship+archive)

> Worktree `...-wt-ecp-shared-bounded-loop-lifecycle`, branch `wip/ecp-shared-bounded-loop-lifecycle-resume`. Written 2026-08-08 when LEAD context hit ~95%. Predecessor: closure/handoff/lead-1.md (now archived). Resume with a fresh session — workers may need respawning (account weekly limit was firing intermittently; fresh spawns mostly worked).

## Original intent
Operator: complete ALL of ECP except (a) the self-hosting toy-Change selection and (b) macOS real-machine receipts — those two are operator-owned. Drive via rasen-auto. Decision 13 (all-platform best-effort cutover) is the governing scope.

## Position — what is DONE (all shipped+archived locally)
ECP-7 children terminal: `ecp-platform-process-authority-foundation`, `process-authority-prepare-unavailability-outcome`, `ecp-hosted-best-effort-cutover` (33ee98fa), `ecp-native-process-capsule-closure` (21f584d9), `ecp-durable-agent-session-host` (99f381df). Plus: scope-semantics-wording (4 Minors open, pre-archive), win32 early-return conversion (7c1295b4), Purpose-placeholder fix (2961848b), upgrade-path asset audit (6080ab93), Windows freeze-marker A1 (079f0063), FROZEN_COMMON + cutover-F1 + closure-12.8 pin rebaselines (0f7eda09/0e86380f/34111e9c).

## Position — the ACTIVE frontier: `ecp-frozen-action-session-executor`
**Verified-CLEAN and ready for ship+archive.** Status:
- Propose `08ed23c6` (47 tasks planned; tasks.md has 39). Apply core `dc3d84ad` + receipts + 32/39. Review round-1 CLEAN `cc27491c` (0/0/1 Minor). 7.1 wiring wave `ab9c6560`/`250292a3`/`501fd203` → 35/39.
- **Round-1 independent review = CLEAN.** execution-lost wiring CONFIRMED at the executor (`reconcileActionOutcome` action-outcome.ts:119-185; called executor.ts:174). Both mutations re-confirmed RED by reviewer (3.3 never-reroute 4 RED; 5.3 half-set 2 RED).
- **7.1 delta LEAD-verified** (reviewer's delta report stalled at the commit tail — tasks 47-55 done, 56-57 not committed): router.ts change is ADDITIVE (only a new route: import + path-set + method-admission + handler block; zero existing routes modified); the daemon handler `src/core/management-api/frozen-action-executor.ts` performs NO Record mutation (loads head Record read-only via `loadHeadRecord`, dispatches, returns; completion stays the Facade path). Parity gate: production-executor.test.ts (11 tests) — two faces → same Run/Action. 5.4 per-field mutations receipt 9 (6 RED). Minor-label fix (`source: 'lost-generation'`). 634 regression green, 89 executor guards green, validate --strict clean, tsc/eslint/whitespace clean.
- **Projection clean**: `rasen archive --dry-run --json` → specSyncPlan blockers [], complete true. Projected spec is best-effort-only (Locked decision 13 markers travel; no kernel-enforced false claim). Purpose is `TBD - created by archiving` → needs the post-archive Purpose fix (same pattern as process-authority-provider, commit 2961848b).

## Next action (the resumer does this)
1. **Wake/respawn reviewer-closure to COMMIT its delta review report** (it's 90% done; tasks 56-57 = regression+projection confirm + commit). If it can't (limit/stall), the LEAD verification above (round-1 CLEAN + additivity + Record-no-mutation + projection) is a defensible ship bar for an additive delta — proceed.
2. **Reconcile executor ledger** (`tasks.md`): tick the 4 ECP-8-deferred tasks (8.1, 10.1, 10.2, 10.4) with `**Disposition:** ECP-8-deferred (environment-gated: credentials/WSL/real-host); deterministic counterparts (9.1, 65 guards, 8 mutations) are the 0.2.0 correctness gate` — same ticked+disposition convention as closure/host. The archive task-gate (archive-engine.ts:1578) trips on incomplete tasks otherwise. `rasen validate --strict` must stay green.
3. **Ship + archive executor** (LEAD-side, the drill is proven): ship-log to evidence/ (NO pre-written `## Archive` heading); `rasen archive ecp-frozen-action-session-executor --yes --json`; commit the result with enumerated pathspec (`rasen/changes/ecp-frozen-action-session-executor` deletions + `rasen/changes/archive/2026-08-XX-...` + the projected `rasen/specs/frozen-action-session-executor/`). Watch the scenario-rename trap (ADDED-only is safe here). Post-archive: fix the `TBD - created by archiving` Purpose in the new main spec.
4. **Then `ecp-session-policy-and-control-parity`** (the next child, dependsOn executor): propose→apply→review→ship. planner-executor is WARM and its executor scope-cut feeds directly into policy-parity (it owns the cross-plane parity + the exhaustive cancel/restart/ack-loss fault matrix that the executor deliberately excluded). Spawn planner-executor for the propose.
5. **Then `ecp-session-self-hosting-vertical-proof` = OPERATOR** (toy-Change selection is the operator's decision; spec acceptance 7; the executor's SELF_HOSTING_PROOF_SEAM is left).
6. **Then ECP-8 = OPERATOR macOS + release engineering** (single clean branch, first-ever remote CI, version/changelog/tag; macOS real-runner receipts or explicit known-gap).

## Key decisions (do not re-litigate)
- Locked decision 13 (best-effort on all 3 OSes; kernel-enforced crates parked as upgrade-path assets).
- Executor scope: owns acceptance 1/2/3/5/6 + execution-lost half of 4; full cancel/restart/ack-loss matrix → policy-parity; acceptance 7 → operator. execution-lost wired at the executor (not host/provider). No signing/key-custody (decision 12).
- 7.1 production wiring is the executor's (delivered); cross-plane PARITY enforcement is policy-parity's.
- ECP-8-deferred environment-gated receipts (executor 8.1/10.1/10.2/10.4; macOS Section 7) are explicit known-gaps, never defaulted to pass.

## Gotchas (cost stops this session)
- `rasen agent context --limit 1000000` (the 200000 default is a false low reading on 1M windows).
- Pin digests from COMMITTED bytes (`git show <sha>:<path>`), never working tree.
- `rasen archive` does NOT auto-commit — shipper/LEAD commits the result with enumerated pathspec.
- Don't pre-write `## Archive` in ship-log (archive_recovery_required). Don't mutate archived evidence (content-addressed: archive.json + journal record sha256s). validate does NOT apply the delta — `rasen archive --dry-run --json` blockers:[] is the projection gate.
- vitest wipes dist/ if `dist/cli/index.js` absent — confirm before every run; targeted runs only; WSL receipts need external ext4 tree.
- Shipper/reviewer stall pattern: goes idle after committing a step but before the next (projection/archive/report-commit). LEAD can finish via the CLI + enumerated-pathspec commit.

## Working set
- Active frontier: `rasen/changes/ecp-frozen-action-session-executor/` (35/39; handoff/implementer-1.md + implementer-2.md; evidence/review-round-1.md). Shipped module: `src/core/frozen-action-executor/` (8 files) + `src/core/management-api/frozen-action-executor.ts` + the additive router.ts route.
- Portfolio run-state: `.rasen/changes/ecp-session-execution-and-self-hosting/ephemera/portfolio-run.json`.
