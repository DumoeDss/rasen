# Handoff: ECP-7 portfolio close-out — LEAD #1

> Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
> Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`. Windows host. Account weekly limit fired at the closure implementer (resets **Aug 12, 3pm Asia/Shanghai**) — all 6 background agents were stopped by the operator.
> Written 2026-08-08. Context 77% on a 1M window.

## Original intent

The operator said: *"切...把那些难以落地的实现先拆分出来（不要把之前的工作都直接丢弃），然后干净利落地切到可以落地的方案。之后我们再慢慢去探索那个更难的方案"* — and then *"全由你来推进！把ecp整体收尾吧！"* The job is to land Target State **locked decision 13** (0.2.0 hosted execution converges to declared best-effort on all three OSes; Linux/Windows kernel-enforced authority crates parked whole to the upgrade path, nothing discarded) and drive the ECP-7 portfolio `ecp-session-execution-and-self-hosting` to completion through ECP-8.

## Position

Portfolio `ecp-session-execution-and-self-hosting` (Tier A, gate policy off, pipeline `small-feature`, implementation-first). The cutover child landed end-to-end this session; closure is mid-implementation. Portfolio run-state (the single-writer ledger): `.rasen/changes/ecp-session-execution-and-self-hosting/ephemera/portfolio-run.json`.

Child states (12 children):
| Child | Status |
| --- | --- |
| `ecp-platform-process-authority-foundation` | done (archived) |
| `process-authority-prepare-unavailability-outcome` | done (archived) |
| `process-authority-scope-semantics-wording` | in_progress (propose+apply+verify done; 4 Minors stay open, 2 are pre-archive — see closure cleanup) |
| `ecp-hosted-best-effort-cutover` | **done — shipped `cb0b4ce4` + archived `33ee98fa` this session** |
| `ecp-linux-process-authority-provider` | skipped (parked upgrade-path; freeze 89f6c1d5; D4/D2 defects recorded as assets) |
| `ecp-windows-process-authority-provider` | skipped (parked upgrade-path; freeze fc49a7c2/367666f6; missing verb recorded; marker A1 fixed) |
| `ecp-macos-process-authority-provider` | in_progress (best-effort code now the cutover's verification baseline; Section 7 real-macOS receipts owed to ECP-8) |
| `ecp-native-process-capsule-closure` | **in_progress — the active frontier (this handoff's change)** |
| `ecp-durable-agent-session-host` | escalated (re-grade done; S2/S4 checks ride closure/executor reviews; S1/S3 parked) |
| `ecp-frozen-action-session-executor` | pending (planning seed refreshed `50c15be0`; DO-NOT-PROPOSE-YET dissolved; propose after closure terminal) |
| `ecp-session-policy-and-control-parity` | pending |
| `ecp-session-self-hosting-vertical-proof` | pending |

## Done / Remaining

### Done this session (commits, newest first)
- `efe834ba` wip: preserve verified 12.8 retention-rule code unit (pin rebaseline PENDING — see Remaining)
- `079f0063` A1: dated superseded-by amendment to Windows freeze marker
- `6080ab93` upgrade-path asset audit — decision-13 retention claim verified TRUE in git
- `33ee98fa` archive ecp-hosted-best-effort-cutover (+ `cb0b4ce4` ship-log)
- `41e3d73f` T1 fix: withdrawn-waiver sentence in mutation-receipts.md
- `30dcb345` cutover delta re-review round 2 = **CLEAN** (reviewer produced the F1 crash-half demonstration)
- `fec34c16` cutover fix: withdraw 7.2b waiver + real-host mutation
- `708b558c` cutover fix: F3 mutations + F4 deferral
- `0e86380f` cutover: authorized F1 pin rebaseline (a070733c) of native-process-scope.ts
- `8e48ce45` cutover fix: F1 one-shot-probe parser containment + F2 D3 terminate-leg
- `5e7a5a18` closure re-review consolidated input package (eat this first for closure review)
- `b3edf5bc` cutover propose (33 tasks)
- earlier: `9db76d31` cutover review round 1 (CHANGES_REQUIRED); `5ad3873e` closure+host decision13-regrade; `e4893286` win32 early-return triage; `7c1295b4` skipIf conversion (10 sites); `753edc7d` semantics 5.4/7.5 residue; `50c15be0` executor seed refresh; `2961848b` Purpose placeholder fix; `0f7eda09` FROZEN_COMMON spec pin rebaseline.

### Remaining — closure (the active frontier)
1. **Land the authorized native-pin rebaseline** (mechanical, F1/`0e86380f` precedent). The 12.8 code is committed at `efe834ba` but the pin lists still hold `a070733c`, so the two pin suites are RED against HEAD. Edit exactly one entry in BOTH `LEGACY_PROCESS_CAPSULE_INPUTS` lists:
   - `test/core/session-host/linux-process-authority-boundary-guards.test.ts` (~line 34)
   - `test/core/session-host/windows-process-authority-package-ci.test.ts` (~line 54)
   - Move `native-process-scope.ts`: `a070733c...` -> `3e74b2c25bfde89a9db300301b7010f2a7c9521be37283ed73169be4f111b828`. **Value already verified** as the SHA256 of committed bytes at `efe834ba` (node: `git show efe834ba:<path> | sha256`). 8-line lineage comment per site: second authorized rebaseline of this file, chain `a070733c` (cutover F1, 0e86380f) -> `3e74b2c2` (RC-005/12.8), TS-adapter-only, Rust untouched, LEAD authorization 2026-08-08. Confirm the other 8 pins (Rust crate, Cargo.lock, build script, resolver.ts, both pinned capsule test files, both FROZEN_COMMON) recompute byte-identical; both pin suites go 21/21.
2. **Tick closure task 12.8** in `tasks.md` (held unticked; verified-green locally: scope-retention-lifecycle.test.ts 7/7, tier suites 59/59, host integration 55/0, mutations (R) under-sweep + (W) over-sweep both RED).
3. **Run the non-author closure review** (OWED, author≠verifier): 9.3/9.4/9.5/9.7-9.10 + 12.9/12.10 — fresh security + code/spec review. **This reviewer MUST NOT be `regrader-closure-host`** (it authored the decision13-regrade + the rescope input package `5e7a5a18` — it is locked out of closure review for independence; it is earmarked for the executor review instead). Spawn a fresh reviewer. The review's prime input is `evidence/decision13-rescope-input.md`. The SEC-001 close (12.2) needs the reviewer's independent re-confirmation on the integrated tree.
4. **Fix loop** if the review returns CHANGES_REQUIRED (author≠verifier; fixer may reuse the closure implementer role once the account limit resets).
5. **Ship + archive** closure (local, same discipline as the cutover: ship-log WITHOUT a pre-written `## Archive` heading; run the `buildUpdatedSpec` projection self-check — confirm the projected main spec asserts ONLY best-effort / declared-unproven, NOT kernel-enforced).

