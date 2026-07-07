# grill 与 gstack 融入 OpenSpec 的现状

> 截止 2026-07-07，记录 `unify-expert-template-pipeline` 归档后的真实落地形态。
> 本文是「现状快照 + 来龙去脉」，不是变更日志。变更日志看 `openspec/changes/archive/` 各 change 的 retro。
> 配套阅读：`docs/opsx-workflow-guide.md`（命令总览）、`docs/review-cycle-workflow-design.md`（评审循环设计）、`skills/experts/docs/`（专家技能架构）。

## 0. 一句话现状

OPSX（OpenSpec 的融合工作流层）已经把 **grill**（Matt Pocock 的技能集，MIT）和 **gstack**（一套平行的方法论/工具层）**消化吸收为单一体系**：19 个专家技能以 TypeScript 模板为唯一源、统一 `openspec` 命名、由 OPSX 工作流命令编排。原 grill / gstack 的入口、工具链、品牌都已退出，只剩吸收后的能力留在 OpenSpec 里。

需要注意一个分寸：**「技能身份层」（用户怎么调、叫什么名、装在哪）已 100% 去 gstack 化；「内部代码层」（运行时路径、文件格式标记、vendored 工具）仍保留若干 gstack 字符串**——其中一部分是改了就会改变行为的（故不动），一部分是历史性注释（可清不清）。第 5 节有诚实清单。

## 1. 背景：这三个词分别是什么

| 名词 | 本质 | 在本仓库的角色 |
|---|---|---|
| **OpenSpec** | 规格驱动开发的核心：`propose → apply → archive` + CLI + change/spec 产物体系 | 主体/宿主 |
| **OPSX** | OpenSpec 之上的「融合工作流层」：`/opsx:auto` 编排器、流水线注册表、ship/verify-enhanced/office-hours/retro 等命令、LEAD+worker 编排模型 | 吸收 grill/gstack 后长出的工作流层 |
| **grill** | Matt Pocock 的技能集（MIT 授权）：代码评审、grilling 访谈纪律、bug 诊断、路由、方法论设计原语 | 能力来源——被「吸收」进专家技能与工作流命令 |
| **gstack** | 一套平行的方法论 + 工具层（专家技能、ship/retro、browse 浏览器工具、编排） | 工具来源——被「收编」进 OPSX，自身作为独立系统退出 |

一句话：grill 提供「方法与纪律」，gstack 提供「专家与工具」，两者都被 OPSX 消化，最终只剩 OpenSpec 一个体系。

## 2. 融合时间线（按归档顺序）

每一步都是一个已归档的 OpenSpec change，commits 在各 change 的 retro 里。

1. **`gstack-skills-integration`** —— 把 gstack 专家技能初次接入 OpenSpec（模板源 + sidecar + 注册 + `openspec init` 安装）。
2. **`add-grill-expert-skills`** —— 引入 grill 的方法论专家（`codebase-design` / `tdd` / `prototype`，MIT），填补「方法级设计原语」缺口。
3. **`review-two-axis-absorption`** —— grill `code-review` 并入 P0 `review`，做成双轴（Standards + Spec）并行评审。
4. **`office-hours-grilling-absorption`** —— grill `grilling` 访谈纪律并入 `office-hours`（一次只问一个问题、给推荐答案、能在代码里查到的就别问）。
5. **`investigate-diagnosing-absorption`** —— grill `diagnosing-bugs` 并入 `investigate`（先建「能复红」的反馈环，再谈假设）。
6. **`navigator-router-skill`** —— grill `ask-matt` 演化为 `navigator` 路由技能，画出 OPSX 主流程 + 专家地图。
7. **一批 `remove-*` / 清理 change**（`remove-gstack-features`、`remove-conductor-config`、`remove-gstack-upgrade-skill`、`remove-setup-browser-cookies-skill`、`dead-stub-removal`、`eureka-telemetry-removal`、`preamble-migration`、`browse-skill-ethos-cleanup`、`legacy-cleanup` 等）—— 逐项移除不再需要的 gstack 特性/telemetry/桩代码。
8. **`remove-parallel-lifecycle-skills`** —— 删除 10 个平行生命周期专家（`/autoplan`、`/plan-*-review`、`/canary`、`/document-release`、`/setup-deploy` 等），并把 `ship`/`retro` 契约吸收进 `/opsx:ship`、`/opsx:retro` 自包含工作流。专家名册 30→20。
9. **`fuse-methodology-into-opsx`** —— grill 四个教学级方法论接入 `propose`/`apply`/`explore`；修 `schema.yaml` 的 `enhance` 钩子现行 bug；清理主 spec 陈旧示例。
10. **`reconcile-fusion-seams`** —— 融合矩阵审查发现的三处缝修复 + **整体移除 `domain-modeling` 专家**（其 CONTEXT.md/ADR 工作方式与 change 目录流结构性冲突），名册 20→19。
11. **`ship-delivery-modes`** —— 重构 ship 契约（见 §4.3）：原样收编自 gstack `/ship` 的「盲 merge main + 无条件全量测试」被改为三交付模式 + 证据门。
12. **`unify-expert-template-pipeline`** —— 把 19 个专家源从 `.tmpl` 内联为 TS 模板、删 `bun/gen-skill-docs/skill-check` 工具链、新鲜度门禁统一到 parity 哈希、**去除 gstack 品牌**（dirName `openspec-<name>`、skill id `openspec:<name>`、源目录 `skills/experts/`）。

