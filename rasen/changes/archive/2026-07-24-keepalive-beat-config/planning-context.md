# Planning context — keepalive-beat-config (LEAD-seeded)

## User intent (verbatim scope, 2026-07-24)

small-feature。做以下四项 playbook 纪律 + UI beat 配置(不做文档修正):

A. **经济模式指令化**(Step B.4):park 派发词要求 beat 长时配套加大 Bash 工具 timeout;两参数同句出现。
B. **beat 静默纪律**:worker 收到 `{beat}` 时不输出任何文字、不思考,立即原样重发 wait 调用。
C. **LEAD 及时 standDown 纪律**:worker 用完立刻写 standDown 信号,12 拍 cap 只是止损兜底。
D. **长命令保温纪律**:预期 >~2 分钟或时长未知的命令(测试/build)→ `run_in_background` + 前台有界轮询(间隔 ≤270s,每次轮询返回=一次缓存刷新);短命令照常前台跑。与既有"禁后台+闲置等唤醒"长任务纪律合并表述(原理由防通知丢失,新增缓存保温理由)。
E. **UI config 增加 beat 配置**:可配置 beat 时长(以及对应的 tool timeout),范围 90–280 秒;包含内置两个配置方案(100 / 270),可选择默认方案(默认 270)。

## LEAD 已确定的设计决策(实验与讨论已定,勿重开)

1. **配置键**:新增 `keepalive.beatSeconds`(global scope,整数 90–280,registry defaultValue=270)。`rasen agent wait` 的 beat 解析顺序:`--beat-seconds` 显式 > config `keepalive.beatSeconds` > 代码兜底 `DEFAULT_BEAT_SECONDS`(100,保持不变作为无配置环境的保险丝)。上限仍受 MAX_BEAT_SECONDS=300 硬顶(TTL 约束)。
2. **timeout 配对问题的解法**:worker 无法感知配置值,所以 playbook 规定 park 的 wait 调用**一律**显式传 Bash `timeout: 330000`(覆盖最大 280s beat + 余量)——不再按档位区分,消除"配置 270 但裸调用被 120s 掐死"的组合。UI 中展示"对应 tool timeout"仅为信息说明(beat+50s),实际派发词用常量 330000。
3. **预设方案**:不新增独立的 preset 配置键——"方案"是 UI 交互概念:两个内置按钮(100=默认超时兼容/快速档,270=经济档)写同一个 `keepalive.beatSeconds` 键,另有 90–280 自定义输入。默认选中 270(即 registry 默认值)。
4. **背景事实**(实验已钉死,写入 proposal 动机即可):5m TTL 每次读取滑动刷新;beat 每拍成本≈前缀×0.1 与时长无关,270s≈理论最优刷新节奏;120s 是 Bash 工具**默认** timeout,显式可到 600s;teammate 也是 5m TTL;SendMessage 唤醒必 rebase。
5. D 项的轮询间隔上限措辞用"≤270 秒"(与经济档一致),不跟随 beatSeconds 配置(轮询是 worker 手写的 until-loop/Monitor,固定上限更简单可靠)。

## 代码落点(LEAD 已核对)

- `src/core/keepalive/index.ts`:`KeepaliveConfig`/`resolveKeepaliveConfig` 增加 `beatSeconds`(接受 90–280,越界回默认);常量注释更新。
- `src/commands/agent.ts` `wait()`:beat 解析接入 config(显式 flag 优先)。
- `src/core/config-keys.ts`:注册 `keepalive.beatSeconds`(global,90–280,default 270,group Pipelines)。
- `src/core/config-schema.ts`:zod `beatSeconds: z.number().int().min(90).max(280).optional()`。
- `src/core/templates/workflows/_orchestration.ts` Step B.4:A/B/C 三条纪律 + timeout 常量 330000;长任务条款(D)——注意该文件同时被 rasen-auto/rasen-goal/review-cycle 共享嵌入。
- UI:`packages/ui` 的 config 页(先查现有 config 渲染机制——上轮 ui-config-redesign 后 config 按 registry 分组渲染;beat 配置需要预设按钮+自定义输入的定制控件,查 Workflows/Pipelines 组现有控件模式)。UI 的 config 读写走既有 config HTTP API,新键应自动获得基础支持,预设按钮为增量。
- 测试:`test/commands/agent-wait.test.ts`(config 解析优先级)、`test/core/keepalive.test.ts`、config-keys round-trip 测试(现有)、UI 侧组件测试若有先例、`test/core/templates/skill-templates-parity.test.ts` 双哈希表(模板改动后须手工回填,先跑测试取新哈希)。
- locales:新 CLI/config 描述字符串三语(en/zh-cn/ja)。**警告**:locale 文件此前混有另一 session 的未提交改动,提交时须核对 diff 归属(shared-index pathspec 纪律)。

## 已知坑(前车之鉴)

- 模板改动 → parity 测试双哈希表(EXPECTED_FUNCTION_HASHES + EXPECTED_GENERATED_SKILL_CONTENT_HASHES)都要回填。
- `bin/rasen.js` 跑 dist,改 src 后须 `pnpm build` 才能 CLI 实测;build 会 clean dist,别与跑着的测试并发。
- PowerShell `Set-Content -Encoding utf8` 带 BOM;信号文件已有 BOM 剥离,但别在测试脚本里踩。
- 昨日 fix-agent-wait-liveness(commit 5196b8cf,已合并 PR #51)已把 DEFAULT_CONTEXT_FLOOR=0、DEFAULT_BEAT_SECONDS=100、陈旧信号防护落地;本 change 在其之上。
