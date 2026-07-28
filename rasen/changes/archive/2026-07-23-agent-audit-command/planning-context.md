# Planning Context — agent-audit-command

## User intent (verbatim scope decision, 2026-07-23)

把 `scripts/token-audit/` 的会话成本审计工具产品化为面向用户的自查工具(**Phase 1**)。用户拍板的产品形态:

- **Pull 模型**:用户自己跑、结果落自己机器、看自己的账单。零后台采集。
- CLI 入口:`rasen agent audit`(归入已有的 `rasen agent` 命名空间,与 `agent context` / `agent wait` 作伴)。
- **Experimental 标记**:文档与命令输出明示"解析 Claude Code 内部 transcript 格式,harness 升级可能暂时失效"。
- **Fail-soft 是硬要求**:格式漂移时输出友好错误("transcript 格式无法识别,可能 harness 已更新"),绝不栈爆炸;钉 fixture 测试,漂移时 CI 先于用户发现。
- 配一个 `/rasen-audit` skill 做引导层(找 sessionId、跑命令、打开 viewer、解读结果)——本项目交付面是 skills-only。
- 输出落 `~/.rasen/analytics/`(用户自有目录,随时可删)。
- viewer.html 作为包资产随包分发;命令支持 `--open` 打开 viewer。

## 明确 OUT OF SCOPE(Phase 1.5/2,本 change 一概不做)

- hook 自动采集(Stop/SessionEnd hook、`--install-hook`)。
- 任何上传/遥测:不动 `src/telemetry/` 契约,不动后端,不做 consent 分档。
- gstack 式富事件流/本地 JSONL 事件日志(那是另一个 change)。

## 已有代码事实(LEAD 已核实)

- `scripts/token-audit/` 已提交(commit 2e8639ee):`audit.mjs`(分析器)、`viewer.html`(自包含单文件 viewer,无网络无依赖)、`forensics/`(一次性脚本,保留 provenance,**不产品化**)、`README.md`。
- `audit.mjs` 核心纪律(README "Measurement discipline",迁移时不得丢失):
  1. 按 `message.id` 去重(按行统计高估 ~2.5×);
  2. 双 TTL 系数(主会话 cache write 2× @1h,subagent 1.25× @5m);
  3. 已对基准会话 c4a16986 逐行验证。
- 输出 schema `rasen-token-audit/1`,自描述(per-request rows 是列数组,`requests.columns` 声明)。
- JSON 里 `session.mainTranscript` 是完整本地路径——**本地工具保留没问题**(viewer 调试/溯源有用);仅当未来上传时才需白名单构造摘要,本 change 无上传。
- audit.mjs 会话发现逻辑:sessionId 前缀匹配 + `--projects-dir` + 直接指 .jsonl 路径;subagent transcripts 自动发现于 `<projectsDir>/<sessionId>/subagents/*.jsonl`。
- `rasen agent` 命名空间已有 `agent context`(transcript 占用探针)与 `agent wait`(keepalive)——新命令跟随其注册模式与代码位置(src/cli/ 注册,src/core/ 或专用模块放逻辑)。`agent context` 已实现 Claude projects 目录发现逻辑,audit 可复用同一套发现代码,避免两份实现漂移。
- README 曾写"刻意不进 CLI 表面"(格式漂移风险)——本 change 用 experimental 标记 + fail-soft + fixture 测试正面化解该矛盾,proposal 里要交代这个决策转变。

## 约束

- 版本号归用户管:绝不 bump version;发布类改动版本无关。
- 跨平台:所有路径 path.join/resolve,Windows CI 意识(见 rasen/config.yaml rules)。
- 产品语言:specs 写用户可见行为,机制细节进 design.md。
- 遥测契约(command+version+distinctId+os+node_version)一字不动;`rasen agent audit` 作为命令名本身会进现有 command-name 遥测,这是既有行为,无需特殊处理。
- forensics/ 留在 scripts/ 原地不动。

## Open questions planner 需在 design 里回答

