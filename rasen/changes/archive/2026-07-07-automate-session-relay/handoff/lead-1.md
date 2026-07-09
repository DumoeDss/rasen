# Handoff: automate-session-relay — lead #1

## Original intent
推翻 "platform cannot restart the main session" 假设：主动接力（撞线时自动拉起继任 Claude Code 窗口）+ SessionStart(compact) hook 被动加固。用户已授权方案 A + hook 互补落地。

## Position
Pipeline: small-feature. Completed stages: propose. Current stage: apply（第 1–3 组任务已完成，第 4 组进行中）。

## Done / Remaining
Done: tasks.md 1.1–1.3（run-state `sessionHandoff.n` + pipeline resume 输出 + 测试）、2.1–2.6（handoff.ts 接力协议、_orchestration.ts H.1 升级 + H.7、auto.ts 预检、模板测试）、3.1–3.3（compact-recovery.sh + init 提示 + 测试）、4.1（孤儿进程补验：前任退出后孙进程存活，ORPHAN-OK）。
Remaining: 4.2（本演练）、4.3（全量测试）、5.1–5.3（docs + docs/zh + changeset）。

## Key decisions (and why)
- 继任者形态 = 可见交互式窗口，非 headless——用户可接管 + 免权限突破面。
- Bootstrap prompt 走文件中转 / `-EncodedCommand`——裸拼引号被双层解析截断（实测中文 prompt 截成前两字）。
- 先 spawn 后退场；quiesce 不变式（仅 stage 边界接力）；`sessionHandoff.n` 代数上限（maxRelays，默认 3）。

## Dead ends & gotchas
- fork + 主动 compact 方案被否：无 IPC 注入 /compact，且对已有蒸馏物重复付摘要成本。
- runCLI 测试跑 dist：改 src 后必须 `pnpm run build` 再跑 CLI e2e 测试。
- 新导出要同步加进 pipeline-registry 的 barrel（index.ts）。

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)
- "CLAUDECODE=1 会拦截嵌套 claude" — 已排除（探针 ① SPAWN-OK）。
- "Start-Process 子进程随 claude 根进程死亡" — 已排除（4.1 ORPHAN-OK）。

## Working set
src/core/templates/workflows/{handoff,auto,_orchestration}.ts、src/core/pipeline-registry/{run-state,index}.ts、src/commands/pipeline.ts、src/core/init.ts、hooks/compact-recovery.sh、test/{commands/{handoff,auto,pipeline},core/{init,pipeline-registry/run-state}}.test.ts。

## Next action
运行 `pnpm test` 全量验证（注意 Windows EBUSY flake 需隔离重跑），然后写 docs/opsx-workflow-guide.md 的 Session relay 小节并镜像到 docs/zh，最后补 changeset。
