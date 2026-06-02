## Context

上一个变更已完成基础设施：27 个 gstack skill 模板注册到 `skill-generation.ts`，`openspec init` 生成 31 个 SKILL.md。但缺少 5 个关键的 OPSX 工作流命令把 gstack 专家能力串入工作流。

fusion 层（`fusion/skills/opsx-*/SKILL.md`）已有完整的命令逻辑实现，本次工作是将其迁入 OpenSpec 的模板体系。

## Goals / Non-Goals

**Goals:**
- 5 个 OPSX 命令（office-hours、verify、ship、retro、auto）作为工作流模板注册
- `openspec init` 时自动生成对应的 skill 文件和斜杠命令
- safety hook 脚本可供用户配置到 Claude Code

**Non-Goals:**
- 不修改 fusion SKILL.md 的核心逻辑（直接复用）
- 不改变现有 11 个 OPSX 工作流命令
- 不新增 CLI 命令

## Decisions

### Decision 1：模板迁入方式 — 直接内联 fusion SKILL.md 内容

**选择**：将 fusion 的 5 个 SKILL.md 内容直接作为 TypeScript 模板函数的 `instructions` 字符串，放在 `src/core/templates/workflows/` 下。

文件映射：

| fusion 源文件 | OpenSpec 模板文件 | 函数名 |
|---|---|---|
| `fusion/skills/opsx-office-hours/SKILL.md` | `workflows/office-hours.ts` | `getOfficeHoursCommandSkillTemplate()` + `getOpsxOfficeHoursCommandTemplate()` |
| `fusion/skills/opsx-verify-enhanced/SKILL.md` | `workflows/verify-enhanced.ts` | `getVerifyEnhancedSkillTemplate()` + `getOpsxVerifyEnhancedCommandTemplate()` |
| `fusion/skills/opsx-ship/SKILL.md` | `workflows/ship.ts` | `getShipCommandSkillTemplate()` + `getOpsxShipCommandTemplate()` |
| `fusion/skills/opsx-retro/SKILL.md` | `workflows/retro.ts` | `getRetroCommandSkillTemplate()` + `getOpsxRetroCommandTemplate()` |
| `fusion/skills/opsx-auto/SKILL.md` + `fusion/agents/dispatch.md` | `workflows/auto.ts` | `getAutoCommandSkillTemplate()` + `getOpsxAutoCommandTemplate()` |

每个文件同时导出 SkillTemplate（用于 `.claude/skills/`）和 CommandTemplate（用于 `.claude/commands/`），与现有的 explore.ts、apply-change.ts 等模式完全一致。

**理由**：fusion SKILL.md 的逻辑已经过测试和使用验证，直接复用内容最可靠。内联为 TypeScript 字符串后，不再依赖外部文件读取。

### Decision 2：verify 增强 — 新命令而非替换

**选择**：新增 `verify-enhanced` 作为独立工作流 ID，不替换现有的 `verify`。

- 现有 `openspec-verify-change` skill → 保持不变（纯 artifact 一致性检查）
- 新增 `openspec-verify-enhanced` skill → 增强版（artifact + review + qa + cso）
- 用户在 Profile 中选择用哪个

**理由**：不破坏现有用户的 verify 行为。增强版是可选升级。

### Decision 3：auto 命令 — 合并 dispatch agent 逻辑

**选择**：将 `dispatch.md` 的任务分析和专家选择矩阵内联到 `auto.ts` 的 SKILL.md 内容中。

fusion 中 dispatch.md 是独立 agent，但在 OpenSpec 模板体系中没有"agent"概念。最自然的做法是把 dispatch 逻辑合并到 auto 命令的指令内容中——AI 在执行 `/opsx:auto` 时读取的 SKILL.md 就包含了"如何分析任务复杂度"和"如何选择专家"的完整指引。

### Decision 4：safety hook — 独立脚本文件

**选择**：将 `safety-check.sh` 放在 `hooks/safety-check.sh`，`openspec init` 时提示用户如何配置。

不自动写入 `.claude/settings.json`，因为修改用户的 hook 配置可能有副作用。改为在 init 输出中提示用户。

### Decision 5：命令中的 gstack 路径适配

fusion SKILL.md 中引用了 `gstack` skill 路径（如 "invoke /review"、"run /ship"）。迁入后这些引用保持不变——因为对应的 gstack 专家 skill 已经在上一个变更中注册为 `openspec-review`、`openspec-ship` 等，AI 可以直接调用。

唯一需要替换的是 fusion SKILL.md 中的 `fusion/` 路径引用（改为直接引用 skill 名称），以及 `~/.gstack/` → `~/.openspec/`。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| auto 命令指令过长（dispatch + auto 合并） | 分段组织，AI 按需阅读 |
| verify-enhanced 同时存在 verify 可能让用户困惑 | 在文档中说明两者区别 |
| safety hook 需要用户手动配置 | init 输出中提供 copy-paste 命令 |