- audit 逻辑迁入包内的位置(建议 src/core/token-audit/ 或类似)与 scripts/audit.mjs 的去留(建议改薄壳委托或删除并在 README 指向新命令,二选一,给理由)。
- viewer.html 资产分发方式(package files 列表/现有资产机制)与 `--open` 的跨平台打开实现。
- fixture 的构造:最小合成 transcript(几行即可覆盖去重、双 TTL、churn 归因路径),不要把真实会话数据(含真实路径)提交进仓库。
- 默认输出目录 `~/.rasen/analytics/` 的机器根解析(项目已有 ~/.rasen 机器根约定,复用现有解析函数)。

## 已决策(design.md D1–D4,2026-07-23)

- **D1 代码位置**:`src/core/token-audit/{parse,classify,audit,errors}.ts`(镜像 `agent-context.ts` 对 `agent context` 的角色)。`AgentCommand.audit()` 加进 `src/commands/agent.ts`(现有 context/wait 同文件),CLI 挂在既有 `agentCmd`(`src/cli/index.ts` 约 L781 起)。**discovery 复用**:`claudeProjectsDir(cwd, homeDir)` + `findLatestMainTranscript(baseDir)`(`src/core/agent-context.ts:304-338`)——比 audit.mjs 自己的 slug 正则更正确(处理路径分隔符更全),不得重新实现一份。
- **audit.mjs 去留**:改薄壳委托(delegate 到 `rasen agent audit`),不删除——因为 `rasen/office-hours/token-cost-audit.md` 与 README 的 baseline 验证(session c4a16986)按脚本原路径引用,直接删除会断链;forensics/ 与 README 保留原地。
- **D2 viewer 分发**:新建仓库根 `viewer/audit.html`(从 `scripts/token-audit/viewer.html` 搬移),`package.json` `files` 新增 `"viewer"` 条目(现有 files 只有 dist/bin/schemas/skills/pipelines/scripts/postinstall.js;`assets/` 目录存在但只是 README 配图,**不在** files 里,不能借用)。`--open` 复用 `src/commands/ui-launch.ts` 的 `openInBrowser()` 模式(darwin `open` / win32 `cmd /c start` / 其余 `xdg-open`,detached+ignore+unref)。
- **D3 fail-soft**:新类型 `TranscriptFormatError`(file/line/cause),仅这个类型在 CLI 层被捕获转成友好文案+exit 1(`--json` 下镜像 `agent context` 的 `{available:false,reason,detail}` 形状);其余异常正常抛出暴露真 bug。单行 JSON 解析失败继续沿用"跳过"旧行为,不算 format-drift。
- **D4 输出目录**:`getGlobalDataDir()`(`src/core/global-config.ts:244`,RASEN_HOME > XDG_DATA_HOME/rasen 兼容别名 > ~/.rasen 默认,与 project registry/store registry/workset state 同一套)+ `analytics` 子目录,不新造第二套机器根约定。
- **skill 注册方式确认**:本仓库 skill 不是 skills/ 下裸 markdown(那目录只有 experts/ 用),而是 `src/core/templates/workflows/*.ts` 导出 `getXSkillTemplate()` → `src/core/templates/skill-templates.ts` facade re-export → `src/core/workflow-registry/builtins.ts` 的 `BUILT_IN_WORKFLOW_IDS`/`BUILT_IN_ADAPTERS`(`{id,dirName:'rasen-audit',skill}`)登记。/rasen-audit 定位为诊断类可选技能,进 `BUILT_IN_WORKFLOW_IDS`(full profile)但**不进** `CORE_WORKFLOW_IDS`。
- **新增 spec 命名**:`cli-agent-audit`(CLI 命令契约)+ `workflow-audit-command`(skill 契约,命名沿用 `workflow-help-command` 现行前缀,不是旧的 `opsx-*-command`)。

## 交付状态

proposal.md / design.md / specs/{cli-agent-audit,workflow-audit-command}/spec.md / tasks.md 全部已写入,`rasen validate agent-audit-command --json` 通过(valid:true,0 issues),`rasen status` 显示 isComplete:true,apply-ready。未 push/未 apply——待用户或 apply 阶段推进实现。

## 范围追加:Codex rollout 支持(LEAD 2026-07-23 追加,已并入 design.md D5/D6 + specs + tasks 8 组)

