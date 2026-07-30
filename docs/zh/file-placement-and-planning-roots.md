# Rasen 文件落点目标设计：planning root、execution root 与 machine root

> 设计结论，更新日期：2026-07-30。本文描述目标模型。
>
> **已由 `file-placement-collapse-landing`（child A，写入侧）关闭的差异：**
> `archive.destination` 不再选择任何行为（仅保留兼容读并在解析时告警，
> `config set` 已拒绝该键，`archive relocate --to external` 与
> `store adopt --archive external` 均已退役），Archive 恒定落在 planning root；
> evidence 与 handoff 落到 `<changeRoot>/evidence/` 与 `<changeRoot>/handoff/`，
> ephemera 落到 execution root 的 `.rasen/changes/<change>/ephemera/`，machine root
> 下的 `workDir` 降级为只读的旧位置（sticky-legacy 链）；design-docs 落点改为
> `<planningRoot>/rasen/design-docs/`，其回退锚定仓库根而非 cwd；run-state 按
> execution root 落点，同名 Change 在同一项目的两个 worktree 中不再碰撞，
> workspace identity 已只读暴露于 `rasen context --json`；probe 的「先按项目惯例
> （`experiments/` / `prototypes/` / `tools/` / `fixtures/` 或模块相邻位置），
> 无惯例才用固定回退 `<executionRoot>/.rasen/probes/<change>/<probe>/`」指引已作为
> 共享常量写入 prototype 与 investigate 两个技能模板，且不提供任何外置选项；
> `rasen work migrate` 不再把 `<changeRoot>/handoff/` 当作迁移候选（那是 handoff
> 的终态落点，扫走它会把该 Change 的后续交接文档钉回 machine root）。
>
> **仍存在的差异**（需通过后续 change 实现和迁移）：`archive.json` 仍记录
> planning 提交哈希；archive 时的四种处置（归档 / 清理 / 静置 / out-of-scope）、
> ephemera 清理器与旧数据一次性迁移器尚未实现（child B
> `file-placement-collapse-archive`）；machine root 中按 workspace 隔离的状态目录
> （`workspaces/<workspace-identity>/`）尚无任何写入方，因此还未落盘。

## 核心不变量

一切落点规则都从这一条推出：

> **凡是 agent 用自己的文件工具（Read / Write / Edit / Glob / Grep）读写的
> 路径，必须位于 planning root 或 execution root 之内。machine root 只允许
> 保存 CLI-owned 状态 —— agent 永不直接引用其路径，只通过 `rasen` 命令的
> 输入输出访问。**

理由：agent 进程的文件可见范围是工作目录加上显式附加的 root（`--add-dir`
一类机制），子 agent 继承父会话的这一范围。落在范围之外的路径，视平台和
权限模式表现为需要人工批准或被沙箱拒绝；而按调度契约，被派发的叶子
worker 不能发起交互式询问，因此它既拿不到批准，也没有可用的回退。

同一条不变量的既有表述：一个 root 对 agent 进程可见（例如通过 `--add-dir`）
并不等于授权写入它。可见性与写入授权是两件事。

实测边界（Windows 11，宽松权限模式）：子 agent 对 `~/.rasen` 下的目录
读、写、Glob、Grep、执行 node 工程全部可用，未出现任何批准请求。该结果
**不能外推**到 macOS / Linux（存在沙箱实现）或默认权限模式（会产生批准
请求）。因此本设计不依赖"agent 访问不到 machine root"这一前提，而依赖
下述三条与平台无关的理由：跨平台默认值必须一致、调研代码必须能进入代码
历史、随 Archive 交付的验证必须能被后人 checkout 重跑。

## 已确定的原则

1. Archive 永远位于 planning root，不允许配置为外置或 prune。
2. Store 管理规划资料，execution project/worktree 管理代码。
3. **内置与外置不是用户配置项。** 每种文件类型的落点由其所有者唯一确定，
   不提供 `internal | external` 开关，也不提供切换命令。
4. Rasen 不配置 Git tracking，用户自行使用 `.gitignore`。Rasen 不自动
   写入、删除或覆盖项目的 ignore 规则。
5. 调研代码也是项目成果物，因此 probe 固定位于 execution root。
6. DAG 节点、切片和 worker 的内部 ID 只能存在于 metadata，不能进入
   Change、代码目录或 Archive 的语义名称。
7. machine root 中按 workspace 隔离的状态，其目录身份必须包含
   workspace/worktree，不能只使用 project 或 Change 名称。

## 三种 root

### planning root

