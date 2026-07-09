## Context

dev-harness 与 origin/main 分叉于 `afdca0d`。上游 72 个提交（v1.2.x → v1.5.0）带来三层结构性变化：Stores 体系（新模块 `src/core/store/`、四个新 CLI 命令）、根解析收敛（`src/core/root-selection.ts` 成为所有常规命令的 root 决策单点 + agent-contract 统一 JSON 信封）、a325305 解析对等修复（change 发现 / 任务计数 / SHALL-MUST 校验三条路径收敛回 canonical 实现）。dev-harness 的 22 个提交集中在 opsx 编排（pipeline registry、run-state、decompose）、browse 子项目和中文文档，均不触碰上游被替换的 workspace/initiative 概念。

`git merge-tree` 预演：27 个文件双方修改，16 个内容冲突，无删除/重命名冲突。完整分析见 `docs/upstream-v1.5-stores-and-resolution.md`。

约束：其他 session 在 dev-harness 上并行开发；合并期间工作区必须只含合并内容，提交需一次成型。

## Goals / Non-Goals

**Goals:**
- 本地 `main` 快进至 `origin/main`（65a7233），随后 `main` 合并进 `dev-harness`，一个 merge commit 完成。
- 16 个冲突文件全部正确解决；我方 opsx 逻辑迁移到上游新扩展点而非保留旧路径副本。
- build + 全量测试通过（含上游 parity 测试与 stores 套件）。

**Non-Goals:**
- 不做 `docs/zh/` 中文文档的翻译跟进（上游 docs 大改版后另立变更处理）。
- 不重构我方 opsx 输出以对齐 agent-contract JSON 信封（记为后续工作）。
- 不在本变更中新增任何功能。

## Decisions

1. **整体 merge 而非 cherry-pick**。上游 changesets/版本发布/stores 演进环环相扣，挑拣会造成版本与规格不一致；真正需要手工判断的只有 16 个文件。
2. **直接在 dev-harness 上合并，不走集成分支**。用户明确指示合并到当前分支；工作区当前干净（仅一个未跟踪的分析文档），一次 merge commit 落地，期间不穿插其他提交。备选（集成分支后再合回）被用户决定否决。
3. **冲突解决策略按文件分类**：
   - lockfile（package-lock.json、pnpm-lock.yaml）：不手解冲突，`git checkout --theirs` 取上游后用 pnpm 重新生成；仓库同时存在两个 lockfile，跟随上游现状保留。
   - `package.json`：版本取 `1.5.0`，依赖以上游为基，叠加我方新增的 scripts/依赖。
   - `src/core/profiles.ts` CORE_WORKFLOWS：合并为 `['propose','explore','apply','sync','archive','auto-command']`（双方新增都保留）。
   - `src/commands/validate.ts` / `src/core/archive.ts` / `src/utils/task-progress.ts` 相关：以上游新结构为骨架，我方逻辑迁移到新挂载点 —— change 发现用 `getAvailableChanges`、任务计数用三参 `getTaskProgressForChange`、自定义 spec 规则进 `Validator.applySpecRules`、删除 `base.schema.ts` 的 SHALL/MUST refine（若冲突涉及）。
   - `src/cli/index.ts`：双方注册的命令全部保留（上游 store/context/workset/doctor + 我方 pipeline 等）。
   - `src/core/global-config.ts`：保证 `getGlobalDataDir()` / `getGlobalConfigDir()` 语义与上游完全一致（store registry 路径依赖它），我方新增字段叠加其上。
   - `openspec/specs/cli-init/spec.md`：双方重写了同一个 "Slash Command Generation" 需求（我方 delivery 语义 vs 上游 adapter 语义），按本变更 delta spec 的融合版本解决（delivery 决定是否生成、adapter 决定哪些工具生成）；对应实现侧（`src/core/init.ts` 等）也要同时满足两种语义。
   - `openspec/specs/cli-update/spec.md`：位置性冲突，双取（我方新增需求 + 上游删除尾部章节）。
   - `.gitignore` / `CHANGELOG.md` / 测试文件：双取合并。
4. **合并后验证以上游测试为准绳**：上游 parity 测试（task-progress/validation/validate/archive/view）验证迁移正确性；我方 pipeline-registry、profiles、skill-generation 测试验证 opsx 不回归。

## Risks / Trade-offs

- [archive/validate 迁移错位 → opsx 闸门失效或双重报错] → 逐文件迁移后立即跑对应 parity 测试，不积攒到最后。
- [global-config 路径语义漂移 → store registry 全部"未注册"] → 解冲突时 diff 双方 `getGlobalDataDir`，以上游为准；跑上游 stores 测试确认。
- [其他 session 并行提交插入合并过程 → 合并提交混入无关内容] → 合并开始前后各做一次 `git status` 校验；merge commit 只 stage 冲突解决产物。
- [上游 workflow 模板改动影响我方生成的 opsx skills] → 合并后重跑 skill 生成并抽查 opsx 系列（记入 tasks）。
- [两个 lockfile 并存导致安装口径不一致] → 跟随上游现状，以 pnpm 为准（项目声明 packageManager: pnpm）。

## Migration Plan

单 merge commit，可用 `git merge --abort`（解决期间）或 `git revert -m 1`（提交后）回退。本地 main 快进无风险。

## Open Questions

- 上游 `website/` 与 CI 的 deploy-docs workflow 是否需要在 fork 上禁用（避免误部署）—— 在 verify 阶段确认，若需要则单独小变更处理。
