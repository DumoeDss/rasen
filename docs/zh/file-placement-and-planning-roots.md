# Rasen 文件落点目标设计：planning root、execution root 与 machine root

> 设计结论，更新日期：2026-08-01。本文描述已实现并通过子变更独立复核的目标模型。
>
> **落点基础：**
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
> `rasen work migrate` 以旧 machine-home work 目录为只读发现源，把 handoff
> 迁入 `<changeRoot>/handoff/`，而不会把终态 handoff 反向迁回 machine root。
>
> **安全与集成状态：** `file-placement-hardening-migration-safety` 已实现
> schema-aware 清理分类、纯 plan/apply 迁移、原子 no-clobber 与 fail-closed I/O；
> `file-placement-hardening-archive-engine` 已实现单一 archive 引擎、可恢复发布、
> 最终 evidence/accounting 与手工完整性恢复；`file-placement-hardening-root-routing`
> 已把 frozen planning/execution/legacy-home context 贯穿 migration 与 Sessions；
> `file-placement-hardening-windows-lock-contention` 已把 Windows legacy registry
> lock 打开时的 `EPERM`、`EACCES`、`EBUSY` 限定为既有 deadline 内的有界瞬态竞争，
> 同时保留语义 winner/`pipeline_already_exists`、busy/timeout、其他错误及非 Windows
> 平台的既有诊断。四个实现子变更的最终独立复核均为 CLEAN。macOS、Linux、Windows 的远端原生
> archive recovery matrix 仍必须在推送后以 CI 结果验收，任何单机 path-flavor
> 测试都不能替代该远端证据。machine root 中按 workspace 隔离的状态目录只有
> 在实际 coordination 写入方使用时才落盘。

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
8. migration、archive 和 session terminal join 在权限边界只解析一次 root
   context；下游不得从 cwd、Store 成员关系或 planning root 猜测 execution。
9. 任何 destructive workflow 都必须先产生完整不可变 plan；apply 只消费该
   plan。除 `ENOENT` 外的权限、I/O、schema、Git 或 evidence 不确定性都失败关闭。
10. direct CLI、single archive、bulk archive 与 in-ship 都使用同一个 archive
    engine；不存在外部 spec-sync 后再移动目录的第二条写入路径。

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

命令或 session 在权限边界冻结一个显式 context：planning root、execution
root、legacy machine-home owner 与 `win32 | posix` path-identity flavor。下游
消费者只使用该值；execution 缺失、被移除或显式 planning-only 时，terminal
状态为 unavailable/absent，不回退到 Store、daemon 启动目录或其他 worktree。

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

> **SUPERSEDED in part** — In Store layout v2, planning content lives under
> per-project partitions (`rasen/projects/<projectId>/`) rather than a flat
> Store-wide tree. Design docs are per-project, not shared Store-wide. See
> [`docs/zh/store-project-partitions-and-planning-worktrees.md`](store-project-partitions-and-planning-worktrees.md).
> The probe and ephemera conclusions below remain in force.

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
修订链。

> **SUPERSEDED** — "同一 Store 下的多个 execution project 共享同一批设计文档"
> is no longer accurate for Store layout v2: design docs are partitioned
> per-project. See
> [`docs/zh/store-project-partitions-and-planning-worktrees.md`](store-project-partitions-and-planning-worktrees.md).

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

处置：**归档期判定**（本设计中唯一需要语义判断的一档）。

- 其中的死路与已排除假设**已被** `design.md` 或 evidence 吸收 → intent 记为
  `absorbed`，只在 staged payload 中省略；
- **未被**吸收 → intent 记为 `preserved`，只在 staged payload 中移到
  `<Archive>/evidence/handoff/`。