## 3. 当前架构（融合后的落地形态）

### 3.1 三层结构

```
┌─────────────────────────────────────────────────────────────┐
│  上层：专家技能（19 个 openspec:<name>，按需调用）            │
│  review / cso / benchmark / qa / design-review / ...         │
│  + 方法论三件：codebase-design / tdd / prototype             │
├─────────────────────────────────────────────────────────────┤
│  中层：OPSX 工作流命令（/opsx:*）                            │
│  explore → propose → apply → verify/review-cycle             │
│  → ship → archive → retro    驱动器：/opsx:auto             │
├─────────────────────────────────────────────────────────────┤
│  底层：openspec CLI（确定性的状态读写/校验/归档基座）         │
│  propose/apply/archive + pipeline/validate/status/...        │
└─────────────────────────────────────────────────────────────┘
```

- **底层 CLI** 是规格驱动开发的核心，所有 slash 命令最终都落到它身上。
- **中层 OPSX** 把零散的 CLI 串成有门禁、有循环、有编排的工作流，并提供 LEAD+worker 多代理编排。
- **上层专家** 是「能力插件」——独立技能，被工作流命令在合适时机条件式引用，也可被用户直接 `/review` 这样调用。

### 3.2 19 个专家技能清单与分类

源在 `src/core/templates/experts/<name>.ts`（每个一个 getter），sidecar 在 `skills/experts/<name>/`，注册名 `openspec:<name>`、安装目录 `openspec-<name>`。

**评审/验证家（full-feature 流水线 `review` 阶段的并行专家组，按 condition 触发）**
- `review` —— 双轴评审（Standards + Spec），始终触发。grill `code-review` 吸收而来。
- `cso` —— 安全审计（condition: security-relevant）。
- `benchmark` —— 性能基线（condition: performance-sensitive）。
- `qa` —— 真实浏览器找 bug 并修（condition: ui）。
- `qa-only` —— ��� qa 但只报告不改（condition: non-ui）。
- `design-review` —— 渲染 UI 的设计审计 + 修复循环（condition: ui）。
- `design-consultation` —— 从零构建完整设计系统（独立专家，不在流水线）。

**方法论三件（grill MIT，条件式被工作流引用，不强制）**
- `codebase-design` —— 深模块设计词汇（module/interface/depth/seam/adapter/leverage/locality）。`propose` 对设计密集型 change 引用。
- `tdd` —— 一个值得留下的测试，红→绿。`apply` 对测试先行工作引用。
- `prototype` —— 一次性探针回答一个设计问题，留答案删代码。`explore` 对「卡住、只有动手才说得清」的设计问题引用。

**调试/诊断**
- `investigate` —— 系统化根因调试，铁律「先建能复红的反馈环再谈假设」。grill `diagnosing-bugs` 吸收而来。

