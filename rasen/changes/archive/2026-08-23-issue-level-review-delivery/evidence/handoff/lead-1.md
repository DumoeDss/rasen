# Handoff: issue-level-review-delivery — LEAD #1（campaign 会话交接）

## Original intent

用户原话（campaign 授权，2026-08-20）：

> 继续推进后续所有slice，每个slice你来direction激活并使用auto推进！

补充指令（2026-08-21）：「继续推进，等g-003完成后直接进Phase 3」——解读为 portfolio
收官后不驻留直滚下一片（按路线序；用户被明确告知下一片按序为 Phase 5，现已过 P5/P6 g-002）。
补充指令（2026-08-23）：「等impl-review-gate回来，你可以rasen-handoff编写交接文档，准备交接session了」。

Campaign = Issue 层（0.3.0）Phase 2–7 逐片交付。本交接点是 **P6 g-002 apply 完成后的
阶段边界**（impl-review-gate 已 DONE，verify 未派发）。

## Position

- 仓库：`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code`
  （远程 DumoeDss/rasen，目标分支 **dev/0.2.0**）。
- **所有 campaign 工作在专用 worktree**：
  `E:\...\OpenSpec-code\.claude\worktrees\issue-layer`，当前分支 `feat/issue-phase6`
  （本地尖端 = g-001 归档 `2bdd1513` + g-002 的未提交工作树改动）。
- 持久 store：`E:\...\Reference\rasen-issue-store`（id `issue-registry`）——
  **四个 Issue 全部 done**（#1 multi-change 3/3、#2 cross-project 4/4、#3 autodecompose 2/2、
  #4 replanning 3/3）；attention 扫描零项。
