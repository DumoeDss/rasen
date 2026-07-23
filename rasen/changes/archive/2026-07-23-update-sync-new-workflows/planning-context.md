# Planning context — update-sync-new-workflows

## User intent (verbatim symptom report, 2026-07-23)

当前的 rasen update 有问题：旧版本升级后，并没有出现 rasen-audit 这个 skill。用户查看 `rasen profile`，UI 里所有 workflow **都是勾选的**（显示 38 个已选，custom）。此时取消勾选再全选、确认后，显示「工作流：已添加 audit」，rasen-audit 的文件夹才出现。

即：升级到带新 workflow（audit）的版本后，`rasen update` 没有安装新 workflow 的 skill；且 profile 编辑器把未入选的 audit 显示为已勾选（显示态 ≠ 存储态），用户无法从 UI 看出缺了什么。

## LEAD 侦察发现

- 选择解析链：`src/core/update.ts` L176-187 调 `resolveProjectWorkflowSelection`（`src/core/profiles.ts` L146-166）→ 项目 override 或 `resolveDesiredWorkflowSelection`（L115-127）→ `getProfileWorkflows(profile, customWorkflows, {expertSelectionExplicit})`。
- 核心疑点 1（安装侧）：`custom` profile 的 `customWorkflows` 是全局配置里落盘的显式列表，写入于旧版本，**冻结在旧 catalog**；新版本 catalog 新增 `audit` 后，该列表不会自动纳入新条目，update 因而不装 rasen-audit。需裁决：custom 列表不自动扩是 by-design（用户显式选择），还是 update 至少应**提示**有新 workflow 可用？（升级静默漏装 + UI 显示全选 = 明确 bug 体验。）
- 核心疑点 2（显示侧）：`src/commands/profile-editor.ts` 的 multiselect 默认勾选态与存储选择不一致 —— audit 不在存量列表却显示为勾选（可能对「catalog 有而列表无」的新条目默认 checked，或以 catalog 全集为默认）。这是显示态/存储态分裂,必须修。
- 相关既有接缝：`resolveProjectWorkflowSelection` 是 install/removal/drift 共用的单接缝（ui-space-workflow-toggle change 引入），修复须保持三方一致，不得旁路。
- 相关记忆：ledger 不可作已装集合主源（skills-only 拍板）；profile 显示 "已选择 38 个（custom）"。

## Constraints / decisions already made

- Pipeline: small-feature（propose→apply→verify→review-loop→ship→archive），gate 全 off（global autopilot.gates=off）。
- 版本号归用户管，不 bump。
- 跨平台 path.join 纪律（见 rasen/config.yaml rules）。
- 修复方向由 planner 根因后定，但至少覆盖：(a) 升级后新 workflow 的可发现性/同步行为；(b) profile 编辑器勾选态必须忠实反映存储选择。

## Planner 根因（读码确证，2026-07-23）

- **一个真缺陷，两处症状**：新增内置 workflow 对**冻结选择**（`custom` profile 或项目 `override`）既不安装也不提示，全程静默。
- **(a) 安装侧根因**：`resolveProjectWorkflowSelection` 分三支——`full`/`core` 走 `getProfileWorkflows` 返回**活** `ALL_WORKFLOWS`/`CORE_WORKFLOWS`，升级自动纳新（无 bug）；`custom` 返回落盘 `config.workflows` **逐字**（+expert 闭包），该数组是选择时的 catalog 快照，`audit` 后加入永不入列 → `getSkillTemplates` 不产出 → 皮肤不装。override 同理逐字冻结。此冻结**是 by-design**（update.ts:479 "keep custom profiles user-owned; do not mutate them" + profiles spec "Custom profile contents"）。缺陷=静默，非冻结本身。
- **(b) 显示侧：LEAD 疑点2（"audit 显示勾选"）经读码不成立**。picker `checked = currentState.workflows.includes(id) || requiredBy.has(id)`（profile-editor.ts:253）；`currentState` 来自 `getProfileWorkflows`，custom 下不含 audit，audit（builtins.ts:129 无 requires）不被任何选中项 require → **audit 渲染为未勾选，显示已忠实**。用户"全勾/38 custom"感知来自：①picker 分页(~7 行)把尾部 audit 行挡在屏外；②legacy 装（`expertSelectionExplicit` 未置位）时 `getProfileWorkflows` 强勾 ALL_EXPERTS。两条硬证据证 audit 未预勾：用户须"取消全选+全选"才加入（预勾行只需确认即加）；且若 currentState 含 audit，同一 resolver 会让 update 也装它——与症状(a)矛盾。故 (b) 的修复=用回归测试**钉住**已有的忠实性，而非改 checked 逻辑。

## Planner 设计决策

- **D1 冻结选择：surface 不 auto-sync**（守 user-owned 不变量；full/core 已自动同步）。
- **D2 已知-workflow 基线**（推荐）：新增可选 `GlobalConfig.knownBuiltInWorkflows?: string[]`，在持久化选择的各路径（applyProfileState/init/迁移）写入当时内置 workflow ids；update 时 `surface = (catalog内置 − 基线) − desired`，以区分"真新增" vs"故意取消"（否则每次 update 骚扰故意子集）。legacy 缺字段：首 update 静默播种当前 ids、当次不 surface（承袭 expertSelectionExplicit/project-ack 的非回归迁移哲学）。**OQ1 留给 LEAD**：若不愿加 config 字段，退化为对 custom/override 无条件列出所有缺席内置（简单但会重复骚扰）。
- **D3 编辑器可发现性行**：picker 前打印"可用但未选"内置 workflow 一行（编辑器语境列全部未选属预期，不需基线）——直接回应用户"从 picker 看不出缺了啥"。
- **D4** 不改 checked，加回归 scenario/测试钉忠实性。
- **单接缝**：复用 `resolveProjectWorkflowSelection`/`getProfileWorkflows`，不旁路 install/removal/drift。
- 改动面：update.ts（surface note）、profile-editor.ts（发现行+回归）、global-config.ts/profiles.ts（基线）、profile-messages.ts（本地化串）。不 bump 版本。

修改 capabilities: `cli-update`、`profiles`、`global-config`（均 ADDED 增量，无 MODIFIED）。