规划事实源：

- in-project 模式下是代码项目；
- Store 模式下是 Store；
- 保存 specs、Change 规划文件、design-docs、evidence、handoff 和 Archive。

### execution root

本次实现实际操作的代码 checkout/worktree：

- 保存业务代码、测试、fixture、probe、prototype 和 ephemera；
- Store 不能改变代码在 execution root 中的组织方式；
- 同一 Store 可对应多个 execution project/worktree。

### machine root

本机 Rasen 数据根 `~/.rasen/`（可由 `RASEN_HOME` 覆盖）。

machine root **始终**保存下列 CLI-owned 状态，这与任何文件类型的落点
规则无关 —— 不存在"machine root 只在某类型外置时才被使用"这种关系：

| 内容 | 路径 |
|---|---|
| 机器级配置 | `config.json` |
| Store 注册表 | `stores/registry.yaml` |
| 项目注册表 | `projects/registry.json` |
| 阈值方案 | `schemes/<runtime>.yaml` |
| 安装 profile | `profiles/*.yaml` |
| 用户级 pipeline 与 workflow | `pipelines/`、`workflows/` |
| 管理面守护进程状态 | `daemon/` |
| ECP run 记录 | `runs/run_<id>/{plan.json,record-v1.json}` |
| association ledger | `projects/<project-identity>/association/` |
| 跨 run / 跨 worktree 的仲裁状态 | `workspaces/<workspace-identity>/coordination/` |
| 本地 token 审计输出 | `analytics/` |

共同特征：它们**不是"某个 Change 的文件"**，而是机器级或跨 worktree 的
状态；且全部由 CLI 读写，agent 不直接引用其路径。因此它们既不属于落点
讨论的范围，也不可能内置。

machine root 不作为 Archive 的权威位置。

## “内置”的含义

`internal` 不是固定指向同一个目录，而是：

> 文件位于该类型真正的所有者 root 内。

| 类型 | 所有者 root |
|---|---|
| Archive | planning root |
| 固定规划文件 | planning root |
| design-docs | planning root（root 级，不属于任何单个 Change） |
| evidence | planning root，`<changeRoot>/evidence/` |
| handoff | planning root，`<changeRoot>/handoff/` |
| probes | execution root |
| ephemera | execution root |
| coordination | machine root（固定外置，CLI-owned） |

因此 Store 模式下：

- proposal、design、specs、design-docs、evidence、handoff、Archive 位于 Store；
- probe 代码和 ephemera 位于选中的代码 project/worktree；
- Store 不得因为自己的切片或 DAG 结构决定用户代码目录。

## 文件类型

### 固定规划文件

`proposal.md`、`design.md`、`tasks.md`、`specs/`、`planning-context.md`。

落点：`<planningRoot>/rasen/changes/<semantic-change>/`

处置：**归档**。

### design-docs

office-hours、design-consultation 和 design-review 产出的设计文档、
test plan 与 design audit。

这一类的作用域是 **root 级而非 Change 级**：它在 Change 尚不存在时就已
产出，后续多个 Change 引用它，并通过 `Supersedes:` 字段形成跨 Change 的
修订链。同一 Store 下的多个 execution project 共享同一批设计文档。

落点：

```text
<planningRoot>/rasen/design-docs/
```

处置：**在 Archive 的作用域之外**。archive 的三档处置只作用于 Change 级
的文件；design-docs 从来不属于任何单个 Change，任何归档期或 GC 期的扫描
都不得把它纳入判断。

实现接缝：落点解析必须来自 planning root，且回退路径也必须是 root 相对
而非工作目录相对 —— 工作目录相对的回退会让 Store 选中或 worktree 中的
运行把文档写到解析到同一 root 的接力者找不到的位置。

### evidence

用于证明审核、验证、质量或交付结论：

- `review-report.md`、`cso-report.md`、`qa-report.md`；
- `benchmark-report.md`、`design-review-report.md`、`review-cycle-report.md`；
- `verification-report.md`、`ship-log.md`；
- baseline、dependency review、surface matrix、测试矩阵和其他稳定结论；
- **随 Archive 交付、供后人重跑的验证 driver**（例如 `verify.sh` 与其
  `README.md`）——evidence 允许内含可执行文件，判据是"要不要被后人重跑"，
  不是"是不是源码"。

落点：`<changeRoot>/evidence/`

处置：**归档**。

evidence 的断言必须打印实测值，不能只输出 PASS/FAIL。只输出判定的断言
无法暴露断言自身写错的情况；打印出被比较的实际值（行偏移、计数、实际
字符串）才能让写反的断言在第一次运行时就暴露。