- Campaign 进度：**P2(#171)/P3(#172)/P4(#173)/P5(#174) 已合并并 golden close**；
  P6 进行中（g-001 done `c870a4b2`/`2bdd1513`；**g-002 apply done 未 verify**；g-003 pending）。
- direction 账面（主 checkout，未提交，operator 自管）：父
  `rasen/work/issue-centered-automation-platform/` 的 work.yaml（activeSlice:
  phase-6-issue-review-delivery）+ roadmap §14.1–§14.5。
- 当前 child：`issue-unified-review-gate`（run-state 在
  `.rasen/changes/issue-unified-review-gate/ephemera/auto-run.json`——注意 g-001 的
  ephemera 已被归档 cleaner 清除，这是 g-002 自己的）。

## Done / Remaining

Done（campaign 级，全部已合并 dev/0.2.0）：
- P2 issue-multi-change-execution（PR #171；Issue #1 done）
- P3 issue-cross-project-execution（PR #172；Issue #2 done）
- P4 issue-autodecompose-uplift（PR #173，含 2 处 CI 预算修复；Issue #3 done）
- P5 issue-cross-project-replanning（PR #174 首轮绿；Issue #4 done）
- P6 g-001 issue-delivery-evidence-rollup（ship c870a4b2 + archive 2bdd1513）
- P6 g-002 issue-unified-review-gate **apply 已完成**（13/13 任务、17/17+7/7+9/9 套件、
  四 Issue 追溯收据在 evidence/；run-state 已记 apply=done）

Remaining（按序）：
1. **P6 g-002 verify**（立即）：派 fresh reviewer（fable）。判定后 review-loop（如需）→
   ship（local）→ archive。
2. P6 g-003 `issue-deferral-record`（延期词汇 + Issue #5 全环 dogfood；planner-p6 暖续
   或新编制；g-002 实现者的 3 条 findings 在其 DONE 里，已录入 planning-context 的
   planner findings 应核实）。
3. P6 portfolio 收官：parent 制品 commit → PR → CI 监控 → 绿即合并（用户既有模式）→
   Issue #5 close（LEAD 四步：seed/绑定 → 门 → accept → done；参照 #4 的 close-summary
   在 rasen/changes/archive/2026-08-22-issue-cross-project-replanning/evidence/）→
   roadmap §14.6 回写 + work.yaml 切 phase-7 → parent 归档 + close 直推。
4. **P7 界面收敛**（campaign 最后一片）：Issue Board / Issue Detail / Operations /
   Unlinked Changes（roadmap §11；`packages/ui` 解冻；三轨并行分析见本文件「关键决策」末条）。
5. ECP 收尾（ECP-7 尾段 + ECP-8）维持延后（用户 2026-08-17 决定；登记在子 direction
   result.md 与父 roadmap §14）。

## Key decisions (and why)

- **交付模式**：每 phase 一个 portfolio（auto-decompose 3-child 串行链，child 全走
  small-feature）→ 全量门（分箱判定法，见 gotchas）→ push → PR → CI 监控（awk TSV v5
  脚本形状）→ 绿即合并 → Issue golden close → roadmap §14.N 回写 → parent 归档 +
  close 直推 dev/0.2.0（fetch+merge 后 push，因 PR merge 是远端对象）。
- **Gate policy off (global)**：全程自动推进，逐 stage 记 gateDecision。
- **模型分配**（用户既有约定）：planner/reviewer=fable，implementer/fixer=opus，
  shipper=sonnet。每个 portfolio 换新编制（planner-pN 暖续三片）。
- **CLI 一律 `node bin/rasen.js`**（worktree 内；全局 rasen 是旧 dev-local 勿用）。
  validate 是位置参数 `validate <name>`（`--change` 只在 status 上合法）。
- **版本纪律**：绝不 bump 版本；`packages/ui` 冻结至 P7；pipeline-registry 冻结
  （P4 已越过边界后恢复冻结）。
- **关闭纪律**：close 动作（seed/绑定/accept）由 LEAD 亲手执行，receipts 入 parent
  evidence；任务清单禁写 LEAD-loop 动作（引擎 tasks 门自指死锁，P4 g-003 教训）。
- **诚实优先**：spec 与代码不一致时改 spec 向真形收敛；行为变更必须 spec 成文 +
  保留声明豁口（P5 g-001 的 begun-node 缝先例）；镜像/重建须注记来源，不伪造。
- **持久 store 的种子身份必须走 `deriveChangeInstanceId`**（planning-identity.js）；
  一别名不得双实例（M-1 形状）；ephemera 被 cleaner 清后可依归档事实重建 run-state
  （注记内联）。
- **P7 并行策略**（本会话早前分析，供 P7 激活时用）：Phase 7 是「收敛」非「新建」；
  可前置约四成（设计/IA、Unlinked Changes、Operations 收敛、Issue 只读骨架）；
  派生状态显示必须等 Phase 1 投影器（已在位）；旧板退休放最后一次性做。

## Dead ends & gotchas（campaign 血泪，全部实测）

- **本机全量套件**：单进程跑不完（会死无摘要）；**分箱法 = node spawn argv 直驱**
  ≤25 文件/箱（`.rasen/run-bins.mjs` 在 worktree，可直接复用改 manifest）。已知失败簇
  = 恰 6 文件（tool-detection/update/profile-sync-drift/init/project-home/config-profile
  ——hermes 等用户态泄漏，2026-08-17 三重裁决）；其余红文件 solo 复跑裁决。**CI 为权威门**。
- **Git Bash 吞路径**：生成脚本里参数的 `/` 会被 MSYS 吃掉（test/a/b→testab→找不到
  测试）——vitest 文件列表必须经 node spawn argv，不能过 bash 拼接。
- **Windows 长路径目录删除**：`git worktree remove --force` 后残留 → robocopy /MIR
  空目录法（`$env:TEMP\robocopy-empty`）+ Remove-Item。
- **磁盘**：E: 曾到 0GB（27 worktree 积累）；已删 25 个陈旧 worktree（3 个有脏保留：
  agent-a480…、canvas-iri-compiler、wt-pointer-init-tools），剩 ~3.4GB——**跑门前查
  FreeGB，临时 fixture 边跑边清**。
- **CLI 测试跑 dist/**：src 改动后必须 `pnpm run build` 再跑 CLI 套件（幻影红）。
- **scenario 标题 = 身份标签**：MODIFIED delta 里改名会被归档守卫拒（validate 拦不住）；
  只增不改。
- **引擎 EOF 双坑**：归档引擎写的 spec 会 EOF 多空行 + Purpose/Requirements 间丢空行
  ——提交前修剪到与兄弟一致（单 \n）；whitespace gate 永不跳（--no-verify）。
- **`*.log` 被 gitignore**（gate 日志留盘随归档 payload）；`*.patch` 不被 ignore。
- **提交纪律**：窄 pathspec（禁 add -A）；CRLF 空噪声不提交；main checkout 的 git 态
  不可碰（direction 文档改动留在其工作树归 operator）。
- **PR merge 是远端对象**：归档 stamp 记本地 HEAD（先例已立，close-summary 承载 PR
  可追溯性）；close 直推前须 fetch+merge origin/dev/0.2.0。
- **CI 预算史**：Windows shard 40m + archive fault-matrix 60s（P4 修）；再遇「取消形
  失败」查 job 级超时，「30s 超时形」查单测预算。
- **502/429 偶发**：worker 撞 API 限时——先查盘面（任务勾选/证据/代码），实质完成则
  LEAD 簿记收口，未完成则暖种继任（P4 g-003 先例）。
- **YAML 狗粮坑**：裸标量含 " #4" 会断（注释起始）；多行标量续行列要对齐或用 >-。

## Eliminated hypotheses

none（LEAD 交接，非 fixer/debugger）。

## Working set

- worktree：`.claude\worktrees\issue-layer`（feat/issue-phase6；g-002 未提交改动在
  src/core/issue-status/{review.ts,types.ts,index.ts} + src/commands/store-issue.ts +
  3 新测试 + 架构索引 2 文件）。
- g-002 交付物：`rasen/changes/issue-unified-review-gate/`（proposal/design/specs/tasks
  13/13 + evidence/ 六收据）；run-state apply=done。
- campaign 状态文件：`.rasen/changes/issue-level-review-delivery/ephemera/
  {auto-run.json,portfolio-run.json}`（本交接的 sessionHandoff 记在 auto-run.json）。
- 主 checkout 未提交改动（operator 自管）：父 direction 的 work.yaml/roadmap §14.x/
  ECP 子 direction 的 result.md。
- 监控脚本形状（CI watch）：awk -F'\t' 按 bucket 列精确匹配（TSV 名含空格，列位会错）
  + 排除 "All checks passed" 假 fail。
- 门执行记录模式：evidence/binned-suite-adjudication.md（分箱 + solo 裁决 + 全枚举）。

## Next action

**派发 P6 g-002 `issue-unified-review-gate` 的 verify reviewer**（fresh，fable，
Agent 名如 reviewer-review-gate）：cwd=该 worktree；读
`rasen/changes/issue-unified-review-gate/`（proposal/design/specs/tasks + evidence 六
收据）+ 父 planning-context 的 planner findings；重点核：（1）determination =
acceptance gate 的全量 1:1 映射（无第二基变异钉——delivery/lifecycle/thread 事实
不得翻转判定）；（2）四 Issue 活体亲读（accepted + threads 站立：evidence-missing×9、
archive-pending×3 含跨项目节点）+ `--json` 的 `review` 键 parity；（3）线程词汇封闭性
（acceptance-awaiting 与 problem 项被排除的理由）；（4）list 紧凑围栏；（5）变异抽查
（映射破坏→矩阵测试红）。报告落 evidence/review-report.md（canonical severities）。
判定后按 campaign 节奏：CLEAN → shipper-p2 暖续 ship local（窄 pathspec，排除兄弟
目录 `.rasen/` 与 LEAD 探针文件 scripts-tmp-*）→ archiver-p2 归档（ADDED capability
spec delta）→ g-003。
