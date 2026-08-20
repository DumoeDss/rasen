
# Planning Context — issue-multi-change-execution（Phase 2，LEAD 种子，2026-08-20）

## 用户意图（原话）

> 继续推进后续所有slice，每个slice你来direction激活并使用auto推进！

Campaign：Issue 层 Phase 2–7 逐片推进；每片 = direction 激活（父级 work.yaml
activeSlice + roadmap 登记）→ portfolio（auto-decompose，child 全走 small-feature）
→ PR → CI 监控 → 绿即合并（PR #168 既有模式）。ECP-7 尾段与 ECP-8 维持延后。

## 本片目标（roadmap §4 Phase 2 最小实现）

单 Issue / 单项目 / **多 Change**：
- 复用现有 auto-decompose、portfolio 和依赖 DAG；
- 把分解结果保存为 Issue 的 Execution Plan（显式 Change 引用，不靠名称前缀推断）；
- 每个 Change 独立运行、重试和验证；
- Issue 状态尊重 required / optional / cancelled / superseded 节点；
- 失败和阻塞进 health，不破 phase。

## 执行环境（所有 worker 必读）

- worktree `E:\...\OpenSpec-code\.claude\worktrees\issue-layer`，分支 `feat/issue-phase2`
  （自 dev/0.2.0 `71b64a16` 切出）。所有命令以该目录为 cwd。
- 一律 `node bin/rasen.js`（0.2.0）；禁用全局 rasen 与其它 worktree。
- 版本纪律：不 bump 任何版本号。禁触 `packages/ui/**`；`src/core/pipeline-registry/`
  本片冻结（canvas 线刚动过它，71b64a16 起）。

## 已有地基（勿重复建设）

- `src/core/store/issues/`：StoreIssues（create/setState/publishPlan/list/show +
  acceptance/accept）；plan 修订不可变序数寻址；`src/core/issue-status/`（唯一投影缝，
  `projectIssueStatus`）；`src/core/issue-execution/`（start 发射 + workspace-index
  定位器 + 归属回流）；`src/core/issue-acceptance/`（门 + 显式 accept）。
- specs：`issue-status-projection`（8 reqs）、`issue-execution-binding`（5）、
  `issue-acceptance-close`（5）、`store-issue-resources`（mutation 词汇 5 操作）、
  `store-planning-layout-v2`。
- 同构先例：coordinator-bridge 的 issues compiler（coordinator inventory → Store
  Issue 端到端，含 fixture 冻结）——C1 的 portfolio→plan 通道可循此模式。

## Phase 1 的教训链（binding，详见归档 handoff 与下方 findings）

1. 投影缝唯一：扩展 `src/core/issue-status/`，不开第二缝。
2. 查询优先 committed 副本；dogfood 里状态变更需先 store commit。
3. dogfood store 放 OS temp；`store setup` 初始分支 master 需 rename main；
   `layoutVersion: 2` 空 store 要手写；`add-project` 写 config + `.rasen-store/`
   两处记得双清。CLI 测试跑 dist/——src 改动后必须 `pnpm run build`。
4. 加 CLI 子命令三面同步：commander + en/ja/zh-cn locale + completions COMMAND_REGISTRY。
5. MODIFIED delta 里别改 scenario 标题（身份标签；归档守卫会拒，validate 拦不住）。
6. C2 发现：worktree-share 规则穿透（注册 worktree 会改写主 checkout 身份）——
   C3 持久化时直接注册主 checkout 所在仓库，或在专用目录。

## Portfolio 计划（LEAD 已拍板）

| # | child | 交付 | 依赖 |
| --- | --- | --- | --- |
| g-001 | `issue-plan-publication` | portfolio/decompose 结构 → Execution Plan 修订发布通道（显式引用 + dependsOn + committed 证据验证；CLI 面） | — |
| g-002 | `issue-node-lifecycle` | required/optional/cancelled/superseded 四态语义贯穿投影/验收门/health；重发布=新修订保留历史 | g-001 |
| g-003 | `issue-persistent-baseline` | 持久 Store + 本仓注册 + 第一个真实 Issue（本 portfolio）+ 多 Change 全环 dogfood | g-001, g-002 |

串行链。每个 child 走 small-feature：propose → apply → verify → review-loop →
ship（local）→ parent 统一交付。

