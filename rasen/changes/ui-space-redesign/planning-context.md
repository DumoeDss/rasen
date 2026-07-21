# Planning Context — ui-space-redesign(规划空间顶层 + Task 实体化 UI 重构,portfolio 父)

## 用户意图(verbatim 要点)

用户报"切 project 无反应 + 项目列表垃圾"后,经三轮设计讨论拍板:UI 以**规划空间(project|store)为顶层**、**Task(=thread)为意图单位**重构整个 daemon/UI 面。参照系:elftia threads(Project 容器 + ThreadCard 网格 + SubprojectPanel chip)与 harness issue 模型(issue repo-blind 两域分离、dispatch 决策落子任务)。"目前的 daemon/ui 也是想要往这个方向继续推进。"

## 已拍板的设计决策(不可漂移)

1. **顶层 = 规划空间**,双命名空间:project(in-repo)| store(logical,成员 repo 用 `store:` 指针外置规划)。切换器分组列出两段,**不再有 "No project (global only)" 选项**(全局配置移进 Config 页的 scope 标签)。
2. **URL 即事实源**:`/p/<projectId>/...`、`/s/<storeId>/...`;`rasen ui` 启动时把 cwd 解析出的空间写进打开的 URL;刷新/深链/多标签各自独立。干掉现在的内存 pub-sub project store。
3. **daemon 项目无关化**:`launchProjectRoot` 降级为默认提示;management API(/changes、/runs、POST /changes、/sessions)全线接受显式空间参数(project|store 寻址,复用 config-api 的 `resolveProjectSelector` / `project:` 前缀机制)。
4. **Sessions 顶级页删除**。live run 三归宿:Task 卡 ⦿ 指示点+阶段;Task 详情页 sessions 列;header 常驻 `⦿ N running` 下拉(当前空间所有 live run,点击直达 Task 详情)。
5. **Session 归属**:session → cwd(物理 repo)→ 该 repo 的规划空间(自身或所指 store)。**切空间只看该空间的 session**(用户明确拍板);store 视图 = 成员汇总 + chip 过滤。
6. **Board 四列推导不变**(Planning/Ready/In Progress/Done),用户拍板。卡片=Task;portfolio 落列规则:任一 child 在跑→In Progress;否则有 ready child→Ready;否则→Planning;全部归档→Done。**卡片不可拖**(状态全由文件推导,动作即状态)——这是状态分组只读视图,不是 kanban。
7. **Task 实体**:portfolio 容器(planning-context.md + children)形式化为 Task;**裸 change = 隐式单件 Task,零仪式**(不强制套壳,懒实体化);Task 状态纯推导,**不新增持久化状态字段**。
8. **Task 详情 = 独立路由页**(用户拍板):`/p/<id>/task/<name>`,左列 children(change 生命周期+勾选进度+deps 提示),右列 sessions(live 顶置、日志尾部、kill、Launch run)。单件 Task 同页,children 列退化为该 change 的 task 清单。
9. **Archive 一等页**(用户拍板"可以放入 Archive 页"):导航 Board · Archive · Config;时间倒序,搜索,store 视图按成员过滤;Done 列只留最近 N 个,列底 "View all in Archive →"。
10. **真源红线(继承 slice3,绝不破)**:daemon 只做读者+进程拉起者;Task/空间语义全部从 rasen/ 工作区文件推导;写路径 spawn CLI;**任何功能不得要求 daemon 在场才能用 CLI 核心流程**。
11. **新设计点——store→成员反向枚举**:指针现为 repo 单向声明(config `store:`);UI 需要"store 有哪些成员"。planner 拍板实现形态(registry 冗余字段回写 vs 现扫),倾向注册/自愈时回写+读时校验。

## Decompose 计划(LEAD 已裁定)

严格串行链(children 触碰面重叠:config-api/router.ts、management-api/router.ts、packages/ui/src/app.tsx、Layout.tsx 多子共改,按保守策略不并行):

