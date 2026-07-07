# Planning Context: close-fusion-followups

> LEAD 播种（Step B.1）。planner 先读本文件，再补研究。这是 fusion 系列（ship-delivery-modes + unify-expert-template-pipeline）的收尾 follow-up。

## 用户意图

「/opsx:auto small-feature 继续完成后续所有的follow up」——把 `docs/grill-gstack-absorption.md` §7 列的 follow-up 清掉。用户已多次表达：全程自主推进，gate 不停，跑到 archive。

## Scope（已由 LEAD 切定，planner 不要扩界）

**本 change 包含 3 项**（都是小而清晰、主题统一的 fusion 收尾）：

### 1. archive 零需求 spec 删除路径（真正的特性，最痛，已复现两次）
- 现状：`openspec archive` 在某 spec rebuild 后归零 requirements 时 abort：`Validation errors in rebuilt spec for <spec>: Spec must have at least one requirement — Aborted. No files were changed`。当前 workaround 是 `--no-validate` + 手删目录（先例：`fuse-methodology-into-opsx` commit 938ef65、`unify-expert-template-pipeline` 一次删 3 个）。
- 目标：让 archiver 把「rebuild 归零 = 删除该 spec 目录」作为**受支持的一等路径**，而非报错。即：当一个 delta 把某 spec 的 requirements 全 REMOVED 后，archive 应删除该 spec 文件/目录（+ 相应 delta），并通过校验。
- 必须研究：archive 命令源（`src/commands/archive.ts` 或附近）、spec rebuild/merge 逻辑（`src/core/` 下的 spec 合并器）、那条 `min(1)` 校验在哪触发。决定改校验逻辑还是改 rebuild 逻辑让其检测归零并删目录。
- 安全：只在「该 spec 全部 requirement 被 REMOVED」时删，不误删仍有内容的 spec；保留一个清晰日志/输出说明删了哪个 spec。
- Spec：`openspec/specs/cli-archive/spec.md`（ADDED 一条 scenario：归零即删除；可能 MODIFIED 现有 rebuild 校验 scenario）。
- Test：加一个测试——归档一个把某 spec requirements 全 REMOVED 的 delta，断言该 spec 目录被删、archive 成功（不 abort）、validate --strict 过。参考已有 archive 测试的 fixture 写法。

### 2. F3 — navigator 的 /opsx:ship 简介提三模式（polish）
- 现状：`src/core/templates/experts/navigator.ts` 主流程第 5 项写死 `**/opsx:ship** — test, push, open the PR from the proposal.`，没反映 ship-delivery-modes 的三交付模式（pr/push/local）+ 证据门。
- 目标：改成一句话反映三模式（pr/push/local）+ 不盲测（按证据门）+ decompose 子任务链完成后统一交付。保持 navigator 的「一句话点到为止」风格，不要把整个 ship 契约搬进来。
- Spec：`openspec/specs/navigator-router-skill/spec.md`（MODIFIED 该主流程 scenario）。

### 3. F2 — ship 证据门加 tree 指纹（polish）
- 现状：`src/core/templates/workflows/ship.ts` 3d 证据门用「HEAD + dirty 状态」判定代码是否未变。F2：改用 `git rev-parse HEAD^{tree}` 的内容树哈希作为更严密的内容指纹（commit 移 HEAD 但不改内容时不作废证据的原则，用 tree 哈希表达更精确）。
- 目标：证据记录加 tree 指纹；ship log 也记 tree 指纹；证据门判定对齐。
- Spec：`openspec/specs/opsx-ship-command/spec.md`（MODIFIED Evidence-based test gate + Ship log 相关 scenario；可能 MODIFIED review-cycle-workflow 的证据记录 scenario 让它也记 tree 指纹——planner 判断是否需要）。
- 配套：auto.ts §5 adaptive verify 的证据记录、review-cycle.ts 的 cycle report 证据行——若它们也记 git 状态，对齐到 tree 指纹（保持横向一致）。

## 明确排除（planner 不要并入）

- **`description: '|'` 空描述痼疾**：18 个专家 getter 写死空 YAML block scalar，是既存 bug。修它=为 18 个专家手写真实 description，**改变技能行为**（context load / model-invocation 触发），属内容决策非机械修复。本 change **不动**，由 LEAD 另行与用户确认是否独立立项。proposal 里不要列它。

## 关键约束（影响实现）

