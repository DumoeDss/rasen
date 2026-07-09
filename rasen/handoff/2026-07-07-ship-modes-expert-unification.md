# Handoff: ship-delivery-modes + unify-expert-template-pipeline — LEAD session（2026-07-07）

> 写给零共享上下文的接班人。交接时 LEAD 占用 24.7%（246,822/1,000,000）。
> 本 session 的两个 change 均已 shipped + 归档，**无进行中工作**——本文档是收官检查点，不是断点续传。
> 上一份 session 级交接：`openspec/changes/archive/2026-07-07-reconcile-fusion-seams/handoff/lead-1.md`。

## Original intent（时序）

1. 「让 subagent 去 ship（仅提交，不用测试）+ archive」reconcile-fusion-seams → 完成（commits `2a5ebb7`/`0160726`）。
2. 「当前 ship 是需要全量测试的吗？……review 阶段应该已经测试完毕，在 ship 阶段不需要再测试了才对」→ 调查确认：ship 契约收编自 gstack /ship 专家（假设 feature 分支→PR→main），无条件 merge base + 全量测试；「怎么这里还会 merge base 分支？」→ 溯源：非 OpenSpec 原版，gstack fusion（52bb5ca，2026-05-29）带入、当天收编（8d6ae87）内联进 opsx ship。
3. 「在其他工作前需要先修改一下 ship……你觉得应该如何修改比较好呢？」→ 用户拍板我的方案：**三交付模式（pr/push/local）+ commit 一等步骤 + 测试证据门 + decompose 子任务链完成后组合层一次交付**；「tdd 措辞不用修改，explore × office-hours 也不用合并」。→ `ship-delivery-modes` 由本 session propose+apply+送审，另一 session 接手 shipped+归档（`50ec7d8`/`2161e21`）。
4. 「/opsx:auto small-feature 接下来你来完成 unify-expert-template-pipeline……没有问题，开始实施吧」+「propose 完成后继续推进，不用停下，直到全部完成」→ 全程 auto 管线跑完，shipped+归档（`ccc3f61`/`bdc8bae`）。

## Position

Pipeline: 两条均收官。`unify-expert-template-pipeline` 是 auto small-feature 管线的**首次完整实战**（propose→apply→verify→review-loop 1 轮 CLEAN→ship→archive，Tier A，5 个 role worker，全部正常退役后被用户手动 stop——无悬挂工作）。

## Done / Remaining

Done：
- `ship-delivery-modes`（`50ec7d8`/`2161e21` 归档）：ship.ts 重写（模式解析绝不默认 main、commit-with-hooks、证据门、按模式交付、模式感知 ship log）+ auto.ts/_orchestration.ts Step G.5（子 change local-only、组合级一次交付、部分失败不 push）+ review-cycle.ts 证据记录契约。4 delta spec。
- `unify-expert-template-pipeline`（`ccc3f61`/`bdc8bae` 归档）：19 专家源内联 `src/core/templates/experts/<name>.ts`（14 共享块 `_shared.ts`；D7 纪律：迁移前基线→逐字节比对→才冻结哈希，reviewer 独立复核成立）；gstack 品牌全除（dirName `openspec-<name>`、skill id `openspec:<name>`、`skills/experts/` 仅 sidecar、docs 活引用清零）；bun/gen-skill-docs/skill-check 工具链删净（含死文档 docs/zh/gen-skill-docs.md）；parity golden-master 扩至 19 专家；init/update 孤儿清理 `openspec-gstack-*`（有 near-miss 测试）。15 delta spec；归档后 `validate --all --strict` 92/92。

