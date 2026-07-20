# Planning Context — platform-slice2-task-submission（路线图切片 2：任务提交入口）

## 用户意图

PR #11 已合并（origin/dev/0.1.5 = 77dd9a6，切片 1 两批全部在线）。用户指令："继续推进 phase2（切片 2）的所有内容"。本分支 dev/platform-slice2 直接切自最新 origin/dev/0.1.5，在主树工作（当前无并发会话冲突）。

## 切片 2 的定义（来源：rasen/changes/rasen-roadmap-research/report.md §6，用户已确认路线）

**任务提交入口**：从 web 界面提交任务/触发工作流，替代"必须开终端敲 CLI"。核心纪律（不可违背）：
> 触发即调用 CLI，**CLI 依然是唯一的写入口**，UI 只是外壳，不复制一套业务逻辑。任何"UI 直接改文件"的实现方式都需要重新论证，默认方案是"UI 调 CLI 子进程"。

验收门槛（沿路线图纪律）：真实跑起来验证——从看板页提交一个任务，真实拉起 CLI 子进程，产生真实的 change/run 产物，看板上可见结果。不是"表单骨架 + 假提交"。

## 范围（IN，planner 细化）

1. **写路径 API（第一个非 GET 端点）**：如 `POST /api/v1/tasks`（或 planner 裁定的资源命名）——接收任务描述 + 类型（如 new change / propose / auto run / goal run），落到**子进程执行既有 CLI**。需要设计：
   - 子进程模型：spawn 什么（`rasen` 自身命令？`claude` CLI headless 跑 /rasen:auto？）——planner 必须裁定切片 2 能真实交付的最小闭环。注意：**拉起并监督 claudecode 会话是切片 3**；切片 2 的安全最小闭环可以是"提交 → 创建 change（rasen new change）/ 触发非交互 rasen 命令 → 看板可见"，把需要 LLM 的 propose/auto 留给切片 3 或作为受限一档。裁定时以"真实可验证 + 不越切片 3 边界"为准绳。
   - 异步语义：命令可能秒回（new change）也可能长跑——长跑是否属于本切片？（倾向：本切片只做快命令 + 任务受理记录；长跑进程的生命周期归切片 3）
   - 安全：仍是回环 + bearer token；写端点需防 CSRF 类问题吗（同源 token 模型下论证）；输入校验（命令注入防护——绝不拼接 shell 字符串，用 spawn argv 数组）。
2. **UI 提交表单**：看板页或独立入口的"新任务"表单（最小字段），提交后看板刷新可见新 change。
3. **提交记录可观测**：提交的任务在看板/或任务列表可见其受理状态（成功创建/CLI 报错原样透出）。

## 范围（OUT）

- **会话生命周期监督**（拉起 claudecode 长跑会话、监控、kill、adopt-or-spawn、daemon 常驻）——切片 3。
- packages/daemon 包化——切片 3。
- 写路径绕过 CLI 直接改文件——永久禁止（除非单独论证）。

## 硬约束

- CLI 是唯一写入口：服务端只 spawn 既有 CLI 命令（argv 数组，无 shell 拼接），不复制业务逻辑、不直接写 rasen/ 工作区文件。
- 不回归切片 1：身份头、getActiveChangeIds 口径（两条 SHALL NOT 主 spec 条款）、只读端点行为、config 契约全部保持。
- 回环 + bearer；写端点同 token 鉴权；任何 CLI stderr/退出码如实透出（不吞错——harness-demo 教训）。
- 交付模式 local（提交留在 dev/platform-slice2），PR 由用户/LEAD 后续决定。
- 主 specs 现有：management-http-api、board-ui、management-ui-command、config-*（注意 PR #10/#11 合并后的最新状态：本地化、profiles、management surface 统一）。

## 已知事实（勿重复调研）

