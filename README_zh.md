<h1 align="center">Rasen — loops that ascend</h1>

<p align="center"><strong>「不是循环，是螺旋」</strong></p>

<p align="center">
  <a href="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://rasen.io/zh/docs/"><img alt="文档" src="https://img.shields.io/badge/docs-rasen.io-4AF626?style=flat-square&labelColor=050505" /></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-9A9A98?style=flat-square" /></a>
  <a href="./README_zh.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-4AF626?style=flat-square&labelColor=050505" /></a>
  <a href="./README_ja.md"><img alt="日本語" src="https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-9A9A98?style=flat-square" /></a>
  <a href="./README_ko.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-9A9A98?style=flat-square" /></a>
</p>

**Rasen** 是一套自主引擎——在你的编码智能体的内循环之外，加装一条工程化的**外循环**。你只需提供意图——一个目标、一个 bug、一项功能——引擎便自行走完提出 → 实施 → 评审 → 修复 → 交付 → 归档，独立迭代直至完成。软件开发的自动挡：**掌控想法，而非代码。**

## 不是圆，是螺旋

回到起点的循环只是一个圆。Rasen（螺旋）是一个不断上升的循环的形状。这就是全部理念，而它恰好映射到工具的实际运作方式：

- **意图是起点。** 每一次改动都始于你想要什么，而不是一份你必须写的文档——一个目标、一个 bug、一项功能需求。引擎把它记录进你的 `rasen/` 工作区，随即开始工作：`/rasen-propose → apply → archive`。过程中产出的规格是流水线自身积累的知识、它的工作记忆，而不是丢回给你的作业。
- **循环是形态。** 工作以周期推进，而非一次瀑布式通过。`rasen` 流水线家族——`small-feature`、`bug-fix`、`full-feature`、`auto-decompose`——把一个任务塑造成 propose、implement、review、ship 的循环。
- **每一圈都在上升。** harness 不只是重复，而是持续进步。`/rasen-auto` 拉起一个 LEAD，编排角色隔离的子 agent、一个能纠正自身错误的评审环，以及跨会话携带上下文的 handoff/接力——让每一圈都比上一圈更高。
- **直到突破。** `/rasen-goal` 以条件而非文档来收束螺旋：把某个指标推到目标、把某个模块做到 rubric 洁净、把某个课题研究到 brief 被回答——重复 modify → judge 直到 gate 达成。

意图是你的起点，螺旋是你抵达的方式。

## 实际演示

```text
你: /rasen-auto full-feature 我想加入深色模式，但还不确定怎样实现才足够整洁。
AI: 流程：full-feature（显式指定）
    第一阶段：office-hours。先检验一下这个设计。
AI: 第一个关键分岔：使用一套共享 token 层，还是在各组件里
    重复编写主题逻辑？我建议使用 CSS 变量，能减少偏差。
    选择共享 token 层吗？
你: 是的——使用一套共享 token 层。
AI: 下一个分岔：默认跟随系统主题，并保存用户的手动
    覆盖设置？我建议这样做；行为可预期，也不需要依赖。
    确认这个方向吗？
你: 是的——确认。
AI: 设计已确认，已写入 office-hours 设计文档。
    ✓ office-hours — 方向已确认并记录
    LEAD 通过角色隔离的工作单元继续执行 full-feature 流程。
    ✓ propose — 意图已整理为变更工件
    ✓ apply — 深色模式已实现
    ✓ expert reviews — 代码审查、设计审查和 QA 均已通过
    ✓ review-cycle — 修复一项发现；复审通过
    ✓ ship — 交付已记录
    ✓ retain — 已评估可沉淀的经验
    ✓ archive — 规格已同步
    完成。深色模式已交付。
```

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

## 你会得到什么

