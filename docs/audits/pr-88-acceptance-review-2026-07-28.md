# PR #88 验收审查报告

> PR：<https://github.com/DumoeDss/rasen/pull/88>  
> 标题：`feat: Store/context portfolio — bootstrap, portable knowledge, and stabilization`  
> 目标分支：`dev/0.1.5`  
> 审查 head：`728688babeb7da98170f5d450bc0ea9b15c3ddc6`  
> 审查时间：2026-07-27—2026-07-28（Asia/Shanghai）  
> 审查方式：PR 元数据、完整 diff、规格/任务账本、静态代码审查、独立对抗审查、隔离工作树构建与测试、最新基线三方合并验证

## 1. 结论

**验收结论：不通过（CHANGES REQUESTED / BLOCK）。**

PR 在 GitHub 上显示 `MERGEABLE / CLEAN`，但这只说明当前没有文本合并冲突，不代表功能、安全性和发布门禁通过。当前同时存在：

- 至少 8 个合并级 Blocker：锁互斥失效、失败清理可能丢数据、凭证泄露、并发注册破坏 Store 身份、membership 丢更新、alias-only obtain 接受错误 Store、bundle 事务的 crash 原子性缺口；
- 多个 Major：用户确认与实际导入内容未绑定、路径发布 TOCTOU、Project identity 比较未统一规范化、I/O 错误被吞成“成员不存在”、审查证据链不可复核；
- 自动化验收门禁没有得到独立绿灯：`git diff --check` 失败，根测试套件在两种 worker 配置下都未通过；
- PR 自己仍把状态定义为 `integrated-candidate`，fresh-machine 人工验收、`human-scenario-accepted` 产物和 `dev/0.1.5` required CI 均未完成。

因此，本 PR 既不能按“最终产品验收通过”签收，也不建议以当前 head 直接合入成为候选版本。应先修复 Blocker/Major、补回归测试、恢复可复核证据链，再重新审查。

## 2. 审查范围与基线

### 2.1 规模

- PR head 相对三点基线：50 个提交，369 个文件，`+68,423 / -3,644`。
- 当前 `origin/dev/0.1.5` 比 PR head 额外前进 7 个提交。
- 最新基线与 PR 的三方合并树无文本冲突。
- 相对最新目标分支的有效合并结果仍有 342 个文件，`+68,012 / -3,587`。

这个规模不适合用“单一 Docs check + 本地一次测试数字”作为验收证据。尤其本 PR 改动 Store identity、membership、跨机 bootstrap、bundle import/export、learned-skill catalog 和 session runtime context，均属于状态持久化或信任边界代码。

### 2.2 Scope Check

**Scope Check：DRIFT DETECTED / STACKED ANCESTRY**

主要交付与 PR 描述一致：Store/context stabilization、`rasen bootstrap`、portable project knowledge。

但 GitHub PR diff 同时携带了主题默认值、audit 展示、verification workflow、旧 PR 归档等堆叠提交。最新目标分支已经以不同提交包含部分等价主题变更，因此这不全是最终合并树里的新增行为；仍然造成：

- GitHub 审查面与实际合并面不一致；
- 50 个提交中混入非 portfolio 主线事项；
- 审查者难以确认每个行为属于本 PR、目标分支还是等价重放。

建议在重新验收前 rebase/cherry-pick 整理 ancestry，或在 PR 描述中逐项声明仍属于本次交付的非 portfolio 变更。

## 3. 门禁结果

