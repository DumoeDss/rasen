# Session Handoff — 2026-07-06 上游 v1.5.0 合并 + 功能融合审计

> 写给零共享上下文的下一个 session。读完本文档即可继续，无需翻旧会话。
> 工作分支：`dev-harness`（已推送到 origin，HEAD = `5469b3e`）。

## 快照：当前状态

- **上游合并已完成并推送**。`origin/main`（Fission-AI 上游同步版, v1.5.0, `65a7233`）已合并进 `dev-harness`：
  - `0e41522` — merge commit（16 个冲突全部解决，冲突解决要点见该 commit message）
  - `0c8285e` — OPSX change artifacts + 上游分析文档
  - `5469b3e` — change 归档（`openspec/changes/archive/2026-07-06-merge-upstream-main/`）
- 本地与远端 `main` 均已同步到 v1.5.0。
- **构建通过，全量测试 114 文件 / 2070 用例全绿**（`pnpm build && pnpm test`）。
- 工作区干净（除本 handoff 文档提交前的瞬时状态）。
- 其他并行 session 注意：基线已大变（版本 1.2.3 → 1.5.0），继续开发前先 `git pull` + `pnpm install`。

## 关键背景文档（按优先级）

1. `docs/upstream-v1.5-stores-and-resolution.md` — 上游 Stores 体系与架构收敛的完整中文详解，含对 dev-harness 的迁移指引（第三部分）。**先读这个。**
2. `openspec/changes/archive/2026-07-06-merge-upstream-main/` — 本次合并的 proposal/design/tasks（design 的 Decisions 节记录了每类冲突的解决策略）。

## 上游 v1.5 带来的关键概念（30 秒版）

- **store** = 独立 git 仓库装标准 `openspec/`，本机按 id 注册（registry 在 `%LOCALAPPDATA%\openspec\stores\registry.yaml`），常规命令用 `--store <id>` 指向它。
- **root-selection** = 所有常规命令（list/show/status/instructions/validate/archive/new change 等）经 `src/core/root-selection.ts` 的 `resolveRootForCommand()` 统一解析动作根：`--store` 显式 > 最近合格 `openspec/` > config.yaml 的 `store:` 指针 > 隐式 cwd。
- JSON 输出统一信封：单文档 + `root` 块 + `status` 诊断数组（`docs/agent-contract.md`）。
- `CORE_WORKFLOWS` 现为 6 项：`propose, explore, apply, sync, archive, auto-command`（上游 `sync` + 我方 `auto-command` 并集）。

## 已完成：功能融合审计（三路验证，结论一致）

用户要求确认"我方功能（opsx workflow、gstack、browse 等）与上游新功能是功能级融合而非仅消除冲突"。已通过 (a) 真实 E2E 运行、(b) root 语义静态审计、(c) skill→CLI 契约审计（16 条调用逐条核对）三路验证：

**融合正确（已验证，无需再查）：**
- init 的 delivery（我方）× adapter-skip（上游）双语义、agent-teams 自动启用
- 指令层 JSON：我方 `enhance/provider/qualityRules` 与上游 `root` 信封共存，store 场景正常
- archive：任务闸门在 store change 上生效；我方 captureQuality 写 store 的 config.yaml（审计确认为正确设计）；JSON 单文档契约保持
- update/config profile 与 store 概念正交，无碰撞；init 对"规划外置"指针仓库有护栏
- 上游信封改造为纯追加式，模板读取的 JSON 字段无一被删改
- gstack expert skills 不触碰 spec CLI，零影响；`hooks/safety-check.sh`、browse 子项目不受影响

## 遗留工作（下一个 session 的任务）

### 1.（主要）修复 pipeline 命令组的 root 语义缝隙 — 用户已知悉，等待确认后动手

**问题**：`openspec pipeline list/show/classify/resume/agents` 仍是 cwd 语义（`src/commands/pipeline.ts:126-128` 的 `resolveProjectRoot()` 直接 `return process.cwd()`，CLI 注册处 `src/cli/index.ts` pipeline 命令组无 `--store`），而合并后 `validate --pipelines` 已是 root-selection 语义（`src/commands/validate.ts:86` + `listPipelines(root.path)`）。合并前全 CLI 都是 cwd 语义所以一致；合并的部分迁移引入了不一致。

**已实测的后果**：
- 子目录里 `pipeline list` 看不到项目 pipeline，`validate --pipelines` 能看到；
- store-pointer 仓库里两者解析到不同根；
- `pipeline resume` 在 store-root change 上找不到 change / `hasRunState:false` → **opsx 断点续跑和 portfolio 编排在 store 场景断链**（blackboard auto-run.json / portfolio-run.json 的唯一 CLI 读取方就是 resume，`pipeline.ts:269-275,334`）；
- `pipeline agents` 的 `writeProjectPipelineOverride`（`pipeline.ts:503`）会在 cwd 写幽灵 override，root-aware 的 validate 看不到；
- `/opsx:auto` skill 同时教 root-aware 命令与 cwd-based pipeline 命令（`src/core/templates/workflows/auto.ts:33/36/38/48/85/89`、`_orchestration.ts:104` 教 LEAD 按 cwd 相对路径写 blackboard），store 场景自相矛盾。

