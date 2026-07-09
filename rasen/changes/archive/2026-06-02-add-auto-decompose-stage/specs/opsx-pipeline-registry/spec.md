## ADDED Requirements

### Requirement: Decompose 阶段类型

流水线 stage schema SHALL 支持一个 `kind` 字段，取值为 `standard`（默认）与 `decompose`，并作为一个具名 enum 常量跟踪。`kind: decompose` 的阶段是一个由 LEAD 解释的扇出点，而非单次 skill 调用；对于这样的阶段，`skill` 字段 SHALL 为可选，且一个可选的 `childPipeline` 字段 SHALL 指明每个子 change 运行的流水线。

#### Scenario: 解析一个 decompose 阶段

- **WHEN** 某条流水线 YAML 声明了一个带 `kind: decompose` 与 `childPipeline: small-feature` 且无 `skill` 的阶段
- **THEN** 注册表 SHALL 接受它，并在解析出的阶段上暴露 `kind = 'decompose'` 和 `childPipeline = 'small-feature'`

#### Scenario: 标准阶段不受新字段影响

- **WHEN** 某条既有流水线声明了一个不带 `kind` 字段的阶段
- **THEN** 解析出的阶段 SHALL 默认为 `kind = 'standard'`
- **AND** 它必填的 `skill` 字段 SHALL 仍像以前一样被强制要求

### Requirement: Decompose 阶段校验

流水线校验 SHALL 强制每条流水线**至多包含一个** `decompose` 阶段，且当存在时，它 SHALL 是 build order 中的**第一个**阶段。违反者 SHALL 使 `openspec validate --type pipeline` 以确定性错误失败。

#### Scenario: 多于一个 decompose 阶段

- **WHEN** 某条流水线声明了两个 `kind: decompose` 的阶段
- **THEN** 校验 SHALL 失败，并给出指明重复 decompose 阶段的错误

#### Scenario: decompose 阶段不在首位

- **WHEN** 某条流水线声明的 `decompose` 阶段不在 build-order 索引 0
- **THEN** 校验 SHALL 失败，并给出说明 decompose 阶段必须位于首位的错误

### Requirement: Decompose 子流水线解析

decompose 阶段的 `childPipeline` SHALL 通过显式的注册表查找（project > user > package）来解析，绝不通过对名称的模式匹配。解析出的子流水线本身 MUST **不含 decompose**（传递地不包含任何 `decompose` 阶段），从而强制单一层级的扇出。当 `childPipeline` 被省略时，它 SHALL 默认为一条有文档记载的、不含 decompose 的内置流水线（`small-feature`）。

#### Scenario: childPipeline 解析不到

- **WHEN** 某个 decompose 阶段指定了一个没有任何注册表条目能提供的 `childPipeline`
- **THEN** 校验 SHALL 失败，并给出子流水线无法解析的错误

#### Scenario: childPipeline 会导致递归

- **WHEN** 某个 decompose 阶段解析出的 `childPipeline` 自身包含一个 `decompose` 阶段
- **THEN** 校验 SHALL 以递归防护错误失败
- **AND** 该错误 SHALL 指明违规的子流水线

#### Scenario: 省略的 childPipeline 使用默认值

- **WHEN** 某个 decompose 阶段省略了 `childPipeline`
- **THEN** 解析 SHALL 选用默认的、不含 decompose 的内置流水线 `small-feature`

#### Scenario: show 呈现 decompose 阶段

- **WHEN** 对一条首阶段为 `kind: decompose` 的流水线运行 `openspec pipeline show <name> --json`
- **THEN** 输出 SHALL 包含该阶段，并带上其 `kind` 与解析后的 `childPipeline`