1. **ui-space-redesign-api-scope**(地基):API 空间参数化 + daemon 项目无关化 + session 空间归属 + store 成员反向枚举 + `rasen ui` 输出带空间的 URL。纯服务端+CLI,不动 packages/ui。
2. **ui-space-redesign-shell**(依赖 1):UI 全局框架——路由 `/p/:id`/`/s/:id`、空间切换器(双命名空间分组)、删 Sessions 顶级页、header running 下拉、URL 事实源替代 pub-sub store。
3. **ui-space-redesign-task-board**(依赖 1,2):/changes 响应 Task 分组(portfolio 容器解析,裸 change=单件)、Board 四列推导+落列规则、Task 卡(子件进度+⦿ live 点)、store 成员 chip。
4. **ui-space-redesign-task-detail**(依赖 3):Task 详情路由页(children+sessions 两列、日志尾部、kill、Launch run 带 task 上下文)。
5. **ui-space-redesign-archive-page**(依赖 2;与 3/4 有导航/路由文件重叠,串行殿后):archive 列表 API + Archive 页 + Done 列近期截断。

依赖 DAG:1 → 2 → 3 → 4;5 在 2 之后但因触碰面重叠排在 4 之后执行。全链 childPipeline=small-feature。

## 关键代码坐标(planner 勿重复调研)

- 空间寻址现成机制:`src/core/config-api/project-addressing.ts`(`resolveProjectSelector`,支持 id/路径/`project:` 前缀)。
- management API 硬绑点:`src/core/management-api/router.ts:242,305`(`context.launchProjectRoot`);config-api 已支持 `?project=`。
- UI 现状:`packages/ui/src/`——`app.tsx`(preact-iso 路由)、`components/Layout.tsx`、`ProjectSwitcher.tsx`、`store/project-store.ts`(将被 URL 事实源取代)、`BoardPage.tsx`、`SessionsPage.tsx`(将删除顶级入口)、`api/client.ts`(所有调用无 project 参数,`projectQuery()` helper 已存在)。
- 项目注册表:`src/core/project-registry.ts`(registry.json,mode: in-repo|store);store 注册表独立(`src/core/store/`);`deriveProjectMode` 在 `src/core/project-home.ts:78`。
- daemon:`src/commands/daemon.ts`、`ui-launch.ts`(adopt-or-spawn;launch 时已解析 cwd 项目——改为写进 URL 而非绑死 context)。
- 会话监督:`src/core/management-api/{supervisor,session-registry,sessions}.ts`;session 启动带 cwd。
- 死条目过滤先例:本 session 已给 `handleListProjects` 加 root 存在性过滤(config-api/router.ts,未提交,在工作树)。
- 看板列推导:`packages/ui/src/board/columns.ts`(`deriveColumn`)——Task 落列规则在其上扩展。
- portfolio 容器识别:目录含 planning-context.md 且 children 以 `<parent>-` 前缀存在(约定);archive 目录 `rasen/changes/archive/<date>-<name>`。

## Planner findings（child 1 propose,2026-07-21）

1. **空间选择器定形**:`?space=` / body `space`,值 = `project:<id|root>` | `store:<id>`,**前缀强制**(裸值 400 `invalid_space`,两命名空间可同名不能猜);缺参 = launchProjectRoot 兜底(零破坏)。错误码:404 `space_not_found`、409 `space_unavailable`(store 健康检查失败,复用 `inspectRegisteredStore` 只读探查)。child 2 的 URL 应直接消费同一 token 形态 `?space=project:<id>`。
2. **store→成员反向枚举拍板:不加注册表字段**。机器项目注册表已有 `mode: 'store'`(指针 repo,自愈维护)= 候选索引;读时逐候选读 config `store:` 指针为权威(读时校验)。否决 `storeId` 回写字段的硬理由:`ProjectRegistryEntrySchema` 是 zod `.strict()`,老版本 CLI 读到新字段直接 `invalid_project_registry` 机器级炸——注册表加字段前必须先想 strict-schema 前向兼容。
3. **术语雷区(实现者必读)**:API 的 `project:` 前缀指机器**项目注册表**(config-api 命名空间),不是 store 注册表里 `store add-project` 的 `project:` 引用命名空间——两者完全不同;design.md D1 已显式标注。
4. **归档次序险情**:未归档的 slice2/slice3 change 挂着 change-submission / management-http-api / management-ui-command / session-supervision 的 pending delta(内容已在 main specs 里 = 陈旧 delta)。child 1 的 delta 刻意只 MODIFY 无人碰的 requirement、其余全用 ADDED(session-supervision 无 main spec,只能 ADDED)。**建议先归档 slice2/slice3 遗留再归档本 portfolio**,否则 spec-merge 守卫会拒或互相覆盖。
5. **spaces 列表去重规则**:store 自己的根会以 `in-repo` 身份出现在项目注册表(CLI 在店内跑过就注册)——`/api/v1/spaces` 按 canonical root 等值把它折进 store 条目,否则每个 store 双列。
6. **`rasen ui` 发 URL 前 ensure-register cwd 项目**(CLI 侧写,红线内),否则未注册项目发出的 `project:<id>` 选择器解析不了;`resolveLaunchProjectRef` 的 projectId 可为空串,不能直接用。
7. session 空间归属**launch 时冻结**在 SessionRecord(cwd 派生或显式 space),listing join 改用 session 自己的 space root + per-space home——顺手修掉今天"非 launch 项目的 session join 全错"的既有 bug。

