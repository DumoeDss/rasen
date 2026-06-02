## ADDED Requirements

### Requirement: Decompose 是 Auto 的条件性首步

`/opsx:auto` SHALL 把 decompose 阶段作为它的第一步来评估，并根据任务本身（而非某个独立命令）决定执行还是跳过。当任务是单个内聚、可 review 的切片时，LEAD SHALL 跳过 decompose，并像今天未拆分的流水线那样在一个 change 上继续。当任务包含多个相互独立的交付物、若干彼此不同的能力、或大到无法作为单个 diff 来 review 的范围时，LEAD SHALL 执行 decompose 并扇出。

#### Scenario: 单个内聚任务跳过 decompose

- **WHEN** 针对一个单个内聚 change 运行 `/opsx:auto <task>`
- **THEN** LEAD SHALL 把 decompose 阶段记录为已跳过
- **AND** SHALL 在一个 change 上运行其余阶段，相对今天无行为变化

#### Scenario: 大型多交付物任务执行 decompose

- **WHEN** 针对一个跨多个相互独立交付物的任务运行 `/opsx:auto <task>`
- **THEN** LEAD SHALL 执行 decompose 阶段并产出一份拆分方案

### Requirement: LEAD 自审拆分方案（默认无人类 gate）

当 decompose 被执行时，`/opsx:auto` SHALL 让 LEAD 自审拆分方案（子 change、依赖 DAG，以及串行/并行执行计划）并自动继续；它 SHALL NOT 在默认情况下要求人类批准。仅当 LEAD 无法产出一份安全方案时，它 SHALL 升级给人类。用户 MAY 仍随时中断。

#### Scenario: LEAD 自审并在无人类批准下继续

- **WHEN** LEAD 形成一份它判定为安全的拆分方案
- **THEN** 它 SHALL 开始按方案执行子 change，而不为人类批准而暂停

#### Scenario: 仅当不存在安全方案时才升级

- **WHEN** LEAD 无法为方案确立安全的排序或独立性
- **THEN** 它 SHALL 升级给人类并说明问题，而不是继续执行

#### Scenario: 用户中断仍被尊重

- **WHEN** 用户在一次已拆分的运行期间中断
- **THEN** LEAD SHALL 停止并交还控制权，且组合运行状态已保存以便恢复

### Requirement: Auto 的组合恢复

当 `/opsx:auto` 在一个已拆分的父 change 上被重新调用时，它 SHALL 从组合运行状态恢复该组合，而非重新开始——按依赖顺序继续未完成的子 change，并且不重新运行已完成的子 change。

#### Scenario: 恢复继续该组合

- **WHEN** `/opsx:auto` 在一个已有组合运行状态的父 change 上被重新调用
- **THEN** LEAD SHALL 从下一个（些）可运行子 change 恢复，且 SHALL NOT 重新运行已完成的子 change
