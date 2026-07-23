# Planning Context — ui-design-overhaul

## User intent (verbatim, 2026-07-24)

> 当前已经实现了web的很多功能，但是整个web的设计只能说是一坨大便。本身我们当前的设计token（配色/字体）是没有问题的（一套claude风格，一套我们官网风格），但是所有地方看着都是这里需要一个按钮就随意放了一个按钮。彻底修复所有的网页设计问题，修改为美观大方实用的现代化网站。并且修复所有提到的问题。

### 逐项问题清单（用户列举，编号保留）

1. **Board 页 worktree 徽章**：worktree 徽章（OpenSpec-code / goal-gate-hardening / OpenSpec-portfolio-wt / wt-pr38-check）大大小小随意摆放在 Board 顶部，缺乏布局设计。截图: `E:\Pictures\QQ20260724-013848.png`
2. **Archived change 详情页**：archived change（如 codex-audit-enrichment）详情只是把 tasks todo 原样倾倒成一长列 markdown；右侧 "Launch run" 和 "Refresh" 两个按钮挤在一起。截图: `E:\Pictures\QQ20260724-013949.png`
3. **Config 页**：Profile / Installed workflows 一坨原始 JSON 数组直接铺在页面上（["propose","explore",...]），"Inherited from global" 又重复一遍同样的 JSON。完全没有可读性。截图: `E:\Pictures\QQ20260724-014106.png`
4. **Pipelines 页配置项**：auto-decompose 等 pipeline 卡片把 RUNTIMES 5 个下拉 + 每个 stage 的 GATE/MODEL/HANDOFF（Fraction/Remaining tokens radio + 数值输入）全部平铺在列表页上，信息过载。用户问"只能把这些配置铺脸上吗"→ 应该收进详情/按需展开。截图: `E:\Pictures\QQ20260724-014208.png`
5. **New pipeline 与 Assemble in canvas 应合并**：除了导入（import）之外，新建 pipeline 用 canvas 就够了，不需要两个入口。
6. **Workflows 页**：卡片大小不一（内容撑开），按钮 "Disable here" 紧贴文字（"Enabled in this space" 和按钮挤在一行）。用户明确要求：**启停做成卡片右上角一个简单 switch 开关**，卡片统一尺寸。截图: `E:\Pictures\QQ20260724-014424.png`
7. **Canvas 页面布局**：canvas 编辑页必须单页显示（viewport 内）：skill 列表侧栏自身滚动，canvas 区域缩放平移，**整个页面不允许随 skill 列表长度滚动**（现在页面跟着列表滚，滚下去 canvas 就看不见了）。
8. **Validate/Save 行为**：Validate 按钮点了没有任何反馈（不弹错误信息也不弹成功）；点 Save 却报 "Fix the blocking issues before saving." 但不知道错在哪。需要：validate 有可见结果反馈，save 被阻止时把具体 blocking issues 展示出来（最好定位到节点）。
9. **Canvas 控件**：左下角三个 React Flow 控件按钮不 hover 看不到 icon（icon 颜色与背景对比度问题，白底白/深底深）；右下角 React Flow attribution（logo/水印）要求移除。截图: `E:\Pictures\QQ20260724-014844.png`

## LEAD 已知代码库事实

- Web UI 位于 `packages/ui/`（React + Vite）。**packages/ui 不是 pnpm workspace 成员** — 独立 `package.json`，需在该目录单独 install/build（见既往 npm-pack 经验）。
- Canvas 编辑器基于 `@xyflow/react`（React Flow），选型经 office-hours 调研拍板（React Flow + preact/compat 实测全绿）。demo 参考：`rasen/office-hours/canvas-demos/`。
- 既往 UI 信息架构设计文档：`rasen/office-hours/ui-config-and-library-redesign.md`（config/库信息架构已按此做过一轮：store 层级/4 tab/Spaces/Workflows/Pipelines 页）。本次是**视觉/交互层面的整体打磨**，不是再次推翻信息架构。
- 设计 token（两套主题：claude 风格 + 官网风格，配色/字体）**用户明确认可，不许推翻**。问题在布局、组件一致性、间距、层次、按钮摆放这些"组合层"。
- React Flow attribution 移除：`proOptions={{ hideAttribution: true }}`（xyflow MIT 许可，技术上允许）。
- UI 由 CLI serve（管理 UI），HTTP API 在 CLI 侧提供;validate/save 的错误信息很可能 API 已返回但前端没有呈现 — 先查前端处理，再考虑 API 是否需要补充结构化错误。

## 约束 / 决策

- 范围：`packages/ui/` 前端为主；仅当 validate/save 错误信息在 API 侧确实缺失时才允许小幅动 CLI HTTP 层。
- 保持现有设计 token 与两套主题；建立统一的组件规范（按钮层级、卡片尺寸、间距系统、switch 组件）并全站套用，消灭"随手放按钮"。
- 9 项问题全部要修，并做全站视觉一致性 pass（不只是修列举的 9 处）。
- 交付前需 `packages/ui` 内构建通过；CLI 侧测试不回归。
- 用户看重：美观大方、实用、现代化；细节质量（对齐、间距、对比度、hover 状态）。

## PLANNER 补充事实（propose 阶段调研所得，2026-07-24）

- packages/ui 是 **Preact**（preact + preact-iso + @preact/preset-vite），不是 React；canvas 经 preact/compat 别名跑 @xyflow/react。新组件写纯 Preact 即可，只有 canvas 文件涉及 compat。
- 全部样式在单文件 `packages/ui/src/style.css`（BEM，单 class 选择器，只消费 token）；两主题 = `prefers-color-scheme` + `data-theme`，另有 opt-in CRT 变体 `data-theme-variant="crt"`。
- **latent CSS bug**：`var(--radius-md)` 与 `var(--warning-fg, #b45309)` 被 canvas 编辑器规则引用但 token 从未定义（应为 `--radius`/`--warn-fg`）；`.board-page__toolbar button:first-of-type` 是伪 primary 的脆弱结构选择器。
- 问题 8 根因纯前端：`handleValidate` 已拿到结构化 `PipelineValidationIssue[]`，但 0 issues 时什么都不渲染（IssuesDrawer 对空列表 return null），且 drawer 渲染在可滚动页面最底部（视口外）。**无需动 CLI/HTTP API**。
- 问题 9：`<ReactFlow>` 未设 `proOptions={{ hideAttribution: true }}`；RF 自带 Controls CSS 白底，暗色主题下 icon 不可见 — 用 token 覆盖 `.react-flow__controls-button` 即可。
- Workflows 启停已有 `data-testid="workflow-enablement-toggle"`；switch 化时保留该 testid 可少改测试。
- pipelines-ui 主 spec 场景 "Stage graph with effective values" 与折叠冲突 → 本 change 用 MODIFIED delta 改写该 requirement；init 对话框移除也走 MODIFIED（CLI `rasen pipeline init` 不动）。
- UI 测试在 `packages/ui/test/**`（vitest + jsdom），构建门 = 在 packages/ui 内 `pnpm run typecheck && pnpm test && pnpm run build`。
- rasen/changes/pipeline-canvas-view|edit 目录只剩空壳 .openspec.yaml（正身已随 pipeline-online-assembly 归档），canvas 需求已在主 specs/pipelines-ui。
