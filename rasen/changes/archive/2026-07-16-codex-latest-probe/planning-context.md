# Planning Context — codex-latest-probe

## User intent (verbatim)
"走auto流程开始补上！" — 补上 parity 缺口：`rasen agent context --latest` 目前只搜 Claude projects 目录，Codex LEAD 无法用它自探测占用，只能拿到 D2 的 `{available:false}` 降级。目标：`--latest` 能发现最新的 Codex rollout，让 Codex 宿主拿到真实占用数字。

## Code facts (verified at fix/codex-host-compat HEAD, this worktree)
- `src/core/agent-context.ts:307` — `findLatestMainTranscript(baseDir)` 只扫 Claude projects 目录（`--dir` 可覆盖 base）；`--latest` 路径见 :358-368。
- 探针本身已经双运行时：`TranscriptKind = 'claude' | 'codex'`（:151），文件嗅探（:194-211，`session_meta` / rollout 文件名 `CODEX_ROLLOUT_BASENAME` 正则）+ `--runtime` 强制标志（:158）；codex 读取走 `readRolloutOccupancy`（`src/core/codex/`，E03 实验钉死 `token_count` 事件 + rollout 自带 context_window）。
- 即：**读取逻辑全部存在，缺的只是"发现最新 Codex rollout"的目录扫描**。Codex rollout 位置：`$CODEX_HOME/sessions/`（默认 `~/.codex/sessions/`），按日期分层目录，文件名即 `CODEX_ROLLOUT_BASENAME` 匹配的 rollout jsonl（`findRolloutPath` 已有构径逻辑可参考，src/core/codex/）。
- D2 刚落地（本分支）：`AgentContextUnavailableError` 环境性缺失 → exit 0 `{available:false, reason:"no-transcript"}`；本 change 的行为要与之协调。
- parity 档案：`docs/codex-parity/solutions/05-transcript-occupancy-probe.md`（live-verified，读侧）；本 change 关闭的是 LEAD 自探测缺口（README 中我方 known-open）。

## Design questions for the planner (decide, don't punt)
1. 发现语义：`--latest` 默认行为怎么定？候选：(a) `--runtime codex` + `--latest` → 扫 Codex sessions 目录；(b) `--latest` 无 runtime 时先 Claude 再 fallback Codex；(c) 只做显式 (a)，隐式 fallback 另议。倾向 **(a) 显式优先**，(b) 的隐式 fallback 若做需明确"哪个才是'我的'会话"的歧义处理——一台机器同时有 Claude 和 Codex 会话时，静默选错比报 unavailable 更糟。
2. "最新 main-session"在 Codex 侧的判定：rollout 无 Claude 的 main/subagent 目录区分，需定义（如 mtime 最新的 rollout 即最新会话；子代理线程与主会话如何区分——可能不需要区分，Codex LEAD 知道自己在最新线程）。
3. `--dir` 覆盖语义对 codex runtime 的映射（覆盖 sessions 根目录）。
4. unavailable 降级（D2）在 `--runtime codex --latest` 下的对应行为：无 sessions 目录/无 rollout → 同样 exit 0 `{available:false}`。
5. auto/_orchestration 模板 Step 0 / Step H 的探针指导是否要提及 Codex LEAD 用法（D4 同类回写）；若改模板记得 parity 哈希（test/core/templates/skill-templates-parity.test.ts 手工 bump，跑测试拿 diff 值）。

## Constraints / decisions already made
- worktree `/Users/sayo/repos/rasen-wt-codex-host`，分支 `feat/codex-latest-probe`（基于 fix/codex-host-compat = PR #5；若 PR #5 被要求改动需 rebase——planner 不用管，LEAD 跟踪）。所有编辑在该 worktree。
- 不 bump 版本；交付本地 commit，push/PR 由用户拍板。
- 前一 change 的耐久发现：runCLI 测试跑 dist/ 需先 `pnpm run build`；parity 哈希手工维护。
- 范围外：会话接力 H.7 的 Codex 侧（parity #13）明确不做，别混进来。

## Findings log (planner appends below)

### planner (propose), 2026-07-16
- **session_meta 携带 `cwd`（本机 live-verified）**：真实 rollout 首行 `{"type":"session_meta","payload":{"session_id":…,"cwd":"/Users/sayo/repos/rasen-site","originator":"codex_exec","source":"exec","thread_source":"user",…}}`。这给了 Codex 侧与 Claude "cwd 派生 projects 目录" 完全对等的项目身份过滤器——设计 Q2 的答案不用发明启发式。
- **fork 子代理 rollout 可辨识**：E11 Finding 3 实证 `spawn_agent` 子线程的 session_meta 带 `forked_from_id` + `parent_thread_id`——即 Claude `agent-*.jsonl` 排除规则的 Codex 对等物。注意：rasen exec 桥 spawn 的 worker 是独立 `codex exec` 进程，**没有** fork 标记，只能靠 cwd 过滤（worker 在 worktree、cwd 不同）；同 cwd 并发 sibling 是已接受残余（design D2 记录）。
- **五问决策**：Q1 显式 only（`--runtime codex` 门控发现，无隐式 fallback；Claude 侧 unavailable detail 加一句指路）；Q2 mtime 最新 + cwd 匹配（path.resolve 后精确比较）+ fork 排除，懒惰 newest-first 只读候选首行；Q3 `--dir` 覆盖 sessions 根（cwd 过滤仍生效——dir 管"在哪存"，cwd 管"是谁的"）；Q4 一切发现落空 → 复用 AgentContextUnavailableError → D2 原样 `{available:false}`，不加新 reason code；Q5 auto+_orchestration 各一行指导，parity 哈希手工 bump（沿 fix-codex-host-compat D4 先例：模板指导不进 spec）。
- **树扫描可复用**：`rollout.ts` 的 `scanForRollout` 已实现有界三层日期树遍历；design D6 定为抽出共享枚举器（`codex/` 保持 policy-free，probe 语义留在 agent-context.ts）。
- **CLI 面零改动**：`--latest/--runtime/--dir` flag 全部已存在，仅既有组合的行为变化；`probeAgentContext` 需把 validated runtime 传进 `resolveTranscriptPath`（现在 runtime 只用于 reader 分流，:403-404）。
- **上一 change 存档确认**：D4 模板指导当时未进 delta spec（archive 里只有 cli-agent-context + opsx-pipeline-registry 两个 delta，均无模板要求）——本 change 同样把模板行留在 design/tasks。
