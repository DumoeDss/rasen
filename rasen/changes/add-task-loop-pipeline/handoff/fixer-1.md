# FIXER Round 1 Handoff

## 交接原因

本轮在修复过程中发生上下文压缩。按照 `rasen-review-cycle` 的上下文卫生要求，停止继续扩展修改，并把当前工作集交给下一位 FIXER。当前补丁是**未完成的原子修改**：`git diff --check` 已通过，但尚未通过 TypeScript 构建、测试或端到端验证。

## 已完成

- 完整阅读了评审报告、proposal、design、delta spec、tasks、`test/AGENTS.md`、相关现有实现和安全路径/输入读取 seam。
- F1/F4 部分：在 TaskLoop 核心中加入更严格的工作证据、判定证据和 actor attestation 校验思路；判定结果现在携带逐条 criterion 的 evidence digest，并开始校验 action/run/change/tree/schema 绑定。
- F2 部分：
  - `safe-path.ts` 增加根目录/现存路径组件的物理路径检查，拒绝符号链接/可识别的 reparse point 和非普通文件。
  - `input-reader.ts` 增加基于文件描述符、大小受限、尽可能使用 `O_NOFOLLOW` 的 JSON 读取器，并在读取前后复核路径。
  - `pipeline.ts` 将 `--input-file` 限定为 TaskLoop，且只允许从当前 change 的 ephemera 根读取。
- F6 部分：增加 TaskLoop 运行计划的精确语义形状检查，要求 `evaluate(goal, rasen-task-loop) -> ship -> archive`，并限制角色、访问方式、依赖和 gate。
- F7 核心方案：撤回对通用 evaluate schema 的字段扩张；仅在 TaskLoop plan-aware 模式下投影扩展判定字段，通用 evaluate 仍走严格 schema。
- F8 部分：TaskLoop 报告开始包含 criterion evidence digests、原始 evidence 内容及 action/tree 关联；在 facade 中加入 workspace observer/report regeneration 的辅助函数骨架。
- `git diff --check` 通过；仅出现仓库既有的 LF/CRLF 提示。

## 当前工作集

本轮直接修改：

- `src/core/change-run/internal/safe-path.ts`
- `src/core/change-run/internal/input-reader.ts`
- `src/core/change-run/internal/task-loop.ts`
- `src/core/change-run/internal/goal-cycle.ts`
- `src/core/change-run/internal/goal-cycle-runtime.ts`
- `src/commands/pipeline.ts`
- `src/core/change-run/internal/facade-runtime.ts`

仓库中还有作者和用户的其他未提交修改。不要覆盖或回退 `rasen/config.yaml`、`.rasen/` 运行状态、`rasen/changes/add-thing/`、`rasen/changes/ecp-v2-default-authoring-and-builtins/`、`rasen/specs/billing/`。

## 尚未完成

1. 先恢复可编译状态：
   - 在 `facade-runtime.ts` 的 resume/complete/inspect 路径接入 `observeTaskLoopWorkspace()` 和 `regenerateTaskLoopReport()`。
   - 更新所有 `validateTaskLoopCompletion(...)` / `assertTaskLoopMayDeliver(...)` 调用的新参数。
   - 在 `runtime-context.ts` 接入动态 workspace observation，避免每个 action 都沿用 initial revision。
   - 修正可能的 TypeScript 类型问题：`Digest` 转换、task-loop judge result、`O_NOFOLLOW` 常量检测、`JsonValue` 投影。
2. F1：完成 current-tree/work-chain/delivery 的运行时接线；更新 fixture，以 `buildEvidenceRef` 生成真实 digest 和精确 binding；补 mismatch、missing、unrelated、stale tree、wrong action/run/change/schema 的负向测试及端到端测试。
3. F2：修正 `parseJsonBytes` 不应吞掉自身 `InputReaderError` 的问题；更新 `pipeline-start-input` 测试以传入授权根；增加真实 symlink/junction/父目录交换/越界/大文件/非普通文件测试。保留并文档化 Node 跨平台 API 无法完全识别任意 reparse tag，以及多组件父路径替换的残余限制。
4. F4：补 builder/reviewer 的 agent role/runtime/session digest 分离测试，包括同 session、角色伪造、runtime 不匹配、缺失 attestation。
5. F5：不要信任 caller 提供的 launch digest。基于规范化的 pipeline + inputs 重算/核对可信启动身份，并明确兼容旧的空 digest 记录；补 spoof 和 legacy 测试。
6. F6：除运行计划形状外，还必须要求 resolver 来源是 package built-in，并拒绝同名 project/user shadow；补 shadow 和错误 DAG/角色/access 测试。
7. F7：补回归测试，证明通用 evaluate 拒绝 TaskLoop 扩展字段，而 TaskLoop plan-aware 解码接受它们。
8. F8：完成 report 在 resume/inspect/缺失或陈旧场景下的确定性再生；不能吞写失败；补 missing/stale/write-failure/manual-edit 测试。
9. F9：更新 README，说明 `rasen-auto` 的 task-loop 路由、适用边界、输入/恢复行为、与 spec-driven 流程并列且不升级。
10. F3/最终验证：先运行 `pnpm run build`、lint 和 focused tests，再跑确定性的全套测试（必要时稳定分片），把评审中的 31 个失败逐项归因到本 change、既有失败或环境问题；完成后写 `evidence/review-fix-round-1.md`。本轮尚未写该 DONE 证据文件。

## 已排除的方向

- 不再建立一套平行的路径安全实现；复用 `SafeRunPath` 和 bounded input-reader seam。
- 整个 actor 的 `identityDigest` 不能证明 reviewer 新上下文；必须比较 agent `sessionIdentityDigest`。
- caller 传入的 `launchRequestDigest` 不能作为可信恢复身份；必须从已规范化的请求/记录字段验证。
- 不能为了 TaskLoop 扩宽通用 evaluate schema；扩展字段必须由 plan-aware TaskLoop 解码处理。
- 这不是从轻量循环“升级”为 spec 流程；它应继续作为 `rasen-auto` 下独立的 TaskLoop pipeline。

## 下一步入口

先查看 `src/core/change-run/internal/facade-runtime.ts` 中 resume、complete、inspect 的现有分支，以小补丁接入 workspace observation 和 report regeneration；随后查看 `runtime-context.ts` 的 action 构造路径，并立即运行 `pnpm run build`。构建通过后再补安全与证据负向测试，不要在未编译的状态上继续叠加功能。
