# Planning Context — fix-pipeline-root-selection

> LEAD 种子文档。planner 先读本文档，再只研究缺失的部分——不要从零研究。
> 权威来源：`docs/handoff-2026-07-06-upstream-merge-session.md`（上一个 session 的交接，含两路审计结论）。

## 用户意图（原话）

> 阅读 docs/handoff-2026-07-06-upstream-merge-session.md，然后修复所有问题

即：修复交接文档"遗留工作"节的第 1 项（主要）+ 第 2 项（次要），并入本 change。第 3 项（docs/zh 过时）明确单独立项，不在本 change 范围。

## 问题陈述（已由上一 session 两路审计确认，勿重新论证是否存在）

上游 v1.5.0 合并后，`openspec pipeline list/show/classify/resume/agents` 五个子命令仍是 **cwd 语义**（`src/commands/pipeline.ts:126-128` 的 `resolveProjectRoot()` 直接 `return process.cwd()`；`src/cli/index.ts` 的 pipeline 命令组未注册 `--store`），而 `validate --pipelines` 已迁移到 **root-selection 语义**（`src/commands/validate.ts:86` + `listPipelines(root.path)`，经 `src/core/root-selection.ts` 的 `resolveRootForCommand()`）。

已实测的后果：
- 子目录里 `pipeline list` 看不到项目 pipeline，`validate --pipelines` 能看到；
- store-pointer 仓库里两者解析到不同根；
- `pipeline resume` 在 store-root change 上找不到 change / `hasRunState:false` → opsx 断点续跑和 portfolio 编排在 store 场景断链（auto-run.json / portfolio-run.json 的唯一 CLI 读取方就是 resume，`pipeline.ts:269-275,334`）；
- `pipeline agents` 的 `writeProjectPipelineOverride`（`pipeline.ts:503`）在 cwd 写幽灵 override，root-aware 的 validate 看不到；
- `/opsx:auto` skill 模板同时教 root-aware 命令与 cwd-based pipeline 命令（`src/core/templates/workflows/auto.ts:33/36/38/48/85/89`、`_orchestration.ts:104` 教 LEAD 按 cwd 相对路径写 blackboard），store 场景自相矛盾。

## 修复方案（两路审计一致确认，修复面很小——按此展开 tasks，不要扩大范围）

1. `src/cli/index.ts`：pipeline 命令组五个子命令注册 `--store <id>`（用文件内现成的 `STORE_OPTION_DESCRIPTION` 与 `hiddenStorePathOption()`）。
2. `src/commands/pipeline.ts`：`resolveProjectRoot()` 改为经 `resolveRootForCommand(selector, {json})` 解析（方法需异步化，五个入口传入 selector）；`resume` 的 changeDir 从 `root.changesDir` 推导。
3. registry 层（`src/core/pipeline-registry/` 的 resolver/run-state/portfolio-state）**不用动**——审计已确认它们全部透传入参路径、无内部 cwd。
4. `src/core/templates/workflows/_orchestration.ts:104`：blackboard 路径教学从"cwd 相对 `openspec/changes/<name>/`"改为"从 `openspec status --change <n> --json` 的 `changeDir` 字段取绝对路径"。
5. 测试：给 `test/commands/` 补 pipeline 命令的 store/子目录场景用例。可参考 `test/commands/validate.test.ts` pipelines describe 块里补 planning-shape fixture 的做法——注意：裸 `openspec/pipelines/` 目录在新判定下不构成合格 root。

## 附带小修（第 2 项，并入本 change）

`src/core/templates/workflows/store-selection.ts` 的 `STORE_SELECTION_GUIDANCE` 把 `context` 列为支持 `--store` 的命令——指的是顶层 `openspec context`；我方模板另教 `openspec agent context`（不支持 `--store`）。加半句区分，防 agent 误套旗标。

## 验证标准（来自交接文档）

- 子目录与 store-pointer 仓库里 `pipeline list` 与 `validate --pipelines` 看到同一 pipeline 集合；
- store-root change 上 `pipeline resume` 能读到 run-state；
- `pnpm build && pnpm test` 全绿（基线：114 文件 / 2070 用例）。
- 跑完全量测试后顺手 `openspec config list` 核对真实全局配置未被污染（见交接文档"事故记录"节——曾发生测试污染真实 `%APPDATA%\openspec\config.json` 的事故，根因未定）。

## 已定决策（勿重新讨论）

- 方向是 pipeline 命令组向 root-selection 靠拢，**不是**把 `validate --pipelines` 改回 cwd 语义。
- quality-rules 写 store config.yaml 是正确设计，勿"修"。
- 写新文档进 `docs/` 时注意 `test/vocabulary-sweep.test.ts` 的禁词模式（fork 级豁免仅限历史分析文档）。

## 死胡同（别再走）

- 别给 `skills/gstack/**/SKILL.md` 或 `.tmpl` 逐个加 store 指引——它们是生成物，正确做法是 TS getter 层追加（已做过）。

## Planner 追加发现（2026-07-07，写 artifacts 时核对代码）

- **字段名纠正（重要）**：`openspec status --change <n> --json` 输出的绝对变更目录字段是 **`changeRoot`**，不是种子文档 point 4 说的 `changeDir`。已在 `src/core/artifact-graph/instruction-loader.ts:492` 核实（`formatChangeStatus` 里 `changeRoot: context.changeDir`）。`_orchestration.ts` 教学必须写 `changeRoot`。tasks 3.1 已按此校正。
- `resolveProjectRoot(): string` 当前返回 `process.cwd()`（`pipeline.ts:126-128`）。迁移方案：改为返回 `ResolvedOpenSpecRoot | null` 的 async helper（`resume` 需要 `root.changesDir`，不止 `root.path`），五个入口 `await` 后对 `null` 早退——照抄 `validate.ts:86-89` 的 `const root = ...; if (!root) return;` 契约。
- `validateChangeExists(change, projectRoot, changesDir?, hints?)` 已支持第三个 `changesDir` 覆盖参（`workflow/shared.ts:141-146`），resume 直接传 `root.changesDir` 即可，无需改该 helper。
- CLI 侧 `STORE_OPTION_DESCRIPTION`（index.ts:45）与 `hiddenStorePathOption()`（index.ts:51）现成可用；pipeline 组在 588-682，五个子命令目前只有 `--json`。
- `pipeline agents` 的 `writeProjectPipelineOverride` 用 `getProjectPipelinesDir(projectRoot)`——迁移后传 `root.path`，override 才落在选中根（tasks 2.5 / 5.4）。
- 现成测试基建：`test/commands/pipeline.test.ts` 已存在（cwd-fixture 风格）；store fixture 照 `test/commands/store-root-selection.test.ts`（`registerStore` + `getGlobalDataDir({ env })` + XDG_* 隔离，绝不碰真实全局 config）。
- 改的两个主 spec 能力：`opsx-pipeline-registry`（Pipeline CLI Surface）+ `opsx-orchestration`（Change Directory Blackboard and Run-State）。均用 MODIFIED delta。
