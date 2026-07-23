<h1 align="center">Rasen — loops that ascend</h1>

<p align="center"><strong>「不是循环，是螺旋」</strong></p>

<p align="center">
  <a href="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="许可证: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://rasen.io/zh/docs/"><img alt="文档" src="https://img.shields.io/badge/docs-rasen.io-4AF626?style=flat-square&labelColor=050505" /></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-9A9A98?style=flat-square" /></a>
  <a href="./README_zh.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-4AF626?style=flat-square&labelColor=050505" /></a>
  <a href="./README_ja.md"><img alt="日本語" src="https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-9A9A98?style=flat-square" /></a>
  <a href="./README_ko.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-9A9A98?style=flat-square" /></a>
</p>

**Rasen** 是一套规范驱动（spec-driven）的开发工作流，并在其之上叠加了一层自动驾驶编排 harness——你写下规范，harness 便驱动 change 走完 propose → apply → archive，自主迭代直到工作完成。

## 不是圆，是螺旋

回到起点的循环只是一个圆。Rasen（螺旋）是一个不断上升的循环的形状。这就是全部理念，而它恰好映射到工具的实际运作方式：

- **规范是原点。** 每个 change 都始于一份写下来的意图——提案、需求、设计、任务清单——在写任何代码之前先落在你的 `rasen/` 工作区里。`/rasen-propose → apply → archive`。
- **循环是形态。** 工作以周期推进，而非一次瀑布式通过。`rasen` 流水线家族——`small-feature`、`bug-fix`、`full-feature`、`auto-decompose`——把一个任务塑造成 propose、implement、review、ship 的循环。
- **每一圈都在上升。** harness 不只是重复，而是持续进步。`/rasen-auto` 拉起一个 LEAD，编排角色隔离的子 agent、一个能纠正自身错误的评审环，以及跨会话携带上下文的 handoff/接力——让每一圈都比上一圈更高。
- **直到突破。** `/rasen-goal` 以条件而非文档来收束螺旋：把某个指标推到目标、把某个模块做到 rubric 洁净、把某个课题研究到 brief 被回答——重复 modify → judge 直到 gate 达成。

规范是你的起点，螺旋是你抵达的方式。

## 血统（Lineage）

