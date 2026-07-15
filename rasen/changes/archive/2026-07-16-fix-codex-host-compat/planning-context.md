# Planning Context — fix-codex-host-compat

## User intent (verbatim)
"--no-gate 新建worktree开修复分支，修复这个codex的问题" + 两张截图：一个 Codex CLI 会话作为 LEAD 运行 `rasen-auto` 时暴露的兼容问题。

## Evidence from the screenshots (Codex-as-LEAD run)
1. **`rasen agent context` 探针在 Codex 宿主下不可用** — 主会话是 Codex，机器上没有对应的 Claude transcript；Codex LEAD 只能把占用状态记为 `unavailable-codex-lead` 继续。当前 CLI 在这种情况下硬报错（非零退出 + ✖ Error），而 auto 工作流把该探针定义为"非阻断预检"。期望：CLI 提供可机读的优雅降级（如 `--json` 输出 `{available:false, reason:...}` 退出 0，或等价机制），让非 Claude 宿主能把探针记为 unavailable 而不是吞一个错误。
2. **run-state Schema 拒绝 Codex 宿主的合法状态** — 截图确认根因："阶段 worker 的 runtime 写成了 Rasen 不接受的 `codex-host-fallback`，且 `transcript:null` 违反可选字符串约束"。代码事实（本仓库当前 HEAD）：
   - `src/core/pipeline-registry/types.ts:23` — `AgentRuntimeSchema = z.enum(['claude','codex'])`
   - `src/core/pipeline-registry/run-state.ts:51` — `runtime: AgentRuntimeSchema.optional()`
   - `src/core/pipeline-registry/run-state.ts:54` — `transcript: z.string().optional()`（不接受 null）
   设计问题待 planner 决断：是放宽 schema（`transcript: z.string().nullable().optional()` / null→undefined 归一化），还是保持 schema 严格但在解析边界做 lenient 归一化（strip null、未知 runtime 归一为 'codex' 或保留原文）。倾向：**解析时归一化 + 宽容读取**，写入方（LEAD prompt/模板）同时更新指导，杜绝再写非法值。
3. **workDir 的 auto-run.json 识别** — 截图称"当前版本没有从返回的外部 workDir 识别 auto-run.json"，Codex LEAD 把状态迁到 changeRoot 后 CLI 仍报找不到。需核实当前 HEAD 的 `rasen pipeline resume` 是否已实现 workDir-first + sticky-legacy 读取（`src/core/pipeline-registry/run-state.ts` / `src/commands/pipeline.ts`）；若已修复则只需回归测试确认，若未修复则修。注意截图会话可能跑的是旧安装版本——以当前代码实测为准。
4. **rasen-auto 说明文档过长** — Codex 首次读取被输出上限截断，需分段读取。候选低成本缓解：模板生成的 Codex adapter 侧拆分/加"分段读取"提示。**定界建议**：此项若牵动模板管线过大可降级为 known-open，写进 proposal 的 out-of-scope。

## Constraints / decisions already made
- 分支 `fix/codex-host-compat`，worktree `/Users/sayo/repos/rasen-wt-codex-host`，基于 dev/0.1.4。所有编辑在该 worktree 内。
- 版本号归用户管：不 bump 版本。
- 交付：本地 commit（ship local），push/PR 由用户拍板。
- 修复应以"非 Claude 宿主（Codex LEAD）驱动 rasen pipeline"为一等公民场景：schema 与 CLI 出口都要对宿主运行时中立。
- 测试仓库跑 `pnpm test`（注意外层 pnpm-workspace 历史问题已修）。

## Findings log (planner appends below)

### Planner (propose), 2026-07-16
- **Scope item 3 is already implemented AND spec'd at HEAD**: `resolveRunStateLocation` (run-state.ts:258, workDir-first + sticky-legacy) is used by `resume` at `src/commands/pipeline.ts:390` (and :327 for portfolio state), and the behavior is a normative requirement in `rasen/specs/opsx-pipeline-registry/spec.md` (Pipeline CLI Surface). Landed as regression-test-only (tasks §4).
- **Root-cause link between items 2 and 3**: `readRunState` (run-state.ts:235) maps ANY validation failure to `null`, so a Codex-written run-state with `transcript: null` surfaces downstream as resume's "No run-state (auto-run.json) found" — the screenshot's "workDir not recognized" symptom is most plausibly the schema rejection, not a location bug (or an older installed version). This motivated design D3 (invalid-vs-absent distinction in resume).
- **Decision D1**: lenient parse-boundary normalization, NOT schema widening. null optional-string fields → stripped; unknown `runtime` → preserved as passthrough `runtimeRaw`, never coerced to `codex` (coercion would fabricate an exec-bridge claim downstream logic acts on). `writeRunState` stays strict.
- **Decision D2**: probe degradation is scoped to environmental absence under `--latest` only (typed `AgentContextUnavailableError` from `findLatestMainTranscript`, exit 0, JSON `{available:false, reason:"no-transcript", detail}`); explicit `--transcript` failures and flag errors stay exit 1. Success JSON gains additive `available: true`.
- **Item 4 declared out-of-scope**: generated rasen-auto instruction ≈90KB (auto.ts 23,328 B + _orchestration.ts 67,249 B); splitting = template-pipeline surgery; Codex segmented reads already cope. Known-open.
- Delta specs target `cli-agent-context` (MODIFIED Context probe command) and `opsx-pipeline-registry` (ADDED host-tolerant parsing + resume invalid-vs-absent). `rasen validate fix-codex-host-compat` passes.
