# Planning context — codex-audit-enrichment

## User intent (verbatim)

「认真分析codex的数据，把能补全展示的都补全！」— 用户发现 `rasen agent audit` 的 Codex 报告比 Claude 报告薄很多,并用真实 rollout 样本证明了 Codex 原始数据其实比工具当前利用的丰富。目标:把 Codex 原始数据**能支持的展示全部补全**,数据真不支持的维度如实标注,不造假。

## LEAD 已完成的调查(planner 不必重查这些结论,可抽查验证)

### Codex rollout 原始数据实际有什么(用户样本 + parse-codex.ts 已验证)

`~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`,每行 JSON。关键事件:

- `event_msg / token_count`:带 timestamp;`info.total_token_usage`(单调累计)**和 `info.last_token_usage`(逐请求增量,当前解析器完全没用它!)**,两者都有 `input_tokens / cached_input_tokens / cache_write_input_tokens / output_tokens / reasoning_output_tokens / total_tokens`;还有 `model_context_window`(当前也没用,可算 occupancy)。
- `event_msg / task_started|task_complete`:带 `turn_id`,turn 边界。
- `response_item` 行:reasoning 是 encrypted_content(不可读),但 message/custom_tool_call 有明细与 `turn_id`。
- `session_meta` 首行:threadId、fork 谱系。

### 现有实现的缺口(源码已核对)

1. `src/core/token-audit/parse-codex.ts` — 逐请求差分**已经提取** ts/turnId/缓存读写增量,但只用 `total_token_usage` 差分;`last_token_usage` 未用(可交叉校验/更准,尤其重放/重置场景)。
2. `src/core/token-audit/audit.ts:404-427`(runCodexAudit)— 把逐请求数据聚合进 turn 后**丢弃**;`CodexAuditResult` 无逐请求 timeline 行、无 churn 检测、无 burst 聚类。
3. `classify.ts` 的 Claude churn 分类依赖 parentUuid 链/注入行/compact 标记 — Codex 没有这些,**成因归因**只能做子集:间隔法 TTL 猜测、cache-read 骤降检测(HIT_PREFIX_RATIO 思路可移植),rebase/injection 归因数据不支持 → 报告须如实标 "unattributed / 数据不支持"。
4. viewer(随包分发,`--open` 打开)只对 Claude 结果渲染时序图/churn 视图;Codex 结果结构(`CodexAuditResult`)需要新增字段后,viewer 增加对应渲染分支。subagent 时序基础数据已有(family 各 thread 的 firstTs/lastTs/turn 边界)→ 时序图(gantt)可做。
5. billedInputEq:Claude 用钉死的 PRICING 倍率;OpenAI/Codex 计费倍率不同(cached input 有折扣)。可加,但倍率来源要么配置要么写死并标注假设;不确定就先不做或标注。
6. fork 重放:父历史重放进子累计计数器(audit.ts:338 注释),已有 caveat 机制,补全展示时须保留/强化该标注。

### 可补全清单(LEAD 判断,planner 细化取舍)

- Codex 逐请求 timeline(ts/turn/缓存读写/输出)进结果 + viewer 时序渲染(含多 thread gantt)。
- 缓存重建**检测**(cache-read 骤降 vs 前缀)+ 间隔法 TTL 近似归因;归因不了的标 unattributed。
- burst 聚类(clusterBursts 思路可移植)。
- `last_token_usage` 用于差分校验或直接替代差分(评估哪个更准)。
- `model_context_window` → occupancy 展示。
- 数据不支持的维度(rebase/注入归因、逐消息结构)在报告/viewer 里显式标注"Codex 数据不支持",不留白也不假装。

## 全量数据摸底(LEAD 2026-07-24,扫描本机 233 个 rollout / 227MB — 推翻上文部分"数据不支持"判断)

事件覆盖统计(全部 rollout 汇总):