### Remaining — after closure
6. **`ecp-durable-agent-session-host`** fresh review (escalated; S2/S4 were verified during the cutover review — their evidence rides here; S1/S3 leave with parked crates). Re-grade input: its `evidence/decision13-regrade.md`.
7. **`ecp-frozen-action-session-executor`** propose (planning seed `50c15be0` is post-decision-13-ready; two-tier roster in-tool + hosted-best-effort; owns the OS×backend capability matrix, never-silently-reroute, execution-lost typing per locked decision 11). This is ECP-7's actual user result.
8. **`ecp-session-policy-and-control-parity`**, then **`ecp-session-self-hosting-vertical-proof`** (the self-hosting proof needs a real non-ECP toy Change run through the executor end-to-end — an **operator decision** on which Change/backend/platform is owed; spec acceptance 7 names Windows+hosted as the Direction suggestion).
9. **ECP-8**: completion audit + release truth (single clean branch, remote CI, version/changelog/tag). macOS real-runner receipts owed here; if no macOS runner, record explicit known-gap.

## Key decisions (and why) — do not re-litigate
- **Locked decision 13** (the cutover): 0.2.0 hosted = best-effort on all 3 OSes; kernel-enforced crates parked whole as upgrade-path assets. Driven by an operator delivery-time/cost constraint after a full audit proved production never wired the crates and their cancel paths were measured-broken.
- **Win32 cutover design**: thin NEW `win32-best-effort-scope.ts` wrapping the UNMODIFIED legacy capsule (zero guard rebaseline for the tier itself); only protocol outcomes mint terminals; `transportLost` latch prevents transport loss from ever minting a release-authorising terminal (the D3/SEC-001 shape).
- **POSIX cutover**: darwin module moved to platform-neutral `posix-best-effort-scope.ts` (no shim — source-scan guards read module source); enabled for linux at the single selection point `hosted-process-scope.ts`.
- **Pin rebaselines this session** (both LEAD-authorized, both with lineage, both from committed bytes): `0f7eda09` (FROZEN_COMMON spec pin, cause 2961848b Purpose fix), `0e86380f` (cutover F1, native-process-scope.ts 0848c77b->a070733c), and the PENDING 12.8 one (a070733c->3e74b2c2).
- **Reviewer `regrader-closure-host` is self-locked from closure AND host re-reviews** (authored both re-grades + the rescope package); it is the earmarked executor reviewer. Closure/host reviews need a fresh worker.
- **Account limit** resets Aug 12 3pm — workers cannot be spawned before then. This handoff resumes then (or via a relayed session, see below).