| 门禁 | 结果 | 证据/说明 |
|---|---|---|
| GitHub mergeability | PASS（仅文本层面） | `MERGEABLE / CLEAN` |
| GitHub required project CI | **BLOCK** | status rollup 只有 Docs site `build-and-deploy`；`.github/workflows/ci.yml` 的 PR trigger 仅监听 `main`，本 PR 目标是 `dev/0.1.5` |
| `git diff --check origin/dev/0.1.5...origin/pr/88` | **FAIL** | `rasen/changes/archive/2026-07-27-pr88-review-fixes/planning-context.md:202: new blank line at EOF` |
| PR head `pnpm build` | PASS | 隔离 Windows/Node 24 环境 |
| PR head `pnpm lint` | PASS | exit 0 |
| PR head `pnpm exec tsc --noEmit` | PASS | exit 0 |
| PR head 根测试，2 workers | **NO RESULT / BLOCK** | 15 分钟内未结束，被执行器终止；与仓库 Windows CI job 的 15 分钟 timeout 相同 |
| PR head 根测试，4 workers | **FAIL** | 约 19 分钟，exit 1；报告出现 95 个 failure records，包含测试超时、CLI 子进程未退出、Windows `EPERM` teardown 级联和 session supervisor 断言失败 |
| 高风险专项 7 文件 | **FAIL** | 149 passed / 3 failed / 3 skipped；`bootstrap-obtain` 有 2 个 10 秒超时和 1 个并发结果不稳定 |
| 上述 3 个失败隔离重跑 | PASS | 说明存在 suite-level 时序/资源稳定性问题，不能把组合失败简单归因于确定性逻辑回归，也不能宣称全套绿灯 |
| UI production build | PASS | Vite build 成功 |
| UI 全套测试 | PASS | 48 files / 498 tests |
| 最新基线合并候选 build/lint | PASS | 三方合并后重新执行 |
| 最新基线新增 Codex-context 相关测试 | **UNSTABLE** | 组合运行 107/108，1 个 10 秒超时；该用例隔离重跑通过 |
| 最新基线合并后的相关 UI | PASS | build + 3 files / 44 tests |
| fresh-machine 人工 10 项 | **BLOCK / 未执行** | PR 内 roadmap 明确列为下一步 |
| `human-scenario-accepted` | **BLOCK / 不存在** | roadmap 明确当前仅 `integrated-candidate` |

`git diff --check` 的实际失败直接反驳 PR 描述和 roadmap 中的 “clean” 声明。测试结果也不能支持 “5441 pass / 0 logical failures” 作为本次独立验收结论。

## 4. Blocker findings

### B1. Owner-aware stale lock 抢占不是原子的，可删除新持有者的活锁

位置：