不得默认删除。"已排除的假设"是一个 Change 中最贵的信息，它的价值恰在
归档之后才开始兑现 —— 它阻止后人重走同一条死路。判定结果必须写入
change-bound、versioned sidecar，并由 archive engine 校验完整 inventory、
相对路径 containment 与枚举值。skill 不得预先移动或删除 active handoff；
sidecar 缺失表示「未判定，全部保留」，格式错误、未来版本、不完整或不可读
则阻断 apply。最终实际结果记入 `archive.json`。

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

## Archive 的四类处置

| 处置 | 成员 | 动作 |
|---|---|---|
| **归档** | 固定规划文件、evidence、未被吸收的 handoff | 进入已验证的 staged payload，再以 no-clobber 方式发布 |
| **清理** | ephemera | 仅按完整 immutable cleaner plan 处置，实际结果记入 `archive.json` |
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

- **schema-aware 白名单**：文件名命中只是候选；已知 run-state 还必须通过
  对应 schema/version 校验。未知条目、未来版本、格式异常和嵌套非源码条目
  一律原样保留并报告确切路径与原因。
- **完整分类优先**：先递归完成整个 ephemera tree 的分类，再产生 delete、
  preserve、`sourceSignals`、typed `blockers` 和 `complete`。任何源码 manifest
  或源码树信号使全部有效路径转为 preserve；任何非 `ENOENT` inspection 错误
  使 plan incomplete 并阻断 archive 的全部 mutation。
- **绝不递归删除** `<executionRoot>/.rasen/changes/<semantic-change>/`
  整个目录，也绝不递归删除 machine root 的任何部分。
- **精确消费与记账**：apply 使用 plan 中的 candidate fingerprint，不重新
  分类；删除前后写 durable per-candidate intent/result，只把实际成功结果写入
  `archive.json`。
- **出口**：提供 `--keep-ephemera` 保留全部 ephemera。
- **预演**：`rasen archive <change> --dry-run --save-plan --json` 必须输出 apply
  随后消费的同一 plan/token，包括完整 delete/preserve 清单、source signals、
  blockers、handoff/probe/spec actions、目标与 recovery identity，并且零写入。
- 发现源码 manifest 或源码树时，禁止清理或静默删除 —— 那是 probes
  被错误分类的信号，交人工判断。

### 事务、发布与恢复

archive 只有一个 plan/apply 引擎。direct CLI、single、bulk 和 in-ship consumer
都先完成 gates 与严格 intent，再由引擎准备 spec actions、sidecar/handoff、
cleaner、quality/evidence、Git facts、目标与 blocker；consumer 不调用外部
spec-sync，不手写 `archive.json`，也不执行 `mv`。

plan 以 content-addressed token 保存。`--apply-plan <token>` 只加载并消费该
plan，不重新规划。apply 在最终 Archive 的同级目录 staging，逐阶段持久化
transaction journal，校验完整 payload 后以 exclusive/no-clobber 能力发布；
并发目标、身份漂移、permission/I/O 或非预期 `EXDEV` 都保留 active source 与
既有目标。spec action 同样使用逐项 capability/progress journal，不能用
check-then-rename 覆盖并发修改。

最终 evidence、quality metadata、ship-log archive section 与 `archive.json`
在 active source 删除前完成并复验。cleaner 只执行 plan 中的候选，active
change 最后删除。中断后只有 transaction id 与 plan hash 一致的 stage/final
可自动 resume；其他状态报告双方路径，禁止猜测所有权或递归清空目录。

完成后若 terminal verification 发现 payload/accounting 腐坏，结果必须指向
published journal，标为 `manual-recovery-required`，不得给出普通自动重试命令，
不得改写腐坏 bytes 或历史 complete phase。即使记录该 alert 的第一次 fsync
失败，也以磁盘上可证实的 journal 为准并保持 manual-only。