## Planner findings（child 2 shell propose,2026-07-21）

8. **`?space=` 活过 token 擦除**——`packages/ui/src/api/token.ts` 的擦除是 `history.replaceState(null,'',location.pathname+location.search)`,**保留 search**;child 1 发的 `…/?space=project:<id>#token=<t>` 里 `?space=` 因此能到达 app。shell 的 bootstrap 在 `initTokenFromLocation()` 之后跑,读 `?space=` → `route('/p/<id>/board', true)`(replace,丢查询)。child 3/4 别改 token.ts 擦除逻辑,否则断掉 space 引导。
9. **URL 事实源路由形态(child 3/4/5 全消费)**:空间前缀路由 `/p/:projectId/...` `/s/:storeId/...`;section 段 = `board|config|archive|task/:changeName`。`useSpace()`(`store/use-space.ts`,child 2 新增)从 `useRoute()` 读 `{type,id,selector}`,`selector=\`${type}:${id}\``;**所有空间域调用**经 `client.ts` 的 `spaceQuery(selector)` 串上。child 3 的 Task board、child 4 的 Task detail、child 5 的 Archive 都 `useSpace()` 取空间,别自己解析 URL。task detail 路由已在 child 2 占位(placeholder),child 4 只替换 placeholder 组件、别动路由表形状。
10. **opaque-token 铁律(承 child1 m1+finding3)**:`project:`/`store:` 后的 id 全程当不透明规范 token——bootstrap 抄进路由参、`useSpace` 读回、`spaceQuery` 重新加前缀,**任何环节不 normalize/lowercase/path-canonicalize**。child 3/4/5 构造空间内链接一律 `/p|s/<useSpace().id>/...` + `encodeURIComponent`,别从 root 路径反推 id。
11. **switcher 只 render 顶层 spaces、不碰 members**:store 成员 chip = child 3;child 2 的 switcher 消费 `/api/v1/spaces` 的顶层条目,`members[]` 留给 child 3 的 Task board 过滤。
12. **config 仍走 `?project=` 非 `?space=`**:child 1 没把 config-api 挪到 `?space=`;child 2 的 `ConfigPage` 对 project 空间传 project id(照旧),对 store 空间只出 "store config 待 Config 重构" 提示(**store-scoped config 是延后项**,归后续 Config-scope-tabs child,不是 child 3/4/5)。
13. **归档次序雷区(承 child1 finding4)**:顶级 Sessions 页的需求属未归档 `slice3-sessions-ui` 的 `sessions-ui` capability delta(**主 specs 里没有 sessions-ui**);child 2 删顶级 Sessions 页,并在 `config-ui-package` MODIFY 里显式复述 Board·Archive·Config 导航来对账漂移。归档本 portfolio 时须**连同 slice3-sessions-ui/slice2 遗留一起归档**,否则 sessions-ui delta 会复活被删的 Sessions 导航项。child 2 的三 spec:新 `management-ui-shell`(ADDED)、`board-ui`(MODIFY 仅"平台主页/导航"一条)、`config-ui-package`(MODIFY 仅"Platform shell"一条)——child 3 若也改 board-ui,注意别撞 child 2 已改的那条。

## Planner findings（child 3 task-board propose,2026-07-21）

