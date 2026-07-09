# Planning context: worker-reuse-policy（portfolio 父容器）

## 用户意图（原话要点）

- "让 lead 来决定是启动新的 subagent，还是复用老的 subagent（包括 handoff）"——apply 的 implementer 目前每 stage 新开；handoff 机制落地后（archive/2026-07-07-automate-session-relay），复用变得可行。
- 复用决策：关联 + 上下文少 → warm 复用；关联 + 上下文多 → 先 handoff 再新开（继任者拿 LEAD 信息 + handoff 文档双源播种）；关联弱 → 直接新开。
- "reuse 单开一个设置，包含 planner 和 implementer，让 planner 也可以配置开启"；`reuse.threshold` 取 **0.25**；用户开关 `never` 恢复现状。
- 探索会话中 LEAD 自审补的五条也要实现（见下）。
- 「不用停下，直到所有任务完成」——gate 预授权 Continue。

## 已定稿的设计决策（探索会话收敛，不要重新推导）

1. **配置形状**（pipeline.yaml 顶层，与 `handoff` 平级；仅 pipeline 级，无 stage 级覆盖——复用是跨 stage/跨 child 关注点）：
   ```yaml
   reuse:
     planner: auto          # auto | never；never = 每次 propose 新开 planner，从 planning-context.md 播种（B.1 的 Tier B 路径升为通用路径）
     implementer: auto      # auto | never；never = apply 永远新开（现状）
     threshold: 0.25        # 接新活的余量门槛（严于 handoff.threshold——回答"该不该接一整个新 change"，不是"该不该继续手头的活"）
     roles: {}              # 可选按角色阈值覆盖，如 { planner: 0.4 }（propose 比 apply 便宜，planner 可放宽）
   ```
   解析：内置默认 `{ planner: auto, implementer: auto, threshold: 0.25 }`；roles 仅覆盖 threshold（与 handoff.roles 同惯例）。校验：enum auto|never；threshold ∈ (0,1]；对齐 pipeline-handoff-config 的校验与 `pipeline show --json` resolved 输出惯例。
2. **关联度判据 = DAG 邻接**：依赖边相连的串行子 change = 强关联（child-2 消费 child-1 的代码，warm implementer 价值最高）；并行 cohort = 可证明独立，各 team 各跑，复用无从谈起。
3. **复用规则**：child-1 review-clean 后（探针时点，见 5.3）、child-2 启动前，probe implementer transcript：`pct ≤ resolved reuse threshold` → SendMessage warm 复用；`>` → 退役换血——implementer 写 handoff 文档（reason: `retired-between-children`，内容重心是跨 change 可迁移知识：conventions / gotchas / dead ends / working set，`remaining` 为空），新 implementer 从"文档 + LEAD 的 child-2 派工信息"双源播种。
4. **复用派工污染防护条款**：child-1 的约定仅在 child-2 artifacts 沉默处成立；先读 child-2 的 proposal/design。
5. **五条自审补丁**（全部在范围内）：
   - 5.1 **H.7 quiesce 扩展**：session relay 前，任何持有中的 warm 复用候选（返回过 DONE 但被留作复用的 worker）必须先写知识摘要文档再退场——否则其跨 child 知识随 agentId 死句柄蒸发，F.1 的文档优先通道对它不成立。
   - 5.2 **DAG 汇合点规则**：仅当 warm 前驱唯一时才复用；child 依赖多个前驱（汇合点）一律新开，从各前驱的 durable findings 多源播种。
   - 5.3 **探针时点 = 前驱 review-clean 之后**：非平凡修复会路由回 implementer，review-loop 期间 pct 还会涨；依赖子 change 的启动门槛本来就是前驱 review-clean，两个时点重合。
   - 5.4 **run-state 血统**：worker 记录新增可选 `reusedFrom: <child-id>`（该 worker 的 transcript 含前一 child 的上下文）；portfolio/child run-state 均可出现；`pipeline resume` 原样透传（passthrough 已天然支持，需要 spec + 测试固化 + resume 输出确认）。
   - 5.5 **工程完整性**：reuse 块进 pipeline 校验与 `pipeline show --json` resolved 输出；显式 non-goal——用户手动连续跑多个 small-feature 的复用判断不在范围（无可靠关联度判据，留给用户）。
6. **信息回流三通道**（child-N 实现发现 → child-N+1 的 propose）：
   - DONE 返回契约增加 durable findings 小节（1-3 行"对后续规划仍成立的发现"）——永远存在，LEAD 原文转贴进 planner 复用派工 prompt；
   - handoff 文档路径（仅退役路径存在）——LEAD 只传指针，planner 选读；
   - child 最终 artifacts 路径——planner 选读。蒸馏永远发生在读端，LEAD 保持薄。planner 读后折叠进 planning-context.md（B.1 第 3 步既有义务）。