- [`src/core/file-state.ts:295-303`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/file-state.ts#L295-L303)
- [`src/core/file-state.ts:328-352`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/file-state.ts#L328-L352)

代码执行 `read lock → 判断 PID 死亡 → unlink(path)`。两个等待者同时读到旧死锁时：

1. A、B 都判断旧 PID 已死亡；
2. A 删除旧锁并创建自己的新锁；
3. B 仍按路径执行 `unlink`，删除的是 A 的活锁；
4. B 或第三个进程取得新锁，与 A 同时进入临界区。

这会破坏 bundle import、membership record、project config hints 等读改写事务的互斥，可能造成静默丢更新或交错发布。

另一个确定缺陷是：`unlink` 失败被吞掉后仍把 `stolen = true`，循环既不 sleep 也不检查 deadline，可能形成无限高 CPU 忙循环。

现有 `file-state.test.ts` 只覆盖单个 stale stealer 和“替换已完成后再 release”，没有两个并发 stealer，也没有 compare/delete 窗口。

**Required fix：** 使用真正原子的 claim/compare-delete 协议；在跨平台无法保证时，宁可停止自动 steal。补双 stealer、release 窗口和 unlink-failure 回归测试。

### B2. 同一 catalog 混用 30 秒 mtime lock 与 owner-aware lock

位置：

- [`src/core/file-state.ts:121-171`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/file-state.ts#L121-L171)
- [`src/core/learned-skills/mutate.ts:1151-1205`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/learned-skills/mutate.ts#L1151-L1205)
- [`src/core/knowledge-bundle/import.ts:918-964`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/knowledge-bundle/import.ts#L918-L964)

bundle import 使用 owner-aware lock，但普通 learned-skill mutation 对同一 `ResolvedStore.lockPath` 仍使用 30 秒 mtime stale 判定。大 bundle import 或慢磁盘操作持锁超过 30 秒时，mutation 会把活锁删掉；mutation 自身锁内还新增了异步 Store/source 重解析，也可能被另一个 legacy writer 误判 stale。

**Required fix：** 所有相同 catalog writer 必须统一使用修复后的同一锁协议；增加 legacy/owner-aware 混合竞争和持锁超过 30 秒的故障注入测试。

### B3. backup 清理部分失败会删除完整新记录，再恢复残缺旧记录

位置：

- [`src/core/learned-skills/mutate.ts:963-979`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/learned-skills/mutate.ts#L963-L979)
- [`src/core/learned-skills/mutate.ts:1315-1327`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/learned-skills/mutate.ts#L1315-L1327)

新记录发布成功后，代码递归删除 backup。Windows 文件锁、杀毒软件或 I/O 故障可能让递归删除“删掉一部分后抛错”。catch 随后：

1. 删除已经完整发布的新目录；
2. 把可能已经缺文件的 backup 改回正式目录；
3. 或 backup 已消失，正式记录被直接删空。

这是 cleanup failure 触发的数据丢失。现有 backup 测试只覆盖完整的 crash debris，不覆盖“部分删除后失败”。

**Required fix：** 新记录成功发布后，backup cleanup 失败只能保留新记录和残余 backup，并报告 degraded；绝不能回滚到已开始破坏的 backup。

### B4. `?token=` / `?access_token=` 被明确当作安全 remote，凭证会原样持久化和显示

位置：

- [`src/core/store/remote.ts:28-44`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/remote.ts#L28-L44)
- [`test/core/store/remote.test.ts:51-73`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/test/core/store/remote.test.ts#L51-L73)

实现只检查 URL userinfo。`https://host/repo.git?access_token=secret`、signed URL 或其他 query secret 会：

- 通过 `assertCredentialFreeRemote`；
- 写入共享 Store metadata/pointer；
- 在 human/JSON 输出和 clone 失败诊断中原样显示。

测试不是遗漏，而是明确断言 `?token` 和 `?access_token` “不是凭证”，把漏洞固化为预期行为。这违反同文件“Store metadata never carries credentials”的写路径承诺。

**Required fix：** 共享 metadata 只接受无敏感 query/fragment 的 clone URL；至少拒绝或严格清洗 credential-bearing query，并补不泄漏原值的回归测试。

### B5. 同一新 Store 的并发注册可由失败者删除成功者 metadata

位置：

- [`src/core/store/registry.ts:456-522`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/registry.ts#L456-L522)
- [`src/core/store/registry.ts:532-614`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/registry.ts#L532-L614)

两个不同 alias 并发注册同一无 metadata root 时，两者可先观察到 absent，再分别覆盖 metadata。成功方写入 registry；失败方的 cleanup 只按自己的 UID/ID/key 查引用，不检查是否存在“同 canonical backend path”的成功注册，也不验证当前 metadata 是否仍由自己创建，于是可能删掉成功方依赖的身份文件。

结果是 registry 指向一个缺失 Store identity metadata 的坏状态，直接违背本 PR 的 fail-closed identity 目标。

**Required fix：** 按 canonical Store root 串行化注册；cleanup 必须验证 metadata 内容/文件身份仍属于本事务，并检查任意同 backend path 的 registry 引用。补同根、不同 alias 的并发测试。

### B6. eject / migrate-membership 绕过 membership 共享锁，可能静默丢并发更新

位置：

- [`src/core/store/migration-ops.ts:209-223`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/migration-ops.ts#L209-L223)
- [`src/core/store/migration-ops.ts:1321-1333`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/migration-ops.ts#L1321-L1333)

这些路径直接 read-compose-write/delete project record，没有使用 `membership.ts` 已建立的共享 machine lock。

例如 `store eject` 读取旧 record 后，另一个进程通过 `store add-project` 新增 knowledge role；eject 再按旧快照 delete/overwrite，会把刚写入的 role 静默删除。`migrate-membership --apply` 有同型覆盖风险。

**Required fix：** 所有同 project record 的 RMW/delete 必须走同一锁，并在锁内重读；补 add-project × eject、add-project × migrate 的交叉并发测试。

### B7. alias-only Store obtain 跳过声明 ID 校验，可发布并注册错误 Store

位置：

- [`src/core/store/bootstrap.ts:1777-1815`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/bootstrap.ts#L1777-L1815)
- [`src/core/store/bootstrap.ts:1830-1857`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/bootstrap.ts#L1830-L1857)
- 已存在但未复用的 ID probe：[`src/core/store/bootstrap.ts:980-1009`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/bootstrap.ts#L980-L1009)

`entry.uid === undefined` 时，代码明确跳过 identity verification；随后 `registerExistingStore` 也没有收到 expected ID。项目 hint 声明 `expected`，remote metadata 实际为 `other` 时，checkout 仍会被发布、按 `other` 注册，bootstrap 最终把原 entry 报告为 `obtained / verified`。

现有测试只证明 alias-only 路径“能成功”，且 remote ID 恰好相同，没有 mismatch 场景。

**Required fix：** 无 UID 时必须回退比较声明 alias/ID；复用统一 probe，而不是维护第二套分支。补 alias-only remote ID mismatch 的 zero-write/no-publish 测试。

### B8. 多记录 import 在 SIGKILL/断电下不满足声明的 all-or-nothing

位置：

- [`src/core/knowledge-bundle/import.ts:798-883`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/knowledge-bundle/import.ts#L798-L883)
- [`src/core/knowledge-bundle/import.ts:979-1047`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/knowledge-bundle/import.ts#L979-L1047)
- 设计不变量：`rasen/changes/archive/2026-07-26-knowledge-bundle-import/design.md:7`

实现逐记录目录发布，只在可捕获异常时执行 rollback。第 N 条发布后进程被杀或机器断电，前 N 条会保留，既不是“全部加入”，也不是“原树 byte-identical”。

**Required decision/fix：**

- 如果 all-or-nothing 包含 crash consistency：采用 catalog 级原子发布或持久 transaction journal + 启动恢复，并加杀子进程/重启恢复测试；
- 如果明确不包含进程/机器故障：必须收窄 spec、CLI 文档和用户承诺，不能继续使用无条件的 all-or-nothing。

## 5. Major findings

### M1. bootstrap 让用户确认 bundle A，却可能从同一路径再次读取并导入 bundle B

位置：[`src/core/store/bootstrap.ts:1417-1482`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/bootstrap.ts#L1417-L1482)

代码先 dry-run 读取路径、等待异步用户确认，然后从同一路径再次读取并 apply；前后没有比较原始字节摘要、bundle ID、plan fingerprint 或 canonical target。确认期间替换文件/symlink，就会导入未经确认的内容。

**Fix：** 解析一次并传递不可变 bundle/plan；或在确认前后绑定内容摘要、文件身份和 canonical containment。补 consent callback 内换包/换 symlink 测试。

### M2. bundle export/Store transport 的检查到 hard-link 之间仍有路径 TOCTOU

位置：

- [`src/core/knowledge-bundle/export.ts:537-564`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/knowledge-bundle/export.ts#L537-L564)
- Store authorization 路径：[`src/core/knowledge-bundle/export.ts:345-372`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/knowledge-bundle/export.ts#L345-L372)

`pathOwnsOpenFile()` 后还会执行 hook/Store authorization，最后再按 pathname `linkSync`。窗口内替换 temporary path，可让命令成功发布错误字节；窗口内替换授权 parent 为 symlink/junction，可把 bundle 发布到保留 Store 子树之外。

**Fix：** 所有授权后立即重验；发布后验证 destination 与已打开 fd 的身份和完整内容。若平台能力不足以证明，必须失败而不是返回成功。

### M3. Project identity 定义为 trim+lowercase，但新增核心路径仍直接比较字符串

规范化函数：[`src/core/store/project-records.ts:92-98`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/project-records.ts#L92-L98)

未规范化比较包括：

- [`src/core/learned-skills/context.ts:306,337,347,908,915`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/learned-skills/context.ts#L304-L347)
- [`src/core/pipeline-registry/execution-binding.ts:94,123,138,172`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/pipeline-registry/execution-binding.ts#L92-L172)

大小写等价 UUID 会被误报 stale/mismatch/missing；frozen resume 可能拒绝，learned-skill evaluation root 可能回退到另一 clone 的 owner root。

**Fix：** 在边界统一 canonical/brand Project ID；补 registry/config/session/frozen 四方大小写差异测试。

### M4. membership 权威读取把非 ENOENT I/O 错误吞成“没有成员”

位置：

- [`src/core/store/project-records.ts:354-356`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/project-records.ts#L354-L356)
- [`src/core/store/project-records.ts:413-419`](https://github.com/DumoeDss/rasen/blob/728688babeb7da98170f5d450bc0ea9b15c3ddc6/src/core/store/project-records.ts#L413-L419)

`pathIsFile()` 和裸 `catch` 把 EACCES、网络盘瞬断、Windows delete-pending 等都当 absent/empty。Session eligibility 和 Store roster 会静默把真实成员判为不存在。

**Fix：** 仅 ENOENT 返回 absent；其他错误必须抛出或形成 degraded/unavailable diagnostic。补 stat/readdir 权限与 I/O 故障测试。

### M5. 审查证据链不可复核，归档 task ledger 与 PASS/CLEAN 声明冲突

证据：

- `rasen/explorations/pr88-test-cases-and-roadmap.md:9-10` 指向的 `global-store-project-unification-development-plan.md` 不在 PR commit 中；
- `pr88-rf-docs/proposal.md:82-84` 反而明确该文件只是 MAIN worktree 的 untracked note；
- roadmap `:127-128` 声称六个 `pr88-rf-*` child 各带 `review-report.md`，但 `pr88-rf-docs/` 没有该文件；
- `pr88-rf-obtain/tasks.md:235-278`、`pr88-rf-regressions/tasks.md:10-130`、`pr88-rf-validation/tasks.md` 仍有大量未勾选项，却已经 archive，并在 report/PR body 中宣称 PASS/CLEAN。

这不是纯文档美观问题：本 PR 正在交付 spec-driven evidence workflow，自身验收账本却无法复核。

**Fix：** 补独立、可追溯的 completion reconciliation/evidence artifact；修正不存在的链接和过度声明，不要事后伪造历史勾选。

### M6. 测试稳定性与 CI 预算没有验收余量

在本机：

- 2 workers 的完整套件 15 分钟未结束；
- 4 workers 的完整套件约 19 分钟后失败；
- 高风险 7 文件组合也有 3 个失败，隔离后才通过；
- 最新基线相关 4 文件组合有 1 个超时，隔离后通过。

这说明问题不只局限于 roadmap 声称的 `store-membership-cli` 0—4 个 flake；CLI 子进程、Windows teardown 和 10 秒 test timeout 在组合运行时广泛失稳。

**Fix：** 在真实 Windows CI 上复现并记录 per-file duration；消除泄漏子进程/句柄，区分真正慢测试与资源竞争；给 CI 留足稳定余量。不能把无限 retry 当成 required gate。

### M7. PR 没有在目标分支上运行项目 required CI

`.github/workflows/ci.yml` 的 `pull_request.branches` 只有 `main`，而 PR #88 目标是 `dev/0.1.5`。GitHub 唯一成功检查是 Docs site，不能证明：

- Linux/macOS/Windows/Node 20/Node 24 matrix；
- root build/test/lint；
- UI build/test；
- merge result 而不是孤立 PR head。

**Fix：** 让项目 CI 监听 `dev/0.1.5`，并设置 `Test` / `Lint & Type Check` / `UI Package Build` / aggregate check 为 required；重新跑最新 merge commit。

## 6. Minor / documentation findings

1. `rasen/specs/session-runtime-context/spec.md:219` 的 scenario 标题仍是 “declaration-only is a valid choice”，正文 `:221-224` 却明确 session 不启动。应把标题改为 rejection 语义。
2. project config reader 自己吞 parse error 返回 `null`，使 bootstrap 的 “unreadable” 分支与 “missing identity” 合并；与 M1 task 要求的 distinct diagnostics 不完全一致。
3. roadmap 记录 head `c4e54285`，实际是 `728688ba`；写 “Node 5.9.3 toolchain”，但 5.9.3 是 TypeScript，真实 Node 要求为 `>=20.19.0`，pnpm 为 9.15.9。
4. Windows portability gate 未覆盖 `\Users\...` root-relative 和 `\??\C:\...` NT namespace path；应按 `path.win32` 语义补齐。
5. `git diff --check` 的 EOF 空行需要修正，并更新 PR body/roadmap 中的 clean 证据。

## 7. 已核验的正向证据

以下机制经代码与测试抽查，未发现新的独立问题：

- bundle JSON 先作为 `unknown` 解析，再经 strict Zod 校验；
- bundle record ID 有跨平台路径语法与 collision-key 检查；
- 可捕获异常下的 import staging、no-clobber hard link、内容/身份校验和 ambiguous-retain 策略总体合理；
- clone 使用参数数组而非 shell 字符串，普通 URL userinfo 凭证会在 clone 前拒绝并脱敏；
- clone 使用随机 sibling staging，失败不会删除预先存在的最终 target；
- Store transport 在非竞态路径上逐级拒绝 symlink/junction；
- UI 改动对应的 build、498 个 UI 测试以及最新 merge 后的 44 个相关 UI 测试通过；
- 最新基线三方合并没有文本冲突，合并候选 build/lint 通过；
- changed frontend source 未引入 `outline:none`、`!important`、小字号正文、跳级 heading 或新增 CSS 反模式。

这些正向证据不能抵消 Blocker，但说明修复可以聚焦在事务、锁、身份、凭证和验收基础设施，而不必推翻整个 portfolio。

## 8. 高风险覆盖图

```text
CODE PATH COVERAGE
==================
[+] owner-aware lock
    [TESTED] 单 stale owner / 活 owner timeout / 普通 release
    [GAP-BLOCKER] 两个 stale stealer 的 compare-delete 竞态
    [GAP-BLOCKER] release check -> unlink 窗口
    [GAP-BLOCKER] legacy mtime writer 与 owner-aware writer 混用

[+] learned-skill catalog rewrite
    [TESTED] 完整 backup debris 的发现与 degraded 报告
    [GAP-BLOCKER] backup 已部分删除后 cleanup 抛错

[+] Store remote
    [TESTED] userinfo 凭证拒绝与脱敏
    [WRONG-TEST] query token/access_token 被断言为安全并原样输出

[+] Store registration / membership
    [TESTED] 串行 mismatch、rollback、同类 writer 并发
    [GAP-BLOCKER] 同 root 不同 alias 并发注册
    [GAP-BLOCKER] add-project × eject/migrate 交叉并发
    [GAP-MAJOR] EACCES/I/O error 不得等同 absent

[+] bootstrap obtain
    [TESTED] UID wrong/missing/unreadable
    [GAP-BLOCKER] alias-only remote ID mismatch
    [UNSTABLE] clone race / project-first obtain 在组合套件中失败，隔离通过

[+] bundle import/export
    [TESTED] 可捕获 publish failure rollback、conflict no-write、path guards
    [GAP-BLOCKER] SIGKILL/断电后的 multi-record recovery
    [GAP-MAJOR] preview/confirm/apply 内容绑定
    [GAP-MAJOR] ownership/auth check -> pathname hard-link TOCTOU

[+] UI
    [TESTED] 48 files / 498 tests；最新 merge 相关 3 files / 44 tests
    [GAP] roadmap 自己列出的真实浏览器交互与 fresh-machine 场景
```

不能给出可信的全 PR path-coverage 百分比：有效合并仍有 342 个文件和约 7.16 万行，且项目没有生成可审计的覆盖率产物。伪造一个百分比会比明确记录高风险缺口更误导。

## 9. 重新验收条件

重新提交验收前，至少完成以下项目：

1. 修复 B1—B7，并为每个问题增加能在旧实现稳定失败的回归测试。
2. 对 B8 做明确的产品/规格决定；若承诺 crash-safe all-or-nothing，必须实现 journal/recovery 或 catalog 级原子发布。
3. 修复 M1—M4 的 trust boundary、canonical identity 和 error classification。
4. 修复 `git diff --check`，整理 archive task ledger、缺失 review report、失效链接、roadmap head/toolchain。
5. 将 PR 更新到最新 `dev/0.1.5`，对真实 merge commit 运行 required CI：
   - Node 20.19：Linux、macOS、Windows；
   - Node 24：Linux；
   - root build、typecheck、lint、完整 test；
   - UI build、完整 UI test；
   - `git diff --check`。
6. 解决组合套件超时/句柄泄漏，使 Windows required job 在 timeout 内有稳定余量；至少连续 3 次无 retry 全绿。
7. 执行 roadmap 的 fresh-machine 10 项人工场景，保存终端记录/截图/产物路径，生成 `human-scenario-accepted`。
8. 由非作者重新做一次并发/安全/规格审查；结论必须为 0 Blocker / 0 Major。

满足以上条件后，才可把状态从 `integrated-candidate` 提升为 `human-scenario-accepted`，再讨论 release。

## 10. 最终判定

```text
STATUS: DONE_WITH_CONCERNS
REVIEW VERDICT: CHANGES REQUESTED
CODE MERGE: BLOCKED
FINAL ACCEPTANCE: BLOCKED
PRIMARY REASONS:
  - data-loss / concurrency / credential Blockers
  - root test gate not green
  - git diff --check failed
  - required project CI absent for this target branch
  - fresh-machine human acceptance not completed
```
