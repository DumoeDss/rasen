## Why

上一个变更（integrate-gstack-into-openspec）完成了基础设施层——skill 迁入、模板注册、schema 扩展、质量闭环管道。但用户实际能感受到"两个项目融合"的 5 个 OPSX 命令（office-hours、verify 增强、ship、retro、auto）完全缺失。这些命令是 fusion 研究文档的核心价值，也是连接 gstack 专家能力与 OpenSpec 工作流的"水龙头"。

## What Changes

将 fusion 层的 5 个 OPSX 命令模板 + dispatch agent + safety hook 迁入 OpenSpec 的模板体系：

- **`/opsx:office-hours`**：产品验证命令，Startup/Builder 双模式，产出设计文档双写到 change 目录，自动被后续 propose 消费
- **`/opsx:verify` 增强**：替换原版 verify，合并 OpenSpec artifact 一致性检查 + gstack review + qa + cso + design-review，按变更规模自适应深度
- **`/opsx:ship`**：发布命令，合并 gstack ship + land-and-deploy，PR 正文来自 proposal 摘要，ship-log 写入 change 目录
- **`/opsx:retro`**：复盘命令，支持 change-scoped / general / global 三种范围，报告写入 change 目录
- **`/opsx:auto`**：自动驾驶命令，dispatch agent 分析复杂度 → 组建专家团队 → 驱动完整 DAG 流程，3 个暂停点
- **Safety hook**：破坏性命令检测脚本，集成到 Claude Code 的 PreToolUse hook

## Capabilities

### New Capabilities
- `opsx-office-hours-command`: `/opsx:office-hours` 工作流命令模板和斜杠命令
- `opsx-verify-enhanced-command`: `/opsx:verify` 增强版工作流命令模板（替换现有 verify）
- `opsx-ship-command`: `/opsx:ship` 工作流命令模板和斜杠命令
- `opsx-retro-command`: `/opsx:retro` 工作流命令模板和斜杠命令
- `opsx-auto-command`: `/opsx:auto` 自动驾驶命令模板和斜杠命令
- `safety-hook`: 破坏性命令检测 hook 脚本

### Modified Capabilities
- `command-generation`: 工作流命令模板注册表扩展，新增 5 个 OPSX 命令

## Impact

- **模板体系**：`src/core/templates/workflows/` 新增 5 个命令模板文件
- **注册表**：`src/core/shared/skill-generation.ts` 新增 5 个 SkillTemplateEntry + 5 个 CommandTemplateEntry
- **Hooks**：新增 `hooks/safety-check.sh`
- **向后兼容**：新增命令不影响现有工作流；verify 增强通过新 skill 文件替换，原版 verify skill 保留
