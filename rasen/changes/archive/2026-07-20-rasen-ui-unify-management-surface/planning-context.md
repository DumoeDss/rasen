# Planning Context — rasen-ui-unify-management-surface（切片1 第二批）

## 用户意图

第一批（rasen-ui-slice1-readonly-api）已合并归档，当时为避让主树在途的 config 修复而刻意推迟的部分，现在解锁。第二批要把"两个并存的 web 表面"收敛成一个：`rasen ui` 成为唯一的管理平台入口，config 页面成为它的一个视图。

## 范围（IN）

1. **命令正名**：隐藏的实验性 `rasen ui` 转正（去掉 Commander 的 hidden，进 help、进文档）；`rasen config ui` 的处置——planner 裁定：保留为别名/弃用提示重定向到 `rasen ui#/config`，还是直接退役（须考虑用户既有肌肉记忆与 0.1.x 兼容承诺）。
2. **服务端合流**：现在是 management-api 处理 status/changes/runs、其余委派给 config-api 的 `createRouter`。第二批把这层委派关系正名——config 端点成为统一管理 API 的一个路由组，而不是被委派方。**不得破坏现有 config 端点的线上契约**（`/api/v1/config*` 路径、鉴权、错误码语义全部保持）。
3. **UI 合并**：config 页并入管理 UI——统一 Layout/导航（这同时关闭第一批的 accepted-known m2："看板在 UI 内无导航入口"），路由结构 `/`(看板) + `/config`，两个页面共享同一壳层与设计语言。

## 范围（OUT）

- **daemon 常驻化**（detach、adopt-or-spawn、后台调度器、`rasen daemon start/stop/status`）——归**切片3**，本批仍是前台进程，Ctrl+C 退出。理由见记忆 rasen-ui-daemon-split-analysis：常驻语义的真实需求来自会话监督，切片1/2 没有需求撑腰。
- 写路径 / 任务提交（切片2）、会话拉起与监督（切片3）。
- `packages/daemon` 包化——目录边界即将来包边界，本批仍在 `src/core/`。

## 硬约束

- **不得回归第一批的既有行为**：身份头 `x-rasen-daemon`/`x-rasen-pid`、只读语义、回环绑定 + bearer token、`getActiveChangeIds` 口径（见下）全部保持。
- **change 枚举口径不得放宽**：主 specs 里 `management-http-api` 与 `board-ui` 两份都写了 SHALL NOT 禁止为对齐 `rasen list` 而放宽，且互为镜像场景。见记忆 two-change-definitions。
- 交付模式 **local**（提交留在 dev/rasen-ui-slice1-b2 分支），合并时机由用户定。
- 主树可能有并发会话在动 `rasen/specs/config-*`（config-page-coherence 归档中）——本批在独立 worktree，但 archive 时的 spec 同步要注意主树届时状态。

## 已知事实（勿重复调研）

### 第一批交付物（本批的基础，已在 dev/0.1.5：merge d13666d，archive aeaf67a）
- `src/core/management-api/{wire-types,changes,runs,router,server}.ts`：`GET /api/v1/{status,changes,runs}`；身份头在 server 层 `res.setHeader` 于路由前统一打（覆盖 200/401/委派/静态）；未匹配请求全量委派 `createRouter(context)`（config-api 的公共导出，返回裸 handler，同 token 同 origin）。
- `src/commands/ui.ts`：隐藏 `rasen ui`（`--port`/`--no-open`），逻辑刻意复制自 `config.ts:1069-1128` 的 `config ui` 流程（含自己的 `openInBrowser` 副本——**合流时应消除这份重复**）；注册在 `src/cli/index.ts:352` 一带。
- `packages/ui`：Preact + preact-iso + Vite；`src/api/client.ts` 是唯一 fetch seam；页面 `ConfigPage` 与新增 `BoardPage`（`src/board/columns.ts` 分列逻辑、`BoardCard`/`BoardColumn`）；`app.tsx` 路由 `/`→ConfigPage、`/board`→BoardPage、`/config`→ConfigPage。
- `packages/ui/src/api/types.ts` 是手工维护的镜像（对应 `src/core/management-api/wire-types.ts` 与 config 的 wire-types），靠 `satisfies` 夹具钉住——合流后仍需保持同步纪律。
- 主 specs 已有三份：`rasen/specs/{management-http-api,board-ui,management-ui-command}/spec.md`。