**浏览器工具 / 第二意见 / 路由 / 访谈**
- `browse` —— 无头浏览器（真实 Chromium，真实点击）。vendored 工具（见 §5）。
- `codex` —— 把任务交给 Codex 做独立第二意见或并行实现。
- `navigator` —— 路由技能，画出本仓库技能地图（grill `ask-matt` 演化）。
- `office-hours` —— YC 式需求验证，Startup 模式（六问）+ Builder 模式（设计头脑风暴）。grill `grilling` 访谈纪律吸收。

**编辑安全家**
- `careful` —— 破坏性命令前警告（rm -rf / DROP TABLE / force-push）。`apply` 引用。
- `guard` —— careful + freeze 一起开。
- `freeze` —— 硬锁编辑到一个目录。
- `unfreeze` —— 解除目录锁。

> 名册从早期的 30（含平行生命周期专家）→ 20（移除平行生命周期）→ **19**（移除 domain-modeling）。当前稳定在 19。

### 3.3 grill 的去留

| grill 技能 | 去向 |
|---|---|
| `code-review` | → `review`（双轴 Standards+Spec） |
| `grilling`（访谈纪律） | → `office-hours` 的访谈 phase |
| `diagnosing-bugs` | → `investigate`（反馈环优先） |
| `ask-matt`（路由） | → `navigator` |
| `codebase-design` / `tdd` / `prototype`（方法论） | → 独立专家技能 + 条件式接入 propose/apply/explore |
| `/to-prd`、`/to-issues`、`/implement`、`/triage`、`/improve-codebase-architecture`、`/research`、`/teach`、`/grill-me`、`/grill-with-docs`、`/setup-matt-pocock-skills` | **未引入**（本 fork 不需要） |

grill 的 MIT 归属在每个吸收它的技能源文件头部保留（如 `review.ts`、`navigator.ts`、`codebase-design.ts` 等的 `<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->`）。

### 3.4 gstack 的去留

| gstack 能力 | 去向 |
|---|---|
| 专家技能层（review/cso/qa/browse/...） | → 19 专家（去 gstack 品牌） |
| `/ship` + `/land-and-deploy` | → `/opsx:ship`（land-and-deploy 变为 `--deploy`） |
| `/retro` | → `/opsx:retro` |
| browse 浏览器工具 | → `browse` 专家（vendored，内部仍带 gstack 命名，见 §5） |
| 编排模型 | → OPSX LEAD+worker 编排 playbook |
| `/autoplan`、`/plan-*-review`、`/canary`、`/document-release`、`/setup-deploy`、`/setup-browser-cookies`、conductor 配置、upgrade skill、telemetry | **已删除** |

主轴确立：**OPSX 工作流消费纯专家层；gstack 作为独立系统不再存在。**

### 3.5 方法论专家的接线方式（条件式引用，不内联）

grill 方法论三件（`codebase-design`/`tdd`/`prototype`）**不**把专家体塞进工作流指令，而是用一两句「条件式引用」告诉 agent 何时去调那个独立技能，并把产物落进 change 目录（而非技能自有路径）。落点：

- `propose.ts` ——「设计密集型 change（新模块/非平凡接口）→ 先咨询 `/codebase-design`，把接口/设计决策记进 `design.md` 的 Decisions。」
- `apply-change.ts` ——「测试先行的工作 → 咨询 `/tdd`；触碰破坏性操作 → 咨询 `/careful`。」
- `explore.ts` ——「设计问题卡住、只有动手才说得清 → 用 `/prototype` 探针，留答案删代码。」

这种「引用而非内联」是为了保持 explore/propose/apply 的「抓取/规划/实现」本职不被方法论文本稀释。`schema.yaml` 不再携带任何 `enhance` 钩子（机制保留休眠、当前无使用方）。

### 3.6 编排模型（LEAD + 角色隔离 worker）

`/opsx:auto` 是驱动器：LEAD（编排者，不亲自动手写产物）按流水线 DAG 把每个 stage 派给一个**角色隔离的叶 worker**（planner/implementer/reviewer/fixer/shipper），worker 调用该 stage 对应的 OPSX 技能。关键不变量：

