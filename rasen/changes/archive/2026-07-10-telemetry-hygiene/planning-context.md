# Planning Context — telemetry-hygiene

Seeded by the LEAD, 2026-07-10. Pipeline: small-feature, NO gates (user directive: drive all stages to completion without pausing). ALL workers sonnet (user directive for this change, including planner).

## User intent

用户在面板发现垃圾遥测数据并确认了处置方案（对话已拍板，照此执行，不重新裁决）：
- **排除规则一处定义、两处生效**：热层（Analytics Engine stats 查询）+ 冷层（D1 rollup/backfill 聚合查询）都排除测试/垃圾事件。
- **一次性清理 D1 冷层**已固化的垃圾聚合行。
- **热层原始数据不碰**——Analytics Engine append-only 只读（产品特性），~90 天滚动窗口自然过期。绝不声称"删除"了热层数据。
- 完成 = 代码改动 + 部署上线 + 清理执行 + 前后验证证据。

## Background facts (LEAD verified 2026-07-10, code read)

- Worker 代码：`telemetry-backend/`（独立 npm 子项目——**npm 装依赖，pnpm 在该子目录 no-op**）。文件：`src/index.ts`（ingest + admin 路由 + Access gate）、`src/stats.ts`（热层 AE SQL + 冷层 D1 查询，DATASET='openspec_telemetry'，热层查询在 :188-230 区域，冷层 :296-333）、`src/rollups.ts`（每日 cron rollup + backfill，UPSERT 进 D1 `rollups` 表，行结构 (date, command, version, os, node_version, events, users)，**无 distinctId 列**——隐私设计）、`src/access.ts`。`wrangler.toml`：AE binding TELEMETRY、D1 binding ROLLUPS（database_name rasen-telemetry-rollups, id 6ef1574a-...）、cron 0 1 * * *、workers.dev + telemetry.rasen.io 双路由。
- **面板可见的垃圾（2026-07-10 用户面板实录）**：`x`(4)、`final`(1)、`regress`(1)、`cd-smoke`(1)、`admintest`(1)、256 个 x 的字符串(1)、`phase-c-infra-hardening:synthetic-probe`(1)。来源=后端开发期 curl 合成测试 + Phase C 4.2 探测。其余（spec:show/validate/instructions/agent:context 等冒号命令）是**真实 rasen CLI 命令**（commander 子命令路径 `:` 连接），不得排除。
- **保留测试标记已有先例**：Phase C 4.2 探测用了全零 UUID `00000000-0000-4000-8000-000000000000` 作 distinctId。热层有 distinctId 列（blob，见 stats.ts 顶部 column map），可按它过滤；冷层无此列只能按 command 名过滤。
- 遥测 TLS 已上线（telemetry.rasen.io 直连可用，Phase C 实测）；workers.dev 路由历史经验须走系统代理访问。
- 前一 session 曾向用户说明 AE 数据"只读无法删除"——本 change 的对外表述必须与此一致（查询侧过滤 ≠ 删除）。

## Design direction (user-approved; planner refines, does not overturn)

1. **单一排除模块**（如 `src/filter.ts` 或 stats.ts 内共享导出）：(a) 保留 distinctId 全零 UUID = 官方合成测试标记（热层过滤用）；(b) 垃圾 command 显式清单（上面 7 个，256-x 可用长度阈值或精确串）；(c) 向前约定：今后合成探测 MUST 用全零 distinctId + command 前缀（如 `probe:`），冷层按前缀过滤。规则写成常量+纯函数（可单测/易 review），热层用 SQL WHERE 片段，冷层 rollup 聚合查询同样注入。
2. **热层 stats 查询**：所有 breakdown/timeseries/totals 查询统一带排除 WHERE（stats.ts 现有 hotWhere 机制是天然注入点——planner 核实）。
3. **冷层 rollup + backfill**：聚合源查询（从 AE 读时）加同样排除，垃圾今后不再进 D1。
4. **一次性 D1 清理**：`wrangler d1 execute rasen-telemetry-rollups --remote` DELETE 垃圾 command 行。执行前先 SELECT 记录将删行数/内容作证据，删后再 SELECT 验证。证据存 workDir/research/。
5. **部署**：`npx wrangler deploy`（telemetry-backend 目录内；wrangler 已在此机认证——此前 session 部署过）。部署后验证：stats API（或面板）返回中垃圾 command 消失、真实命令仍在。admin API 有 Access gate——验证走无 auth 的路径（ingest 202）+ 用户面板复核，或 wrangler tail。若 stats 验证需要 Access JWT 而无法命令行获取，记录限制并把面板复核留给用户，不伪造。