ship-log 的 ship-side bytes 在归档前已经最终化。引擎只在 staged evidence 中
加入 archive-side facts 后再 hash；包含该 Archive 的后续提交 SHA 只通过 Git
history/commit message 形成稳定链接，不再 append 到已经 hash 的 evidence。

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
  "handoffAbsorbed": {
    "judged": true,
    "entries": [{ "path": "handoff/implementer-1.md", "outcome": "absorbed" }]
  },
  "ephemeraDiscarded": ["ephemera/auto-run.json"],
  "missing": ["<未运行或缺失的项目>"]
}
```

**不记录 planning root 的提交哈希。** `archive.json` 本身会被那个 planning
提交收进去，所以写入其中的哈希是一个闭不上的自我引用：一旦 amend 存放它
的提交，该哈希立刻指向孤儿提交。唯一有约束力的标识符是 `codeCommit`
（跨仓库，可闭合）与 finalized recursive evidence tree 的内容哈希（内容寻址，
可闭合）；planning 侧只记录分支与干净/脏状态。confirmed non-Git planning
root 可记录 `planningBranch: null` 与已定义 tree state；Git、evidence、sidecar
或 accounting 不确定性不能伪装成 null/clean，而必须阻断或留下 recovery journal。

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

> **SUPERSEDED** — The flat Store tree below describes the pre-v2 layout.
> Store layout v2 partitions planning content under
> `rasen/projects/<projectId>/`. See
> [`docs/zh/store-project-partitions-and-planning-worktrees.md`](store-project-partitions-and-planning-worktrees.md)
> for the current design. The tree is retained as historical reference.

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

Store-aware consumer 在入口冻结上述两棵树：Store 只拥有 planning paths，
当前选中的 member checkout/worktree 拥有 execution paths 与 legacy-home lookup。

> **SUPERSEDED** — `--store` and `--project` are no longer mutually exclusive.
> In Store layout v2 they are orthogonal selectors: `--store` selects the Store,
> `--project` selects the project partition within it. See
> [`docs/zh/store-project-partitions-and-planning-worktrees.md`](store-project-partitions-and-planning-worktrees.md).
> The Store-aware consumer freezing rule above remains in force.

`rasen work migrate --store <id>` 与 `--project <id>` 使用共享且互斥的 selector；
preview 后 cwd、注册表或 Store membership 改变也不能重新解析。Sessions 的
planning filter 继续使用记录的 space，但 ephemera 和 legacy work join 只使用
记录的 execution root；缺失、planning-only 或已移除的 execution 一律返回
`runState: { kind: "absent" }`，且零写入。

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
  已归档 Change 的 run-state 只在 apply 实际删除成功后报告 discarded；失败则
  报 failed/incomplete，第二次运行必须是可证明的 no-op 或可恢复重试。
- 旧 `workDir` 中发现源码 manifest 或源码树时，禁止 GC 或静默删除 ——
  按 probes 处理，迁回项目时 exclusive publish、校验 destination identity，
  只在完全验证后删除原副本。
- machine root 下的历史 probe 目录逐个按"分类判定顺序"重分类：driver 与
  harness 迁回 execution root；采样输出按 ephemera 处理；结论已被 handoff
  或 evidence 吸收的可丢弃。迁移报告必须逐目录列出判定结果。
- design-docs 从 `machineHome/design-docs/` 迁入
  `<planningRoot>/rasen/design-docs/`。
- 旧 sticky-legacy 文件继续可读；本设计的落点成为权威写入位置。
- 当前按 project home 共享的 worktree 状态迁移到 workspace identity，
  消除同名 Change 碰撞。
- migration 每次 invocation 只规划一次；interactive confirmation 与 `--json
  --yes` 都 apply 完整同一 plan，不重新扫描候选、root 或 machine identity。
- `--change` 的 scope filter 在任何 filesystem inspection 之前执行；无可证实
  owner 的 global probe/design-doc 不得进入 scoped plan。
- 一切迁移冲突时**不覆盖**，使用 exclusive publication 保留两份并交给用户
  判定权威副本。只有显式 `EXDEV` 可以进入 no-clobber copy fallback；权限/I/O
  错误不触发 fallback，copy 成功但 source removal 失败必须保持 incomplete。
