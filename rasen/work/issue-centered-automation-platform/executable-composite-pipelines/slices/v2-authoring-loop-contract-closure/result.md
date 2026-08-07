# ECP-6 Result

Status: passed

## Reconciliation

- Reconciled at：2026-08-04T06:26:58+08:00
- Observed Git revision：`050fc84332b26a75a07f441efd6b235842f89e1e`
- Observed branch/worktree：`wip/ecp-shared-bounded-loop-lifecycle-resume` / isolated
  cumulative ECP worktree
- Projected portfolio：`ecp-v2-authoring-loop-contract-closure`

ECP-6 的四个严格串行 child 均完成实现、修复循环与独立非作者复审：

1. `ecp-shared-bounded-loop-lifecycle`：`CLEAN`，0/0/0/0；
2. `ecp-v2-default-authoring-and-builtins`：Round 3 cap review `CLEAN`，0/0/0/0；
3. `ecp-canvas-v2-authoring-parity`：Round 3 final re-review `CLEAN`，0/0/0/0；
4. `ecp-v2-authoring-loop-vertical-proof`：Round 6 `CLEAN`，0/0/0/0，tasks
   68/69；唯一未勾选项 9.10 是 parent-owned 统一 PR/远端 CI/merge/archive。

## Acceptance evidence

### 1. v2 default authoring — passed

- `pipeline init`、空白 Canvas 与 Change-level built-in 的公开新建路径以 authored
  Definition v2 为默认；内部 dependency capability 保持可安装但不泄漏为公开选择。
- v1 normalization 继续保留历史 Gate/compatibility contract；native v2 继续以 authored
  Gate 为唯一 authority。
- `pipelines/auto-decompose/pipeline.yaml` 保持 byte-identical，Git blob
  `6f306544010a8950508f1223acfca5d62de407f5`。

证据：
[`Child 2 review`](../../../../../changes/ecp-v2-default-authoring-and-builtins/evidence/review-cycle-report.md)。

### 2. Canvas v2 authoring parity — passed

- Canvas 对首版八类节点、declaration/body、typed outcomes、loop lifecycle/limits/exits、
  FanOut/Join pairing 和 capability 已有创建、编辑、保存、重载与诊断闭环。
- declaration outcome 与所有引用 loop 的 exits 原子协调；v1 编辑不发生隐式迁移；
  preparation、Management validate/save/detail 和 digest 保持一致。
- Child 3 独立验证包含 UI 648/648、fresh root 6,845 tests 0 failed，并以
  `CLEAN` 关闭全部 Canvas finding。

证据：
[`Child 3 review`](../../../../../changes/ecp-canvas-v2-authoring-parity/evidence/review-cycle-report.md)。

### 3. Shared bounded-loop lifecycle — passed

- ReviewCycle/GoalLoop 的 logical attempt、blocked/resume occurrence、WaitId、strategy
  exhaustion、research exhausted-report tail 与 projector/replay 已统一在共享 lifecycle。
- 独立 focused gate 2 files / 63 tests 通过；两个原始 Blocker 均关闭，最终
  `CLEAN` 0/0/0/0。

证据：
[`Child 1 review`](../../../../../changes/ecp-shared-bounded-loop-lifecycle/evidence/review-cycle-report.md)。

### 4. Vertical success/recovery/fail-closed dogfood — passed

- 同一个从空白 Canvas 创作的 loop + parallel v2 Custom Composite 经过 Management
  save/preparation/lowering、filesystem RunStore、public completion/control、CLI status、
  Management detail 与 Operations projection。
- fresh built vertical 1/1；独立 dot run 记录 73 个 fresh CLI processes / 73 transitions，
  覆盖 success、required-member failure、process loss、catalog rotation、tamper/replay/
  conflict rejection 与 Management parity。
- plan-bound Ed25519 public authority、signed EvidenceRef/actor claim、HostEvidenceWriter
  complete-set publication、Facade re-read/reverify，以及 post-link crash recovery 均通过
  独立安全复审。

证据：
[`Child 4 review`](../../../../../changes/ecp-v2-authoring-loop-vertical-proof/evidence/review-cycle-report.md)。

### 5. Review and repository gates — passed

- 四个 child 的最终独立 review 均为 `CLEAN`，与 Definition、Canvas、loop contract、
  vertical proof 相关的开放 Blocker/Major 为零。
- 最终 fresh root：440 files / 1,803 suites；6,911 tests = 6,877 passed + 34 pending +
  0 failed，耗时 75.44 分钟。
- 最终 fresh UI：59 files / 181 suites / 651 tests，0 failed/pending。
- root/UI typecheck、build、lint、strict Change validation、diff check 与 v1 source hash
  均通过。

## Accepted boundaries

- ECP-6 的可信 producer 由测试宿主提供；真实 Session/worker producer、session
  identity、cwd、usage、reuse/handoff、cancel/restart 与 automatic observation 是
  ECP-7 的明确边界。本 Slice 没有把测试私钥或签名入口暴露给 CLI、project 或 Run。
- parent task 9.10 的统一 PR、远端 Windows/Linux/macOS CI、merge 与 archive 仍开放。
  用户已锁定整个 0.2.0 ECP 只做一个最终 PR，因此该 delivery gate 由 ECP-8/最终
  Direction 交付统一关闭；它不否定 ECP-6 已满足的本地功能验收。
- Issue、Execution Plan、portfolio runtime 与 `auto-decompose` 迁移仍属于 0.3.0；
  ECP-6 没有改变该边界。

## Outcome

全部六项 Slice observable acceptance 均有真实、独立、可追溯证据。ECP-6 终态为
`passed`；Direction 的唯一开放前沿移动到 ECP-7 Session Execution and Self-hosting。