## 决策记录

- 2026-08-20 操作者：campaign 授权（见 work.yaml campaign 块 + roadmap §14.1）。
- 2026-08-20 LEAD：分支 `feat/issue-phase2`；ECP 保持延后；Phase 8 可选池不排期。

## Planner findings（g-001 propose 完成，2026-08-20）

1. **child `id` 就是语义 change 名 = 目录名**（playbook Step G.7 原文）——调度 id（`node: g-001`）只活在
   可选元数据里，绝不进名字。portfolio→plan 通道按 child id 做**名字→实例**解析（搜 committed evidence
   里 `changeId == child.id`），nodeId 与 changeAlias 都取 child id。g-002/g-003 的 dogfood 依赖此映射。
2. **现有 `resolveChangeReference` 只按 instanceId 解析**——名字键解析是新方向，复用
   `gatherReferenceEvidence` 即可。**archived committed Change 算证据**：子项归档后再发布（真实场景：
   全环 dogfood 完成后重发布）必须仍可解析；projection 已把 archived+outcome 读作 finalized。
3. **portfolio 定位缝 = `pipeline resume` 的缝**（`src/commands/pipeline.ts` resume 的
   changeDir/ephemeraDir/workDir 推导，约 :2692-2727）。strict 读（invalid ≠ absent）+
   `state.parent` 与请求名一致性校验。g-003 在本仓跑真 portfolio 时，run-state 会落在
   `.rasen/changes/<parent>/ephemera/`（本 worktree 的 execution root ephemera）。
4. **`StoreIssues.publishPlan` 白拿全套纪律**——图检查/摘要/序数/锁/commit 建议全部继承，无需平行实现；
   重复 child id → duplicate node 拒绝，dependsOn 指向非 child → dangling 拒绝，全是现成诊断。
5. **加 CLI 选项（非子命令）同样三面同步**：en/ja/zh-cn 的
   `cli.root.commands.store.commands.issue.commands.plan.options.from-portfolio`（presentation
   层结构校验，缺一个键 CLI 起不来）+ completions `plan` flags。命令面只多一个选项，无新子命令。
6. 诊断码 `issue_plan_from_file_required` 被 `issue_plan_source_required` 取代（grep 证实无测试/规范钉住
   旧码）。
7. **留给 g-002 的口子**：本片把 plan 节点 schema 冻结（无 status/pipeline 字段），发布只写 revision 一个
   文件；四态语义要么扩节点 schema 要么立兄弟记录，决定权在 g-002（design.md D3/D6）。

## g-001 交付追加教训（2026-08-20）

7. `validate` 的合法形式是**位置参数** `validate <name> [--type change]`——`--change`
   flag 不存在（phase-1 已踩、phase-2 任务文本复发；planner 写任务时直接用位置形式）。
   `status` 侧相反：`status --change <name>` 是合法 flag。
8. 归档引擎写的 spec 会在 EOF 多一空行 + Purpose/Requirements 之间丢空行——提交前
   修剪到与兄弟 spec 一致（单 `\n` 结尾），钩子不跳。
9. 本机全量门在 child 级已上提为 portfolio 交付级（LEAD 统一跑 + 簇分类）；child 级
   门 = 受影响 + store 族 + 三面同步（cli-presentation / command-registry / locales
   catalog）——g-001 的门日志漏了三面同步三件，靠 reviewer 补跑闭合，g-002 起列入。

## Planner findings（g-002 propose 完成，2026-08-20）

1. **拍板：节点 schema 扩展，非兄弟记录**（design D1）。`lifecycle: required|optional|cancelled|superseded`
   只加在 change 节点上；absent ≡ required；cancelled/superseded 必带 `reason`（portable text）。
   显式 `required` 在发布时规范化为省略（镜像 changeAlias 模式）→ g-001 的 0001/0002 摘要逐字节稳定。
   反向兼容不对称：旧代码读新修订会按 strict-read 报 unrecognized field（可见拒绝，设计如此）。
2. **四态一张表**（design D3）：required 计进度/卡门/可启动；optional 不计数、不因未完成卡门、但运行中算
   active、失败算 failed health（wanted work）；cancelled/superseded 完全在执行图之外——不驱动
   phase/health、不是 frontier 候选、start 拒绝（新 refusal kind node-cancelled/node-superseded）、
   从 required-total 剔除且**剔除连同 reason 显示在门旁**。