- **意图驱动的工作流** — 告诉它要构建什么。引擎会把它变成一个文件夹——提案、规格、设计、任务清单——在工作过程中自行生成并维护，你从不需要亲自动手写：`/rasen-propose → /rasen-apply-change → /rasen-archive-change`。
- **`rasen` 流水线家族** — `small-feature` / `bug-fix` / `full-feature` / `auto-decompose` 以数据（YAML）形式提供；用 `rasen pipeline show|list|classify|resume` 查看，用 `rasen pipeline import|export` 作为可安装包分享，或在 web UI 的流水线画布中拖拽组装你自己的流水线。新增一种任务类型 = 加一个文件，零代码。
- **`rasen ui` 管理平台** — 本地 web UI：任务看板、可脱离终端存活的受监督 headless agent 会话、流水线画布，以及 config/workflow/profile 管理。见 [Web UI](#web-ui)。
- **`/rasen-auto` 自动驾驶** — 一条命令把 agent 变成 **LEAD**，通过角色隔离的子 agent（planner / implementer / reviewer / fixer / shipper）驱动整条流水线，仅在 gate 处暂停。
- **`/rasen-goal` 目标驱动迭代** — `/rasen-auto` 的姊妹，用于"完成"是一个条件而非文档的任务（把 Lighthouse 推到 90、把模块做到 rubric 洁净、研究并写出 brief）。LEAD 把任务分类到 measure / evaluate / research 后端，并重复 modify → judge 直到 gate 满足或达到轮次上限。
- **Auto-decompose** — 当任务大到无法作为单个可评审 diff 时，拆分为多个可独立交付的子 change，附带依赖 DAG 与保守的串/并行策略。
- **chrome-use** — 一个通过 CDP 驱动你真实 Chrome 的专家：导航、点击、抓包、注入 JS、读 cookie 和 `localStorage`、等待请求——面向需登录的页面、SPA，以及普通 fetch 触及不到的一切。
- **上下文感知与交接** — `rasen agent context` 测量真实占用；`/rasen-handoff` 写一份蒸馏检查点；worker 在软预算下自我交接，一个 compact 恢复 hook 会在 auto-compact 后把会话重新锚定到蒸馏物，让长任务在上下文上限下存活。
- **Prompt 缓存保活** — `rasen agent wait` 让空闲 worker 停靠在保活心跳上，而不是任由其 5 分钟 prompt 缓存过期——等待 implementer 的 reviewer 不再在下一轮支付整个上下文的重写成本。心跳长度可通过 `keepalive.beatSeconds` 调节。
- **Token 审计** — `rasen agent audit` 展示一个会话的 token 究竟花在了哪里：按 agent 的开销、缓存 churn 及其成因，附带 HTML 查看器。支持 Claude Code transcript 与 Codex rollout，完全本地——不上传任何数据。

## Web UI

CLI 之外还有一个基于浏览器的管理平台。在 CLI 旁边安装 UI 包,然后启动:

```bash
npm i -g @atelierai/rasen-ui
rasen ui
```

`rasen ui` 会启动(或接管)一个常驻后台 daemon——仅绑定 127.0.0.1,带每会话 token——并打开应用:

- **Board** — 你的活跃 change 以 Task 为单位分布在生命周期列中,通过空间切换器覆盖所有项目与 store。
- **Sessions** — 在浏览器里发起 headless 的 `/rasen-auto` / `/rasen-goal` 运行,查看输出、一键终止;关掉终端它们也继续存活。
- **Pipeline 画布** — 以 DAG 形式查看任意流水线,并通过把技能拖上画布来组装新流水线,保存前有服务端校验。
- **Config / Workflows / Profiles** — 可见继承来源的分层配置、支持按空间启停的可安装 workflow 库,以及命名的 workflow profile。

### 0.1.5 Web UI

**Pipeline Canvas** — 编辑阶段图、验证依赖，并调整角色、运行时、模型与交接设置。

![Rasen 0.1.5 流水线画布](assets/webui/rasen-ui-0.1.5-pipeline-canvas.png)

**Session Audit** — 对比 token 总量与缓存组成，并在时间线上追踪智能体和缓存抖动事件。

![Rasen 0.1.5 会话审计](assets/webui/rasen-ui-0.1.5-session-audit.png)

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

## 遥测与隐私

Rasen 收集匿名使用遥测以了解哪些命令被使用。它**只**发送命令名、rasen 版本、一个匿名 UUID，以及你的操作系统和 Node 版本——**绝不**包含路径、参数或项目数据。

退出方式，设置任一：

```bash
export RASEN_TELEMETRY=0
# 或跨工具标准：
export DO_NOT_TRACK=1
```

在 CI 环境中遥测也会**自动禁用**。

## 社群

<p>
  <a href="https://discord.gg/JbWScy4y9K">
    <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="加入 Rasen Discord">
  </a>
</p>

- **QQ 群：** [1087505735](https://qm.qq.com/q/B663fvfMc0)
- **LINUX DO：** [linux.do](https://linux.do)
