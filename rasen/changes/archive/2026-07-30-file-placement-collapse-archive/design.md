# design — file-placement-collapse-archive

## Context

child A（`file-placement-collapse-landing`，已归档 `12c50be8`）关闭了写入侧：
落点配置归零、所有 landing point 重接线、新能力 `file-placement` 进入 main
specs（含真实的 Purpose 与七类文件落点规则）。本 change 关闭 archive 侧。

当前 archive 代码（`src/core/archive.ts`、`src/core/templates/workflows/archive-change.ts`）
的行为：

1. **没有 `archive.json`。** archive 把 change 目录整体移到 archive 目录，写
   `.openspec.yaml`（quality capture），不写任何处置记账。设计文档要求的
   `codeCommit` / `planningBranch` / `probes[]` / `handoffAbsorbed` /
   `ephemeraDiscarded` / `missing` 字段全不存在。

2. **没有 ephemera 清理器。** archive 不触碰 execution root 的
   `.rasen/changes/<c>/ephemera/`——child A 让 ephemera 落在那里，但没有清理
   路径。归档后残留的 run-state 会让恢复命令试图复活一个已归档的 Change。

3. **没有 handoff 吸收判定。** `handoff/` 目录随 change 目录整体进入 archive，
   不区分死路是否已被 `design.md` 或 evidence 吸收。

4. **`rasen work migrate` 方向是反的。** 现有命令（`src/commands/work.ts` +
   `src/core/work-migration.ts`）把 in-repo ephemera 迁入 machine home work
   目录。终端模型把方向反过来：machine home 的遗留状态迁入 child A 建立的
   终端落点。

5. **prune tombstone 已由 child A 移除写入分支**；但 `Pruned:` ship-log 记录
   的读取路径仍然存活（`archive-change.ts` 的 already-archived 检测 + 联合
   发现）。本 change 的迁移器依赖该读取器继续工作。

6. **`change-work-dir` 的 "Migration completes the sticky-legacy lifecycle"
   需求**描述旧迁移方向（change 目录 → machine home），终端模型反转该方向。
   本 change 修改该需求以反映反转后的生命周期。

引用的工作代码坐标（worktree 精确）：
- `src/core/archive.ts:577-614` — archive 主流程（move + quality capture，
  无 ephemera 清理，无 archive.json）
- `src/core/archive.ts:629-700` — `captureQuality` 写 `.openspec.yaml`
- `src/core/file-placement.ts` — child A 的 per-class 落点解析器（本 change
  引用 `ephemeraDir` / `evidenceDir` / `handoffDir`，不重新实现）
- `src/core/change-work.ts:52-80` — `resolveChangeWorkDir`（probe-first，
  legacy-read 桥）
- `src/core/change-work.ts:125-142` — `legacyExternalArchiveDir`（只读发现）
- `src/core/work-migration.ts:105-209` — 旧迁移器（扫描 change 目录的
  in-repo ephemera）
- `src/commands/work.ts` — `rasen work migrate` 命令面
- `src/core/templates/workflows/archive-change.ts:126-169` — skill 的
  bookkeeping + delivery-chain 步骤

## Decisions

### D1: 四档处置的接缝——处置发生在 move 之前

ephemera 清理和 handoff 吸收判定在 change 目录移动到 archive **之前**执行。
理由：

- ephemera 位于 execution root（`<executionRoot>/.rasen/changes/<c>/ephemera/`），
  不在 change 目录内。change 目录的 move 不碰它。所以清理必须在 move 之前
  （或之后，但之前更安全——如果清理发现问题可以中止整个 archive）。
- handoff 吸收判定需要读取 `design.md` 和 evidence，它们此时还在 change 目录
  原位。判定后：被吸收的 handoff 原地删除；未被吸收的移入
  `<changeRoot>/evidence/handoff/`。然后 change 目录（含更新后的 evidence/）
  整体 move 到 archive。

处置顺序：handoff 吸收 → ephemera 清理 → change 目录 move → archive.json 写入。

### D2: ephemera 清理器的白名单

白名单是确定规则，不是自由裁量。清理器只删除已知文件名，具体清单来自设计
文档的 ephemera 类型定义：

**run-state 与控制状态**（删除）：
`auto-run.json`、`portfolio-run.json`、`goal-run.json`、
`.signal`、`.lock`、`.heartbeat`、`expert-selection-explicit.json`。

**可重新生成的原始材料**（删除，按已知扩展名/前缀）：
`*.log`、`raw-*.json`、`benchmark-*.json`。

**一律保留并报出路径**：
未知文件名、未来版本的状态文件、格式异常的条目、嵌套目录条目。

**源码 manifest 检测**：发现 `package.json` / `Cargo.toml` / `pyproject.toml`
/ `build.rs` / `rust-toolchain.toml` / 源码目录树时，中止该 change 的清理，
报出发现的路径——这是 probes 被错误分类的信号。

白名单是文件级、非递归的。绝不递归删除 ephemera 目录。

### D3: handoff 吸收判定是 agent 判定，不是 CLI 判定

handoff 吸收需要语义理解（读取 handoff 文档、检查其内容是否已被 design.md
或 evidence 覆盖）。这不是确定性的 CLI 操作。

设计接缝：
- **CLI `rasen archive`** 不执行 handoff 吸收判定——它只负责确定性的 ephemera
  清理和 archive.json 写入。如果 change 目录有 `handoff/` 子目录且未被处理，
  CLI 把目录整体随 change 目录 move 到 archive（安全默认：保留）。