14. **分组落点定形:server 报 portfolio 成员事实,UI 做分组/落列/渲染**。portfolio 父目录只有 planning-context.md、无 proposal.md → 被 `getActiveChangeIds` 排除、`/changes` 永不含父,UI 从扁平表根本推不出成员关系;纯名字前缀启发式不安全(`store-add-project`/`store-project-namespace` 同前缀但无 `store/` 容器 → 会造出幻影 Task)。故 server 在 `changes.ts` 枚举含 planning-context.md 的兄弟目录(容器),给每个 change 挂 `portfolio?: string` = **最长**匹配容器名(change===P 或 startsWith(P+'-')),只读、不 mint。落列/渲染全 UI 侧(承 `columns.ts` "column assignment is UI policy")。wire 加 `ChangeSummary.portfolio?`(server wire-types + UI api/types 双镜像 + satisfies fixture,别用 as)。
15. **落列聚合形式化(承 Decision 6,已补 Done 终态)**:UI `columns.ts` 新增 `deriveTaskColumn`:逐 child 跑现成 `deriveColumn`,按 In Progress>Ready>Planning>Done(仅全 child done 才 Done)聚合;单件 Task 退化=其一 change 的列;escalated=OR。`deriveColumn` 不动。
16. **⦿ live 指示走 live sessions 非 run 文件**:run-state/hasRunFiles 跑完仍在,不能表"正在跑";board 新增 `listSessions(selector)` 并列 fetch(child 2 header 已在拉同一数据),session→Task 经 `session.changeName`→child→其 Task;liveStage 取 session 的 joined runState(ok 时 pipeline/stage)。changeName-less auto session 不映射任何 Task(承 child1 runState:absent)。
17. **store 成员 chip 天花板 = session 溯源(数据层无 change→member 归属)**:store space 解析成**单一中心 root**,成员=外置规划的 pointer repo,change 集中在 store 的 rasen/changes、**磁盘上没有任何 per-change member 字段**。故 chip 过滤只能靠 session 溯源(session.cwd 落在 member.root 下 → 该 Task 归该 member),零新持久态、守红线。**局限(已在 design/spec 记录)**:从没跑过 session 的纯规划 Task 无归属、只在 All 下现身;自愈(首次跑即归属)。durable store-change→member 约定=未来 change,不在本 portfolio。**给用户/后续的信号**:若要 chip 真正好用,需要在建 change 时记 authoring member 的约定——这是 Decision 5"成员汇总+chip"的数据前提缺口。
18. **spec 归位避撞**:board-ui **只 MODIFY** "Board-embedded change submission"(child 2 只动了 "Board is the platform home",不撞)+ **ADDED** 三条(Task 分组 / 落列 / 卡片 · 成员 chip);management-http-api **ADDED** "Changes listing reports portfolio-container membership"(child 1 MODIFY 了 "Changes listing…",本 child 不再 MODIFY 同条,避免两未归档 delta 撞同一 requirement)。归档次序仍承 finding 4/13。
19. **createChange 空间归属(carryover 已 spec+task)**:`NewChangeDialog` 收 `space?` prop=`useSpace().selector`,穿进 `client.createChange` body.space;`SubmitChangeRequest.space` + server 解析均 child 1 已就位,纯 UI 接线。放在 board-ui 的 MODIFIED submission requirement + tasks group 6。
20. **给 child 4(Task detail)的交接**:(a) Task 详情链接由 board 卡片经 `spaceHref(space,'task', task.id)` 打出,`task.id`=**portfolio 容器名 或 裸 change 名**——child 4 的 `:changeName` 路由参会收到"容器名"(portfolio Task)或真 change 名(单件),须两者都处理:容器名对应父目录(有 planning-context.md、无 proposal.md),真 change 名对应普通 change。(b) portfolio 进度"N/M changes"本 child 只数**在板活跃 child**,不含已归档 → child 4 详情页应读父目录 + portfolio-run.json + archive 得**全量 roster**(active+archived)才准。(c) session→Task 映射规则(finding 16)可复用到详情页的 sessions 列。

## 约束

- **工作树有未提交改动**(测试隔离修复+listProjects 过滤,属于本 portfolio 的先导修复):child 1 的 ship 把它们一并纳入或先行单独 commit,由 shipper 裁定,勿丢弃勿回退。
- 版本号归用户管,绝不 bump([[version-discipline]])。
- Windows 环境;pnpm;UI 包 `packages/ui`(preact + preact-iso,无 React)。
- 模型分配:planner/reviewer=fable,implementer/fixer=opus,其余 sonnet(用户 2026-07-21 更新)。
- 交付:children 全部 local ship(只 commit);portfolio 级一次性交付,模式届时由用户/配置定,分支 dev/0.1.5。