- **author ≠ verifier**：评审者不能是作者；修复必须由非作者复核。
- **change 目录是黑板**：stage 间通过 `openspec/changes/<name>/` 的产物交接（proposal/design/tasks/specs/review-report/ship-log），不靠共享���存。
- **门禁**：gate stage 暂停等人工；review-loop 有界（默认 3 轮），到顶仍有 Blocker/Major 不悄悄判过，走 LEAD 升级阶梯。
- **Tier A/B/C**：有 agent-teams（Tier A）可用 `SendMessage` 温续；只能 spawn 不能温续（Tier B）；单上下文降级（Tier C）。pipeline 定义三层一致，只是机制不同。

## 4. 源码、构建、命名

### 4.1 专家技能的单一源

`src/core/templates/experts/<name>.ts` 是专家技能的**唯一权威源**——每个 getter 返回一个 `SkillTemplate`，指令体是 TS 模板字符串。共享块（PREAMBLE、BROWSE_SETUP、SPEC_REVIEW_LOOP 等 14 个）抽到 `src/core/templates/experts/_shared.ts` 常量。`openspec init`/`update` 从这些模板生成安装侧的 `SKILL.md` + sidecar。

> 这是 `unify-expert-template-pipeline` 的核心成果：此前源是 `skills/gstack/<name>/SKILL.md.tmpl`，由 bun + `gen-skill-docs` 生成。现已统一为 TS 模板 + parity 哈希门禁，工具链删除。

### 4.2 命名规则（去 gstack 后）

| 维度 | 旧 | 新 |
|---|---|---|
| 技能调用 id | `gstack:<name>` | `openspec:<name>` |
| 安装目录名 | `openspec-gstack-<name>` | `openspec-<name>` |
| 源目录 | `skills/gstack/` | `skills/experts/`（仅 sidecar） |
| 工作流命令 | `/ship`、`/retro` | `/opsx:ship`、`/opsx:retro` |

`openspec-` 前缀的工作流技能（explore/propose/apply/...）与 `openspec-` 前缀的专家技能现在共处同一命名空间、无歧义（`openspec-review` 专家 vs `openspec-review-cycle` 工作流，名字不同）。

### 4.3 新鲜度门禁：parity golden-master

`test/core/templates/skill-templates-parity.test.ts` 用两组哈希钉死模板内容：`EXPECTED_FUNCTION_HASHES`（每个 getter 的结构哈希）和 `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`（生成内容哈希）。改了模板必须同步重算哈希，否则测试红——这就是「新鲜度门禁」，取代了旧的 gen-skill-docs 一致性检查。19 个专家现已全部纳入。

### 4.4 ship 契约（去 gstack 假设后的重构）

gstack `/ship` 假设「feature 分支从 main 分叉、PR 回 main」，所以无条件 merge base + 全量测试。这在直推工作分支、decompose 子任务共享工作树等场景下是**正确性错误**。`ship-delivery-modes` 重构后：

- **三交付模式**：`pr`（开 PR）/ `push`（直推当前分支）/ `local`（仅 commit，decompose 子任务用）。解析顺序：显式参数 > 现存 PR > 仓库惯例 > 询问用户，**绝不默认 repo 默认分支**。
- **commit 是 ship 的一等步骤**（hook 失败修复重试，绝不 `--no-verify`）。
- **测试改证据门**：有绿色测试证据（review/verify 报告记录的通过测试所对应的代码未变）就跳过，否则才跑。
- **decompose 子任务链全部完成后**，才在组合层做一次统一 push/PR。

## 5. 残留的 gstack 字符串（诚实清单）

去品牌针对的是**技能身份层**。内部代码层仍有 gstack 字符串，按性质分三类——**它们大多是「改了就改变行为」或「历史记录」，刻意保留**：

### 5.1 故意保留（功能性）