**修复方案（两路审计一致确认，修复面很小）**：
1. `src/cli/index.ts` pipeline 命令组五个子命令注册 `--store <id>`（用文件内现成的 `STORE_OPTION_DESCRIPTION` 与 `hiddenStorePathOption()`）。
2. `src/commands/pipeline.ts`：`resolveProjectRoot()` 改为经 `resolveRootForCommand(selector, {json})` 解析（方法需异步化，五个入口传入 selector）；`resume` 的 changeDir 从 `root.changesDir` 推导。
3. registry 层（`src/core/pipeline-registry/` 的 resolver/run-state/portfolio-state）**不用动**——审计确认它们全部透传入参路径、无内部 cwd。
4. `src/core/templates/workflows/_orchestration.ts:104`：blackboard 路径教学从"cwd 相对 `openspec/changes/<name>/`"改为"从 `openspec status --change <n> --json` 的 `changeDir` 字段取绝对路径"。
5. 测试：给 `test/commands/` 补 pipeline 命令的 store/子目录场景用例（可参考我在 `test/commands/validate.test.ts` pipelines describe 块里补 planning-shape fixture 的做法——裸 `openspec/pipelines/` 目录在新判定下不构成合格 root）。

**建议走一个小 OPSX change**（如 `fix-pipeline-root-selection`），流程照常 propose → apply → verify → archive。

### 2.（次要，一句话改动）STORE_SELECTION_GUIDANCE 措辞

`src/core/templates/workflows/store-selection.ts` 里把 `context` 列为支持 `--store` 的命令——指顶层 `openspec context`。我方模板另教 `openspec agent context`（不支持 `--store`）。加半句区分，防 agent 误套旗标。可并入上面的 change。

### 3.（独立跟进，未开始）`docs/zh/` 中文文档过时

上游 docs 大改版（新增 stores-beta 指南、agent-contract 等），`docs/zh/` 是我方翻译，已整体落后。单独立项处理，不阻塞。

## 决策记录（本 session 内已定，勿重新讨论）

- 整体 merge 而非 cherry-pick；直接合到 dev-harness（用户指示），单 merge commit。
- lockfile 不手解，取上游后重新生成（pnpm + `npm install --package-lock-only`）。
- captureQuality 在 `--json` 时静默（`quiet` 参数）以守单文档契约。
- 上游 parity 测试要求所有注册模板含 store 指引 → 已给我方 7 个 opsx workflow 模板 + 31 个 gstack expert 模板注入 `STORE_SELECTION_GUIDANCE`（expert 是在 TS getter 里追加，不动生成的 SKILL.md 源）。
- `test/vocabulary-sweep.test.ts` 加了 fork 级豁免（历史分析文档可引用 retired 词汇）——写新文档进 `docs/` 时注意别踩该 sweep 的禁词模式。
- quality-rules 写 store config.yaml 是正确设计，勿"修"。

## 死胡同（别再走）

- 别试图给 gstack expert 的 `skills/gstack/**/SKILL.md` 或 `.tmpl` 逐个加 store 指引——它们是生成物/会被 gen-skill-docs 重生成，正确做法是 TS getter 层追加（已做）。
- 别把 `validate --pipelines` 改回 cwd 语义来"消除不一致"——方向应是 pipeline 命令组向 root-selection 靠拢。
- a325305 不是大重构（archive.ts 仅 +4/−4），别按"大架构收敛提交"去理解它；archive/validate 的大变化来自 stores beta 的根解析改造。

## 事故记录（2026-07-06 晚，已恢复，根因待查）

用户的真实全局配置 `%APPDATA%\openspec\config.json` 在 22:29:20 被改写为 `profile: custom` + 仅 4 个 workflows（`new,ff,apply,archive`），导致之后 `openspec init` 只装 4 个 workflow skill/command。**已恢复**：profile custom + 全部 18 个 ALL_WORKFLOWS，并重跑 `openspec update`（48 skills + 18 commands 齐全）。

**根因未定**，线索：
- 写入内容与 `test/commands/config.test.ts:108` 的 "set workflows from JSON array syntax" 测试完全一致（`["new","ff","apply","archive"]`）；
- 但该文件的隔离看起来是完好的（beforeEach 设 `XDG_CONFIG_HOME` 临时目录，`getGlobalConfigDir` 在所有平台都优先 XDG）；
- 22:29:20 不在本 session 任何一次测试运行的时间窗内；当天有其他并行 session 在此仓库工作（archived add-context-handoff）。
- 已排查：`test/core/update.test.ts` mock 了 global-config（安全）；其余写 global config 的测试文件都引用了 XDG 隔离。

**待查**：在 Windows 上复核每个写 global config 的测试的隔离是否真正生效（尤其 vitest worker 复用/模块缓存时序），或确认是并行 session 所为。在查清前，**跑全量测试后建议顺手 `openspec config list` 核对真实配置未被污染**。

## 下一步（第一个具体动作）

向用户确认后，创建 OPSX change `fix-pipeline-root-selection`，按上面"修复方案"五点实施。验证标准：子目录与 store-pointer 仓库里 `pipeline list` 与 `validate --pipelines` 看到同一 pipeline 集合；store-root change 上 `pipeline resume` 能读到 run-state。