Remaining（均未立项，按优先级）：
1. **archive 零需求 spec 工具缺口**（已复现两次，unify 一次挡 3 个 spec）：archiver 无法 rebuild 到零 requirements，只能 `--no-validate` + 手删。值得小 change 开删除路径。
2. ship-delivery-modes 评审 follow-up：**F2** 证据加 tree 指纹（`git rev-parse HEAD^{tree}`，比"HEAD+dirty 状态"严密）；**F3** navigator 对 /opsx:ship 的简介未提三模式。
3. docs/zh 整体过时（独立立项）；全局配置事故（2026-07-06）根因未查——详见 memory `upstream-v15-merge-handoff`。
4. `openspec list` 里 4 个 2026-03 的旧 in-progress change（unify-template-generation-pipeline 等）是**上游遗留草稿**，非本线工作，勿误 resume。

## Key decisions（勿重新讨论或静默反转）

- ship 三模式解析顺序：显式参数 > 现存 PR > 仓库惯例 > 询问用户；**任何一步不允许默认 repo 默认分支**（原 bug 根源）。证据门"有证据才跳过、没证据就跑"；证据绑定代码内容而非 commit hash。用户明确接受"证据新鲜完全跳过测试"（不留冒烟尾巴）。
- decompose 子 change ship 固定 local 模式；组合完成后父层交付恰好一次；部分失败绝不 push。
- 专家改名 `openspec-gstack-<n>`→`openspec-<n>`、`gstack:<n>`→`openspec:<n>`（pipelines/*.yaml 的 skill 引用是 load-bearing）；`methodology-skill-tool-scoping` 主 spec 判 REMOVED（allowed-tools 从未进安装侧——getter 剥 frontmatter、生成器不 emit；真要做安装侧工具域收窄是独立新特性）。
- 专家 getter 的 `description: '|'` 空描述痼疾**有意保留**（行为不变原则）；COMMAND_REFERENCE/SNAPSHOT_FLAGS 从动态生成**冻结为静态常量**（不拉 bun browse 进主构建）。
- CHANGELOG 的 gstack 提及是历史记录，**不改**；docs 历史叙述性提及（"OPSX/gstack 融合工作"）保留。
- ship 惯例：push 模式直推 origin dev-harness，不开 PR；commit 尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## Dead ends & gotchas

- **worker 空闲通知先于回报到达**（本 session 又遇 3 次：planner/implementer/fixer）——先查黑板（tasks.md 勾选、grep 验证落盘）再判断，勿催派。
- PowerShell 给 git grep 传 `'a|b'` 不会按 alternation 解释（BRE 字面量）——用 `git grep -E`。
- `openspec archive` 遇零需求 spec 会 abort（"must have at least one requirement"）——`--no-validate` + 手删是既定先例（fuse-methodology `938ef65`、unify `bdc8bae`）。
- 老三样仍有效：PowerShell Get-Content/Set-Content 写坏 UTF-8（用 Read/Edit/Write 工具）；openspec 原生命令 PowerShell 下 exit 255 但输出正常（看输出）；Windows 全量测试 temp-dir 抖动（隔离重跑绿即过）。
- H.2 温续守卫实操：探测 worker transcript 用 glob `<projects>/<cwd-slug>/**/subagents/agent-*<name>*.jsonl` + `openspec agent context --transcript`。

## Eliminated hypotheses

none（本 session 无排障线；ship merge-base 溯源是 git 考古而非调试）。

## Working set

工作树干净，四个 commit 全部推送：`50ec7d8`/`2161e21`（ship-delivery-modes，另一 session 完成）、`ccc3f61`/`bdc8bae`（unify）。本文档是唯一未提交文件。memory 已更新（`upstream-v15-merge-handoff` + MEMORY.md 索引）。归档物：`openspec/changes/archive/2026-07-07-{ship-delivery-modes,unify-expert-template-pipeline}/`（含各自 review-report/review-cycle-report/ship-log）。

## Next action

无进行中工作。若用户点名下一项，Remaining 第 1 项（archive 零需求 spec 删除路径）是最被反复验证的痛点，bug-fix/small-feature 管线即可；F2+F3 可打包成一个 quick change。