### handoff

给后继 worker 或后继 session 接力用的过程知识：决策、走过的死路、
**已排除的假设**、下一步动作，以及 relay prompt。

落点：`<changeRoot>/handoff/`

处置：**归档期判定**（本设计中唯一需要判断的一档）。

- 其中的死路与已排除假设**已被** `design.md` 或 evidence 吸收 → 删除原文件；
- **未被**吸收 → 整份移入 `<Archive>/evidence/handoff/`。

不得默认删除。"已排除的假设"是一个 Change 中最贵的信息，它的价值恰在
归档之后才开始兑现 —— 它阻止后人重走同一条死路。判定结果必须记入
`archive.json`。

### probes

可执行、可复现的调查代码：

- probe/prototype 源码；
- 测试 harness、fixture、shim；
- `Cargo.toml`、`Cargo.lock`、`package.json`、`pyproject.toml`；
- `build.rs`、工具链配置、生成脚本和测试资源。

落点：优先遵守项目已有的 `experiments/`、`prototypes/`、`tools/`、
`fixtures/` 或模块就近约定。只有无法识别项目约定时才回退到：

```text
<executionRoot>/.rasen/probes/<semantic-change>/<semantic-probe>/
```

probe **不提供外置选项**，理由三条，均与平台无关：

1. 跨平台默认值必须一致。一个在某个操作系统上可用、在另一个上静默失败
   的默认落点，比两边都不支持更糟。
2. probe 是项目成果物（原则 5）。落在 machine root 就进不了代码历史，
   无法交付、无法 review、不出现在 PR 中。
3. 随 Archive 交付的验证必须能被后人 checkout 出来重跑。没有人能
   checkout 一个 machine root 目录。

处置：**静置**。归档不移动、不复制、不删除 probe；Archive 只记录其
execution root 相对路径和代码提交。probe 的最终去留由用户决定。

构建产物不因位于 probe 工程中就属于 probes。例如一个 Rust probe：

```text
src/                 probes
native/              probes
include/             probes
Cargo.toml           probes
Cargo.lock           probes
build.rs             probes
rust-toolchain.toml  probes
target/              ephemera
```

### ephemera

Change 存活期间有用、归档时失去意义的一切：

**run-state 与控制状态**

- `auto-run.json`、`portfolio-run.json`、`goal-run.json` 或其他 loop run artifact；
- Change 级的 signal、lock、heartbeat；
- 只用于调度和恢复的 worker/expert selection 状态。

**可重新生成的原始材料与缓存**

- 原始日志、抓包、长 transcript；
- fetched corpora、原始截图和大体积采样；
- 临时 benchmark JSON；
- Rust `target/`、下载缓存和其他构建缓存；
- 尚未整理为稳定结论的探测输出。

落点：

```text
<executionRoot>/.rasen/changes/<semantic-change>/ephemera/
```

处置：**清理**。

run-state 的唯一用途是恢复一次运行。Change 归档后恢复的语义本身不成立
（已归档的 Run 拒绝一切 mutation），残留的 run-state 只有害处：它会让
恢复命令试图复活一个已归档的 Change。这些文件还携带调度 ID，按原则 6
不应进入归档语义。

这些文件是否进入 Git 完全由用户的 `.gitignore` 决定。

### coordination

跨 run、跨 worktree 的仲裁状态：workspace reservation、lease、跨运行的
锁与心跳、ECP run 记录。

这一类**必须**位于 machine root：它的全部意义就是在两个 worktree 之间
裁决谁持有某个 workspace，落在任一 worktree 内部就失去了仲裁能力。

落点：

```text
~/.rasen/workspaces/<workspace-identity>/coordination/
~/.rasen/runs/run_<id>/
```

访问方式：**CLI-owned**。agent 永不直接引用这些路径，只通过 `rasen`
命令读写。因此它不违反核心不变量。

处置：由 CLI 生命周期管理，不参与 Archive 的三档处置。

## Archive 的三档处置

| 处置 | 成员 | 动作 |
|---|---|---|
| **归档** | 固定规划文件、evidence、未被吸收的 handoff | 整目录随 Change 移入 Archive |
| **清理** | ephemera | 按文件名白名单删除，删除清单记入 `archive.json` |
| **静置** | probes | 不移动、不删除，只在 Archive 中记录路径和代码提交 |

作用域之外：design-docs（root 级）、coordination（CLI 生命周期）。

固定归档结果：