## Constraints

- 表面 = `telemetry-backend/**` 独占（当前 git 干净，无并发 session 触碰）。主仓 CLI/模板/specs 一概不动。
- 共享工作树纪律照旧：ship 显式 pathspec `git commit -- telemetry-backend rasen/changes/telemetry-hygiene` + `git show --stat` 复核；绝不捆绑他人在途文件（package.json/CHANGELOG/src/core/** 等）。
- ship = local 模式（只 commit 不 push）。**但 wrangler deploy 是本 change 的交付一部分**（用户明确要求做完），deploy ≠ git push，不受 local 模式限制。
- D1 DELETE 是破坏性操作：只删明确垃圾 command 的行，DELETE 语句必须枚举精确 command 值（不用 LIKE 通配以免误删），先 SELECT 存证。
- worker 无既有测试套件（核实：telemetry-backend 无 test 目录）——若排除逻辑做成纯函数，可加轻量 node 断言脚本作回归证据；不强求引入完整测试框架。
- CLI 不在 PATH：`node dist/cli/index.js <args>`（主仓命令用）。

## Planner findings (2026-07-10, code verified) — corrections + confirmations

- **纠正一条错误的种子事实**：`telemetry-backend` **确有** vitest 测试套件——`telemetry-backend/test/worker.test.ts`，29 个测试，`npm test` 全绿（baseline 已跑过）。种子背景里"worker 无既有测试套件（核实：telemetry-backend 无 test 目录）"不成立。设计与 tasks 已改为**扩展现有 vitest 套件**（同文件新增 describe/断言 hot SQL body、cold D1 SQL+binds、rollup/backfill AE 查询体、filter.ts 纯函数单测），不引入新框架、不写零散 node 脚本。
- **hotWhere 确认为热层单一注入点**：`stats.ts:176-183`，`overviewHot`/`dauHot`/`breakdownHot` 三个函数全部经过它，无旁路。
- **coldWhere 确认为冷层 stats 读取单一注入点**：`stats.ts:251-269`，`overviewCold`/`dauCold`/`breakdownCold` 全部经过它，且已用 D1 bound params（`?`），新排除逻辑可直接复用绑定参数机制（不需要像热层那样手工转义拼接，尽管仍在 escapeSqlLiteral 里做了转义以防列表未来混入引号）。
- **rollups.ts 的 runDailyRollup / runBackfill 不经过 hotWhere**——两者各自手写 AE SQL 字符串（rollup 已有 WHERE 用于时间窗；backfill 目前完全没有 WHERE 子句），是必须单独注入排除谓词的第二、第三个点。设计文档已把这两处和 hotWhere 并列为"3 个调用点，同一 HOT_HYGIENE_PREDICATE 常量"。
- **Phase C 4.2 探测载荷已读取核实**：`command="phase-c-infra-hardening:synthetic-probe"`, `distinctId="00000000-0000-4000-8000-000000000000"`, **version="0.1.1"**（不是 0.0.0）——证实这条垃圾数据本来就绕过了现有 hideTest 机制（hideTest 只认 version=='0.0.0'），所以新排除规则必须独立于 hideTest、无条件生效，不能做成可关闭的 toggle。
- **hideTest 与本次卫生排除是两套正交机制**：hideTest 是可切换的、面向 version=='0.0.0' 开发态流量的便利开关（用户可能想看它）；本次新增的 junk/synthetic 排除永远开启、无"包含垃圾"的开关——两者共存，互不影响，design.md Decision 2 已写明理由。
- **一次性清理证据落盘位置沿用既有惯例**：`work/research/` 子目录（已在 `phase-c-infra-hardening/work/research/` 验证过这个模式），清理用 SQL 文件不进 `telemetry-backend/migrations/`（那是 schema 迁移目录，本次是数据清理不是 schema 变更）。
- 四个 artifact（proposal/design/specs/tasks）已全部写出，`node dist/cli/index.js validate telemetry-hygiene` 通过，`status --json` 显示 `isComplete: true`。