- **孤儿清理前缀常量**：`src/core/legacy-cleanup.ts` 的 `RETIRED_EXPERT_SKILL_PREFIX = 'openspec-gstack-'`。`init`/`update` 用它精确匹配并删除改名遗留的旧安装目录（`openspec-gstack-*`），带 near-miss 测试防止误伤 `openspec-*`。改了它，孤儿就清不掉。
- **freeze 家族的运行时状态目录**：`freeze`/`guard`/`investigate`/`unfreeze` 把锁状态写在 `${CLAUDE_PLUGIN_DATA:-$HOME/.gstack}`。改路径会让用户机器上已有的 freeze 锁失效。属运行时状态目录，不在去品牌范围。
- **review 引擎的文件格式标记**：`_shared.ts` 里 `## GSTACK REVIEW REPORT` 是评审报告写进 plan 文件的固定 section 名（稳定字符串标识）。改名是文件格式变更。
- **design-sketch 临时文件前缀**：`_shared.ts` 的 `/tmp/gstack-sketch-*.html/png`。纯 temp 命名，下游技能按这个路径引用截图。

### 5.2 vendored 工具的内部命名

- **`browse`** 是一个 vendored 的无头浏览器工具（真实 Chromium，自带 `src/`、`test/`、`scripts/build-node-server.sh`）。它原本是 gstack 的工具，整个工具树作为黑盒并入 `skills/experts/browse/`，内部文件（`gstack-config.test.ts`、`gstack-update-check.test.ts` 等）保留其原始命名。去品牌只动技能模板层，不重写 vendored 工具的源码。

### 5.3 历史性注释/prose（可清不清）

- `skill-generation.ts:48`、`skill-templates.ts:31` 的 `// from gstack` / `// migrated from gstack` 注释——溯源说明，无害。
- `guard.ts:12`「by the gstack setup script」、`verify-enhanced.ts:5`「with gstack expert reviews」——过时注释。
- `retro.ts:80`「Do NOT persist gstack-style `.context/retros/*.json`」——这是在告诉 agent **别做**旧的 gstack 行为，"gstack-style" 是对旧行为的描述，留着合理。
- `docs/` 里 `review-cycle-workflow-design.md`、handoff 文档中的 "OPSX/gstack 融合工作" 叙述——历史叙述，保留。
- `CHANGELOG.md` 中的 gstack 提及——历史发布记录，**刻意不改**（改了等于伪造历史）。

> 一句话：用户看到的、调用的、装出来的全是 openspec；翻进源码才会看到 gstack 作为「历史/运行时路径/vendored 工具」留下的字样。这是有意的分层，不是清理漏网。

## 6. 测试与门禁

- **parity golden-master**：`test/core/templates/skill-templates-parity.test.ts`（函数哈希 + 生成内容哈希，19 专家 + 工作流全在列）。
- **profiles**：`test/core/profiles.test.ts` 守核心/扩展技能集划分（review-cycle 是 opt-in 不进 core）。
- **skill-generation / sidecar-install**：守生成与安装正确性。
- **pipeline-registry**：守流水线 DAG（skill 引用必须真实存在——改名后 `openspec:review` 等都得对得上）。
- **legacy-cleanup**：守孤儿清理的精确性与 near-miss 安全。
- 全量 `pnpm test` 当前 2091 passed / 22 skipped（`unify-expert-template-pipeline` 归档后基线）。

## 7. 已知 follow-up（非阻塞）

- **archive 零需求 spec 工具缺口**（已复现两次）：archiver 无法把 spec rebuild 到零 requirements，全 REMOVED 的 spec 只能 `--no-validate` + 手删目录。值得一个小 change 开删除路径。
- **navigator 的 `/opsx:ship` 简介未提三模式**：`navigator.ts:22` 仍写「test, push, open the PR」，没反映 §4.3 的三交付模式 + 证据门。一句话级修复（`ship-delivery-modes` 评审遗留 F3）。
- **ship 证据门可加 tree 指纹**：用 `git rev-parse HEAD^{tree}` 比「HEAD + dirty 状态」更严密（F2）。
- **专家 getter 的 `description: '|'` 空描述痼疾**：除 navigator 外每个 getter 写死空 YAML block scalar，是既存 bug，按「行为不变」原则保留，未在本线修。
