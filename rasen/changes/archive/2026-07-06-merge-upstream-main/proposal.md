## Why

dev-harness 分叉于上游 `afdca0d`（v1.2.x 时代），上游 `origin/main` 已推进 72 个提交到 v1.5.0，带来 Stores 体系（breaking）、根解析收敛、a325305 解析对等修复、十余个 bug 修复和 6 个新工具适配。偏离越久合并成本越高；现在合并可以让 dev-harness 的 opsx/pipeline 功能建立在上游新的 canonical resolution 架构上，并直接获得上游修复（其中 #1202 是影响 archive 数据安全的真实 bug）。

## What Changes

- 本地 `main` 快进到 `origin/main`（65a7233, v1.5.0）。
- `main` 合并进 `dev-harness`：预演（git merge-tree）显示 27 个文件双方修改、16 个内容冲突、无删除/重命名冲突。
- **BREAKING**（来自上游）：workspace/initiative/collection/context-store 概念被 Stores 体系替换 —— dev-harness 从未使用这些概念，无实际迁移负担；新增 `store`/`context`/`workset`/`doctor` CLI 命令。
- 冲突解决要点：
  - `src/core/profiles.ts` 的 `CORE_WORKFLOWS`：两边都保留（我方 `auto-command` + 上游 `sync`）。
  - `src/commands/validate.ts` / `src/core/archive.ts`：我方 opsx 逻辑迁移到上游新扩展点（`getAvailableChanges`、三参 `getTaskProgressForChange`、`Validator.applySpecRules`），并删除 `base.schema.ts` 遗留的 SHALL/MUST refine。
  - `package.json` 版本取 1.5.0 基础上保留我方字段；lockfile 冲突不手解，合并后重新生成。
- 合并后运行 build + 全量测试（含上游新增的 parity 测试与 stores 测试套件）。

## Capabilities

### New Capabilities

（无 —— 本变更不引入我方新能力；上游新能力随合并整体进入，其规格由上游 spec 文件自带。）

### Modified Capabilities

- `cli-init`: 采纳上游对 "Slash Command Generation" 需求的修订（无命令适配器的工具跳过命令生成但保留 skill 生成，含 Kimi CLI 场景），与 dev-harness 新增的 smart-defaults 系列需求共存于同一规格文件。

（`cli-update` 的合并冲突是位置性的 —— 上游删除尾部 Edge Cases/Success Criteria 章节、我方在上方新增需求，无语义交叉，直接在合并中双取，不需要 delta spec。）

## Impact

- 受影响代码：16 个冲突文件（核心为 `src/cli/index.ts`、`src/commands/validate.ts`、`src/core/archive.ts`、`src/core/init.ts`、`src/core/profiles.ts`、`src/core/project-config.ts`、`src/core/artifact-graph/instruction-loader.ts`、`src/core/global-config.ts`）+ 上游净增的约 380 个文件（stores、completions、新适配器、docs、website）。
- 依赖：lockfile 重建（pnpm）；上游 CI 配置更新（merge_group、权限硬化）。
- 风险面：我方 opsx/pipeline 功能依赖的 `global-config.ts` 路径语义必须与上游保持一致，否则 store registry 路径漂移；`docs/zh/` 中文文档在上游 docs 大改版后过时（本变更不处理翻译跟进，单独立项）。
- 协作约束：其他 session 在 dev-harness 上开发 —— 合并提交时工作区必须只含本次合并内容。
