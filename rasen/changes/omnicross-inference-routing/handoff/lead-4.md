# Handoff: omnicross-inference-routing — lead #4

## Original intent

用户要求在 `dev/0.2.0` 上通过 `$rasen-auto small-feature` 开发 OmniCross inference routing：Pipeline/Workflow stage 只需配置工具（Claude Code 或 Codex）、Provider/upstream 与模型，Rasen 通过常驻 OmniCross daemon 自动申请该次执行专用的下游路由凭据和格式转换；用户不再手工创建或绑定下游 key。不得改写用户的 Codex `config.toml`/`auth.json` 或 Claude 凭据文件。本会话约束：仅使用 Claude Code runtime（不用 Codex），所有 worker 使用 Opus，上下文 250k，使用现有 worktree（禁止新建）。

## Position

Pipeline: `small-feature`. Completed: `propose`, `apply` (32/32 original tasks), `verify` (round 1–3 review). Current stage: `review-loop`, configured 3-round cap reached with **Major M4**; post-cap strategy attempt 2 (candidate-preview protocol) was implemented and LEAD-verified (8170 passed / 0 failed full suite). The original reviewer (Claude session `f64a92e9-f9d6-4c16-8f3d-e57d55c9503a`) then found one additional **Major** — a cross-process publish CAS race — which LEAD-4 fixed this session. **The final reviewer re-review after the CAS fix has NOT yet been dispatched.**

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-omnicross-inference-routing` (Git-registered; do NOT create a new worktree). Branch `feat/omnicross-inference-routing`, base `dev/0.2.0` @ `75c3366a`. Every shell command must `cd` into this worktree explicitly (the session tool cannot persist CWD there).

## Done / Remaining

Done (this session, lead-4):
- Fixed the 4 lifecycle protocol regressions from lead-3's handoff (ack-loss CLI ephemera path → `.rasen/`, Canvas `Safe path root`, composite-dogfood preview/admit split, pipeline-cli-admission disposition preservation). Lifecycle cluster 121/121.
- Verified all 14 compatibility-cluster files (CLI/E2E + template/help parity). Rebaselined all shipped pipeline capability digests + generated skill content hashes from production generators/catalog (not hand-copied from `.claude/skills/`). Built-in digest audit 5/5, template parity 9/9, compatibility 85/85.
- Repaired a pre-existing U+FFFD sequence in `test/core/pipeline-registry/run-state.test.ts:800`.
- Ran full `pnpm test` three times: 8170 passed / 0 failed (run 1, pre-CAS-fix); 8170 passed / 1 timeout-fail (run 2, `local-version-runtime` 30s timeout — flaky, passes 9/9 in isolation); 8169 passed / 2 fail (run 3, `capstone-journeys` 30s timeout + `pipeline.test.ts` locale-neutral import temp-dir competition — both pass in isolation).
- Dispatched the original reviewer (session `f64a92e9…`) for final strategy-2 re-review. Reviewer returned **NOT READY — Major M4 not fully resolved**: found a cross-process CAS race in `publishAtomic()` where a concurrent `pipeline admit` loser could return apparent success with a non-canonical Action because the store treated a present target as idempotent without byte comparison.
- Fixed the CAS race: `src/core/change-run/internal/publish-atomic.ts` now compares the existing target's bytes byte-for-byte with the proposed bytes before declaring `alreadyPresent`; if different, throws `PublishError('publish_target_exists', …)`. Both the "already-present at entry" path and the "race-during-rename" path are guarded. Added two discriminating unit tests in `test/core/change-run/publish-atomic.test.ts` (idempotent-only-when-identical + race-winner-different-bytes) and updated the existing O_EXCL race test comment in `fault-journeys.test.ts`. Focused 3-file suite 58/58. `tsc` and build pass.

Remaining:
- **Re-dispatch the original reviewer** (session `f64a92e9…`) for the CAS-race-fix delta. Only after it confirms M4 closed with no new Blocker/Major does review-loop end and ship/archive proceed.
- After reviewer confirms: re-check task 7.2 (currently unchecked because the protocol changed; the CAS fix is additive hardening, not a redesign of 7.2 itself — but the convention is to re-verify after any post-cap change). Tasks 7.1, 7.3–7.8 are checked and verified.
- Run `pnpm test` one final time for the green-on-clean record (the three runs this session each had at most 2 flaky, unrelated failures; the CAS fix added 2 new tests that pass).
- Then ship → archive (on-merge delivery per ship log).

## Key decisions (and why)
- **publishAtomic must byte-compare, not just existence-check.** The reviewer's scenario: two `pipeline admit` processes with the same candidate frontier but different trusted prompt bytes; both pass manifest coverage and construct Actions; one Record wins; the loser's `commit()` reaches `publishAtomic`, sees the target version already exists, and returns idempotent-success without comparing bytes. The loser then returns a non-canonical receipt. The fix makes idempotency conditional on byte equality, which is correct because content-addressed immutable files are only idempotent when their content matches. The successor must NOT re-litigate this.
- **The CAS fix is at the store layer, not the admission layer.** Admission logic was not weakened; the filesystem publication boundary was hardened. The store now correctly refuses a same-version Record with different bytes, so `commit()` throws and `admit()` propagates the error instead of returning false success.
- **All other authority properties confirmed clean by the reviewer.** The reviewer explicitly verified: lifecycle contexts cannot supply prompt resolution; candidate identity binds Run/version/digest/descriptor with no prompt; manifest parsing is closed/bounded/no-follow/exact-coverage; trusted Action construction derives domain-separated digest+length with no prompt body persistence; dispatch validates complete Action equality and checks transported bytes before backend/lease/process; routed historical missing authority fails closed while unrouted historical stays compatible; command/host bindings construct their real Action kinds. The CAS race was the only open finding.

## Dead ends & gotchas
- The `pipeline.test.ts` locale-neutral and capstone-journeys tests are **flaky under full-suite parallel load** on Windows: they spawn many fresh CLI processes into temp directories and occasionally hit 30s timeouts or EPERM cleanup errors. They pass reliably in isolation. Do NOT treat a full-suite failure from either of these as a regression — re-run the single file to confirm.
- The first full-suite run after rebaselining all pipeline/skill digests may still show a handful of content-hash mismatches if any source template was edited after the baseline computation. Always recompute via the production generator (`loadWorkflowCatalog` + `computeBuiltInWorkflowDigest`) rather than hand-copying from `.claude/skills/` output.
- The `builtin-v2-package-audit.test.ts` `EXACT_CAPABILITY_PINS` table and `skill-templates-parity.test.ts` hash tables must be updated in lockstep whenever any shared skill template text changes (including `STORE_SELECTION_GUIDANCE`, which is interpolated into every workflow + expert skill). A node script that reads from `dist/` and patches the hash tables is the safest method.

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)
- "The CAS race is in `admit()` itself" — false; `admit()` correctly builds the Action and calls `store.commit()`. The defect is purely in `publishAtomic()` treating a present target as idempotent without byte comparison.
- "The existing O_EXCL race coverage was sufficient" — false; the existing test only exercised identical publication bytes (`fault-journeys.test.ts:290-311`). The race with different bytes was never discriminated.
- "The full-suite flaky failures are regressions from the CAS fix" — false; `publish-atomic.test.ts`, `fault-journeys.test.ts`, and `facade-runtime.test.ts` all pass 58/58. The two failing files (`capstone-journeys`, `pipeline.test.ts locale-neutral`) fail on timeout/temp-dir-competition, not on CAS logic.

## Working set
- CAS fix: `src/core/change-run/internal/publish-atomic.ts` (byte-equality check on both idempotent paths), `test/core/change-run/publish-atomic.test.ts` (2 new tests + import), `test/core/change-run/fault-journeys.test.ts` (comment update).
- Reviewer receipt: `.rasen/changes/omnicross-inference-routing/ephemera/reviewer-final-strategy-2-receipt.json`.
- Reviewer prompt: `.rasen/changes/omnicross-inference-routing/ephemera/reviewer-final-strategy-2-prompt.md`.
- Run-state: `.rasen/changes/omnicross-inference-routing/ephemera/auto-run.json` — `review-loop` in_progress round 3, `strategyAttempts` has 2 entries, `openFindings` = [M4 (status: open — CAS fix applied but reviewer not yet re-confirmed)].
- Evidence: `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md` (has LEAD final verification section appended).
- Tasks: `rasen/changes/omnicross-inference-routing/tasks.md` — 7.1 checked, 7.2 unchecked (pending CAS re-confirmation), 7.3–7.8 checked.
- Reviewer session (for final re-review): Claude `f64a92e9-f9d6-4c16-8f3d-e57d55c9503a`, cwd = the worktree.
- Diff: ~109 tracked files, +4700/-650 (approximate after CAS fix).

## Next action
1. Run `pnpm exec vitest run test/core/change-run/publish-atomic.test.ts test/core/change-run/fault-journeys.test.ts --reporter=dot` to confirm CAS fix tests still green on a fresh tree.
2. Re-dispatch the original reviewer (session `f64a92e9-f9d6-4c16-8f3d-e57d55c9503a`) with a prompt focused on the CAS-race-fix delta: "Review the publishAtomic byte-equality fix in `src/core/change-run/internal/publish-atomic.ts`. Confirm the cross-process CAS race is closed and no new Blocker/Major was introduced. The two new discriminating tests are in `test/core/change-run/publish-atomic.test.ts`." Use `rasen agent dispatch --runtime claude --prompt-file <prompt> --contract leaf --sandbox read-only --model opus --effort max --cwd <worktree> --timeout-ms 1800000 --resume f64a92e9-f9d6-4c16-8f3d-e57d55c9503a --json`.
3. If reviewer confirms M4 closed: re-check task 7.2, run final `pnpm test` for the green record, then proceed to ship → archive.
4. If reviewer finds a new issue: fix it (the pattern is the same — identify the root cause in source, fix at the right layer, add a discriminating test, re-verify).
