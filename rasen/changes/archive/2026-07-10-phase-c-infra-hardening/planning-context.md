# Planning Context — phase-c-infra-hardening

Seeded by the LEAD, 2026-07-10. Source of truth for propose. Pipeline: small-feature (explicit user selection), gates default (pause at propose/apply gates). Model routing (user directive): propose worker = default model; ALL other workers = sonnet.

## User intent (verbatim constraints)

- "其他session在处理phase A和B，你来处理PhaseC吧" — this change owns **Phase C 基础设施硬化** from `docs/brand-independence-status.md` §5 (待做清单 §4 items #7/#8/#10/#11):
  1. **#7** release.yml 增加 npm publish job（NPM_TOKEN gated），使 `rasen-v*` tag 一打 → GitHub Release + npm 双通道自动出货。
  2. **#8** flake.nix `pnpmDeps.hash` 复核路径 — 本机 Windows 无 nix，无法本地验证；可做的是 CI 侧保障（如 nix build 的 CI job）或明确记录复核步骤。planner 裁决落点。
  3. **#10** 遥测 `telemetry.rasen.io` TLS provisioning 确认 + 端到端打点验证（endpoint 硬编码 `src/telemetry/index.ts:30`；fire-and-forget 设计，TLS 未就绪则打点静默丢失）。
  4. **#11** CI 矩阵回填确认（rebrand known-open）— 检查 `.github/workflows/ci.yml` 现状，缺什么补什么（OS 矩阵？node 版本矩阵？）。
- **Phase A/B 归另一 session，勿碰其表面**：package.json 版本号、CHANGELOG、push/tag 操作、`rasen/specs/` 混词回写、`docs/` 品牌回写、README。本 change 只动 `.github/workflows/*`、`flake.nix`（若需要）、遥测验证（只读/外部探测，若需改码再议）。
- Phase C 出口判据（status doc §5）："tag 一打，GitHub Release + npm 双通道自动出货；nix build 可复现。"

## Known facts (LEAD verified 2026-07-09/10)

- `.github/workflows/` 现有：`ci.yml`、`deploy-docs.yml`、`release.yml`、`README.md`。
- release.yml 现状（status doc §3.2）：由 `rasen-v*` tag 触发（line ~6），build → `npm pack` → tarball 上传 GitHub Release（~41-49），**不含 npm registry publish**；无 `.npmrc`。
- 无任何 `rasen-v*` tag 存在；release workflow 从未被触发。**本地有 26+ 未推送提交** — push/tag 是 Phase A（另一 session/用户）的事，所以 release.yml 改动只能**静态验证**（YAML 结构、job 依赖、actionlint 式审查），不能 live 触发。tasks 里不要写"打 tag 验证"。
- 版本号 0.1.0 vs 0.2.0 不一致由 Phase A 处理 — publish job 必须版本无关（从 package.json 读）。
- NPM_TOKEN secret 需用户在 GitHub repo settings 配置 — workflow 里引用即可，交付时明确告知用户此前置。建议 publish job 对 secret 缺失做优雅降级（跳过并提示）或明确失败——planner 裁决。
- flake.nix：品牌字段已就位（pname="rasen" 等，:29,76,79,88）；`pnpmDeps.hash` 有值（:54）但来源未复核。
- 遥测：`TELEMETRY_ENDPOINT='https://telemetry.rasen.io'`；Worker custom domain 已挂但 2026-07-09 时 TLS 证书仍 provisioning 中。验证手段：curl 探测 TLS/可达性 + 用 CLI 实发一条打点 + （面板确认归用户，fire-and-forget 无回执）。**本机 curl 注意代理**：直连 rasen.io 可能需走代理或 `--noproxy` 视网络环境（历史经验：workers.dev 须走代理）。
- CI 矩阵回填的原始 known-open 出自 rebrand session（"CI 矩阵回填待确认"）——具体缺口需 planner 读 ci.yml 确认（怀疑点：是否只跑单 OS/单 node；Windows EBUSY flake 是否需要 CI 侧处理）。

## Constraints (repo conventions, all stages)

- 共享工作树多 session 并发：另有 sha-stamping session 的未提交改动（`src/core/templates/workflows/archive-change.ts`、`bulk-archive-change.ts`、`ship.ts`）+ Phase A/B session 可能触碰 package.json/CHANGELOG/docs/specs/README。**绝不 stage/commit 非本 change 文件；ship 一律显式 `git commit -- <paths>` + `git show --stat` 复核。**编辑任何文件前先 `git status` 确认无外来在途改动。
- 子 change ship 用 **local** 模式（只 commit 不 push）——交付决策在用户手里（Phase A）。
- CLI 不在 PATH：`node dist/cli/index.js <args>`；若改 src 需 `pnpm build`。本 change 预计不动 src/core/templates → 无 parity 哈希扰动预期；若动了 `src/telemetry/*` 则跑相关测试。
- Windows CLI-spawning 测试 EBUSY flake 为已知非回归。
- 绝对化规则措辞规范：NEVER/ALWAYS/MANDATORY 必须带作用域从句。
- workDir 已解析：run-state/报告写 `C:\Users\Sayo\AppData\Local\rasen\projects\openspec-code-1e42477e\changes\phase-c-infra-hardening\work`。

## Durable findings (propose stage, 2026-07-10 — verified against tree)

- **CI OS 矩阵已完整，非缺口**：`ci.yml` `test_matrix` 已跑 ubuntu/macos/windows 三 OS，每 OS 独立 `VITEST_MAX_WORKERS`（windows=2，即 EBUSY flake 的既定缓解）。planning-context 里 #11 "CI 矩阵回填" 的 OS 维度**已经做完**；本 change 仅补 node 版本维度（floor 20.19.0 + 一条 linux 新 major 腿，bracket 支持区间，不做 3×N 全网格=避免镀金）。
- **Nix pnpm hash 已由 CI 强制，非缺口**：`ci-nix-validation` 的 `nix-flake-validate` job 先跑 `nix build`，`fetchPnpmDeps` 按 `pnpm-lock.yaml` 重取 → hash 陈旧则 `nix build` 失败 → job 失败。后续 `update-flake.sh`+diff 步骤仅信息性（"Check flake.nix modifications" 从不非零退出，`Restore flake.nix` 走 `git checkout --`）。#8 **无需新代码**：只补一条 spec scenario 钉住这个保证防回归；本机 Windows 无 Nix，不伪造本地复核（update-flake.sh 需 nix build）。
- **唯一真正代码缺口 = release.yml 无 npm publish job**（#7）。裁决：独立 `publish-npm` job（`needs: release`）；版本无关（读 package.json）；NPM_TOKEN 缺失=优雅跳过+`::notice::`（tarball 是主产物不该被 npm 凭证挡红）；`npm publish --provenance --access public` + job 级 `id-token: write`；setup-node registry-url + NODE_AUTH_TOKEN 标准范式，不提交 .npmrc。release.yml 只能**静态验证**（26+ 未推提交，无法 live 打 tag）。
- **遥测 #10 = 纯验证任务，不改码**：`src/telemetry/index.ts:30` endpoint 已正确、fire-and-forget 设计健全。apply 阶段做 curl TLS 探测 + 合法 event 202 探测 + 一条真实 CLI 打点，证据写 workDir/research/；TLS 若仍 provisioning 则记录为已知外部依赖挂起、**不阻塞 archive**（spec 把"验证义务"而非 Cloudflare 时间线设为可满足条件）。curl 直连 rasen.io 注意代理（`--noproxy '*'` 或走代理，同 workers.dev 历史经验）。
- **能力映射**：4 个 delta spec 全部挂到既有 capability（无新建）——`fork-release-preparation`（+npm publish，改 Tag-Triggered/Escalated 两 requirement）、`ci-test-harness`（+node 版本覆盖）、`ci-nix-validation`（改 flake-build 加 stale-hash scenario）、`telemetry-backend`（+production TLS/e2e）。propose 时 `ci.yml`/`release.yml`/`flake.nix`/`src/telemetry/` 均无并发 session 在途改动（已 `git status --porcelain` 确认）。