```text
<planningRoot>/rasen/changes/archive/YYYY-MM-DD-<semantic-change>/
├─ proposal.md
├─ design.md
├─ tasks.md
├─ specs/
├─ evidence/
│  ├─ review-report.md
│  ├─ verification-report.md
│  ├─ ship-log.md
│  ├─ verify.sh
│  └─ handoff/                 仅未被吸收的 handoff
└─ archive.json
```

### 清理纪律

清理必须是确定规则，不是归档期的自由裁量。自由裁量是静默丢弃的复现路径。

- **白名单删除**：只删除已知文件名。未知条目、未来版本的状态文件、格式
  异常的条目、嵌套条目一律**原样保留**并报出其确切路径供人工判断。
- **绝不递归删除** `<executionRoot>/.rasen/changes/<semantic-change>/`
  整个目录，也绝不递归删除 machine root 的任何部分。
- **记账**：删除了什么、吸收了什么，必须在 `archive.json` 中查得到。
- **出口**：提供 `--keep-ephemera` 保留全部 ephemera。
- **预演**：`rasen archive --json --yes` 的 dry-run 必须能打印完整待删
  清单和 handoff 判定结果。
- 发现源码 manifest 或源码树时，禁止清理或静默删除 —— 那是 probes
  被错误分类的信号，交人工判断。

### archive.json

```json
{
  "change": "<semantic-change>",
  "archivedAt": "<ISO-8601>",
  "codeCommit": "<execution root 的提交>",
  "planningBranch": "<planning root 的分支>",
  "planningTreeState": "clean | dirty",
  "evidence": [{ "path": "evidence/review-report.md", "sha256": "..." }],
  "probes": [{ "path": "<execution root 相对路径>", "codeCommit": "..." }],
  "handoffAbsorbed": ["handoff/implementer-1.md"],
  "ephemeraDiscarded": ["ephemera/auto-run.json"],
  "missing": ["<未运行或缺失的项目>"]
}
```

**不记录 planning root 的提交哈希。** `archive.json` 本身会被那个 planning
提交收进去，所以写入其中的哈希是一个闭不上的自我引用：一旦 amend 存放它
的提交，该哈希立刻指向孤儿提交。唯一有约束力的标识符是 `codeCommit`
（跨仓库，可闭合）与 evidence 的内容哈希（内容寻址，可闭合）；planning
侧只记录分支与干净/脏状态。自我引用闭不上，就不要装作闭上了。

## in-project 路径

```text
<Project>/
├─ rasen/
│  ├─ specs/
│  ├─ design-docs/                    root 级，不属于任何 Change
│  └─ changes/
│     ├─ <semantic-change>/
│     │  ├─ proposal.md
│     │  ├─ design.md
│     │  ├─ tasks.md
│     │  ├─ specs/
│     │  ├─ evidence/                 归档
│     │  └─ handoff/                  归档期判定
│     └─ archive/                     永远在 planning root
│
├─ .rasen/
│  └─ changes/<semantic-change>/
│     └─ ephemera/                    归档时清理
│
└─ <项目语义路径>/<semantic-probe>/   静置
```

## Store 路径

```text
<Store>/
└─ rasen/
   ├─ specs/
   ├─ design-docs/                    多个 execution project 共享
   └─ changes/
      ├─ <semantic-change>/
      │  ├─ proposal.md
      │  ├─ design.md
      │  ├─ tasks.md
      │  ├─ specs/
      │  ├─ evidence/
      │  └─ handoff/
      └─ archive/                     永远在 Store

<Execution Project Worktree>/
├─ .rasen/
│  └─ changes/<semantic-change>/
│     └─ ephemera/
│
└─ <项目语义路径>/<semantic-probe>/
```

## machine root 路径

```text
~/.rasen/
├─ config.json
├─ stores/registry.yaml
├─ projects/
│  ├─ registry.json
│  └─ <project-identity>/association/
├─ schemes/<runtime>.yaml
├─ profiles/*.yaml
├─ pipelines/、workflows/
├─ daemon/
├─ analytics/
├─ runs/run_<id>/{plan.json,record-v1.json}
└─ workspaces/
   └─ <project-name>--<workspace-short-id>/
      ├─ workspace.json
      └─ coordination/
```

要求：

- 一个 Git worktree 对应一个 workspace identity；
- 不同 worktree 的同名 Change 不共享仲裁状态；
- 可读名称来自项目的语义名称，短 ID 只用于防碰撞；
- `workspace.json` 记录 projectId、worktree、planning root、Store 关系和路径；
- `g-002`、`g-003` 等调度 ID 不进入目录名。