Rasen fork 自 [OpenSpec](https://github.com/Fission-AI/OpenSpec)（MIT，Fission-AI 出品），由 [Sayo](https://github.com/DumoeDss) 独立维护。它**与 Fission-AI 无从属关系**。其工作流语义与上游 **OpenSpec v1.5.0** 对齐——`propose → apply → archive` 的 spec/change 模型完全一致——但 rasen 运行在**独立的命名空间**中：`rasen` 二进制、`/rasen-*` 斜杠命令、`rasen-*` 技能，以及 `rasen/` 工作区。rasen 在其之上叠加自动驾驶编排，并且从不改动上游的 `openspec/` 安装。

## 安装

需要 **Node.js `>=20.19.0`**。

```bash
npm i -g @atelierai/rasen
```

然后在你的项目中初始化：

```bash
cd your-project
rasen init
```

`rasen init` 会创建一个 `rasen/` 工作区（specs 与 changes），并为你的 AI 编程工具安装 `/rasen-*` 斜杠命令。

升级后刷新 AI 指导并获取最新斜杠命令：

```bash
rasen update
```

## 与 OpenSpec 共存

Rasen 被设计为可以与上游 OpenSpec **并存**而互不冲突。每一个界面都是独立的命名空间，因此二者可以同时安装在同一个项目里：

| 界面 | OpenSpec | Rasen |
| --- | --- | --- |
| 二进制 | `openspec` | `rasen` |
| 斜杠命令 | `/opsx:*` | `/rasen-*` |
| 技能 | `openspec-*` | `rasen-*` |
| 工作区 | `openspec/` | `rasen/` |

由于命名空间从不重叠，安装 rasen 绝不会干扰已有的 OpenSpec 配置——不需要先卸载任何东西。

如果你已有一个 `openspec/` 工作区并想把它迁入 rasen：

```bash
rasen migrate
```

`rasen migrate` 是**仅复制（copy-only）**的：它把 `openspec/{specs,changes,config.yaml}` 复制进 `rasen/`，跳过任何已存在的目标。你原有的 `openspec/` 目录**永远不会被修改或删除**——你可以继续用 OpenSpec 对它照常工作。

### chrome-use 前置条件

`chrome-use` 专家通过 Chrome DevTools Protocol 驱动你日常使用的 Chrome。使用它你需要：

- 已安装 **Google Chrome**。
- **Node.js 22 或更新版本**（CDP 代理工具链要求）。
- 以远程调试模式启动 Chrome——打开 `chrome://inspect/#remote-debugging`（或用 `--remote-debugging-port` 启动 Chrome）。
- **首次 CDP 连接**时，Chrome 会弹出 **"Allow"** 授权提示——批准它以允许工具挂载。

## 你会得到什么

- **规范驱动的工作流** — 每个 change 是一个文件夹，含提案、specs、设计和任务清单。在写代码之前先就要构建的内容达成共识：`/rasen-propose → /rasen-apply-change → /rasen-archive-change`。
- **`rasen` 流水线家族** — `small-feature` / `bug-fix` / `full-feature` / `auto-decompose` 以数据（YAML）形式提供；用 `rasen pipeline show|list|classify|resume` 查看。新增一种任务类型 = 加一个文件，零代码。
- **`/rasen-auto` 自动驾驶** — 一条命令把 agent 变成 **LEAD**，通过角色隔离的子 agent（planner / implementer / reviewer / fixer / shipper）驱动整条流水线，仅在 gate 处暂停。
- **`/rasen-goal` 目标驱动迭代** — `/rasen-auto` 的姊妹，用于"完成"是一个条件而非文档的任务（把 Lighthouse 推到 90、把模块做到 rubric 洁净、研究并写出 brief）。LEAD 把任务分类到 measure / evaluate / research 后端，并重复 modify → judge 直到 gate 满足或达到轮次上限。
- **Auto-decompose** — 当任务大到无法作为单个可评审 diff 时，拆分为多个可独立交付的子 change，附带依赖 DAG 与保守的串/并行策略。
- **chrome-use** — 一个通过 CDP 驱动你真实 Chrome 的专家：导航、点击、抓包、注入 JS、读 cookie 和 `localStorage`、等待请求——面向需登录的页面、SPA，以及普通 fetch 触及不到的一切。
- **上下文感知与交接** — `rasen agent context` 测量真实占用；`/rasen-handoff` 写一份蒸馏检查点；worker 在软预算下自我交接，一个 compact 恢复 hook 会在 auto-compact 后把会话重新锚定到蒸馏物，让长任务在上下文上限下存活。

## 实际演示

```text
你: /rasen-explore
AI: 你想探索什么？
你: 我想做暗色模式，但不确定怎么干净地实现。
AI: 让我看看你的样式设置……
    最干净的路径：CSS 变量 + 一个小的主题 context，
    加上系统偏好检测。不引入新依赖。要不要定下范围？
你: 好，就这么做。

你: /rasen-propose add-dark-mode
AI: 已创建 rasen/changes/add-dark-mode/
    ✓ proposal.md — 为什么要做、有哪些变更
    ✓ specs/       — 需求和场景
    ✓ design.md    — 技术方案
    ✓ tasks.md     — 实施清单
    准备开始实施！

你: /rasen-apply-change
AI: 正在执行任务...
    ✓ 1.1 添加主题上下文提供者
    ✓ 1.2 创建切换组件
    ✓ 2.1 添加 CSS 变量
    ✓ 2.2 接入 localStorage
    所有任务已完成！

你: /rasen-archive-change
AI: 已归档至 rasen/changes/archive/2026-01-23-add-dark-mode/
    规范已更新。准备好迎接下一个功能。
```

## 遥测与隐私

Rasen 收集匿名使用遥测以了解哪些命令被使用。它**只**发送命令名、rasen 版本、一个匿名 UUID，以及你的操作系统和 Node 版本——**绝不**包含路径、参数或项目数据。

退出方式，设置任一：

```bash
export RASEN_TELEMETRY=0
# 或跨工具标准：
export DO_NOT_TRACK=1
```

在 CI 环境中遥测也会**自动禁用**。

## 许可证

MIT — Copyright (c) 2024 OpenSpec Contributors 及 Copyright (c) 2026 Sayo。见 [LICENSE](./LICENSE)。

问题与反馈：[github.com/DumoeDss/rasen](https://github.com/DumoeDss/rasen)。
