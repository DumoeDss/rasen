# opsx-orchestration — Delta

## ADDED Requirements

### Requirement: 子 change 本地交付，组合级统一交付

当一次已拆分（decompose）运行中的子 change 执行其流水线的 ship 阶段时，该阶段 SHALL 以 `local` 交付模式运行：仅提交（commit），SHALL NOT push，也 SHALL NOT 创建 PR。对外交付（push 或 PR）SHALL 在全部子 change 完成后，由 LEAD 在父/组合层按解析出的交付模式执行且**恰好一次**。组合发生部分失败时，已完成子 change 的提交 SHALL 保留在本地且 SHALL NOT 被推送——LEAD SHALL 连同未完成前沿一起升级上报，绝不交付不完整的组合。

#### Scenario: 子 change 的 ship 仅提交

- **WHEN** 某个子 change 的流水线执行到 ship 阶段
- **THEN** 该 ship SHALL 以 local 模式运行（仅 commit）
- **AND** SHALL NOT push 也 SHALL NOT 创建 PR

#### Scenario: 组合完成后统一交付

- **WHEN** 组合中的全部子 change 均已完成其流水线
- **THEN** LEAD SHALL 在父/组合层解析交付模式并执行一次统一的 push 或 PR 交付

#### Scenario: 部分失败时不交付

- **WHEN** 某个子 change 失败或升级导致组合未全部完成
- **THEN** 已完成子 change 的提交 SHALL 保留在本地
- **AND** LEAD SHALL NOT 执行组合级 push/PR，而 SHALL 升级上报
