## 1. Run-state：sessionHandoff 代数

- [x] 1.1 `src/core/pipeline-registry/run-state.ts`：`sessionHandoff` 增加可选字段 `n`（缺省按 1 处理），旧 run-state 原样解析
- [x] 1.2 `src/commands/pipeline.ts`：`pipeline resume`（text 与 `--json`）输出 `sessionHandoff.n`
- [x] 1.3 `test/core/pipeline-registry/run-state.test.ts` + `test/commands/pipeline.test.ts`：带 `n` / 不带 `n` 两种 run-state 的解析与 resume 输出断言（路径断言用 `path.join()`）

## 2. Session-relay 协议（模板层）

- [x] 2.1 `src/core/templates/workflows/handoff.ts`：session handoff 写完后追加接力步骤——询问用户是否拉起继任会话；生成 bootstrap prompt（读 `handoff/lead-<n>.md` → `openspec pipeline resume <change>`（store-scoped 带 `--store`）→ 按 next action 继续）
- [x] 2.2 handoff.ts：引号安全传输指引——bootstrap prompt 写入 `handoff/relay-prompt.txt` 文件中转（平台无关形态）；Windows 附 `-EncodedCommand` 捷径示例；明确禁止裸拼含引号/非 ASCII 的 prompt
- [x] 2.3 handoff.ts：平台分支 spawn 指引（Windows `Start-Process`；macOS Terminal.app；Linux gnome-terminal/konsole）+ 通用 fallback：spawn 失败或终端未知时打印手动接力命令（工作目录 + prompt 文件路径 + 启动命令）
- [x] 2.4 handoff.ts：代数与上限——`sessionHandoff.n` 递增写入；`n` 达 `maxRelays`（复用 pipeline 解析值或默认 3）时不自动 spawn，向用户升级并建议 decompose
- [x] 2.5 `src/core/templates/workflows/_orchestration.ts`：H.1 预检从"一行提醒"升级为三选一询问（自动接力 / 继续本会话 / 手动处理）；新增 session 接力小节（H.7）——quiesce 不变式、先 spawn 后退场时序、跨会话不恢复 subagent（复用 Step F.1 梯度）；"platform cannot" 结论在 H.7 中正式修订（注明 2026-07-07 探针与 CLI 2.1.202）；auto.ts 预检同步升级
- [x] 2.6 `test/commands/handoff.test.ts` + `test/commands/auto.test.ts`：生成的 skill/命令文本包含接力询问、文件中转指引、quiesce 与代数上限段落

## 3. Compact-recovery hook

- [x] 3.1 新增 `hooks/compact-recovery.sh`：stdout 输出恢复指引（运行 `openspec pipeline resume`、查 `sessionHandoff` 与各 stage `handoffs[]`、优先蒸馏物、不信任 compact 摘要细节），exit 0（实测输出与退出码）
- [x] 3.2 `src/core/init.ts`：在 Safety Hook 提示旁打印 SessionStart（matcher `compact`）copy-paste 配置片段；绝不改写 `.claude/settings.json`（注：hooks 属仓库文件而非生成物，无生成物名单常量适用——与 safety-check.sh 先例一致）
- [x] 3.3 init 输出测试：断言 SessionStart 片段与脚本引用出现在 init 输出中，且 settings.json 无 hooks 键

## 4. 验证与残留项

- [x] 4.1 实现期补验：前任会话完全退出后分离子进程存活（Windows job object 语义）——嵌套 headless claude 前任 spawn 孙进程后退出，孙进程仍写出 ORPHAN-OK；结论已记入 design.md Open Questions
- [x] 4.2 端到端演练一次真实接力：写 handoff/lead-1.md + sessionHandoff(n=1) → 模板标准形态 spawn（relay-prompt.txt 文件中转 + `-EncodedCommand`）→ 继任窗口回复 RELAY-DRILL-OK handoff/lead-1.md generation=1 + Next action（用户目视确认）；演练用 auto-run.json / relay-prompt.txt 已清理，lead-1.md 保留
- [x] 4.3 本地 `pnpm test` 全量通过：三轮验证——唯一实际失败是既有 vocabulary sweep 缺中文镜像豁免（已修：`test/vocabulary-sweep.test.ts` 加 `docs/zh/upstream-v1.5-stores-and-resolution.md`，与英文原版同理）；已知 flaky 超时（artifact-workflow deprecation notice）隔离重跑 2s 通过

## 5. 文档对齐

- [x] 5.1 `docs/opsx-workflow-guide.md`：新增 session relay 小节（主动接力 + hook 被动加固、代数上限、quiesce）
- [x] 5.2 `docs/zh/` 镜像同步 5.1
- [x] 5.3 changeset：`.changeset/automate-session-relay.md`（minor）