- **parity 哈希**：navigator 现在是 19 专家之一、已在 golden-master（`test/core/templates/skill-templates-parity.test.ts` 的 EXPECTED_FUNCTION_HASHES + EXPECTED_GENERATED_SKILL_CONTENT_HASHES）——改 navigator.ts **必须重算它的哈希**。ship.ts 是 workflow，**不在**函数哈希表（表只有 11 base + feedback），改 ship.ts 无需重算（planner/implementer 核实这点，别假设）。
- **delta 纪律**：MODIFIED 需求必须携带该需求全部 scenario（丢 scenario=静默删除，仓库铁律）。对照 `openspec/specs/<cap>/spec.md` 原文逐 scenario 核。
- **平台坑**：改文件用 Read/Edit/Write 工具，禁 PowerShell Get-Content/Set-Content（写坏 UTF-8）；openspec 命令 PowerShell 下 exit 255 但输出正常（看输出）；Windows 全量测试 temp-dir 抖动，未触碰文件隔离重跑绿即过。
- **ship 惯例**：push 模式直推 origin dev-harness，不开 PR；commit 尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## 期望产出

proposal.md（Why/What Changes/Impact；若有主 spec 需手调 Purpose 行，加 archive NOTE）+ design.md（archive 归零删除的实现决策：改校验 vs 改 rebuild；F2 tree 指纹如何与现有证据定义对齐）+ tasks.md + 各受影响主 spec 的 delta（cli-archive、navigator-router-skill、opsx-ship-command，可能 review-cycle-workflow）。`validate close-fusion-followups --strict` 自验通过。

## Planner 追加记��区
（planner 完成后把新发现 APPEND 到这里）

### Planner 完成记录（2026-07-07）

**Artifacts 已产出**：proposal.md / design.md / tasks.md + 4 个 delta（cli-archive、navigator-router-skill、opsx-ship-command、review-cycle-workflow）。`validate close-fusion-followups --strict` 通过（exit 0，"Change 'close-fusion-followups' is valid"）。

**研究定论（implementer 直接用，勿重查）**：
1. **archive 源在 `src/core/archive.ts`**（不是 `src/commands/archive.ts`）。rebuild/merge 逻辑在 `src/core/specs-apply.ts` 的 `buildUpdatedSpec`（应用顺序 RENAMED→REMOVED→MODIFIED→ADDED 到 `nameToBlock`，且已知 `isNewSpec`）。
2. **min(1) 门**：`SpecSchema.requirements` 在 `src/core/schemas/spec.schema.ts:9`，经 `Validator.validateSpecContent` 在 **两处**触发——`archive.ts:~442`（archive 流）和 `specs-apply.ts:~442`（`applySpecs` 独立 sync 流）。两处都要改，否则 archive/apply 会漂移。
3. **删除实现决策（design.md Decision 1）**：在 `buildUpdatedSpec` 算 `emptied = (!isNewSpec) && nameToBlock.size === 0` 并随 `{ rebuilt, counts }` 返回；两个 caller 对 `emptied` 项跳过 `validateSpecContent`、写盘阶段 `fs.rm(path.dirname(update.target), { recursive: true, force: true })` 删目录、打一行清晰日志（JSON mode 静默）。**不要**全局放宽 `min(1)`——空 spec 在其它场景（新建/手编）仍应失败；只有「现存 spec 被本 delta 清空」走删除。新 spec 清空（仅被忽略的 REMOVED + 骨架）仍撞 min(1) 失败，正确。
4. **parity（已核实）**：navigator 在 golden master 里被 **两个**哈希锁定——`getNavigatorSkillTemplate`（`EXPECTED_FUNCTION_HASHES`，test 文件 line 93）+ `openspec-navigator`（`EXPECTED_GENERATED_SKILL_CONTENT_HASHES`，line 127）。改 navigator.ts **必须重算两个**。ship / review-cycle / auto 三个 workflow 模板 **都不在**两张表里（表只有 11 base + 19 expert 的 skill 模板），改它们无需重算哈希。navigator 改动不增减专家数，count 测试（19）不动。
5. **auto spec 无需 delta**：`opsx-auto-command` 的证据 scenario（line 83）只说 "the git code state it ran against"（泛指），tree 指纹满足它不矛盾。`review-cycle-workflow` 的 "Gate-Run Test Evidence Is Recorded for Ship" 把 "HEAD + dirty" 写死了，**需要** delta（已改 tree 指纹）。所以 F2 共 3 个代码点（ship.ts、review-cycle.ts、auto.ts）+ 2 个 spec delta（opsx-ship-command、review-cycle-workflow）。
6. **无主 spec Purpose 手调**：4 个 spec 的 Purpose 行���不需改（零删是 Spec Update Process 内新 scenario；navigator ship 一行是 map 内 scenario；tree 指纹是证据门细化）。proposal 不含 archive NOTE。
7. **F2 设计（Decision 2）**：`git rev-parse HEAD^{tree}` 作唯一 code-state token，三处证据记录（ship log、review-cycle report、auto run-state）统一记它；ship 门直接比对 recorded vs current tree 指纹；base-merge 引入新内容会改 tree 指纹，故 run-condition (a) 仍正确触发。

**排除项确认**：description-`|` 空 block scalar bug 未纳入（按 LEAD 排除）。