7. **范围排除**：设计级 fixer 不进 reuse 块（新鲜眼睛是其价值）；Tier B 降级 = transcript 暖种子 / 文档播种（F.1 既有梯度）；Codex worker 的 threadId resume 即其 warm 复用，政策跨 runtime 成立。

## 拆分方案与依赖

- **worker-reuse-config**（child-1，small-feature）：CLI 管道——`reuse` 块类型/解析/校验/解析顺序、`pipeline show --json` resolved 输出、run-state `reusedFrom` 字段、`pipeline resume` 透传；测试对齐 pipeline-handoff-config 的既有测试形态。触碰面：src/core/pipeline-registry/*、src/commands/pipeline.ts（如需）、test/*。
- **worker-reuse-playbook**（child-2，small-feature，依赖 child-1）：政策层——_orchestration.ts（B.1 改造为 reuse.planner 可配置、新增 implementer 跨 child 复用小节、H.3 DONE 契约加 durable findings、H.7 quiesce 扩展）、handoff.ts（retired-between-children 文档重心说明）、auto.ts（如需）、模板测试、docs/opsx-workflow-guide.md + docs/zh 镜像、changeset。触碰面：src/core/templates/workflows/*、test/commands/*、docs/*、.changeset/*。
- 依赖理由：playbook 文本必须引用 config 的最终形状与校验语义；串行，无并行 cohort。

## 代码库既有事实（省研究）

- `handoff` 配置块的解析/校验/resolved 输出在 src/core/pipeline-registry/（types、loader）与 `openspec pipeline show`；spec 是 openspec/specs/pipeline-handoff-config/spec.md——reuse 块照此惯例即可。
- run-state schema：src/core/pipeline-registry/run-state.ts（zod，passthrough；RunStateWorkerSchema 已有 role/agentId/transcript/threadId 等可选字段——reusedFrom 加在这里）；barrel 导出记得同步 index.ts。
- runCLI e2e 测试跑 dist：改 src 后必须 `pnpm run build` 再跑 test/commands/*。
- 相关主 specs：pipeline-handoff-config、orchestration-handoff、opsx-orchestration、session-relay（H.7 quiesce 在此）、workflow-handoff-command。
- Windows 测试 flake 前科：EBUSY rmdir / 10s 超时，隔离重跑确认即可。
- 提交规范：结尾 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>；PowerShell 下多行/含引号 commit message 用 `git commit -F <file>`。

## child-1 propose findings（durable，供 implementer）

- **能力划分**：单一 NEW 能力 `worker-reuse-config`（3 个 requirement：reuse 配置块、解析顺序、worker-record `reusedFrom` 血统 + resume 透传）。**无 MODIFIED delta**——`reuse` 块是 `handoff` 的平级新兄弟，`reusedFrom` 是 worker-record 新字段，都不改 pipeline-handoff-config 既有 requirement（handoff threshold/relays、session/stage handoff 记录）。artifacts 在 openspec/changes/worker-reuse-config/{proposal,design,specs/worker-reuse-config/spec,tasks}.md，`openspec validate worker-reuse-config` 通过。
- **reuse 仅 pipeline 级**：无 stage 覆盖层（与 handoff 的关键差异）。因此 **不建 `StageReuseConfigSchema`**，resolver 是 pipeline-scoped 的 `resolvePipelineReuseConfig(pipeline)`，不是 per-stage。
- **精确落点（读过源码确认）**：
  - `src/core/pipeline-registry/types.ts`：照抄 `HandoffConfigSchema`/`DEFAULT_HANDOFF_CONFIG`/`resolveStageHandoffConfig` 惯例。新增 `ReuseModeSchema`(auto|never)、reuse threshold schema((0,1]，消息措辞"reuse threshold")、`ReuseRolesSchema`(`.strict()`，**仅 planner/implementer** 两键 optional threshold——借此天然拒 `roles.reviewer`)、`ReuseConfigSchema`(`.strict()`，四字段全 optional)、`DEFAULT_REUSE_CONFIG={planner:'auto',implementer:'auto',threshold:0.25}`、`ResolvedReuseConfig{planner,implementer,threshold,roles:{planner,implementer}}`、`resolvePipelineReuseConfig`。挂载：`PipelineYamlSchema` 加 `reuse: ReuseConfigSchema.optional()`（`handoff` 那行旁边，约 types.ts:202）。`.strict()` 自带"未知键拒绝"校验，无需手写。
  - `src/core/pipeline-registry/run-state.ts`：`RunStateWorkerSchema` 加 `reusedFrom: z.string().optional()`（已是 `.passthrough()`，声明只为一等公民/契约固化）。**不动** `stageWorkers()` 的 `agentId||transcript||threadId` 过滤——reused worker 自带 transcript 已被纳入，`reusedFrom` 是描述性血统不是纳入键。
  - `src/core/pipeline-registry/index.ts`：barrel 同步导出新 types.ts 符号。
  - `src/commands/pipeline.ts`：`show()` 的顶层 `result` 对象（约 pipeline.ts:189）加 `reuse: resolvePipelineReuseConfig(pipeline)`（`agents` 平级，**不进 `toStageView`/`StageView`**——reuse 无 stage 维度）。`resume()`（约 pipeline.ts:419）的 `workersWithContext` 是逐 worker `...w` 展开，`reusedFrom` 天然透传，通常无需改代码，仅加测试确认。
- **测试形态对齐**：core 测试在 `test/core/pipeline-registry/{pipeline,run-state}.test.ts`（handoff 用例在 pipeline.test.ts:473+ `describe('handoff config')`，含 valid/invalid/strict-unknown-key/resolve 四类）；CLI e2e 在 `test/commands/pipeline.test.ts`（show 的 handoff 断言在 :159、resume 的 handoff 断言在 :447，用 `runCLI([...])` + `--json`）。**runCLI 跑 dist：group-4 CLI 测试前必须 `pnpm run build`**（已写进 tasks.md 5.1）。

## child-2 propose findings（durable，供 implementer）

- **能力划分**：1 NEW `worker-reuse-orchestration`（reuse 政策本体：可配置 planner reuse、跨 child implementer warm-vs-retire、unique-warm-predecessor/merge-node、reusedFrom 血统、design-fixer 排除、Tier B/Codex 降级、manual-sequence 非目标）+ 2 MODIFIED delta（`orchestration-handoff` 的 "Worker handoff contract" 加 durable-findings DONE 条款；`session-relay` 的 "Relay only at stage boundaries" 加 held-warm-candidate 先写 digest 条款）。**不动** worker-reuse-config（已冻结）、workflow-handoff-command（retired-between-children 复用同一份 handoff 文档模板，语义归 worker-reuse-orchestration，handoff.ts 只加内容侧重 prose）、opsx-orchestration、auto.ts。`openspec validate worker-reuse-playbook` 通过。
- **纯文本改动，无 schema/CLI/build 依赖**（与 child-1 不同）：政策活在单一共享字符串 `ORCHESTRATION_PLAYBOOK`（`src/core/templates/workflows/_orchestration.ts`），被 auto.ts 与 review-cycle.ts 逐字内嵌；其文本由 `test/commands/auto.test.ts` 经渲染 skillText 的 `toContain` 断言（现有风格见 auto.test.ts:39-54，如 `expect(skillText).toContain('Step H.7')`）。因此 reuse 政策测试写进 auto.test.ts，不是新建文件。
- **精确落点（读过源码确认）**：
  - _orchestration.ts **Step B.1**（:66-74）：前置 `reuse.planner` 门控——auto=现状，never=每次 propose 新开 planner 从 planning-context.md + 盘上 sibling proposals 播种（把 B.1 item-2 的 Tier-B 播种路径升为通用 never 路径）。item 5 的退役阈值澄清用 *reuse* 阈值非 handoff 阈值。resolved 值走 `resolvePipelineReuseConfig` via `openspec pipeline show <name> --json`。
  - _orchestration.ts **跨 child implementer reuse 新节**：锚在 **Step G**（:144-166）的 G.4 串行规则旁（:158 "前置 implemented 且 review-clean" 那句）——探针时点与该 gate 重合，无新同步点。probe 用 `openspec agent context --transcript <path>`（Step F worker 指针）。决策：`≤` warm reuse（Tier A SendMessage + 污染防护 clause）/`>` retire-between-children（handoff 文档 reason=retired-between-children、可迁移知识侧重、remaining 空）+ 双源播种。merge-node→新开多源播种。`reusedFrom` 记在 child-B implementer worker 记录（LEAD 单写）。scope：never→全新、design-fixer 排除、Tier B/Codex 走既有 ladder。
  - _orchestration.ts **H.3**（:178-181）：DONE 契约加 durable-findings（1-3 行、LEAD 原文转贴进下个 planner 派工）——须与 orchestration-handoff delta 同措辞。
  - _orchestration.ts **H.7 "Quiesce first"** bullet（:190）：relay 前 held warm reuse candidate 先写 digest——须与 session-relay delta 同措辞。
  - **handoff.ts**（HANDOFF_INSTRUCTIONS，"Worker-level use" 附近 ~:60）：加 retired-between-children 内容侧重 note（复用现有模板，remaining 空）。
- **delta 与模板措辞必须逐字对齐**：durable findings（H.3↔orchestration-handoff）、held warm candidate 先写 digest（H.7↔session-relay）——两处 spec 文字与 playbook 文字用同一批锚短语，implementer 改 playbook 时照抄。
- **docs**：`docs/opsx-workflow-guide.md` + `docs/zh/opsx-workflow-guide.md` 镜像必须同步（repo 硬约定）；加 minor `.changeset`。
