# Planning Context — ui-profile-workflow-split

## User intent (verbatim, 2026-07-24)

> 接着做些修改：1. config页面，进入默认显示global 2. 移除config/local的General（profile）tab 3. 在config/local/Project内增加一个Profile的配置（在最上方），这个是用来选择用户创建的Profile 4. 增加一个Profile页面，可以创建/切换/修改Profile，该页面的正文显示内容和当前workflow选择一个space时相同（Enable/disable per space），因此之前是说在workflow选择开启关闭（安装卸载），把它拆成了两个部分，一个是Profile页面创建的Profile用于管理清单，在config的Profile页面用于选择Profile（此时会真正的切换用户选择的Profile来进行安装卸载workflow）。而workflow页面就还是回归到查看，以及new/import/vaildate等功能。之前是我把Profile的职责和workflow的职责搞混在一起了。 5. 创建pipeline的canvas页面还是有问题，当前依旧是滚动条滚动整个页面，而不是仅滚动skills列表，导致单页情况下看不到画布底部的报错，需要进行修改。[截图: E:\Pictures\QQ20260724-101009.png]

### 需求解读（LEAD 整理，planner 需向代码求证细节）

**核心概念重构：Profile 与 Workflow 职责拆分**（用户自述"之前是我把Profile的职责和workflow的职责搞混在一起了"）：
- **Profile = 命名的 workflow 启停清单**（用户可创建多个 Profile 实体）。新增顶层 **Profile 页面**：创建 / 切换 / 修改 Profile。页面正文 = 现在 Workflows 页选中一个 space 后的那套"Enable/disable per space"内容（分区卡片 + Switch），但语义变为**编辑某个 Profile 的清单**（管理清单，不立即安装卸载）。
- **Config 里选择 Profile = 真正切换生效**：在 config/local/Project 区最上方加一个 "Profile" 配置项，下拉选择用户创建的 Profile；选定即触发按该 Profile 清单安装/卸载 workflow（真正的切换动作）。
- **Workflows 页面回归纯查看** + new / import / validate 等功能；移除逐卡片的启停 Switch（上一个 change 刚做的右上角 Switch 在 Workflows 页上退役，其交互模式移植到 Profile 页）。

