# Proposal: ship-delivery-modes

## Why

`/opsx:ship` 的执行契约是从 gstack `/ship` 专家原样收编的（remove-gstack-parallel-lifecycle, 2026-07-07），其假设是「feature 分支从默认分支分叉、最终 PR 回默认分支」的 GitHub 流。这个假设在本工作流的两个核心场景下失效：

1. **盲 merge 默认分支是正确性错误。** ship 现在无条件探测 base（PR base → repo 默认分支 → main 兜底）并 `git merge origin/<base>`。直推工作分支（如 dev-harness）的仓库没有 PR 也不该合 main；auto-decompose 的子 change 共享父级工作树，其"目标"是父分支而非 main——把默认分支合进工作分支会引入不该进来的代码。
2. **无条件全量测试是对 review 阶段的纯重跑。** 不发生 base merge 时，ship 时的代码与 review 循环刚验证过的代码是同一份，重跑全量测试没有信息增量。ship 自己的 fresh-verification gate（3e）已经承认"代码没变就不用重测"，但 3c 没有遵循同样的逻辑。

同时 pre-flight 要求 working tree 干净、让用户自己先 commit，与实际用法相反——commit 恰恰是 ship 的必要环节（pre-commit hook / lint 失败需要修复重试，这是 ship 阶段的职责）。

## What Changes

- **`/opsx:ship` 引入三种交付模式**（`pr` / `push` / `local`），按「显式参数 > 现存 PR > 仓库惯例 > 询问用户」解析，**绝不默认 repo 默认分支**作为集成 base：
  - `pr`：merge 解析出的 base（现存 PR 的 base > 显式 `--base` > fork-point 推断）→ 测试合并态 → push + `gh pr create`。
  - `push`：不 merge 任何 base，直接 push 当前分支，不开 PR。
  - `local`：仅 commit，不 push 不开 PR——decompose 子 change 专用，交付延迟到组合层。
- **commit 成为 ship 的一等步骤**：ship 负责 stage + commit；pre-commit hook 失败 → 修复 → 重试，绝不 `--no-verify`；pre-flight 不再要求 working tree 干净。
- **测试从无条件改为证据门**：仅在 (a) base merge 实际引入新提交、(b) 当前代码状态没有绿色测试证据（review/verify 报告或 run-state 记录的通过测试所对应的代码已变）、(c) 用户显式要求，三者任一成立时运行；证据新鲜则跳过并在 ship log 记录证据指针。fresh-verification gate（代码变了必须重测）原则保留。
- **decompose 子 change 的 ship 阶段固定 local 模式**：整个子任务链全部完成后，才在父/组合层做一次统一的 push/PR（编排 playbook Step G 新增交付点；auto 守则同步）。
- **证据记录契约**：review-cycle 的 cycle report 与 bug-fix adaptive verify 的 run-state 记录测试命令、结果与所针对的 git 代码状态，供 ship 的证据门消费。
- ship log 变为模式感知（记录 mode、base、测试决策与证据来源）。

## Impact

- Specs: `opsx-ship-command`（2 ADDED + 3 MODIFIED）、`opsx-orchestration`（1 ADDED）、`review-cycle-workflow`（1 ADDED）、`opsx-auto-command`（1 MODIFIED）
- Code: `src/core/templates/workflows/ship.ts`（Ship Phase 重写）、`auto.ts`（守则 + adaptive verify 证据记录）、`_orchestration.ts`（Step G 新增组合级交付点）、`review-cycle.ts`（cycle report 证据行）
- 四个模板均不在 parity 哈希白名单内（白名单为 explore/propose/apply 三件套），无哈希重算
- 不改 `verify-change.ts`（parity 锁定）；PR Body / Land-and-Deploy 需求不动（本就仅 pr 模式适用）

## NOTE（归档提示）

`opsx-ship-command` 主 spec 的 Purpose 行需在归档时手调为：
"Provide the `/opsx:ship` command — pre-flight checks, delivery-mode resolution (pr / push / local), commit-with-hooks, an evidence-based test gate, a PR body derived from the proposal, a mode-aware ship log, and optional land-and-deploy."