- 服务端装配点：`src/core/management-api/server.ts`（切片 1 批 2 确立的组合模式——config router 零改动、管理路径谓词独立；**新写路由组照此模板挂载**）。ProjectHome 有 server 生命期缓存（null 逐请求重探）。
- `src/commands/ui-launch.ts` 共享启动流程；`rasen ui` 公开命令；UI 是 Preact SPA（packages/ui，唯一 fetch seam src/api/client.ts，Board|Config 导航，看板=首页）。
- run-state 读链已在 runs.ts；changes.ts 用 getActiveChangeIds+loadChangeContext。
- **新命令/新可见 flag 必须**：completions command-registry 条目 + src/locales/{en,ja}.json 双语描述（PR #10 的 parity 测试强制，切片 1 已两次踩坑）。
- UI 包在裸树不可解析：运行时验证用兄弟符号链接法（<parent>/@atelierai/rasen-ui → packages/ui，vite build 后），验完删。
- 遗留待办（与本切片相关性低但勿撞）：list.ts 收敛 follow-up 未立项；/gates 顶级化、startConfigApiServer 去留待用户。

## 待 planner 裁定

1. 写端点资源模型与命名（tasks? changes? actions?）、受理语义（同步等待快命令完成 vs 受理即返回+轮询）。
2. 切片 2 支持的命令白名单（最小闭环选哪些：`rasen new change` 必有？`rasen validate`？触发 auto/goal 是否越界到切片 3——给出明确边界论证）。
3. 子进程安全模型细节（argv 白名单、工作目录锁定、超时上限、并发上限）。
4. UI 表单的落点（看板页内嵌 vs /new 路由）与提交后反馈模式。

## Planner 裁定结果与耐久发现（planner-1 追加，2026-07-20）

四项裁定（详见 design.md Decisions）：
1. **D1**: `POST /api/v1/changes`（复用既有资源名，不造 tasks 队列抽象）；**同步受理**（new change 亚秒级，30s 超时兜底；异步 202+轮询机器归切片 3，/runs 已是天然读侧）。
2. **D2**: 白名单=唯一操作 create-change（`new change <name> --proposal=<text> --json`）；准入三条件=有界确定性终止/无 LLM 网络依赖、无常驻进程、结果经既有读端点可观测——auto/goal 违反前两条即切片 3 边界论证。白名单是数据表非散落 if，切片 3 扩表。
3. **D3**: spawn `process.execPath` + 服务端自身 dist 的 cli-entry（createRequire 解析，绝不走 PATH）；shell:false；预 spawn 校验（kebab-case 名、描述长度上限/无控制字符）；描述用 `--proposal=<text>` 单 token 防 flag 注入；cwd 锁 launchProjectRoot（无项目 409 no_project）；30s 超时 SIGTERM→SIGKILL→504；并发 cap=1 撞则 409 busy；非零退出 422 原样带 CLI 错误+exitCode+stderr；CSRF 论证=bearer 头非 cookie+无 CORS 头即天然免疫，写进 spec。
4. **D4**: 看板内嵌对话框（非 /new 路由）；成功后关表单+store refetch+高亮真实新卡（禁乐观注入假卡）；失败表单留驻原样显示 CLI 错误；in-flight 禁用提交。

耐久发现（后续切片勿重蹈）：
- **关键 gap**：`rasen new change` 只建 `.openspec.yaml`（--description 只写 README.md），**不产 proposal.md**；而 board/GET /changes 走 getActiveChangeIds（要求 proposal.md）且有两条 SHALL NOT 禁止放宽——裸提交在看板上不可见。解法=新增 CLI flag `--proposal <text>` 种子化 proposal.md（经 CLI 写入，不绕过），change 立即 active 落 Planning 列。这触发了 planning-context 预言的两个 seam（registry+locales），已入 tasks 1.2/1.3。
- management-http-api 的 "Read-only…" requirement 是**改名级**变更，delta 用 REMOVED+ADDED（validate 不查 rename，MODIFIED 不安全——沿 office-hours fork-first 教训）。
- 405 逻辑现在 router.ts:75 是笼统 non-GET 拒绝，须改为 per-path method 路由（auth 先于 405 的现序保持）。
- `newChangeCommand --json` 失败路径：printJson({change:null,status:[…]}) + exitCode 1——服务端解析错误时两处都要看（stderr 可能为空，错误在 stdout JSON 里）。
- registry 条目位于 command-registry.ts:250（new→change flags 数组）；locale 键是英文描述原文直键（en.json/ja.json 各 445 行附近格式）。

Artifacts 全 done，validate --json 通过（1/1 passed）。