- **Skill `/rasen-archive-change`** 在 bookkeeping 之前引导 agent 执行吸收
  判定：读取每份 handoff 文档、判断其死路/已排除假设是否已被 design.md 或
  evidence 吸收、删除已吸收的、将未吸收的移入 `<changeRoot>/evidence/handoff/`。
  判定结果记入 `handoffAbsorbed`。

理由：把唯一的裁量点放在 agent 层（skill），把确定性的清理和记账放在 CLI 层。
agent 不会执行 rm；CLI 不会执行语义判定。

### D4: archive.json 不记录 planning-root 提交哈希

`archive.json` 本身被那个 planning 提交收进去，所以写入其中的哈希是一个闭不
上的自我引用：一旦 amend 存放它的提交，该哈希立刻指向孤儿提交。

唯一有约束力的标识符是 `codeCommit`（跨仓库，可闭合）与 evidence 的内容哈希
（内容寻址，可闭合）；planning 侧只记录分支与干净/脏状态。

这不影响 `sha-cross-stamping` 的 ship-log 交付链——ship-log 的 archive 段
记录的是 archive commit SHA（通过先 append 再 commit 再 follow-up append 的
两步流程，不是自我引用），与 `archive.json` 的字段是独立的两件事。

### D5: archive.json 与 .openspec.yaml 共存

`archive.json` 管处置记账（codeCommit / ephemeraDiscarded / handoffAbsorbed /
probes / evidence）。`.openspec.yaml` 管质量捕获（quality 字段）。两者关注点
不同，共存于归档目录。不合并、不替换。

### D6: `rasen work migrate` 反转方向

旧迁移器把 in-repo ephemera 迁入 machine home work 目录。终端模型反转：
machine home 的遗留状态迁入 child A 建立的终端落点。

命令名不变（`rasen work migrate`），因为旧迁移器是到一个已不存在模型的桥梁；
反转方向是它的自然完成。`--dry-run` / `--json` / `--yes` / `--include-tracked`
契约不变。但迁移候选集和目的地完全反转：

- 旧 `workDir` 中的报告（review、QA、CSO、benchmark、verification、ship-log）
  → `<changeRoot>/evidence/`（已归档 Change → 对应 Archive 的 `evidence/`）
- 旧 `workDir` 中的 handoff 文档 → `<changeRoot>/handoff/`
- 旧 `workDir` 中的 run-state → ephemera（execution root）；已归档 Change
  的 run-state 直接丢弃并在迁移报告中列出
- machine root 下的历史 probe 目录逐个按分类判定顺序重分类
- `machineHome/design-docs/` → `<planningRoot>/rasen/design-docs/`

迁移器是最后一个实现任务（它迁移到 child A 的终端状态，该状态必须先稳定）。

### D7: 冲突不覆盖

迁移一切冲突时不覆盖，保留两份并交给用户判定权威副本。这与旧迁移器的
"destination file already exists → skip and report as conflict" 一致，但方向
反转后冲突的含义也反转（现在冲突是目标位置已有文件，而不是源位置）。

### D8: `--dry-run` 作为 validate 盲区的闭环

`rasen validate` 不把 delta 套用到 main specs。`rasen archive --dry-run`
报告全部计划动作（spec sync、change 目录 move、ephemera 删除清单、handoff
判定结果）而不执行任何操作——这闭合了 validate 盲区：你可以在不提交的情况下
预演完整的 archive 流程（包括 spec 重建）。

### D9: `change-work-dir` 迁移生命周期反转

`change-work-dir` 的 "Migration completes the sticky-legacy lifecycle" 需求
当前描述旧方向（change 目录 → machine home）。终端模型反转：迁移把 machine
home 的遗留内容移入终端落点，此后终端位置的副本是唯一副本。

读取链方向不变（`file-placement` 的 sticky-legacy 链：终端位置优先，machine
home 回退）。但迁移完成后 machine home 的副本不再存在。

## Alternatives considered

### A1: mint 新能力 `archive-disposition` 而非 MODIFY `file-placement`

被 planner-1 的发现否决：`file-placement` 已在 main specs，本 change 的 delta
MODIFY 它（加处置需求），不另起新能力。另起会产生 TBD placeholder 风险，且
处置规则是文件类型模型的自然延伸，不是独立关注点。

### A2: CLI 执行 handoff 吸收判定

被否决：吸收判定需要语义理解（"这条死路是否已被 design.md 覆盖"），这不是
确定性 CLI 操作。把唯一的裁量点放在 agent 层（skill 引导），把确定性的清理
和记账放在 CLI 层。

### A3: `archive.json` 替换 `.openspec.yaml`

被否决：两者关注点不同（处置记账 vs 质量捕获）。合并会让 archive-quality-capture
能力失明。共存更干净。

### A4: 迁移器新建命令名（`rasen work consolidate`）

被否决：旧迁移器���到一个已不存在模型的桥梁，反转方向是自然完成而非新功能。
保留命令名减少用户认知负担。`--dry-run` 预览让方向反转可见。

### A5: archive 时递归扫描 probes 并纳入清理

被否决：probes 处置是静置——不移动、不删除。archive 只记录其 execution root
相对路径和代码提交。probes 的去留由用户决定。把 probes 纳入清理违背原则 5
（probe 是项目成果物）。
