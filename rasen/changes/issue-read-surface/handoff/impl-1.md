# Handoff: issue-read-surface — implementer #1

> **来源注记（诚实红线）**：本文档由 LEAD 派遣的代笔（`handoff-read-surface`）于 2026-08-24 03:19 从**盘面证据重建**，非原 implementer 自述。原 worker（`impl-read-surface@session-ce6b39f6`，opus）在 apply 阶段被 API 429 打断、进程已停止，其会话 transcript 不可恢复。所有进度判断按下述证据等级标注：
> **[E1]** git diff / 盘上产物实证（最高）；**[E2]** 代笔独立复跑的命令结果；**[E3]** 仅 tasks.md 7.2 注记中的声称、代笔未复跑；**[E4]** 由文件时间戳推断。

## Original intent

P7 g-001 `issue-read-surface`：把 Issue 读面从纯 CLI 派生收敛为「一份组装、两个调用方」。四制品在本 change 目录（proposal / design / specs×2 / tasks）；P7 charter 在 `rasen/changes/issue-ui-convergence/planning-context.md`（g-001 findings 节含 D1 组合模块、端点形状、IA 速览）。范围内：`src/core/issue-read/` 组合模块（三条 compose 函数 + 具名 payload，query/run-state 注入）、management API flat 族三条 GET（`issue-projections` / `issue-projection` / `issue-attention`）、只读 Issue Board + Detail UI（store 空间专属路由）、真 store 只读 dogfood 收据。范围外：写入面（g-002）、旧板处置与交互补全（g-003）、`pipeline-registry` 冻结区。

执行纪律（LEAD brief 钉死）：CLI `--json` 字节在抽取下不变；UI 测试必须 `pnpm --filter @atelierai/rasen-ui test`（根 config 会静默跑零个 UI 测试）；zh-cn 小跨度 Edit + U+FFFD 扫描；持久 `issue-registry` store 只读。

## Position

Pipeline `small-feature`，tier A，gates off（global）。propose done（planner-p7，4 制品 + 2 ADDED specs，validate 一次绿）。apply 在 worker 死亡时**已近乎走完**——auto-run.json 仍显示 `apply: running`（代笔未改，stage 记账是 LEAD 单写者行为）。

时间线重建（文件 mtime）[E1/E4]：planner 制品 23:53–23:57（08-23）→ apply 派工 23:59 → core 模块 00:08–00:10 写入 → 接线/UI/测试至 ~01:10（推断）→ dogfood 收据 01:18–01:38 → **dist 全量重建成功 01:50:33–38**（`pnpm build` 绿的直接实证）→ tasks.md 末次写入 01:54（7.2 状态注记）→ 此后盘面无任何写入。429 打断点在 01:54 之后，即 apply 收尾段，**不是中途**。

## Done / Remaining

**Done — tasks 1.1–7.1 共 21 条全部勾选，且逐条有真实落盘产物 [E1]**（无一条空勾）：