### 第一批遗留（本批可顺手关闭的）
- **m2**：`/board` 在 UI 内无导航入口（受当时"app.tsx 只改一行"约束）——本批做统一 Layout 正好关闭。
- **m4**：每次看板加载重复调用 `resolveProjectHome` 两次（changes/runs 各一次）。
- **t1**：`MANAGEMENT_PATHS` 精确匹配，`/api/v1/status/` 会落到 config router 404。
- **t2**：token 用 `===` 比较（与 config-api 齐平，非新缺陷）。
- `test/` 目录不在 eslint 覆盖内（既有仓库状况）。
- **独立 follow-up（不在本批范围，但相关）**：`src/core/list.ts` 应向 `getActiveChangeIds` 收敛（6-vs-10 分歧根因）；目前唯一存活记录在归档的 `rasen/changes/archive/2026-07-20-rasen-ui-slice1-readonly-api/design.md` Follow-ups 段与 management-http-api spec 第二条需求段落。用户已知悉，待定是否单独立项。

### config 侧现状（第一批期间由另一会话完成，已合并）
- c6c5004：autopilot keys 支持 global scope、per-role handoff/model 配置、gates inventory 面板（`packages/ui/src/components/GatesInventoryPanel.tsx`、`GET /api/v1/pipelines` 端点、`WirePipeline*` 类型）。
- 因此 config 页现在不只是"配置编辑器"，还含 gates inventory——合流设计要把它一并纳入信息架构考虑。

## 待 planner 裁定

1. `rasen config ui` 的处置（别名重定向 vs 弃用提示 vs 直接退役）——须给出兼容性理由。
2. 服务端合流形态：management router 反过来吸收 config 路由组（单一 router），还是保持两个 router 模块但由统一 server 装配？（倾向后者：模块边界清晰，且 config-api 的既有测试面不动）
3. `openInBrowser` 等 `ui.ts`/`config.ts` 重复逻辑的归置位置。
4. 统一后的信息架构：看板 / config / gates inventory 三者的导航与路由结构。

## Planner findings（propose 阶段追记，2026-07-20）

### 四项裁定（详见 design.md D1–D6）
1. **`rasen config ui` = 弃用别名**，不退役：启动同一统一管理服务器，开 `/config#token=...`，打印一行弃用提示指向 `rasen ui`。理由：0.1.x 已发布且该命令是 specced 入口；退役归未来 minor（版本归用户管）。关键兼容事实：**token 逐会话铸造 ⇒ 不存在可失效的持久书签/深链**，入口路径变更天然安全。
2. **双 router 模块 + 统一 server 装配**（采纳 planning-context 倾向）：委派逻辑从 management router 上提到 server.ts 成为装配点；`config-api/router.ts` 及其测试零改动。吸收成单 router 被否：需重证 config 契约，纯风险无收益。
3. **共享启动模块 `src/commands/ui-launch.ts`**（命令层，非 core）：整段 ~60 行启动流程（非仅 openInBrowser）参数化为 {entryPath, notice}；core 保持无 process 全局副作用，利于切片3 daemon 抽取。
4. **IA：Board=首页 `/`，`/board` 保留别名，`/config` 配置页；nav 两项 Board|Config**。gates inventory **留在 config 页内**——c6c5004 是用户数日前明确要求的布局（配置页条理化含 gates 清单），本批不推翻；`/gates` 顶级化列为 open question 供用户拍板（面板已自含，随时可提）。

### m4/t1 设计
- m4：ProjectHome 上提为 server 生命期状态，lazy `ensure:false` 解析、命中即缓存、**null 结果每请求重探**（覆盖会话中途注册）。"fresh read" spec 条款只管 change/run 状态，不管 registry 映射。
- t1：仅容忍**单个**尾斜杠的归一化，非前缀匹配；`/api/v1/status/extra` 仍落 config 组 404。

### 调研到的事实（后续 batch 可复用）
- docs/ 与 README 均无 "config ui" 字样（grep 零命中）——文档面极小，实现时只需 help 文本与 RelaunchNotice 文案。
- `startConfigApiServer` 本批后无任何命令引用（config-api 测试仍覆盖）；退役与否归切片3 packaging，已记 design open question。
- 现 Layout.tsx 标题 "Rasen Config"、nav 仅一个 Config 链接；RelaunchNotice 文案指 `rasen config ui`，需随别名化改为 `rasen ui`。
- 延性 spec 教训沿用：改名需求用 REMOVED+ADDED（management-ui-command 的 "Hidden..." 与 config-ui-command 的 "...starts the config server" 均如此处理）；两份 SHALL NOT（枚举口径）主 spec 未被触碰。