**Config 页面调整**：
1. 进入 Config 默认显示 **Global**（当前默认 Local）。
2. 移除 config/local 的 **General（profile）tab**（就是现在显示 Installed workflows 那个 General tab）。
3. config/local/**Project** tab 内最上方加 **Profile 选择**配置。

**Canvas 滚动 bug 复修（上一 change 的修复在真实浏览器无效）**：
5. canvas 编辑页仍然是整页滚动条（截图可见右侧全页滚动条），skills 列表撑开页面，画布底部（含报错区）看不到。上一 change 加了 `isPipelineCanvasPath`（packages/ui/src/store/use-space.ts）+ `app-content--canvas` Layout modifier + jsdom 测试（测试过了但真实浏览器没生效）。**必须找真实根因**：可能是 html/body 层没锁高度、`app-content--canvas` 的 flex/height 链条断在某一层（100vh vs min-height、父级没有 height 约束时 overflow 不生效）、或路由判定没盖住实际路径。用户全局装的 UI 0.1.1-dev.local.2 已含上次修复,实测无效——jsdom 断言 class 存在≠布局正确,这次修复需要从 CSS 高度链条逐层论证,并建议实机浏览器验证。

## LEAD 已知代码库事实（沿用上一 change 的 durable findings）

- `packages/ui` 是 **Preact**（preact-iso 路由 + @preact/preset-vite），非 React;canvas 经 preact/compat 跑 @xyflow/react。新原语写纯 Preact。
- 全部样式在单文件 token-only `packages/ui/src/style.css`;新组件只消费 token,两主题+CRT 变体自动继承;禁止硬编码配色。
- 上一 change（ui-design-overhaul,已合并 PR #50）建了组件系统:`src/components/ui/` 下 Switch / PageHeader / ValueDisplay / inline-code;Workflows 页现在是统一卡片+右上角 Switch;Config 页用 ValueDisplay。本次在其上继续,不要推翻。
- canvas 是唯一 viewport-locked 路由,判定 `isPipelineCanvasPath(path)`(store/use-space.ts,segments [p|s]/id/pipelines/<name>);Layout 侧 class `app-content--canvas`。
- UI 测试在 `packages/ui/test/**`(vitest+jsdom),构建门=packages/ui 内 `pnpm run typecheck && pnpm test && pnpm run build`。
- 每 space 的 workflow 覆盖层接缝:`resolveProjectWorkflowSelection`(core 侧,来自 ui-space-workflow-toggle change);全局 profile 经 `rasen profile` CLI 编辑,UI Config 显示 "Installed workflows...Inherited from global"。
- **命名 Profile(多个可切换的清单实体)目前很可能不存在于后端**——现状是单一 user-wide profile + 每 space 覆盖。planner 必须研究 core/HTTP API 现状,设计 Profile 实体的存储(全局配置层)、CRUD+切换端点、与现有 per-space override/resolveProjectWorkflowSelection 的关系(切换 Profile 影响的是 user-wide 基线还是 space 级?用户话术"真正的切换用户选择的Profile来进行安装卸载workflow"指向 user-wide 生效清单)。允许动 CLI/HTTP 层来支撑(这与上一 change 的"纯前端"约束不同)。
- wire-type 镜像纪律:core 侧 wire 类型改动必须同步 packages/ui 侧镜像类型(三件套教训,见 workflows-ui-cleanup)。

## 约束 / 决策

- 保持设计 token 与两套主题不变;继续使用上一 change 的组件系统与视觉规范。
- Profile 页面复用 Workflows 页现有的分区(DRIVER/TASK/EXPERT)+卡片+Switch 交互模式,尽量抽公共组件而非复制。
- Workflows 页保留 new/import/validate 与查看;移除启停交互（职责移交 Profile 页）。
- Canvas 修复必须给出高度链条论证（html→body→#app→Layout→app-content--canvas→canvas 容器逐层有界），不接受"加了 class 测试过了"式修复;新增/调整测试要断言到能防住这次回归的层面（尽 jsdom 所能),并在 tasks 中安排真实浏览器冒烟（可用 rasen-chrome-use/CDP,若环境不可用则记录为手工验证项)。
- 交付前 packages/ui 内 typecheck+test+build 全绿;若动了 CLI/core,根仓 pnpm test 相关子集不回归。
- 版本号不动。

## Durable findings (planner, 2026-07-24)

1. **命名 Profile 后端已完整存在，无需新建实体**：`src/core/named-profiles.ts` 有全套 CRUD/import/export/校验（存储 `<global-config>/profiles/<name>.yaml`，保留名 full/core/custom），CLI `rasen profile new/use/update/list/delete` 是其薄壳；project config 的 `profile` key 即"锁定 profile"（init-profile-lock），`resolveLockedProfileBase` 可解析 saved 名，config-keys registry 的 `enumValuesForScope` 在 project scope 已枚举 saved 名。缺的只是 HTTP 面（GET/POST /api/v1/profiles）+ enablement 端点的 set-profile/clear-profile op。注意语义：`rasen profile use` 是把定义**值拷贝**进 global config（无持久 active-name 指针），而 per-space 锁才是有名指针——Config 选择器走 per-space 锁（design D3 已声明该语义裁决及备选）。`workflows` override 永远 shadow 锁，故 set-profile 必须同笔清掉 override（design D4）。
2. **Canvas 整页滚动真根因（实测钉死）**：`.app-content--canvas` 的 `height: calc(100vh - 60px)` 是死代码——同元素带 `.app-content` 的 `flex: 1`（= flex-basis 0%），而 `.app-shell` 只有 `min-height: 100vh`（indefinite 高度），百分比 basis 无法解析 → flex base size 回落为内容尺寸，且 flex item 的 `height` 属性不约束 flexed 尺寸 → main 长到内容高（实测 1930px），shell 随之长过 min-height 地板，整页滚动、palette 反而不出内滚条（与截图完全一致）。headless Chrome 四变体实测：现行 CSS 滚（2004px vs 790 视口）；`app-shell--canvas{height:100vh}` + content `flex:1;min-height:0`（去 calc）则 shell 恰好=视口、palette 内滚。修复即此链；jsdom 无 layout 是上次假绿的原因，故本次验证三层：jsdom 结构断言 + style.css 字符串 pin（禁 `calc(100vh`）+ 真浏览器量测任务（必做，禁以 jsdom 充数）。复现 harness 在 scratchpad `canvas-repro/`（make-variants.ps1 + chrome --headless=new --dump-dom）。
3. **Local General tab 会自然消失**：General tab 的三组（Profile/Appearance/Behavior）中只有 Profile 组两个 key（profile/workflows）有 project scope，其余全 global-only；因此 Local 模式下从 `tabbedEntries` 排除 Profile 组后，既有"空 tab 不渲染"规则自动移除 General，无需特判 tab。
4. **PR #53（init-profile-lock，d0d7d5c1）核对结论**：planner 全部代码研读本就发生在 #53 合并后的树上，设计即建立其上。#53 对 wire 镜像只加宽了 `mode: 'locked-profile'`（两侧均已同步）——`lockedProfile` 名字字段、set-profile/clear-profile op、`/api/v1/profiles` 端点均仍不存在，本 change 的后端任务不变。#53 自身 change 目录待归档，其 delta specs（profiles/config-key-registry/cli-init/cli-update/config-loading）与本 change 六个能力零重叠，spec 同步无冲突。`profile update` 契约（编辑定义不动 user-wide/项目文件，锁定 space 下次 apply 生效）已并入 profiles-ui spec 与 design D5。