- `token_count` 5513 次,其中 **`info.last_token_usage` 5493 次(99.6%)**、`info.model_context_window` 5446 次。→ **逐请求明细应直接用 last_token_usage**,累计差分只作交叉校验/旧格式 fallback(20 条旧事件无 last_token_usage,须兼容)。
- **`context_compacted` 事件存在(13 次)** → 压缩(context-drop)归因可做,不是"数据不支持"。
- **`thread_rolled_back`(3 次)** → 回滚检测可做。
- **`user_message` event_msg(1520 次)** → 注入检测可做(turn 内出现 user_message ≈ Claude 侧的 injected 判据)。
- **`turn_aborted`(73 次)** → 中断 turn 的边界事件,当前 parse-codex.ts 只认 task_started/task_complete,aborted turn 的归属会悬空 → 须补。
- `session_meta` 键全集:id/timestamp/cwd/originator/cli_version/instructions/git/source/model_provider/base_instructions/**forked_from_id**(31 个 fork)/thread_source/**agent_nickname/agent_path/agent_role/parent_thread_id**(79 个 subagent 相关)/dynamic_tools/memory_mode/session_id/multi_agent_version/history_mode/**context_window**。
- 其他可展示信号:`sub_agent_activity`(23)、`inter_agent_communication_metadata` response_item(16)、`thread_goal_updated`(634)、`web_search_end`(26)、`patch_apply_end`(236)、`mcp_tool_call_end`(1079)、`function_call`/`function_call_output`(5590/5578)、`ghost_snapshot`(6)。
- 修正后的归因结论:Claude 三大 churn 成因中 **压缩(context_compacted)、注入(user_message)、TTL(时间间隔)在 Codex 数据里都有信号**;唯一真缺的是 parentUuid 式消息链分叉检测(rebase 归因)。报告只须对 rebase 类标"数据不支持"。
- 注意各字段是**后期版本才加的**(20 条无 last_token_usage 的是旧 CLI 版本);session_meta 的 cli_version 可用来解释字段缺失。解析须对缺字段 fail-soft,不 throw。

## Constraints / decisions

- 版本号归用户管,不 bump。
- experimental 定位不变(解析内部格式,harness 升级可失效);fail-soft 边界照旧(坏行跳过,格式漂移 throw TranscriptFormatError)。
- viewer 是随包分发的单文件(注意:项目根 scripts/token-audit/viewer.html 是 D5 原型;产品化的 viewer 在 src/ 分发路径,改产品化那份)。
- Windows 平台,测试跑 `pnpm test`(注意已知 EBUSY flake)。
- 中文用户;CLI 文案已本地化(RASEN_LANG),新增文案遵循现有 i18n 机制。

## Planner findings (appended by planner-1, 2026-07-24)

- 产品化 viewer 实为**仓库根 `viewer/audit.html`**(约 570 行单文件,`resolveAuditViewerPath` 从包根 `viewer/audit.html` 解析)——不在 src/ 下;Codex 渲染分支已存在(`renderCodex` 系列),timeline/composition 卡当前对 codex 隐藏(`render()` 里 toggle),补全就是解开该 toggle + 列名间接层。
- 关键设计裁决(见 design.md):D2 Codex 类只复用现有 `RequestClass` 子集 spawn/hit/ttl-expiry/unattributed(viewer 色表键可复用,绝不发 rebase/context-drop);D5 累计差分仍为 primary,`last_token_usage` 只做交叉校验,分歧超容差走既有 `caveats` 机制(换 primary 会静默改变已见数字,拒);D6 不支持维度用 `unsupportedDimensions: {dimension, reason}[]` 显式列举(命名常量,非模式推导);schema 保持 `rasen-token-audit/2` 纯增量(沿 M1 caveats 先例)。
- delta spec 同时 MODIFIED 了原 "Codex report omits Claude-specific accounting" 场景(改名为 "Codex report presents runtime-appropriate accounting",原文 "SHALL NOT present cache-churn cause classification" 与新增 rebuild 可见性冲突,须整段重述)+ Viewer integration 两场景新增;archive 时注意场景改名=REMOVED+ADDED 语义已由整个 requirement 重述覆盖。
- 占据率估算器(D4)故意留到实现期对真实样本钉死,tasks 1.2 要求把选择回写 tasks.md;billed-equivalent 定价明确 Non-Goal(倍率无来源)。

## Planner revision after 全量摸底 (planner-1, 2026-07-24 second pass)

- 按摸底节全量修订 proposal/design/specs/tasks(validate 仍绿):**last_token_usage 升为 primary**(累计差分=旧格式 fallback + endpoint 交叉校验,分歧→caveat;缺字段=absence 绝不 throw);Codex 类扩到 spawn/hit/context-drop/rebase/ttl-expiry/unattributed 全集,事件证据(context_compacted/thread_rolled_back→context-drop、user_message→rebase=injection)优先于间隔法;**唯一标"数据不支持"的只剩 chain-fork 归因 + billed-equivalent 定价**;`turn_aborted` 作为 turn 边界纳入(CodexTurn.aborted);viewer Codex 路径 rebase 图例文案须写 "injection"(不得暗示链分叉)。
- 上一节 findings 中 "D2 只发 spawn/hit/ttl-expiry/unattributed" 与 "D5 累计差分为 primary" 两条裁决**已作废**,以本节为准。