| 任务 | 裁决 | 证据 |
|---|---|---|
| 1.1 composition.ts | 完整成品 | 17,163 字节；三 compose 函数 + payload 类型；`statusInputFor`/`resolveStoreWideningContext`/`resolvePredecessorPlan`/`detailForList`/`attentionCounts` 均在模块内，barrel 导出 [E1] |
| 1.2 run-context.ts + index.ts | 完整 | `resolveRunStateContext` never-throws 语义成文 [E1] |
| 1.3 CLI 重接 | 完成 | store-issue.ts:59–63 导入自 core/issue-read，:267 `resolveProjectionContext` 薄包装，:1132/:1164 list/show 调 compose；store.ts:46–49/:1738 attention 调 compose；`detailForList` 已离开 store-issue.ts [E1] |
| 1.4 守卫套件不改断言过 | 部分复现 | store-issue-cli 串行复跑 9 中 3 绿 6 红，**全部**为 30s 超时 + EPERM 清理（本机已知状态泄漏簇），零断言失败；见「死胡同」[E2/E3] |
| 2.1 三 handler | 完成 | stores.ts:320/:336/:354，uid-query + `projectionScope` 形状贴合 D2 [E1] |
| 2.2 mapThrown 404 | 完成 | stores.ts:198 `issue_attention_unknown_issue: 404` [E1] |
| 2.3 路由 | 完成 | router.ts MANAGEMENT_PATHS :357–359 + 三 GET 分支 :1664/:1686/:1705 [E1] |
| 2.4 wire 别名 | 完成 | wire-types.ts:1458/:1461/:1464 直接 alias，无重声明 [E1] |
| 3.1–3.3 测试文件 | 文件完整 602 行 | 内容含 handler 级 + over-the-wire parity + 通道/新鲜度钉；绿否见「测试实况」[E1] |
| 3.4 vitest 权重 | 完成 | vitest.config.ts:78，240000ms [E1] |
| 4.1 UI 类型镜像 + floor | 完成 | types.ts +450；mirror floor 三名 :63–65；**mirror 套件 18/18 绿** [E2] |
| 4.2 client 三方法 | 完成 | client.ts:700/:714/:728 [E1] |
| 5.1 Board+Card | 完成 | 234+101 行 [E1] |
| 5.2 Detail | 完成 | 618 行 [E1] |
| 5.3 路由/导航/i18n | 完成 | app.tsx:91–92 两路由；Layout 导航项；三 locale 各 +124 行；**zh-cn U+FFFD 复扫 = 0** [E2] |
| 5.4 UI 测试+fixture | 完成 | board 306 行 + detail 308 行 + fixture 568 行（7 个 `satisfies` 化 fixture 含 `realIssueProjectionFixture`）；app.test 路由/导航断言在位 [E1]；**两组件测试 23/23 绿** [E2] |
| 6.1 dogfood 收据 | 完成且扎实 | `evidence/dogfood-cli-http-parity.json`：**12 对 CLI↔HTTP 字节级一致**（重序列化 `JSON.stringify(body,null,2)` 后逐字节比对）+ 未知 narrowing 404 拒收通道见证 [E1] |
| 6.2 板渲染 + 真 fixture | 完成 | `dogfood-board-render.{html,json}`（5 卡全 Done 泳道、0 attention 行、visibility 披露）+ `dogfood-real-issue-projection.json`（32KB）蒸馏入 UI fixture；一次性 harness 已删 [E1] |
| 7.1 architecture-index | 完成 | spec-store-engine 新模块条目 + workflow-pipeline 端点族段 + templates-ui 路由行 + quick-locate 三行 [E1] |

**Remaining — 仅 7.2（唯一未勾，按设计分半）**：implementer 自有半的声称记在 tasks.md 7.2 注记里 [E3]：`pnpm build` 绿（dist 时间戳独立佐证 [E1]）、validate 绿（代笔复跑绿 [E2]）、UI 全套 71 文件/953 测试绿（文件数 71 已核实 [E1]，套件未复跑 [E3]）、13 个守卫套件 66 测试绿（抽检见「测试实况」）、issue-projection 14 绿（未决，见下）、stores/stores-api/router/wire-mirror 共 100 绿（wire-mirror 18/18 已独立复现 [E2]）。根全量套件归 LEAD/CI，未动。

## Key decisions (and why)

