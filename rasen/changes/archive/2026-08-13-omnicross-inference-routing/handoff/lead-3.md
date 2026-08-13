# Handoff: omnicross-inference-routing — lead #3

## Original intent

用户要求在 `dev/0.2.0` 上通过 `$rasen-auto small-feature` 开发 OmniCross inference routing：Pipeline/Workflow stage 只需配置工具（Claude Code 或 Codex）、Provider/upstream 与模型，Rasen 通过常驻 OmniCross daemon 自动申请该次执行专用的下游路由凭据和格式转换；用户不再手工创建或绑定下游 key。不得改写用户的 Codex `config.toml`/`auth.json` 或 Claude 凭据文件。本会话约束：仅使用 Claude Code runtime（不用 Codex），所有 worker 使用 Opus，上下文 250k，使用现有 worktree（禁止新建）。

## Position

Pipeline: `small-feature`. Completed: `propose`, `apply` (32/32 original tasks). Current stage: `review-loop`, configured 3-round cap reached with **Major M4 open**; now in **post-cap strategy attempt #2** (candidate-preview protocol for executable input authority). Tasks 7.1–7.8 (the post-cap rework tasks) are implemented in source but **all 8 remain unchecked** — dynamic full-suite verification is incomplete.

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-omnicross-inference-routing` (Git-registered; do NOT create a new worktree). Branch `feat/omnicross-inference-routing`, base `dev/0.2.0` @ `75c3366a`. Every shell command must `cd` into this worktree explicitly (the session tool cannot persist CWD there).

## Done / Remaining

Done (this session):
- Independent verify (round 1): found M1 (shipped Management API never wired route-aware process bridge) + M2 (cancel-after-success when callback ignores abort). Both fixed by a fresh Claude Opus fixer; re-review confirmed resolved.
- Round 2: M1/M2 fixes introduced M3 (hardcoded `leaf` contract for all routed Actions) + Minor-1 (routed turns bypass `maxInputBytes`). Fixed; re-review confirmed resolved but introduced M4 (partial Action equality — executor consumes caller Action, not committed Action) + Minor-2 (diagnostic sanitizer truncates valid evaluate gaps >100).
- Round 3 (cap): Minor-2 fixed; M4's caller-Action-copy portion fixed via complete `canonicalJson()` equality + dispatching `committed.action`. But M4's deeper root remained: request sibling `turnInput` is the actual Claude/Codex prompt and is NOT authenticated against committed `agent.input`.
- Post-cap strategy #1: planner chose design **B2** — freeze optional `agent-turn-input/1` binding (domain-separated SHA-256 digest + exact UTF-8 byte length of trusted rendered prompt; do NOT persist prompt body, do NOT serialize `agent.input`). Low-level binding/assertion/typed-failures implemented, but BLOCKED: shipped orchestration admits/grants the Action BEFORE the LEAD renders the complete worker prompt, so no trusted pre-admission render boundary existed.
- Post-cap strategy #2: designed + implemented the **candidate-preview → trusted-render → manifest → `pipeline admit`** protocol (the major architecture addition this session):
  - `start`/`resume`/`complete`/`control` stop before every agent candidate and return prompt-free `candidates[]`; no auto-admission.
  - New `rasen pipeline admit <change> --run <runId> --turn-input-file <private-ephemera-manifest> --json` command: validates exact frontier coverage, computes binding inside Action builder, atomically admits/grants.
  - `RuntimeCapabilityBinding` became a closed discriminated union (agent|command|host); `prepareRuntimeContext.buildAction` dispatches by kind to `buildAgentAction`/`buildCommandAction`/`buildHostAction` (previous code unconditionally called `buildAgentAction` with a fake placeholder prompt for non-agent kinds — a real regression now fixed).
  - Source orchestration templates (`_orchestration.ts`, `auto.ts`, `goal-command.ts`, `review-cycle.ts`) updated to the preview→render→manifest→admit handshake.
  - review-cycle capability digest rebaselined `d185e73f…` → `4216a022…` across 3 shipped pipelines + `builtin-v2-package-audit.test.ts` (the source template changes shifted the skill content digest; the stale pin cascaded into 5 collection failures + ~500 downstream in the first full-suite run).
  - Compatibility migration: shared helpers added for (a) facade exact preview→trusted admission and (b) fresh-process CLI preview→private manifest→`pipeline admit`. GoalCycle, ReviewCycle, evaluator, physical-readiness, CLI-complete, composite/ack-loss/Canvas, bug-fix/complex E2E migrated.
- Verified GREEN on latest tree: TypeScript `tsc --noEmit`; `pnpm build`; preview/admit protocol 36/36; execution-authority 126/126; replacement-lease identity 15/15; change-run construction 59/59; broader AT regression 14 files 229/229; built-in registry smoke 47/47.

Remaining:
- **4 lifecycle failures** (cluster run, not yet fixed — last fixer hit server overload twice with zero changes):
  1. `test/core/change-run/ack-loss-journeys.test.ts` ~line 628 & 675: fresh-process CLI commands exit 1. Must read the real child stderr/stdout and fix the shared fresh-process preview→manifest→admit helper (likely missing option, wrong receipt parse, or manifest outside allowed ephemera). Do NOT blindly change expected exit code.
  2. `test/core/change-run/canvas-v2-vertical-proof.test.ts` ~line 604: `Safe path root does not exist.` — fixture must create the private ephemera root before writing/passing the turn-input manifest.
  3. `test/core/change-run/ecp-composite-dogfood.test.ts` line 153: received `advanced` vs expected `created` — migrated helper overwrote `startReceipt` with the explicit-admission receipt. Preserve both: start preview is `created`/actions=[]/candidate present; admit receipt is `advanced`/one Action.
- **Other unverified clusters** from the 14-file failed set (compatibility migration applied but NOT yet re-run after migration):
  - CLI/E2E: `test/cli-e2e/basic.test.ts` (pipeline help must include new `admit` subcommand), `test/commands/pipeline-bugfix-e2e.test.ts`, `test/commands/pipeline-complex-e2e.test.ts`, `test/core/change-run/cli-complete.test.ts`.
  - template/help parity: `test/core/completions/command-registry.test.ts`, `test/core/templates/orchestration-bundles.test.ts`, `test/core/templates/skill-templates-parity.test.ts` (rebaseline only actual source-template digests; never hand-edit generated `.claude/skills`).
- After all 14 files green: re-run full `pnpm test -- --reporter=dot` (Windows ≈25 min; background it, poll ≤270s). Then change validation, `git diff --check`, UTF-8 replacement scan, JSON/YAML parse, persisted prompt/secret scan, architecture-index check. Then check tasks 7.1–7.8.
- Then dispatch the original independent reviewer (Claude session `f64a92e9-f9d6-4c16-8f3d-e57d55c9503a`) for a final re-review of the strategy #2 delta. Only after it confirms M4 closed with no new Blocker/Major does review-loop end and ship/archive proceed.

## Key decisions (and why)
- **B2 digest+length binding, not prompt-body persistence and not `agent.input` serialization.** `agent.input` is structured orchestration JSON (e.g. `{ change }`), not a complete prompt; serializing it would authenticate the wrong workload. Persisting full prompt bodies would duplicate MiB-scale text across Record snapshots. Digest+length authenticates exact rendered bytes via collision-resistant SHA-256 over a domain-separated stream while keeping transport bounded. The successor MUST NOT re-litigate this.
- **Mandatory preview boundary; no auto-admission of agent candidates.** `start`/`resume`/`complete`/`control` stop at agent preview; LEAD renders → writes private manifest → calls `pipeline admit`. This is load-bearing for M4 — do not restore auto-admission to make tests green.
- **Historical routed Actions without binding fail closed; historical unrouted preserve old request-rendered behavior.** Legacy `rasen agent dispatch --prompt-file` is unchanged and outside the frozen-action executor.
- **`RuntimeCapabilityBinding` is a closed discriminated union** freezing command invocation authority / host operation authority; `prepareRuntimeContext.buildAction` dispatches by kind. Do not revert to a single `buildAgentAction` with placeholder input.
- **review-cycle capability digest = `sha256:4216a022…`** (was `d185e73f…`). If source templates change again, recompute via `computeBuiltInWorkflowDigest` and update all 4 binding sites in lockstep.
- Worker terminal permissions in this environment repeatedly blocked child test/typecheck execution; LEAD ran all dynamic gates directly. Successor workers will likely hit the same — plan to verify gates from the LEAD session.

## Dead ends & gotchas
- Strategy #1's hidden `--turn-input-file` manifest assumed the complete prompt existed before the existing mutating calls. It does not: shipped LEAD first receives an admitted Action and only then renders the worker brief. This is why strategy #2 had to add an explicit quiescent preview boundary rather than a late renderer.
- First full-suite run reported **516 failures** — almost entirely the review-cycle digest cascade (5 collection failures → ~500 downstream on a broken registry). The real frontier after digest repair was 14 files / 89 tests. Always fix collection-level failures before reading the cascaded count.
- Earlier in the session the Agent tool forced an `isolation: worktree` on a reviewer dispatch, violating the no-new-worktree constraint; switched to `rasen agent dispatch` (Claude print bridge) with explicit `--cwd` pinned to the existing worktree. Use `rasen agent dispatch` for all leaf workers, never the Agent tool.
- Two test failures were `.rejects` matcher shape mismatches, not product bugs: `facade.admit` synchronously throws `candidate_stale` before returning a Promise, so `expect(() => …).toThrowError(...)` is correct, not `await expect(…).rejects`.
- `digestLaunchIntent` takes `{ pipeline, engine: 'reconciler', inputs }`; a fixture that hashed the whole request or used a hardcoded digest triggered `launch_request_conflict`. Derive digest from the canonical normalized envelope.
- Worker 5ca7bed7 (strategy #1 impl) died on API 401 mid-run after 232 turns and left a large accidental churn (+6745/-3871 incl. a literal NUL in `pipeline.ts`); revival cleaned it to +3165/-200. Always audit `git diff --numstat` after an interrupted worker before trusting its files.

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)
- "Complete Action equality implicitly covers `turnInput`" — false; `turnInput` is a sibling request field, not an Action field. Current best fix: strategy #2 candidate-preview protocol (in progress).
- "`agent.input` can be serialized as the prompt" — false; it is structured lifecycle metadata omitting the rich driver brief.
- "Routed-only enforcement is sufficient" — false; unrouted hosted/in-tool seams consume the same request string.
- "The 516 full-suite failures are 516 distinct defects" — false; digest cascade. Real frontier after repair: 14 files.
- "Non-agent `buildAction` regression is intentional" — false; `buildCommandAction`/`buildHostAction` must be reachable. Fixed.

## Working set
- Change blackboard: `rasen/changes/omnicross-inference-routing/` (tasks.md 7.1–7.8 all unchecked).
- Run-state: `.rasen/changes/omnicross-inference-routing/ephemera/auto-run.json` — `review-loop` in_progress round 3, `strategyAttempts` has 2 entries, `handoffs[]` records fixer strategy series, `openFindings` = [M4, Minor-2(resolved in source, unchecked)].
- Strategy design: `rasen/changes/omnicross-inference-routing/evidence/strategy-review.md` (B2 decision + Strategy attempt 2 protocol section — authoritative for the preview state machine).
- Fix reports: `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md` (rounds 1–3 + Post-cap strategy attempt 2 fix section, partially filled).
- Review report: `rasen/changes/omnicross-inference-routing/evidence/review-report.md` (rounds 1–3 re-review appended; M4 open).
- Worker handoffs (fixer series): `handoff/fixer-strategy-1.md`, `fixer-strategy-2-successor.md`, `fixer-strategy-2-tests.md`, `fixer-strategy-2-final-two.md`, `fixer-preview-compatibility-migration.md`.
- Core new/changed source: `src/core/change-run/contracts.ts`, `internal/actions.ts`, `internal/facade-runtime.ts`, `internal/runtime-context.ts`, `facade.ts`; `src/core/frozen-action-executor/{authority,executor,production-executor,action-outcome}.ts`; `src/core/omnicross/lease-execution.ts`; `src/core/agent-diagnostics.ts`; `src/core/worker-contracts.ts`; `src/commands/pipeline.ts` (new `admit` subcommand); `src/core/templates/workflows/*.ts`; `pipelines/{small,full,bug-fix}/pipeline.yaml`.
- Diff: 101 tracked files, +4514/-490.
- Reviewer session (for final re-review): Claude `f64a92e9-f9d6-4c16-8f3d-e57d55c9503a`, cwd = the worktree.

## Next action
1. Fix the 4 lifecycle failures listed above (ack-loss ×2, Canvas, composite-dogfood). The exact failure diagnostics are in task output `bkqtga3j4` (cluster run). Re-run that 7-file lifecycle cluster until 121/121.
2. Re-run the remaining unverified clusters (CLI/E2E + template/help parity) from the 14-file set; fix iteratively.
3. Re-run full `pnpm test -- --reporter=dot`; get to 0 failures.
4. Run change validation, `git diff --check`, UTF-8/JSON/YAML/persistence scans; update architecture-index detail if seams changed.
5. Check tasks 7.1–7.8.
6. Dispatch the original reviewer (session `f64a92e9…`) for final re-review of the strategy #2 delta; confirm M4 closed, no new Blocker/Major.
7. On clean: end review-loop, proceed to ship → archive (on-merge delivery per ship log).
