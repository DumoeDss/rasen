## 36. PR #88 全面审查报告（2026-07-27）

### 36.1 审查结论与本文状态修正

审查对象：

- PR：`DumoeDss/rasen#88`
- 标题：`feat: Store/context portfolio — bootstrap, portable knowledge, and stabilization`
- base：`origin/dev/0.1.5`，`e5c4189022415d1b6062c0e97957d61bb1832d5a`
- head：`a884f5e4414340693fc65b0c7c8db4f05861a1bd`
- 规模：34 commits、321 changed files、60,683 additions、3,564 deletions
- 审查 worktree：
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-pr88-review`

**结论：BLOCK / 不建议合并。**

PR 在身份、membership、Store scope、bootstrap、portable knowledge 和 stabilization
方面已经落下大部分实现，但当前仍同时存在：

1. 可导致 checkout 或 catalog 数据丢失的并发缺陷；
2. obtain 后未完成身份闭环，可能把错误仓库登记成期望 Store/Project；
3. merge conflict resolution 重新引入的 pipeline/init 回归；
4. 两个可稳定复现的既有测试失败，以及无法在 15 分钟内完成的全量测试；
5. canonical specs、change 状态、验收 artifact 与发布说明未收口。

因此，本文前面仍把“从 Phase A 开始”写成下一 Session 入口的段落已经失效。
截至本报告，**有效状态应解释为：Phase A–F 的主要代码已集中到 PR #88，但该 PR
仍是未通过验证的 release candidate，不是完成态。** 本报告覆盖并替代本文
§2.1、§2.4、§35 中关于“下一步从 Phase A 开始”的指令；历史设计内容保留，
不得再把它当作当前执行状态。

本次审查未修改 PR 代码，只将审查结果追加到本文。

### 36.2 证据范围

本次不是只看 PR 摘要或少量热点文件。相对 `origin/dev/0.1.5...HEAD` 的实际
变更按目录统计如下：

| 范围 | 文件数 | diff 行数 |
|---|---:|---:|
| `src/**` | 86 | 26,937 |
| `test/**` | 69 | 20,333 |
| archived change artifacts | 79 | 8,271 |
| canonical `rasen/specs/**` | 24 | 2,711 |
| docs | 6 | 2,553 |
| UI package | 12 | 238 |
| 其他 | 45 | 3,204 |

审查同时覆盖：

- head 与 base 的完整 diff；
- head merge commit 相对 first parent 的回归；
- 本文的锁定决策、阶段 Gate、测试矩阵和 release Gate；
- canonical specs 与仍然 active 的 delta specs；
- PR 状态检查、归档任务真值和可复查验证证据；
- lint、build、focused regression tests、full Vitest 和 `git diff --check`。

严重度统计：

| 严重度 | 数量 | 合并含义 |
|---|---:|---|
| Blocker | 5 | 任一项未解决都不得合并 |
| Major | 15 | 必须修复或经明确设计决策接受并补齐回归测试 |
| Minor | 2 | 合并前应清理 |
| Trivial | 2 | 可随修复批次一并处理 |

### 36.3 Blocker findings

#### B1. Release/test Gate 未兑现，归档任务与可复查事实冲突

**证据**

- 本地 `pnpm run lint` 通过。
- 本地 TypeScript build 通过。
- `pnpm test` 独占运行 15 分钟仍未结束，被超时终止，不能作为 green evidence。
- 两个既有 focused regression test 可稳定复现断言失败：
  - `test/commands/pipeline.test.ts:2446-2475`：
    `counts delegated stages as outstanding...` 期望 `completed=[]`，实际得到
    `['propose','apply','verify']`；
  - `test/commands/pipeline.test.ts:2361-2403`：
    `child carries an out-of-enum status...` 期望 `status='unknown'`，实际得到
    `status='pending'`。
- `git diff --check origin/dev/0.1.5...HEAD` 失败；14 个 canonical spec 文件带
  `new blank line at EOF`。
- GitHub 当前唯一 status check 是 Docs site 的 `build-and-deploy`；没有项目
  lint/build/test check。本文 §23.4 明确要求不能只依赖 docs-site。
- `rasen/changes/archive/2026-07-27-store-bootstrap-diagnose/tasks.md:78-80`
  如实保留 `[ ] Full suite green` 并记录 6 个失败。
- `rasen/changes/archive/2026-07-27-store-bootstrap-repair-text/tasks.md:62`
  却将 `Full suite green` 标为 `[x]`，同一行又记录 full suite 有 530 个失败。
- E2 `store-bootstrap-adopt-local/tasks.md:91` 和 E3
  `store-bootstrap-obtain/tasks.md:89` 也勾选 full-suite gate，却没有持久、可复查
  的 full-suite green 结果。
- 本 PR 自己新增的
  `rasen/changes/stabilize-store-context-foundation/specs/verify-ship-evidence/spec.md:5-12,31-34`
  要求 Gate 必须由已取得的可检查证据结算，这些任务状态违反该要求。
- 本文 §26、§28.5、§32.4 要求的集中真实场景验收清单和
  `human-scenario-accepted` artifact 不存在。

**影响**

绿色 Docs check 会掩盖真实 release Gate 未通过；归档任务不能作为“已完成”的
可信证据。当前不能证明 321 个文件的变更可发布。

**要求**

1. 先修复本报告中的行为回归；
2. 串行运行并保存 `pnpm lint`、`pnpm build`、`pnpm test`、`git diff --check`
   的最终结果；
3. 更正 E1–E4 tasks 的事实状态，不得用“非本 change 引入”替代
   “full suite green”；
4. 增加真正覆盖项目测试的 required CI check；
5. 完成本文规定的真实用户场景验收并保存 artifact。

#### B2. `delegated` 被重新计为普通 run 的完成阶段，可能提前进入 delivery

**证据**

- `src/core/pipeline-registry/run-state.ts:576-589` 的
  `completedStages()` 将 `delegated` 与 `done`、`skipped` 一起返回。
- `src/commands/pipeline.ts:850-859` 的普通 resume 路径直接用该集合计算 ready、
  next 和 remaining。
- 上述 focused test 在 `test/commands/pipeline.test.ts:2446-2475` 已复现失败。
- `git diff HEAD^1..HEAD -- src/core/pipeline-registry/run-state.ts` 显示 first
  parent 已明确排除 `delegated`，最终 merge resolution 又将它加入。

**影响**

父 run 没有 `portfolio-run.json` 或 portfolio 状态不可用时，尚由 child 持有的
工作会被误判为已经完成；resume 可能跳到 delivery/ship。

**要求**

恢复 first-parent 的语义：普通 run 只把 `done|skipped` 视为完成；
`delegated` 是否完成必须由 portfolio child 的 durable state 决定。保留并修复
现有回归测试，再增加“portfolio record 缺失/损坏”场景。

#### B3. clone 失败清理存在 TOCTOU，可删除另一进程成功创建的 checkout

**证据**

- `src/core/store/bootstrap.ts:1508-1548` 在 clone 前以一次
  `fs.existsSync(target)` 记录 `targetExistedBefore`。
- clone 失败后，只要旧观察为 absent，就在
  `src/core/store/bootstrap.ts:1525-1530` 无条件递归删除 target。
- 该 guard 同时服务 Store 和 Project obtain。
- `test/core/store/bootstrap-obtain.test.ts:290-319` 只覆盖单进程、预先存在
  target，没有覆盖两个 bootstrap 指向同一 absent target 的竞态。

**触发与影响**

进程 A、B 同时看到 target 不存在；A clone 成功；B 因 target 已存在而 clone
失败；B 依据旧的 absent 观察删除 A 的成功 checkout，造成真实数据丢失。

**要求**

clone 到每次调用独占的 staging 目录，再以 no-replace/所有权可证明的方式发布；
清理只能删除当前事务持有的 staging。增加跨进程、同目标并发 clone 回归测试。

#### B4. Store obtain 后不校验期望 UID，错误 remote 会被登记成正确 Store

**证据**

- `src/core/store/bootstrap.ts:1626-1655` clone 成功后直接调用
  `registerExistingStore({ path })`，随后把原 expected entry 标为
  `obtained`、`verified`。
- 该路径没有重读 clone metadata 并比较 `entry.uid`。
- Project obtain 在 `src/core/store/bootstrap.ts:2720-2739` 已有身份比较，
  证明 Store 路径缺少了同类必要步骤。
- main spec `rasen/specs/store-bootstrap/spec.md:373-375` 要求 checkout 身份不符时
  不得写任何内容。

**影响**

声明 remote 被替换、配错或指向另一个有效 Store 时，错误 Store 会进入 registry，
并可能继续提供错误 membership/bundle 数据；报告却声称期望 Store 已验证。

**要求**

注册前读取 clone 的现代/legacy Store metadata，严格比较永久 UID；缺失、不可读
或不匹配都 fail closed，保留 checkout 供检查，但 registry 零写入。增加 wrong
UID、missing UID、unreadable metadata 三类测试。

#### B5. 固定 30 秒 stale lock 会抢占仍活跃的 bundle import

**证据**

- `src/core/file-state.ts:62-64,139-147` 仅按 mtime 超过 30 秒判断 stale，并直接
  删除 lock；没有 heartbeat、owner token 或进程存活检查。
- `src/core/file-state.ts:164-169` release 时无条件删除 lock path，不能证明它仍
  属于当前 holder。
- `src/core/knowledge-bundle/import.ts:917-920` 在整个 import 发布事务期间持有该
  lock。大 bundle 或慢盘完全可能超过 30 秒。

**影响**

第二个 importer 可删除第一个仍活跃的锁并进入；旧 holder 最后还会删除新
holder 的锁。两个 all-or-nothing 事务可能交错，出现“命令报告成功，但随后另一
事务 rollback 删除了该记录”的 catalog 丢失/不一致。

**要求**

锁文件写入唯一 owner token；使用 heartbeat 或可证明的 owner liveness；release
只删除自己的 token。增加持锁超过 30 秒、旧 holder 释放、新 holder 仍运行以及
双进程 import/rollback 测试。

### 36.4 Major findings

#### M1. Project obtain 将缺失/不可读的 `projectId` 当作可接受

`src/core/store/bootstrap.ts:2725-2749` 只在 cloned ID“存在且不相等”时拒绝；
ID 缺失时仍使用 Store record 的 ID 调用 `registerProject()` 并报告 obtained。
错误或旧仓库会被登记成目标 Project。缺失、不可读、不合法和不匹配都必须
fail closed，且 registry 零写入。

#### M2. 显式 `globalDataDir` 未贯穿 Store 注册写路径

`BootstrapInput` 支持 `globalDataDir`，大部分 bootstrap 读路径也构造了
`options`；但 `src/core/store/bootstrap.ts:1635,1824,2607` 三处调用
`registerExistingStore()` 时没有传入。`src/core/store/operations.ts:945-1071`
又始终使用默认 registry 路径。embedder 传入目录 A、进程默认目录为 B 时，
bootstrap 会从 A 规划、写入 B，并可能错误报告 complete。应让注册 API 接收并
贯穿 `StorePathOptions`，增加 A≠B 的三路径测试。

#### M3. merge resolution 重新引入 init learned-materialization 静默失败

`src/core/init.ts:856-894` 吞掉 plan 和 per-tool reconcile 的所有异常；相对
first parent 还丢失 `previousStores` 和 `execution.globalDataDir` 传递。
`src/core/update.ts:784-830` 保留了正确的诊断和上下文实现。结果是 init 表面成功，
但 learned skills 未生成，旧 Store outage relevance、自定义 machine-home 的
global artifact ledger 还可能走错。应恢复 first-parent/update 的错误报告、
repair、`previousStores` 和 `globalDataDir`，并添加 merge regression test。

#### M4. Portfolio JSON 把未知 child status 伪装成 `pending`

`src/core/pipeline-registry/portfolio-state.ts:109-126` 虽保存 `statusRaw`，却把公开
`status` 改为 `pending`；`src/commands/pipeline.ts:705-714` 原样输出该值。
`test/commands/pipeline.test.ts:2361-2403` 已稳定失败：期望 `unknown`，实际
`pending`。delivery guard 仍会阻止交付，所以低于 B2，但 API 状态已发生不兼容
变化。公开状态应为 `unknown`，原值可另存 `statusRaw`。

#### M5. Store learned catalog 在 crash backup 存在时被静默读成空

`src/core/learned-skills/catalog.ts:337-351` 静默跳过
`.rasen-learned-skill-backup-*`；恢复仅在下一次 mutation 的
`src/core/learned-skills/mutate.ts:989-1032,1157-1160` 执行。普通 effective read
在 `src/core/learned-skills/effective.ts:595-600` 因此看不到仍可恢复的真实记录，
并可能选择 global fallback 或清理 materialization。这违反本文
“unavailable 不得解释为空集合”的 fail-closed 决策。read path 应将可恢复 backup
报告为 degraded/unavailable，禁止从“空 catalog”推导 destructive reconciliation。

#### M6. Membership authority 在 plan、canonical specs 和 Session 实现之间矛盾

本文 §12.4、§17.4、§34 锁定 Store
`.rasen-store/projects/<projectId>.yaml` 为 membership authority；
`rasen/specs/store-project-membership/spec.md:8-10` 也称其为 single authority。
但 `rasen/specs/session-runtime-context/spec.md:211-234` 和
`src/core/management-api/session-launch-context.ts:72-107` 允许 Store record
**或 Project 自己的 Store declaration** 任一授予 Session 资格。

这让 Project 的 locator/planning declaration 同时成为 membership grant，破坏
authority 分离。必须做一次明确设计裁决：如果 Store record 是唯一 authority，
删除 declaration OR arm 并提供 legacy migration；如果要保留兼容 union，就必须
修订本文锁定决策和 membership canonical spec，明确其权限及退出时间。

#### M7. Store membership record 是无锁 read-modify-write，会丢并发字段

`src/core/store/membership.ts:730-760` 读取旧 record、compose 整个 next、覆盖写回；
`src/core/store/project-records.ts:462-478` 只有单文件 temp+rename，没有 lock/CAS。
两个进程同时更新同一 Project 的 roles、adoption 或 remote 时，last writer 会
静默丢掉另一个字段。应按 Store+projectId 加 owner-aware lock，并在锁内重读、
merge、verify。

#### M8. Project `storeMemberships` hint 同样存在无锁覆盖

`src/core/project-config.ts:2060-2127` 在 2079 行读取完整 hints，提前构造新数组，
随后覆盖整个 YAML 字段；writer 虽重读 YAML 以保留其他字段，却不会 union 此间
新增的 hints。两个并发 Store membership 添加可互相丢失。应在 config lock 内
重读并按永久 UID merge，增加不同 Store 并发添加测试。

#### M9. 手写/legacy credential-bearing remote 可进入 git argv 和错误信息

`src/core/project-config.ts:1421-1433` 的 durable pointer reader 接受任意非空
remote；`src/core/store/bootstrap.ts:2191-2220,2050-2055` 将原值送入 obtain；
`src/core/store/git.ts:160-180` 把它放入进程 argv，并将底层 `error.message`
拼入用户错误。正常写路径虽有 `assertCredentialFreeRemote()`，但手写或 legacy
配置可绕过，令 token 出现在进程列表、日志或异常中。bootstrap 在执行前也必须
拒绝 credential-bearing remote，错误文本只能使用 redacted URL。

#### M10. 大写 Project ID 无法导入自己刚导出的 bundle

`src/core/project-knowledge-home.ts:96-113` 导出路径按 trim+lowercase 规范化
project ID；registry 在 `src/core/project-registry.ts:310-313` 保留原字符串；
import 在 `src/core/knowledge-bundle/import.ts:1107-1138` 又与 registry 原值严格
比较。`test/core/knowledge-bundle/export.test.ts:184-229` 已证明 uppercase
registry 会导出 lowercase bundle，却没有 roundtrip import 测试。所有比较必须
使用 `normalizeProjectIdentity()`，并添加 uppercase UUID export→import 测试。

#### M11. 损坏的 legacy-only Store metadata 可被误判为完整 Project

`src/core/store/foundation.ts:210-217` 明确支持读取 legacy
`.openspec-store/store.yaml`；但 `src/core/store/bootstrap.ts:2933-2938` 把
metadata 读取异常压成 `null`，随后只用现代 `.rasen-store` 目录判断 Store-first。
legacy-only metadata 损坏时会落入 project-first；若没有 projectId/声明，最终
甚至可报告 `origin: project, state: complete`。metadata reader 应返回
`absent|valid|unreadable`，同时探测现代与 legacy 位置；unreadable 必须 blocked。

#### M12. Stabilization change 未归档，canonical specs 未同步

`rasen/changes/stabilize-store-context-foundation/` 仍是 active change，虽然 tasks
全部勾选；7.2 只做 archive rehearsal。该 delta 中的 pipeline/session/Store
identity/verification evidence requirements 尚未完整进入 `rasen/specs/**`，
applicability 的修改也只留在 delta。代码已经依赖这些规则，canonical specs 却
不是最终 ground truth。合并前必须真实 archive/sync，再运行 requirement title、
scenario preservation 和 Purpose 检查。

同一类漂移还出现在
`rasen/specs/store-bootstrap/spec.md:5`：Purpose 仍说 obtaining、registering、
writing declarations “not part of this capability yet”，而同文件
304、322、373 行及实现已经包含这些能力。Purpose 必须更新到 E4 后的最终语义。

#### M13. 本权威计划的 current-state/command contract 已陈旧

本文 §2.1、§2.4、§35 仍把 Phase A 作为下一步；§3.2 仍称
`LearnedSkillScope` 只有 `project|global`，实际
`src/core/learned-skills/types.ts:26` 已为 `project|store|global`；§19 不含
`--apply`，并保留旧 `--store-path/--project-path/--clone-root` 形态，实际 CLI
使用 `--apply`、`--path`、`--into`，裸 `rasen bootstrap` 只列模式。

本 §36 已修正执行状态，但后续仍应对前文加显式 obsolete 标记并更新命令契约，
避免新 Session 复制错误命令或重复实施 Phase A。

#### M15. Release notes 没有完整表达 A–E 行为和版本边界

`CHANGELOG.md` 已记录 Store config scope、migration commands 和 F1–F4 portable
knowledge，但没有完整说明 Store UID、project-keyed membership、Session runtime
context、Store-scoped learned resolution、bootstrap apply/obtain/doctor 的整体
迁移语义，也没有按本文 §29.2 明确声明 `0.1.5` 不包含 Issue、Execution Plan 和
portable run checkpoint。应按实际 shipped surface 补齐，而不是只从最后几个
child change 摘录。

### 36.5 Minor / Trivial findings

#### Minor

1. PR body 声称每个 child 都通过 role-isolated review，但 13 个相关 archive
   change 中没有可审计的 `review-report.md`/ship log；现有持久 combined
   verification 只覆盖 A–D2，且记录过 `pnpm test` exit 1。应链接真实 artifact，
   或收回无法证明的表述。
2. `src/commands/bootstrap.ts:1-16` 顶部注释仍称 bootstrap 只有两种只读模式、
   没有 mutation flag，与 `--apply` 相反。

#### Trivial

1. `src/locales/ja.json:446,450` 和 `src/locales/zh-cn.json:446,450` 分别重复
   `unknownHostRuntimeWarning` key；JSON 后值覆盖前值，当前文本虽相同，仍会给
   维护和生成器带来歧义。
2. PR body 的 `Blocklers` 是拼写错误。

### 36.6 验证结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `pnpm install --frozen-lockfile --prefer-offline` | PASS | clean worktree 安装成功 |
| `pnpm run lint` | PASS | 无 lint error |
| TypeScript build | PASS | build 成功 |
| delegated focused regression | FAIL | expected `[]`，actual `propose/apply/verify` |
| unknown child status focused regression | FAIL | expected `unknown`，actual `pending` |
| `pnpm test` | NOT PROVEN | 独占运行 15 分钟仍未完成，超时终止 |
| `git diff --check origin/dev/0.1.5...HEAD` | FAIL | 14 个 main spec EOF whitespace errors |
| GitHub required checks | INSUFFICIENT | 只有 Docs `build-and-deploy: SUCCESS` |
| real user scenario acceptance | MISSING | 无 checklist / `human-scenario-accepted` artifact |

`git diff --check` 涉及：

```text
cli-artifact-workflow
config-resolution
learned-skill-effective-materialization
portable-project-knowledge
project-knowledge-home
session-runtime-context
session-supervision
store-adopt
store-bootstrap
store-config-inheritance
store-eject
store-identity
store-project-membership
store-scoped-learned-skills
```

### 36.7 已确认通过的部分

以下内容在本轮有正向证据，但不足以抵消上述 Blocker：

- PR base 正确指向 `dev/0.1.5`，当前 GitHub 判定 mergeable；
- lint 和 TypeScript build 在 clean detached worktree 通过；
- F1→F4 已按顺序归档；
- `portable-project-knowledge` canonical spec 已形成最终 requirement 集；
- 没有发现 Issue、Execution Plan、Issue Board 或 portable run checkpoint 的实现，
  因而 `0.2.0` 的功能边界本身没有被代码突破；
- clone 使用 `execFile` 参数向量而非 shell 拼接；
- Store/Project obtain 的单进程“预存目录不删除”测试存在；
- PR 没有 Greptile 评论、人工 review 或额外 CI 结果需要另行 triage。

### 36.8 合并前修复顺序

必须按以下顺序收口，避免先“修文档”掩盖行为风险：

1. 修复 B3 clone 所有权/清理和 B5 lock ownership；增加跨进程并发测试。
2. 修复 B4/M1 obtain 身份验证；Store 和 Project 都执行
   `valid + present + exact canonical identity` 后才允许注册。
3. 修复 B2、M3、M4 三个 merge regression，恢复并通过现有 focused tests。
4. 修复 M2 数据目录贯穿、M7/M8 membership 并发写、M9 remote redaction。
5. 修复 M5、M10、M11 的 fail-closed/canonicalization 问题。
6. 对 M6 做 authority 设计裁决，并使 plan、canonical specs、delta specs、代码和
   tests 只有一个答案。
7. 真实 archive/sync stabilization change，更新 `store-bootstrap` Purpose、
   本文 current-state/CLI contract、CHANGELOG 和 PR scope。
8. 拆分或正式纳入 UI theme 变更。
9. 清理 diff-check，串行运行完整 lint/build/test，并保存机器、命令、退出码、
   通过/失败计数和失败归因。
10. 在 fresh machine-home 完成本文 §26 的 Store roster → exact checkout →
    real Agent/Change 场景，保存 `human-scenario-accepted`。
11. 为项目测试增加 required CI check；所有 required checks green 后再重审 delta。

在第 1–11 项完成前，不得将 PR #88 标记为 release-ready，也不得以
`mergeable: MERGEABLE` 或 Docs check green 代替产品、数据安全和发布 Gate。