- **D1 一份组装、两个调用方**：payload 键序承载语义（`printJson` 按插入序序列化）。代笔已做静态逐键比对：list `{issues,complete,unsearchedRefs,problems}`、show `{issue,plan,status,delivery,review,complete,unsearchedRefs,problems}`、attention `{narrowed,issueId,scannedCount,scanned,items,counts,total,unsearchedRefs,complete}` 与 HEAD 抽取前字面量**逐键一致** [E1]。
- **D2 flat 族、projection 名词、review 随 detail 走**：不设第四端点；handler 是 compose 的纯透传，零缓存零派生，每请求重解 run-state（两次相同 GET 之间的 Store 变更无需失效步骤即被第二次读到）。
- **D3 两条互不转换的通道**：拒收走 HTTP status+code（`issue_attention_unknown_issue` → 404，经 `STATUS_FOR_STORE_ERROR_CODE`，否则会落 500 `store_query_failed` 把客户端错报成服务端故障）；不可读证据走 200 载荷内 `problems`/`complete:false`/`unsearchedRefs`。**未知 Issue 的单 Issue 读不是拒收**——query 从不为找不到的 Issue 抛错，CLI 照样打印空记录读，服务端加 404 会破坏 parity。
- **D4 run-state 诚实降级**：`resolveRunStateContext(undefined)` 直接 `{}`；解不出执行根 = `runStateVisibility:'none'` + 仅 committed evidence，呈现方必须披露、永不伪造 live 事实。
- **D5 UI IA**：store 空间专属路由、无 `/p/` 对、不进 `SWITCHABLE_SECTIONS`；闭词汇→i18n 键的字面查表在 `components/issue-vocabulary.ts`（UI 侧唯一映射层，不派生任何轴）。
- **D6/D7**：零第二状态层（钉死在测试）；dogfood 收据不进 CI；一次性 harness 用后即删。
- **唯一与 design 字面有偏离处（worker 自述并留证）**：`store issue show` 人类渲染的 delivery-evidence 项目别名改为从 `status.projects` lanes 取（store-issue.ts 新 `projectAliasesFromStatus`），不再重读 Store catalogs——因为 lane alias 就是该值且组合已返回 payload。收据在 `evidence/dogfood-readonly-proof.txt`（真人渲染见证 `@rasen` 别名分支；CI fixture 无 catalog 别名只钉 raw-id 回退分支）。`--json` 字节不受影响（别名只在 human 渲染路径）。

## Dead ends & gotchas

- **原 worker 死于 API 429**——环境事实，非代码问题；盘面无「半成品断裂点」，全部文件完整、无桩标记（TODO/FIXME/stub 扫描 = 0）[E1]。
- **真 Git 套件在本机绝不可并发跑**：代笔首轮三进程并发（issue-projection + 守卫两件套 + UI），issue-projection 被拖到 23 分钟（单跑预算 ~230s）出 2 红、守卫 11 红；串行复跑后守卫的全部失败仍是 `Test timed out in 30000ms` + fixture 目录 EPERM 清理——仓库 memory 已记载的本机状态泄漏簇（30s 默认超时 + Windows 临时目录锁），**零断言失败、零字节比对失败**。继任者复跑一律串行、一次一个套件。
- **别用裸管道 tail 吞测试输出**：代笔首跑 `| tail -12` 把退出码吞成 0、失败测试名全丢（只余汇总行）。重定向全量到文件再 grep。
- **UI 测试必须 `pnpm --filter @atelierai/rasen-ui test`**；本 worktree 的 `packages/ui/node_modules` 已装好 [E1]。
- 持久 `issue-registry` store（`E:\...\Reference\rasen-issue-store`，uid f76edc31-…）**只读**；其前后 git 状态在 readonly proof 里。
- `.rasen/` 下的大量平铺残留（p6close-*、i5-*、g003-* 等）属 08-23 晚更早阶段的其他 agent，**与本 change 的 worker 无关**（该 worker 零平铺残留、临时 harness 自清）。

## Eliminated hypotheses

- 「worker 留下半成品代码」——被 [E1] 排除：文件全完整、dist 全量重建、evidence 齐全、时间线连续到 01:54。
- 「抽取改变了 `--json` 字节」——被 [E1] 排除：三 payload 键序与 HEAD 逐键一致 + 12 对 dogfood 字节级 parity + 守卫失败全为超时型（若是字节回归应为断言型失败）。
- 「issue-projection.test.ts 真红」——**未排除，未决**：首轮 2 红/12 绿发生在三进程并发下，失败测试名因 tail 截断未留存；串行复跑未及执行（LEAD 收尾指令）。当前最佳假说：同为机器簇假红，但**必须串行复跑裁决后才能这样写进任何结论**。