- **复用清单(禁止二次实现)**:`src/core/codex/index.ts` 已导出 `findRolloutPath`/`listRolloutFiles`/`readRolloutOccupancy`/`readRolloutConversation`/`resolveCodexHome`/`CODEX_CLI_VERSION_PREMISE`(来自 `rollout.ts`/`codex-home.ts`)。`agent-context.ts` 已有 `detectTranscriptKind`/`CODEX_ROLLOUT_BASENAME`/`findLatestRollout` 供 runtime 判定复用。**唯一缺口**:session_meta 首行读取函数 `readSessionMeta` 目前是 `agent-context.ts` 内部私有函数——design D5 决定搬到 `src/core/codex/rollout.ts` 导出为 `readRolloutSessionMeta`(纯改名迁移,行为不变),消灭"第二个解析器"隐患,tasks 2.1 落实。
- **rollout 真实格式(LEAD 用真实样本 + 仓库既有 fixture `test/fixtures/codex-rollout/sample-rollout.jsonl` 双重核实)**:每行 `{timestamp,type,payload}`;`session_meta`(恒为首行)带 `cwd`/`thread_source`("user" 主线程/"subagent" 子代理)/`parent_thread_id`+`forked_from_id`(子代理血统)/`agent_nickname`+`agent_path`/`cli_version`;`event_msg` 里 `payload.type:"token_count"` 带 `info.total_token_usage`(**单调递增累计值**)+ `info.last_token_usage`(截至该事件的状态,流式更新会重复出现,不是干净的单请求增量)+ `info.model_context_window`;`task_started`/`task_complete`(各带 `turn_id`)界定回合边界。
- **去重规则的 Codex 对应物**(design D5 核心):不是 dedup by id,而是"仅在累计计数器变化时记一条派生请求记录",增量=当前累计−上次记录累计;数值未变的重复事件跳过(等价于 Claude 一行 message.id 重复)。
- **子代理发现方式与 Claude 完全不同**:没有 `subagents/` 子目录,必须扫 `sessions/<Y>/<M>/<D>/` 整棵树(`listRolloutFiles`,已有且有界)+ 读每个候选的 `session_meta.parent_thread_id` 做 BFS 归属判定(含多级嵌套子代理)。
- **计费模型不可硬套**:Codex 无 TTL 分级、`cache_write_input_tokens` 通常为 0(自动缓存非计费写入)、多出 `reasoning_output_tokens` 字段。design D6 拍板:Codex 报告不产出 `billedInputEq`/churn 归因分类(Claude 专属概念无法套用),改为原始 token 分量总计 + `cacheHitRatio` 信号。
- **schema 版本决策**:bump 到 `rasen-token-audit/2`(加性、非破坏性改名),用 `session.runtime:'claude'|'codex'` 做判别式;`/2` 的 Claude 分支形状与 `/1` 完全一致(仅多一个 runtime 字段),`/2` 的 Codex 分支不产出 pricing/churnEvents/resumes/billedInputEq(不补零),改产出 rawTokens/cacheHitRatio/turns[]。viewer 需要 runtime-aware 渲染分支(不能假设 Claude 专属字段总存在)。
- **CLI 形状**:`--runtime <claude|codex>` 镜像 `agent context` 既有约定——裸 id 不带 `--runtime` 时默认按 Claude session id 解析(现状不变);要按 Codex thread id 解析必须显式 `--runtime codex`,内部走 `findRolloutPath(threadId, {codexHome})`(已有,有界 active+archived 扫描)。
- **fixture 约束不变**:Codex 侧新增 `test/fixtures/token-audit/codex/`(合成,仿照 `test/fixtures/codex-rollout/sample-rollout.jsonl` 已核实的真实结构),同样禁止真实会话数据/真实本地路径——包括 LEAD 给出的那个真实样本路径本身,只能"仿照结构"不能直接抄内容。
- **spec 归属**:两条新 Codex 需求全部并入既有 `cli-agent-audit`/`workflow-audit-command` 两个 capability(未新增 capability),因为这仍是"一个 audit 命令,两种 runtime",不是新功能面。
