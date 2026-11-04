# ECP-6 Projection Plan

## Direction source

- Workstream：`rasen/work/issue-centered-automation-platform/executable-composite-pipelines`
- Slice：`slices/v2-authoring-loop-contract-closure`
- 选择基线：`dev/0.2.0` @ `14ed62bc088197294f4a219ff20e946a6a99691d`
- 权威顺序：North Star > Target State > Roadmap > Slice Spec > 本 Plan > Changes

## 投影边界

本 Slice 需要多个可独立审查的 Change，因此投影给 `auto-decompose`。父 Change 只作为
portfolio planning container；每个子 Change 使用独立的 `small-feature` Run。子 Change
只做 local delivery，全部通过后由父级统一创建一个 PR。

经独立分解审查后，portfolio 固化为以下 4 个语义 Change：

1. `ecp-shared-bounded-loop-lifecycle`：统一 ReviewCycle/GoalLoop 的公共生命周期和终态。
2. `ecp-v2-default-authoring-and-builtins`：关闭 CLI/registry/default-definition 的 v1
   新建路径，迁移 Change-level built-ins，并修复误导 warning。
3. `ecp-canvas-v2-authoring-parity`：完整创建和编辑首版支持原语并保持 round-trip digest。
4. `ecp-v2-authoring-loop-vertical-proof`：以真实 loop + parallel Custom Composite 贯穿
   Definition、Canvas、Runtime、fresh-process recovery 和 Operations。

## 依赖与并行安全

- 最终 DAG 为严格串行：`ecp-shared-bounded-loop-lifecycle`
  → `ecp-v2-default-authoring-and-builtins`
  → `ecp-canvas-v2-authoring-parity`
  → `ecp-v2-authoring-loop-vertical-proof`。
- lifecycle 与 default migration 会共同修改 Definition、lowerer、runtime plan 和 typed
  outcomes；default migration 与 Canvas 会共同修改 blank definition、wire types、serializer
  和 round-trip contract，因此不存在安全的并行 cohort。
- vertical proof 是唯一 merge node，必须等待前三项全部 review-clean。
- `ecp-run-spine`、`ecp-association-registry-wiring` 和 `ecp-settle-completeness` 作为
  已交付基线消费，不吸收、不替换，也不据 artifact checkbox 重做已合并能力。

## Dogfood path

从空白 Canvas 创建包含 BoundedLoop 和 FanOut/Join 的 v2 Custom Composite，保存并重载，
通过 CLI/API 启动 reconciler Run；分别收集成功、进程重启恢复和 malformed/failed member
的 fail-closed 证据，并用 Operations projection 核对 root/composite/loop/parallel 状态。

## 返回 Direction 的证据

- 每个子 Change 的 proposal/design/spec/tasks 与 review-clean 状态；
- 运行命令、tree fingerprint、RunId/ActionId、状态转换和恢复证据；
- Canvas round-trip fixture/digest；
- root/UI tests、typecheck、lint 与独立 review 报告；
- 一个统一 PR 及其 CI 状态；
- 未解决 finding、环境性例外和所有被接受的已知限制。