## Dead ends & gotchas
- **`rasen agent context` reports `limit:200000` / `pct:3.8%` on a 1M-window session — false.** Always pass `--limit 1000000`; real occupancy here was 77%.
- **Pin digests must be computed from COMMITTED bytes** (`git show <sha>:<path>`), never the working tree — `core.autocrlf=true` makes working-tree hashes always-locally-green. Verified recipe: `node -e "...execSync('git show <sha>:<path>')...createHash('sha256')..."`.
- **`git checkout -- <file>` cannot revert a mutation** under autocrlf=true (rewrites CRLF, 330 bytes differ, next LF anchor silently misses). Use byte-exact backup/restore.
- **vitest wipes dist/**: `vitest.setup.ts` calls `ensureCliBuilt()` unconditionally; if `dist/cli/index.js` is absent it runs build.js which `rmSync('dist')`. Confirm `dist/cli/index.js` exists before EVERY vitest run; targeted runs only. Linux receipts need an external ext4 WSL tree (recipe in `rasen/changes/ecp-linux-process-authority-provider/handoff/lead-2.md`).
- **Archive ship-log trap**: never pre-write a `## Archive` heading (not even a placeholder) or `rasen archive` rejects with `archive_recovery_required`. Let archive append its own heading.
- **The cutover `88ffc08b` and this `efe834ba`** are both preservation commits of interrupted waves — verify-before-trust.
- **Author==verifier is the systemic risk on this branch.** Every guard without a RED mutation counterpart is assumed non-discriminating; `record.processTerminal.emptiness` (host.ts:652-658) is a hardcoded projection literal — only scope-own-receipt assertions prove tier honesty.

## Eliminated hypotheses
- *"The two frozen authority crates are wired into production"* — NO. `router.ts:639` -> `createHostedProcessScope()` routes darwin to best-effort, every other platform to the legacy ProcessCapsule. The crates were never on the production path. (This is what made decision 13 safe.)
- *"Fixing the crates' cancel path is the fastest path to a landable 0.2.0"* — NO; measured: each needs a new verb/protocol + a full re-freeze/re-bind, and the discovery rate of new Blockers was not converging. Cutover was faster.

## Working set
- Active frontier change dir: `rasen/changes/ecp-native-process-capsule-closure/` (spec re-authored `9b1ff319`; 12.8 code at `efe834ba`; dispositions in `evidence/closure-integration-disposition.md`; handoff `implementer-2.md`).
- Cutover (done, archived): `rasen/changes/archive/2026-08-07-ecp-hosted-best-effort-cutover/`; main spec projected to `rasen/specs/hosted-best-effort-process-scope/spec.md`.
- Shipped tier code: `src/core/session-host/process-capsule/{hosted-process-scope,posix-best-effort-scope,win32-best-effort-scope,native-process-scope,scope-retention}.ts` + `src/core/session-host/process-scope.ts` + `host.ts`.
- Two pin-list files to edit (Remaining step 1): `test/core/session-host/linux-process-authority-boundary-guards.test.ts`, `test/core/session-host/windows-process-authority-package-ci.test.ts`.
- Account limit: workers unavailable until Aug 12 3pm Asia/Shanghai.

## Next action

1. **Confirm `efe834ba` is intact** (`git show --stat efe834ba`; the 6 files: native/posix/win32 scope + scope-retention.ts + the lifecycle test + fake-capsule seam).
2. **Land the authorized pin rebaseline** (Remaining step 1) — one commit, enumerated pathspec (the two test files only), both LEGACY lists, lineage comment, value `3e74b2c2...`. Re-verify both pin suites 21/21 + the other 8 pins byte-identical. Tick 12.8.
3. **Spawn a fresh closure reviewer** (NOT `regrader-closure-host`) for 9.3/9.4/9.5/9.7-9.10 + 12.9/12.10, seeded from `evidence/decision13-rescope-input.md`.
4. Fix loop -> ship+archive closure -> host review -> executor propose -> policy-parity -> self-hosting -> ECP-8.

Account limit note: if reading this before Aug 12 3pm, the pin rebaseline (step 2) is a pure LEAD edit (no worker spawn needed) and can be done immediately; steps 3+ need workers, which require the limit reset OR a relayed successor session.