## 配置和命令

**没有落点配置项，也没有落点命令。** 下列命令与配置在目标模型中不存在：

```text
rasen placement
rasen placement set <type> <internal|external>
placement: { runtime: ..., scratch: ..., probes: ... }
archive.destination
```

每种类型的落点由其所有者 root 唯一确定（见"内置的含义"表）。用户需要
决定的只有两件事，都不经过 Rasen：`.gitignore` 里怎么写，以及归档后
静置的 probe 留不留。

## 分类判定顺序

判定的第一问是**用途与生命周期**，不是"是不是源码"。以"是不是源码"起手
会把一个既是可执行工程又是交付证据的目录（例如含 `verify.sh` 的
`verification/`）判去 execution root，而它的全部意义正是随 Archive 一起
被后人重跑。

```text
它跨 Change 存活、是设计资料吗？
  是 → design-docs（planning root，Archive 作用域之外）

它要随 Archive 被后人重跑或复核吗？
  是 → evidence（允许内含可执行 driver）

它是要交付进代码历史的源码或验证工程吗？
  是 → probes（execution root，静置）

它是给后继 worker/session 接力用的过程知识吗？
  是 → handoff（归档期判定吸收与否）

它是跨 run / 跨 worktree 的仲裁状态吗？
  是 → coordination（machine root，CLI-owned）

否则是恢复运行所需、或可重建的原始/中间材料
  → ephemera（归档时清理）
```

## 调度 ID 与语义名称分离

错误形式：

```text
phase-2-g003-macos-shim/
g-003-probe/
```

目标形式：

```yaml
nodes:
  - id: g-003
    change: phase-2-macos-shim
    label: macOS shim validation
```

对应用户路径：

```text
rasen/changes/phase-2-macos-shim/
experiments/macos-shim/
```

`g-003` 只能出现在 run-state、portfolio DAG、内部 metadata 和调度 UI 中。

## 负担转移

全部内置有一个代价，本设计选择明说而非回避：**清理只发生在归档时，因此
永远不会归档的 Change（被放弃的、被 decompose 掉的）的 ephemera 会长期
留在工作树里。** 这正是外置曾经附带的隐含好处 —— 不在仓库里就不用管 ——
现在这个好处消失了。

处置：不提供自动 GC。`.rasen/` 由用户的 `.gitignore` 一行覆盖，堆积只
占磁盘、不影响 Git 状态，清理由用户在需要时自行删除。这与原则 4 立场
一致：与其发明一个可能误删的回收器，不如承认这是用户的磁盘。

外置从未真正解决这个问题，只是把堆积移到了用户更看不见的地方；而
`_orchestration` 层面为外置给出的理由（"不需要提交也不需要 gitignore
条目"）在原则 4 把 Git tracking 交给用户之后就已经不成立了。

## 兼容与迁移

- 新版本停止读取 `archive.destination` 作为写入策略；新 Archive 总是
  planning root。旧的外置 Archive 保持可发现，迁移回 planning root 后再
  退出兼容读取。
- 旧 `workDir` 中的 review、QA、CSO、benchmark、verification 报告和
  `ship-log.md` 按 evidence 处理：活动 Change 迁入 `<changeRoot>/evidence/`，
  已归档 Change 迁入对应 Archive 的 `evidence/`。
- 旧 `workDir` 中的 handoff 文档迁入 `<changeRoot>/handoff/`。
- 旧 `workDir` 中的 run-state 迁入 `<executionRoot>/.rasen/changes/<c>/ephemera/`；
  已归档 Change 的 run-state 直接丢弃并在迁移报告中列出。
- 旧 `workDir` 中发现源码 manifest 或源码树时，禁止 GC 或静默删除 ——
  按 probes 处理，迁回项目时先复制和校验，不在构建验证通过前删除原副本。
- machine root 下的历史 probe 目录逐个按"分类判定顺序"重分类：driver 与
  harness 迁回 execution root；采样输出按 ephemera 处理；结论已被 handoff
  或 evidence 吸收的可丢弃。迁移报告必须逐目录列出判定结果。
- design-docs 从 `machineHome/design-docs/` 迁入
  `<planningRoot>/rasen/design-docs/`。
- 旧 sticky-legacy 文件继续可读；本设计的落点成为权威写入位置。
- 当前按 project home 共享的 worktree 状态迁移到 workspace identity，
  消除同名 Change 碰撞。
- 一切迁移冲突时**不覆盖**，保留两份并交给用户判定权威副本。