3. **optional 失败卡门的解读**（design D4）：seed 的"optional never block"取"不因未完成阻塞"义；失败的
   optional 是 wanted work 的真实失败 → health failed → 门卡住；出路 = 重跑或带 reason 取消（取消后
   escalation 即历史，门自清）。
4. **零 required 节点是被陈述的答案**：进度 0/0（≠ 不可读的 null/-/-）、门空洞 eligible 但必须把剔除与
   optional 节点名在门旁。`assertCoherentGateSnapshot` 本就允许 0/0（acceptance.ts 验证过）。
5. **无新 CLI 面**：lifecycle 修改走既有两发布源；单节点取消的流程 = `show --json` 拷最新修订节点表 →
   手改 → `--from-file` 发布下一修订。三面同步三件套照跑（预期零 diff，门日志记录）。
6. **M-1 未碰**：lifecycle 不新增任何引用解析/验证路径；pin 测试须原样绿。g-003 注册主 checkout 走正常
   归档流（move 非 copy），不会制造 active+archived 同名对——那是 fork/migration 异常才有的形态。
7. **g-003 dogfood 集成点**：真 Issue 的 0001 从真 portfolio 发布（全 required）；若中途弃某子，0002 用
   `--from-file` 带 cancelled+reason；验收时所有 required 子项 terminal 才过门。MODIFIED 场景标题
   byte-stable 已脚本验证（15 个新场景、0 改名/丢弃）——g-003 若再 MODIFIED 这些 spec，照此法先验。

## Planner findings（g-003 propose 完成，2026-08-20，Phase 2 收官）

1. **零 delta 变更在本 schema 不可表达**：artifact 图按 `specs/**/*.md` glob 判完成——无 delta 文件则
   specs 永远 ready、tasks 永远 blocked（探针变更实测）。LEAD 的"if any"落空时，须挑一个真实的最小
   产品面 delta；本片选 `store setup --layout 2`（MODIFIED store-planning-layout-v2 的声明需求，+2 场景）。
2. **Store 选址拍板**：不复用旁边空壳 `rasen-store`（v1 形态、来历不明、是 operator 的），在
   `Reference\rasen-issue-store`（id `issue-registry`）用新 flag 全新创建——v2 原生、无 residue 之舞、
   且 dogfood 新能力。`Reference\` 已验证不在任何 git 仓内。空壳店记入 receipts 待 operator 退役。
3. **seeding 机制链已全部验证**：archived entry 只需 identity 版 `.openspec.yaml` 落在
   `rasen/projects/<uuid>/changes/archive/<line>/<dated-entry>/`；repo 的 v1 `archive.json` 骑行即
   legacyRecord（outcome null）→ finalized 观察由子项真实 terminal run-state 补上（"count the same"）。
   g-001 的 name resolver 内建 `archiveDatePrefixedNameMatches`——日期前缀归档名直接匹配 child id。
   **每 instance 恰一份 committed copy** = M-1 形态不可能；repo 自己的 archive 不进 store 证据。
4. **真 portfolio 现状快照**：run-state 在 worktree ephemera（g-001 done / g-002 done / g-003
   in_progress，serial DAG）；每子项 per-child auto-run.json 在位（g-001 全 done）。投影读必须 cwd=
   worktree 才见 run-state（设计行为，receipts 两种读法都演示）。
5. **注册主 checkout 的跨界写**：add-project 会写主 checkout `rasen/config.yaml` 的 membership hint
   ——需 operator/LEAD 协调提交；planning 不迁移（membership ≠ binding，D10）。target line =
   line-0.2（storeRef refs/heads/main，codeRef dev/0.2.0）。
6. **Phase 3 候选记忆**：seeding 无产品面（operator 工具，shipped helpers 可用）；三步链 UX（path→
   healthy root→residue）在 v2 原生 setup 后只剩前两步仍有价值；bootstrap 命令（store-bootstrap spec）
   是现成的"机器缺什么"入口。Issue 注册表的持久性 = 硬盘路径 + git 历史 + machine registry，备份/
   remote 是 operator 后续。