## Working set

Worktree：`.claude/worktrees/issue-layer`（分支 `feat/issue-phase7` @ `1afa021f`），全部改动**未提交**：

- 新增：`src/core/issue-read/{composition,run-context,index}.ts`；`packages/ui/src/components/{IssueBoardPage,IssueCard,IssueDetailPage}.tsx` + `issue-vocabulary.ts`；`packages/ui/test/components/issue-{board,detail}-page.test.tsx` + `test/fixtures/issue-projection.ts`；`test/core/management-api/issue-projection.test.ts`；`rasen/changes/issue-read-surface/`（含 evidence/ 五件）。
- 修改：`src/commands/{store-issue(-300/+73),store(-119/+26)}.ts`、`src/core/management-api/{stores(+100),router(+73),wire-types(+24)}.ts`、UI `api/{types(+450),client(+53)}.ts`/`app.tsx`/`Layout.tsx`/三 locale、`packages/ui/test/app.test.tsx`、`test/core/management-api/store-aggregate-wire-mirror.test.ts`、`vitest.config.ts`、architecture-index 四文件。
- dist 已含全部改动（01:50 构建）[E1]。

## Test verification status（代笔实跑，2026-08-24 02:45–03:19）

| 命令 | 结果 | 等级 |
|---|---|---|
| `node bin/rasen.js validate issue-read-surface` | 绿 | [E2] |
| `pnpm exec vitest run test/core/management-api/store-aggregate-wire-mirror.test.ts` | 18/18 绿 | [E2] |
| `pnpm --filter @atelierai/rasen-ui test test/components/issue-board-page.test.tsx test/components/issue-detail-page.test.tsx` | 23/23 绿 | [E2] |
| `pnpm exec vitest run test/commands/store-issue-cli.test.ts`（与 store-attention 同跑、串行于其他进程） | 3 绿/6 红，红全为 30s 超时+EPERM，零断言失败 | [E2] |
| `pnpm exec vitest run test/commands/store-attention-cli.test.ts`（同上批） | 写文档时仍在跑，未决 | — |
| `pnpm exec vitest run test/core/management-api/issue-projection.test.ts`（首轮并发） | 2 红/12 绿，失败名因 tail 截断丢失；**串行复跑未执行，未决** | [E2] |
| zh-cn U+FFFD 扫描 / UI 测试文件计数 | 0 个 FFFD / 71 个文件 | [E2/E1] |

未复跑的 [E3] 声称：UI 全套 953 测试、13 守卫套件 66 测试其余 11 个、stores/stores-api/router 共 82、根全量套件（归 LEAD/CI，CI 为权威门）。

## Next action

1. **串行复跑裁决（唯一实质未决）**：`cd <worktree> && pnpm exec vitest run test/core/management-api/issue-projection.test.ts > %TEMP%\ip-serial.log 2>&1`（单跑预期 ~230s）。全绿 → 代码侧零剩余；有红 → 失败名会指明位置，从 compose 缝 `src/core/issue-read/composition.ts`（或对应 handler/路由分支）修起；若红仍是超时型则归机器簇，交 CI 裁决。
2. 可选补证：串行跑 `store-attention-cli.test.ts` 及其余守卫套件（或直接信 CI）。
3. 向 LEAD 报 apply DONE 并附本文档；`auto-run.json` 的 apply→done 翻转是 LEAD 的单写者行为（代笔只追加了 sessionHandoff 指针）。verify 阶段随后推进；7.2 的「implementer 半」在步骤 1 绿后即视为闭合，根全量仍归 LEAD/CI。
