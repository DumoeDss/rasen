# Proposal: automate-session-relay

## Why

主会话（LEAD）撞上下文上限时，现状只有两条路：用户手动 `/opsx:handoff` 后自己开新会话，或被动等 auto-compact 用一份不可控的机器摘要接管。`add-context-handoff` 当时把"自动主会话重启"标记为 out of scope（"platform cannot"）——该假设已被探针推翻（2026-07-07，claude CLI 2.1.202，Windows）：会话内可拉起新的 Claude Code 客户端（嵌套 headless 不被 `CLAUDECODE=1` 拦截；`Start-Process` 分离进程继承 cwd 并独立完成工作；新终端窗口交互式 + 初始 prompt 经 `-EncodedCommand` 传递可完整送达并得到回复）。既然平台能做到，接力就应该闭环：主动路径自动拉起继任会话，被动路径（auto-compact）自动指路回蒸馏物。

## What Changes

- **主动接力（方案 A）**：LEAD 自探针达阈值后，写 session handoff 文档 → 更新 run-state `sessionHandoff`（新增代数计数）→ 征得用户授权 → 在工作目录拉起新终端窗口的交互式 Claude Code 继任会话，初始 prompt 指示"读 handoff 文档 → `openspec pipeline resume <change>` → 继续推进"→ 前任确认继任者接手后收尾退场（先 spawn 后退场，不依赖孤儿进程存活）。
- **Quiesce 不变式**：session 接力只发生在 stage 边界——所有在飞 worker 已返回 `DONE`/`HANDOFF` 且 run-state 落盘。跨会话不恢复 subagent（agentId 是死句柄）；继任者按既有 Step F.1 冷恢复梯度重生新 worker。
- **接力链防失控**：`sessionHandoff` 增加代数 `n`；session 级接力复用 `maxRelays` 语义，超限时不再自动接力，改为向用户升级（反复接力本身是"任务该 decompose"的信号）。
- **引号安全的 spawn 机制**：初始 prompt 必须经 `-EncodedCommand`（base64）或文件中转传递——裸拼引号会被双层命令行解析截断（探针 ③ 首次尝试实测：中文 prompt 被截成前两字）。
- **被动加固（方案 B）**：新增 SessionStart（matcher: `compact`）hook 指引——compaction 发生后自动注入"运行 `openspec pipeline resume` 检查 `sessionHandoff` 与各 stage handoff 文档，从蒸馏物恢复，不要信任摘要细节"。沿用 safety-hook 先例：提供脚本 + init 打印 copy-paste 配置，绝不自动改写 `.claude/settings.json`。
- **H.1 升级**：auto 入口的 session 预检探针从"提醒用户考虑 /opsx:handoff"升级为"提供自动接力选项"（仍非阻塞，用户拥有决定权）。
- 修订 `add-context-handoff` design 中 "platform cannot" 的历史结论（归档不改；新 design.md 记录推翻依据）。

## Capabilities

### New Capabilities

- `session-relay`: 主动接力协议——探针触发、handoff 文档先行、用户授权、引号安全地拉起继任客户端、quiesce 不变式、代数上限、前任退场时序。
- `compact-recovery-hook`: SessionStart(compact) 恢复指引 hook——脚本交付 + init 配置说明，compaction 后把会话指回 handoff 蒸馏物与 pipeline resume。

### Modified Capabilities

- `orchestration-handoff`: "LEAD session pre-flight probe" 要求从单纯提醒升级为提供自动接力选项；新增 session 接力的 quiesce 与代数上限约束。
- `workflow-handoff-command`: `/opsx:handoff` 在写完 handoff 文档后增加可选接力步骤（询问是否拉起继任会话），并在 `sessionHandoff` 中记录代数。
- `pipeline-handoff-config`: run-state `sessionHandoff` 增加可选代数字段 `n`；`openspec pipeline resume` 原样报告（无字段时行为不变）。

## Impact

- **模板**：`src/core/templates/workflows/_orchestration.ts`（H.1 升级、session 接力协议、quiesce 不变式）、`src/core/templates/workflows/handoff.ts`（接力步骤 + spawn 机制说明）。
- **run-state**：`src/core/pipeline-registry/run-state.ts`（`sessionHandoff.n` 可选字段）及 `src/commands/pipeline.ts` resume 输出。
- **hook 交付**：compact-recovery hook 脚本 + `src/core/init.ts` 的配置提示（对齐 safety-hook 的"只打印、不改写"先例）。
- **测试**：`test/commands/handoff.test.ts`、`test/core/pipeline-registry/run-state.test.ts`、`test/commands/pipeline.test.ts`、init 输出断言。
- **文档**：`docs/opsx-workflow-guide.md` 与 `docs/zh/` 镜像对齐。
- **跨平台**：spawn 机制在 Windows（PowerShell `Start-Process` + `-EncodedCommand`）已验证；macOS/Linux 的等价形态（终端模拟器差异、`nohup`/`open -a Terminal` 等）在模板中按平台分支给出指引，实现期验证。
- **残留验证项**：分离进程活过整个前任会话退出（Windows job object 语义）——接力时序上不依赖此点（先 spawn、确认接手、再退场），实现期补验。
