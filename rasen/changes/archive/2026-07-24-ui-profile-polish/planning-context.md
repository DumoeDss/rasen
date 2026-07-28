# Planning Context — ui-profile-polish

## User intent (verbatim, 2026-07-24)

> 一些bug进行修复并且增加一些优化：1. 切换workflows和profiles页面时，board会显示高亮 2. config的global的profile只会显示full core custom，在profiles创建的profile只会在config的local中显示，而且没有custom。3. config的local的profile这里选择之后，还需要有个update按钮，用于更新当前的skills，现在是切换之后自动更新，可以显示加一个按钮，并且用户如果切换了profile，没有update会有文本提醒，如果切换tab会有弹窗提醒，并且更新的时候，现在会弹个cmd的窗（一闪而过），把这个窗给隐藏掉。4. 这是个优化，在profiles页面，用户自定义profile时，如果开关上层的workflow，应该能够自动关联下层的workflow，比如当我选择开启rasen-auto时，所有强依赖的workflow都应该自动开启（关闭就不用关联了，让用户手动去处理），而弱关联的专家workflow就可以提示是属于某个workflow的增强功能（如果某个专家workflow是强关联的也就进行关联打开）。另外就是再增加一个全选/反选的按钮，能够快捷打开全部。

### 需求解读（LEAD 整理，planner 向代码求证并在 design 里裁决）

1. **导航高亮 bug**：进入 Workflows 或 Profiles 页时，顶部导航的 Board tab 也显示高亮。查 Layout 导航 active 判定（很可能是 startsWith/fallback 判定把非 space 路由归给了 Board，Profiles 是 space-agnostic 路由 `/profiles`，Workflows 可能同类）。修为每页只亮自己。
2. **Profile 下拉两侧不一致**：
   - Config **Global** 的 profile 选择只显示保留名 full/core/custom — 用户创建的命名 profile 不在列。期望：Global 也能选用户创建的 profile（后端 `enumValuesForScope` 在 #53 只对 project scope 枚举 saved 名，global scope 未枚举 — 查 `src/core/config-keys.ts`）。
   - Config **Local** 的 profile 选择只有 saved 名，没有 custom 这类选项。planner 须裁决 Local 侧语义：per-space 锁的合法值域是什么（#53: `custom` 锁会告警回退 user-wide — 那 Local 下拉是否应提供"清除锁/继承"以外的 custom 项？还是补 full/core?）。目标是两侧值域观感一致、语义诚实,在 design 里写清楚裁决理由。
3. **Local profile 切换改为显式 Update**：
   - 现状：SpaceProfileSelector 选中即触发 set-profile（立即安装/卸载）。改为：选择只改 UI 草稿,新增 **Update 按钮** 才真正执行；
   - 未点 Update 时显示文本提醒（未应用的 profile 变更）；
   - 带着未应用变更**切换 tab**（Global/Local、General/Project,以及离开 Config 页）时弹窗提醒（确认丢弃/留下）；
   - **cmd 窗一闪而过**：执行更新时 Windows 弹出控制台窗口。这是后端 spawn 子进程未加 `windowsHide: true`（查 workflow-enablement 的 bounded update apply / spawn 调用链,`src/core/` 里所有 spawn/spawnSync 落点）。修掉（windowsHide 或等效）。注意可能不止一处（update/install 相关 spawn 全查）。
4. **Profiles 页依赖级联（优化）**：
   - 开启一个上层 workflow（如 rasen-auto）时，其**强依赖**的 workflow 自动级联开启；**关闭不级联**（用户手动处理）；
   - **弱关联**的专家 workflow（review/cso/benchmark/qa/design-review 等,被 pipeline 的 verify/expert 阶段引用的那类）：UI 提示"是某 workflow 的增强功能"；若某专家是强依赖则照样自动开启；
   - 已知后端事实（上一 change durable finding）：built-in workflow 的 `requires.workflows` **全空** — 依赖藏在 skill/pipeline 层（workflow 带 skills+pipelines,pipeline 的 stage 引用 skill,skill 属于别的 workflow）。强/弱的判定要从这些既有数据推导：**强依赖** ≈ 该 workflow 的 pipeline 各 stage 的 skill 所属的 workflow（缺了 pipeline 就跑不动）;**弱关联** ≈ pipeline 中带 condition 的专家 stage / parallelGroup 成员的 skill 所属 workflow（缺了会跳过或降级）。planner 研究 `named-profiles.ts`/`resolveWorkflowSelection`/pipeline registry 现有 closure 能力,决定在哪一层算这个图（倾向后端算好经 HTTP 给 UI,如 GET /api/v1/profiles 的响应或独立端点附 per-workflow `requiresWorkflows`/`enhances` 元数据）,避免 UI 复制解析逻辑。
   - **全选/反选按钮**：Profiles 页成员编辑器加快捷全开/全关（反选=invert 还是全关？用户话术"全选/反选…快捷打开全部"——做成 全选 + 反选 两个动作,或全选/全不选;planner 按最实用裁决并说明）。

