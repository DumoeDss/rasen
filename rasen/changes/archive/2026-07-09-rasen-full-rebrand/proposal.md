## Why

rasen 目前只改了 CLI 名（`rasen`），但斜杠命令前缀（`/opsx:*`）、技能目录名（`openspec-*`）和工作区目录（`openspec/`）都沿用上游。这意味着 rasen 和用户自装的上游 OpenSpec 在同一个项目里会**正面冲突**：两者都往 `.claude/commands/opsx/`、`.claude/skills/openspec-*/` 写文件、都认 `openspec/` 目录为工作区。README 目前的解法是要求用户"先卸载已安装的 openspec"——这是最差的共存方案，实际上把"试用 rasen"变成"放弃 OpenSpec"。本变更完成品牌化的最后一块：命令、技能、工作区目录全部换到 rasen 命名空间，与上游 OpenSpec 无冲突共存，旧 `openspec/` 工作区作为只读迁移源。

## What Changes

- **BREAKING** 斜杠命令前缀 `/opsx:*` → `/rasen:*`：所有 28 个工具 adapter 的命令文件路径（`commands/opsx/<id>.md` → `commands/rasen/<id>.md`、`opsx-<id>.md` → `rasen-<id>.md`）与 ~24 个 workflow 模板正文中的命令引用全部更换；引入统一的前缀常量，消除散落字面量。
- **BREAKING** 技能命名空间 `openspec-*` / `openspec:` → `rasen-*` / `rasen:`：技能目录名、模板 `name` 字段、`metadata.author`、`pipelines/*.yaml` 引用的技能 ID 全部对齐。
- **BREAKING** 工作区目录 `openspec/` → `rasen/`：`OPENSPEC_DIR_NAME` 等常量改值，~40 处绕过常量的硬编码 `'openspec'` 路径字面量全部收编到常量。
- **新增** 旧工作区只读迁移：检测到 `openspec/` 且无 `rasen/` 时，`rasen init`（及显式 `rasen migrate`）提示并**复制**（不移动、不改写）`openspec/` 内容到 `rasen/`；旧目录永不被 rasen 写入。若同一项目同时在用上游 OpenSpec，用户可拒绝迁移，两套工作区互不干扰。
- **变更** store 元数据目录 `.openspec-store/` → `.rasen-store/`（读取时向后兼容旧名），默认 store 位置 `~/openspec/<id>` → `~/rasen/<id>`（已注册的旧路径继续有效）。
- **变更** README/README_zh：删除"先卸载已安装 openspec"的要求，改为共存说明（rasen 与上游 OpenSpec 可同项目并存，命令/技能/目录命名空间完全隔离）；更新"布局与上游一致"的对齐表述。
- **变更** 本仓库自举：仓库自身的 `openspec/` 工作区迁移为 `rasen/`。
- 旧的 rasen 装的 `/opsx:*` 命令与 `openspec-*` 技能文件：`rasen update` 仅在能确认归属本 fork 时清理，无法确认（可能属于上游）时保留并提示——绝不误删上游 OpenSpec 的文件。

## Capabilities

### New Capabilities
- `workspace-migration`: 检测旧 `openspec/` 工作区并以只读复制方式迁移到 `rasen/`；迁移的触发时机（init 提示 / 显式命令）、不覆盖已有 `rasen/`、旧目录零写入、与上游共存时可拒绝迁移。

### Modified Capabilities
- `rasen-cli-identity`: 反转原有 carve-out——工作区目录、命令前缀、技能命名空间不再"保持上游不变"，全部纳入 rasen 品牌命名空间。
- `command-generation`: 命令文件路径与命令名前缀从 `opsx` 改为 `rasen`；前缀由单一常量定义。
- `skill-name-prefix`: 技能 `name`/dirName/author 从 `openspec:`/`openspec-`/`openspec` 改为 `rasen:`/`rasen-`/`rasen`。
- `cli-init`: 脚手架创建 `rasen/` 工作区；检测到旧 `openspec/` 时进入迁移流程；输出文案引用 `/rasen:*`。
- `cli-update`: 刷新 rasen 命名空间下的命令/技能；对旧 `opsx`/`openspec-*` 遗留文件按归属安全处理。
- `store-registration`: store 元数据目录改名并向后兼容；默认 store 根路径更换。
- `project-readme`: 共存说明取代卸载要求；上游对齐表述更新。

## Impact

- **代码**：`src/core/config.ts`、`src/core/openspec-root.ts`、`src/core/command-generation/`（28 个 adapter + `command-file-id.ts`）、`src/utils/command-references.ts`、`src/core/templates/workflows/*`（~24 文件）与 `templates/experts/*`、`src/core/init.ts`、`src/core/update.ts`、`src/core/migration.ts`、`src/core/profile-sync-drift.ts`、`src/core/store/foundation.ts`、`src/commands/store.ts`，以及 ~40 处散落的 `'openspec'` 路径字面量。
- **数据文件**：`pipelines/*/pipeline.yaml`（技能 ID）、`schemas/spec-driven/`（生成指引中的 `openspec/specs/` 路径）、`hooks/compact-recovery.sh`。
- **测试**：~96 个测试文件中约 1300 处 `openspec`/`opsx` 引用需按新命名更新（多数为机械替换，`test/helpers/openspec-fixtures.ts` 为集中点）。
- **用户**：已按旧命名安装过本 fork 的用户，命令与工作区目录名变化（有迁移路径）；上游 OpenSpec 用户不受影响，且可与 rasen 并存。
- **上游对齐**：`openspec/` 布局不再与上游一致，后续 cherry-pick 涉及路径/前缀的补丁需要多一步映射；对齐声明相应更新。
- **本仓库**：自身工作区目录迁移，历史 archive 路径保留在 `rasen/changes/archive/`。
