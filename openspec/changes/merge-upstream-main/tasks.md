## 1. 准备

- [x] 1.1 校验前置状态：工作区除本变更目录与 docs 分析文档外无未提交内容；`git fetch origin` 确认 origin/main 仍为 65a7233（若已前进，重新跑一次 merge-tree 预演确认冲突面未变化）
- [x] 1.2 本地 `main` 快进到 `origin/main`（`git fetch origin main:main` 或 checkout 后 ff-only pull）

## 2. 合并与冲突解决

- [x] 2.1 在 dev-harness 上执行 `git merge main --no-commit`，确认冲突文件清单与预演一致（16 个）
- [x] 2.2 解决琐碎冲突：`.gitignore`、`CHANGELOG.md`（双取）、`package.json`（版本 1.5.0，依赖以上游为基叠加我方新增）、`test/core/profiles.test.ts`、`src/core/global-config.ts`（getGlobalDataDir/getGlobalConfigDir 语义严格随上游）
- [x] 2.3 解决 `src/core/profiles.ts`：CORE_WORKFLOWS 合并为含 `sync` 与 `auto-command` 的并集，同步核对 ALL_WORKFLOWS
- [x] 2.4 解决 `src/cli/index.ts`：保留上游 store/context/workset/doctor 注册与 root-selection 接线，叠加我方 pipeline 等命令注册
- [x] 2.5 解决 `src/core/init.ts`：同时满足我方 delivery 语义与上游 adapter 跳过语义（对照 delta spec specs/cli-init/spec.md）
- [x] 2.6 解决 `src/core/archive.ts`：以上游为骨架（root-selection + 三参 getTaskProgressForChange），迁移我方 opsx 逻辑到新结构
- [x] 2.7 解决 `src/commands/validate.ts`：change 发现迁移到 getAvailableChanges（上游 listChangeIds 包装），保留我方 validate UX 扩展；核对 base.schema.ts 的 SHALL/MUST refine 已按上游删除、规则统一在 Validator.applySpecRules
- [x] 2.8 解决 `src/core/project-config.ts` 与 `src/core/artifact-graph/instruction-loader.ts`：上游新增能力（references/store 指针、指令装配）为基，叠加我方扩展
- [x] 2.9 解决 `openspec/specs/cli-init/spec.md`（按 delta spec 融合版本）与 `openspec/specs/cli-update/spec.md`（位置性双取）
- [x] 2.10 lockfile：取上游版本后用 pnpm 重新安装生成，确认无幽灵 diff

## 3. 验证与提交

- [x] 3.1 `pnpm build` 通过；tsc 无类型错误
- [x] 3.2 全量测试通过：上游 parity 测试（task-progress/validation/validate/archive/view）+ stores 套件 + 我方 pipeline-registry/profiles/skill-generation 测试
- [x] 3.3 重新生成 skills 并抽查 opsx 系列未被上游 workflow 模板改动破坏
- [x] 3.4 冒烟：`openspec status`、`openspec pipeline list`、`openspec store list` 各跑一次确认共存
- [x] 3.5 检查上游 CI/deploy-docs workflow 是否会在 fork 上误触发，需要禁用则记录为后续小变更（design 中的 Open Question）
- [x] 3.6 `git status` 复核后创建 merge commit（只含合并产物），不推送 —— 推送在 ship 阶段