## LEAD 已知代码库事实（沿用前两个 change 的 durable findings）

- `packages/ui` = Preact（preact-iso;canvas 走 preact/compat）;样式单文件 token-only `src/style.css`;组件系统 `src/components/ui/`（Switch/PageHeader/ValueDisplay/inline-code）+ `components/workflow-cards.tsx` 共享卡片（ProfilesPage 与 WorkflowsPage 共用,含 ToggleContext）。
- ProfilesPage：draft+stored+justSaved 就地补丁模式(save 后 profilesData map-on-name 更新,seed effect 按 membership 键,name 键清 note);Config SpaceProfileSelector：resolve root → 读 enablement(mode+lockedProfile) → set-profile/clear-profile,单飞+override 确认。
- 后端：`src/core/named-profiles.ts` 全套 CRUD;`/api/v1/profiles` in-process HTTP 面;enablement `set-profile` 用 `updateProjectConfigKeys` 原子批量写(锁+清 override 一笔);`mode: 'profile'|'override'|'locked-profile'` wire 镜像双侧已同步(勿重复添加)。
- wire-type 镜像纪律:core wire 类型改动必须镜像 `packages/ui/src/api/types.ts`。
- UI 测试 `packages/ui/test/**`(vitest+jsdom,jsdom 无 layout);构建门=packages/ui 内 typecheck+test+build;UI 不是 workspace 成员,worktree 里要单独 `pnpm install`(root 也要)。
- `updateProjectConfigKey` 单 key RMW;多 key 用 `updateProjectConfigKeys`。
- supervisor.test.ts 并行负载下会 flake — 先隔离重跑再归因。
- ConfigPage 现默认 Global;Local 无 General tab;Project tab 顶部是 SpaceProfileSelector(上一 change 所建,本次在其上改造,不推翻)。

## 约束 / 决策

- 实施在 worktree `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-polish-wt`（分支 feat/ui-profile-polish,基于 origin/dev/0.1.5@bf07dc22,交付=PR）。change 工件由 LEAD 拷入 worktree。
- 保持 token/主题/组件系统;新交互复用现有组件（按钮层级、Switch、确认弹窗模式沿用现有 dialog 约定）。
- item 3 的"切换 tab 弹窗"覆盖:Config 页内 tab 切换 + 离开 Config 路由;实现走现有 dialog 约定,不引新依赖。
- item 4 依赖图的强/弱判定逻辑放后端（core）一处,UI 只消费;判定规则在 design 里成文（含边界:自引用、环、未安装 workflow 的依赖缺失如何显示）。
- cmd 闪窗修复:排查范围是执行 set-profile/update apply 时后端的全部 spawn 落点,Windows `windowsHide: true`(或等效)全部补齐;若有测试可断言 spawn options 则加。
- 门禁:packages/ui typecheck+test+build 全绿;root 相关子集(management-api/completions/config keys/named-profiles/spawn 相关)不回归;版本号不动。

## Durable findings (planner, 2026-07-24)

1. **Global 侧 saved profile 是三层断路,不只是枚举问题**:`getProfileWorkflows`(src/core/profiles.ts:102)对任何非 full/core/custom 值静默按 `full` 处理(全局 profile 写 saved 名今天是合法写入+错误解析);且 `config-api/serialize.ts:31,63` 只上送静态 `enumValues`,`resolveEnumValues(definition, scope)` 从未到达 wire。修复须三层齐动:registry 枚举(config-keys.ts enumValuesForScope global 分支)+ 核心解析 seam(新 `resolveUserWideProfileBase`,镜像 resolveLockedProfileBase 的 unresolvable→full+warning 形状)+ wire 每 scope 枚举域(新可选字段 `enumValuesByScope`)。直连消费点只有 workflow-enablement.ts:124/:335 两处绕过 resolveDesiredWorkflowSelection。
2. **现有安装闭包不覆盖 pipeline stage skills**:`resolveWorkflowSelection`(includeSkillDependencies)只走 requires.workflows+requires.skills;auto-command 的 requires.pipelines(small-feature 等)stage 引用的 rasen-ship/rasen-review-cycle/rasen-archive-change 等技能所属 workflow 不会被闭包拉入——这正是级联需求的病根。强/弱判定:无 condition 或 condition:'always' 的 stage=强(parallelGroup 不减弱,full-feature 的 review 即强);condition≠always=弱。skill→workflow 映射用 selection.ts 既有的 portablePathCollisionKey 双身份 map。服务端算传递闭包,UI 零图算法。
3. **spawn 清单与例外**:全 src/ 仅 store/git.ts:24 已设 windowsHide:true(现成先例);cmd 闪窗主犯=workflow-enablement.ts:365 runUpdate;唯一交互式例外=commands/config.ts:835 $EDITOR spawn(不得隐藏)。另发现 config-key-registry spec 陈句仍称 profile global-only,与 #53 后代码(scopes: ['global','project'])矛盾——本 change delta 已顺手修正。
