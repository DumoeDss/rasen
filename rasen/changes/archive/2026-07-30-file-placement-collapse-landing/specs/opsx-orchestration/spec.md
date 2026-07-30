## MODIFIED Requirements

### Requirement: 拆分产出一份由 LEAD 自审的方案

当 LEAD 执行一个 `decompose` 阶段时，它 SHALL 产出一份**拆分方案**，由一组子 change（每个都是可独立交付、可 review 的切片）和一个**依赖 DAG**（声明哪些子 change 必须先落地）组成。LEAD SHALL 在扇出之前自审这份方案（切片内聚性、任何并行同批的独立性依据，以及 DAG 的正确性），并且 MAY 在无人类确认下继续。仅当它无法产出一份安全方案时，它 SHALL 升级给人类。每个子 change SHALL 用 `rasen new change <semantic-name>` 创建，名称 SHALL 是语义化的 kebab-case 名（描述该切片交付什么）；调度用的节点 ID（如 `g-003` 一类）SHALL 只存在于组合运行状态的 metadata 中，SHALL NOT 进入 change 目录名（`file-placement` capability 的调度 ID 分离规则）。

#### Scenario: 在扇出前自审方案

- **WHEN** LEAD 为一个多交付物任务执行 decompose 阶段
- **THEN** 它 SHALL 产出一份方案，列出每个子 change 以及它们之间的依赖边
- **AND** 当方案安全时，它 SHALL 自审该方案并在无需人类确认的情况下开始扇出

#### Scenario: 父成为规划容器

- **WHEN** decompose 阶段被执行
- **THEN** 父 change 的其余流水线阶段 SHALL 被标记为 delegated，且 SHALL NOT 在父级运行
- **AND** 每个子 change SHALL 运行解析出的 `childPipeline`（propose → apply → verify → review-loop → …）

#### Scenario: 子 change 使用语义名称而非调度 ID

- **WHEN** LEAD 创建拆分方案中的子 change
- **THEN** 每个子 change 目录名 SHALL 是语义化 kebab-case 名称
- **AND** 调度节点 ID 只出现在组合运行状态的 metadata 字段中

### Requirement: 组合运行状态

LEAD SHALL 维护一份**组合运行状态**记录（其路径用平台 path 模块构建，其文件名作为具名常量跟踪），落点为 execution root 的 ephemera 目录（`file-placement` capability；sticky-legacy 链兼容已存在于旧位置的记录），记载拆分方案、子 change 列表、依赖 DAG、每个子 change 的执行模式与并行同批、每个子 change 的流水线状态，以及当前可运行前沿。每个子 change SHALL 保留它自己的、按 change 计的运行状态。组合运行状态在恢复时 SHALL 为权威；子目录与产物存在性是交叉校验。

#### Scenario: 组合状态记录 DAG 与每个子 change 的状态

- **WHEN** LEAD 执行一次已拆分的运行
- **THEN** 组合运行状态 SHALL 记录每个子 change 的状态以及子 change 之间的依赖边

#### Scenario: 恢复计算下一个可运行子 change

- **WHEN** `rasen pipeline resume <parent>` 针对一个已拆分的父 change 运行
- **THEN** 它 SHALL 读取组合运行状态加各子状态，并报告其前置已完成的下一个（些）子 change

#### Scenario: 部分失败时停止受影响的链并升级

- **WHEN** 某个子 change 的流水线在运行中失败或升级
- **THEN** LEAD SHALL 停止该子 change 的依赖链、保留已完成的独立子 change 不动，并连同未完成的前沿一起升级上报

## ADDED Requirements

### Requirement: Planning-Root and Execution-Root Blackboard

Stages SHALL hand off through durable files at the per-class landing locations of the `file-placement` capability: review material (proposal, design, tasks, delta specs, planning-context) under `changeRoot`; evidence (reports) under the payload's `evidenceDir`; handoff documents under `handoffDir`; run-state and other process ephemera under `ephemeraDir`. `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel. The LEAD SHALL resolve every location as an absolute path from `rasen status --change <n> --json` (or the instructions payloads) before writing any blackboard artifact, so all paths are interpreted relative to the selected Rasen root — including a `--store`-selected store root — and never relative to the current working directory. The sticky-legacy chain applies to every ephemeron and report: a file that already exists at a legacy location (the machine-home work directory or the change directory) keeps living there; one file's state is never split across locations.

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to its class's landing location and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded in the execution root

- **WHEN** the LEAD starts recording run-state for a change with no pre-existing `auto-run.json`
- **THEN** the LEAD SHALL write `auto-run.json` into the payload's `ephemeraDir`
- **AND** `rasen pipeline resume <change>` resolved to the same root SHALL read the run-state (`hasRunState: true`)

#### Scenario: Run-state resumes from a legacy location

- **WHEN** a change's `auto-run.json` already lives in the machine-home work directory or the change directory
- **THEN** the LEAD SHALL keep reading and writing that file in place
- **AND** SHALL NOT create a second run-state file in the ephemera directory

#### Scenario: Store-selected run writes to the selected root

- **WHEN** the change lives in a store-selected or non-cwd Rasen root
- **THEN** review material, evidence, and handoff SHALL be written to the absolute store-side locations from the payload, and ephemera to the execution root's ephemera directory
- **AND** `rasen pipeline resume <change>` resolved to that same root SHALL read the run-state (`hasRunState: true`)

## REMOVED Requirements

### Requirement: Change Directory Blackboard and Run-State

**Reason**: Superseded by the Planning-Root and Execution-Root Blackboard requirement above — the two-location (change directory + machine-home work directory) contract is replaced by the per-class landing locations of the `file-placement` capability.

**Migration**: The LEAD reads the per-class directories from the status/instructions payloads; files already at legacy locations keep working via the sticky-legacy chain.
