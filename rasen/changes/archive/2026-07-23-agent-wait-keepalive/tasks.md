# Tasks: agent-wait-keepalive

## 1. 核心模块

- [x] 1.1 新建 `src/core/keepalive/` 模块:信号文件协议(路径解析 `<changeRoot>/signals/<key>.json`、原子写辅助、读取+消费带 Windows 删除重试)与拍状态持久化(`signals/.state/<key>.json` 读写、三种复位规则、2 小时陈旧判定)
- [x] 1.2 实现默认封顶解析(全角色统一 12 拍)与 `--max-beats` 覆盖逻辑
- [x] 1.3 实现运行时检测适配(复用 `src/core/shared/tool-detection.ts` / `src/core/codex/` 现有指纹:Claude Code / Codex / unknown)与门控解析(默认 claude=on、codex=off、unknown=off,配置覆盖)

## 2. CLI 命令

- [x] 2.1 在 `rasen agent` 命令组新增 `wait` 子命令:参数(`--change` 必填、`--role` 必填、`--max-beats`、`--context-tokens`、`--beat-seconds` 上限 300),changeRoot 解析与 signals 目录初始化
- [x] 2.2 实现拍主循环:门控检查 → 上下文豁免检查 → 封顶检查(不阻塞即返) → 5s 间隔轮询至 beat-seconds 超时;全部出口 exit 0 + 单个 JSON stdout(`{beat,remaining}` / `{resumed,instruction}` / `{standDown,reason}`)
- [x] 2.3 信号消费路径:resume → 输出 payload+删除信号+清拍状态;standDown → 输出 lead-stand-down+删除信号+清拍状态

## 3. 配置

- [x] 3.1 在 config-key-registry 登记 `keepalive.runtimes.claude`(bool, 默认 true)、`keepalive.runtimes.codex`(bool, 默认 false)、`keepalive.contextFloor`(正整数, 默认 100000),global 作用域;接通 config set/unset/编辑器/HTTP API 校验
- [x] 3.2 命令内读取 effective config 解析门控与 contextFloor

## 4. 模板(playbook / review-cycle)

- [x] 4.1 `src/core/templates/workflows/_orchestration.ts`:新增 keepalive 生命周期节——三档复用视界的派发标注、parked worker 只走信号文件(禁 SendMessage)、LEAD 信号写入格式(原子写)、standDown 后继任者冷启动种子规则
- [x] 4.2 review-cycle 模板:LOOP_BOUND reviewer/fixer 的轮间 park 流程(调 `rasen agent wait`、按 JSON 行动)、循环出口下线;decompose 的 planner MILESTONE_BOUND 规则(最后一个 child propose 完成 → LEAD 写 standDown)
- [x] 4.3 verify 扇出等宽扇出阶段显式标注 ONE_SHOT(禁叠加 keepalive)
- [x] 4.4 build → `rasen update` 重装 skill,同步 workflow-template-parity 哈希基线

## 5. 测试

- [x] 5.1 keepalive 核心模块单测:信号写读消费(含并发 rename 竞态)、拍状态三种复位、角色族封顶解析
- [x] 5.2 命令级测试:超时拍输出、resume/standDown 信号路径、封顶即时返回、门控三态(claude/codex/unknown,用环境变量注入模拟指纹)、`--context-tokens` 豁免、`--beat-seconds` 上限钳制
- [x] 5.3 Windows 兼容:信号路径分隔符、删除重试(EBUSY 模拟);确认新增测试不引入 CLI-spawn flake 模式
- [x] 5.4 配置注册测试:三个键 round-trip config schema、非法值拒绝
- [x] 5.5 全量 `pnpm test` 绿(基线失败按已知清单排除),模板 parity 测试过
