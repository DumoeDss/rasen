# Planning Context — upstream-cherrypick-batch1 portfolio

## User intent (verbatim)

「upstream-cherrypick-batch1直接走auto decompose」+ 此前分诊对话：从上游同步的 13 个提交中拿 5 个 bugfix，跳过 feature/CI/docs 类。用户已预授权连续推进（同 phase2-rasen run 的授权语境：全权推进不用停下）。

## Repo state（2026-07-09，分支改名后）

- 分支：`main` = rasen 产品线（原 dev-harness，default，ci.yml 在此分支生效）；`upstream-main` = 上游纯镜像（Fission-AI/OpenSpec 同步源，本地 65a7233 / 远端 93e27a7）。
- 品牌：rasen 改名已全量落地（bin/rasen.js、RASEN_* env、config 目录 rasen；工作区 `openspec/`、`opsx:` 前缀、skill 命名空间 `openspec-*` 保留）——见 memory/phase2-rasen-shipped + openspec/changes/phase2-rasen/planning-context.md。
- changesets 已移除、release-prepare.yml 已删除、tag 走 `rasen-v*`。
- 本地 main 领先远端 1 个提交（另一 session 的 telemetry 修复 73c3642），工作树可能有另一 session 的 telemetry-backend/** 在途改动——不碰。

## Decomposition & DAG（LEAD 已定，含独立性证明）

按上游时间序 cherry-pick，冲突最小。所有 pick 因全局改名都**不会干净应用**——期望冲突点：品牌字串、bin 路径、测试断言、我们已删除的文件。

- **A `…-archive-fixes`**（cohort1，可并行）：pick `5956a8e`（archive 验证失败退出码）+ `7e21cc5`（archive scenario drift #1246）。touch-set：src/core/archive.ts、src/core/specs-apply.ts、test/core/archive.test.ts。**适配**：丢弃 .changeset/*.md hunk（changesets 已移除）。
- **B `…-lockfile-cleanup`**（cohort1，可并行；与 A 零交集）：pick `8ac624b`（删 vestigial package-lock.json，-4990 行）。touch-set：package-lock.json（删）、package.json、.gitignore、.github/workflows/{ci,deploy-docs}.yml。**适配**：release-prepare.yml hunk 跳过（文件已删）；ci.yml hunk 对着我们已分叉的版本手工套。
- **C `…-win-flake`**（依赖 B——共享 ci.yml）：pick `296ecbc`（Windows CI flake 加固——直击本机 EBUSY 痛点）。touch-set：ci.yml、vitest.setup.ts、test/helpers/{run-cli,temp-cleanup}.ts、~9 个测试文件。**适配**：我们的测试已重品牌（rasen 字串/bin 路径），上下文行冲突要手工解。
- **D `…-store-fix`**（依赖 A——共享 archive.ts/archive.test.ts；依赖 C——共享 store-git/store-root-selection 测试）：pick `93e27a7`（store 空注册 bug #1328）。touch-set：src/core/{archive,list,openspec-root}.ts、src/core/store/operations.ts、test 若干。**适配**：docs/** hunk 全部跳过（docs 渐弃，本 run 不动 docs）。

调度：{A ∥ B} → C → D。childPipeline 一律 **bug-fix**（propose → apply → adaptive verify → ship → archive）。

## Hard constraints（继承 phase2 run 的实战教训，违反=回归）

- **共享工作树 ship/archive 一律 pathspec-scoped commit**（无 pathspec 的 git commit 会卷走 sibling staged 内容，phase2 实测两次）。
- 不碰：telemetry-backend/**（另一 session）、src/telemetry、README.md、docs/**、其他 openspec/changes/* sibling 目录。
- children 一律 local 交付（只 commit，不 push，不 tag，绝不 push --tags）。portfolio 结束统一 push origin main 一次。
- cherry-pick 用 `git cherry-pick -n <sha>`（不自动 commit），解完冲突/适配后留在工作树，ship 阶段才 commit。若 pick 太脏，允许手工移植（读上游 diff 手写），在 tasks 里注明。
- 全局 `openspec` shim 已断，CLI 一律 `node bin/rasen.js <args>`。
- **共享树 dist/ 竞态**：sibling 并发 `node build.js` 会先清 dist/——任何 validate/CLI 步骤前要紧挨着重新 build（implementer-a 实测 ERR_MODULE_NOT_FOUND）。
- **同文件串行 pick 链的第 2+ 个 pick 用 `git show <sha> -- <files> | git apply`**（先 --check）——绕开 dirty-tree 的 cherry-pick 拒绝，且不碰共享 index。
- 本环境 `pnpm build`/`pnpm vitest` 可能报 "packages field missing or empty"（上层 workspace + corepack 问题）——workaround：`node build.js` + `node node_modules/vitest/vitest.mjs run <file>`；或 `--ignore-workspace` **放在 pnpm 子命令之前**（`pnpm --ignore-workspace build`，放后面会被当脚本参数吞掉）；`pnpm install` 的 prepare hook 在嵌套 repo 会挂，frozen 校验加 `--ignore-scripts`。
- **B→C 的 ci.yml 基线交接**：lockfile-cleanup 后 ci.yml 有 3 个无 pin 的 `pnpm/action-setup@v4`（约 56/110/147 行），win-flake 在此之上手工套。B 必须先 ship 再开 C（同文件，未提交的 B 会卷走 C 的在途编辑）。
- repo 嵌上层 pnpm workspace：lockfile 操作必须 `CI=true pnpm install --ignore-workspace`。B child 删 package-lock.json 与 pnpm-lock.yaml 无关，但若动 package.json 需复验 frozen-lockfile。
- vitest ESM 下不能 spy node:fs 具名导出；Windows CLI-spawn EBUSY flake 隔离重跑确认（C child 装的正是上游对此的加固，落地后重评）。
- parity golden-master：本批 pick 不含模板改动，不应触发 hash 重生成——若某 child 意外触发，先停下想想是不是改错了东西。
- flake.nix pnpmDeps.hash 已知过期（无 nix 环境，交付时修）——本批不要试图修它，但 B/C 动 ci.yml 时别把 nix job 改坏。

## Verification conventions

pnpm build；每 child 跑自己 touch-set 对应的 vitest 文件 + 受影响 suite；ship 前按 bug-fix pipeline 的 adaptive verify 定简单/复杂。specs 基线 96/96（`node bin/rasen.js validate --specs`）。C child 落地后：全量 pnpm test 观察 EBUSY flake 是否实际改善（写进 ship-log 作为证据）。

## Upstream commit 台账（pick 源，hash 在本地对象库）

- 5956a8e Fix `archive` exit code on validation failure (#1311)
- 7e21cc5 fix archive scenario drift for #1246 (#1252)
- 8ac624b chore: remove stale npm lockfile (#1319)
- 296ecbc Fix Windows CI flake hardening (#1325)
- 93e27a7 fix empty store registration (#1328)

跳过（记录在案）：8e9e457 beta prerelease workflow（与自建 rasen-v* 管线方向冲突）、871dece/4ef0761 docs 类（渐弃）、9a0dfb5 requirement reader 重构（改名后冲突风险>收益）、8886e3a/3f0ca3f OMP/Trae 适配器 + a70dacc /opsx:update skill（feature，待用户有需求再立项）。

## Planner findings — batch1 proposes

Proposed all four children (propose-stage artifacts written + `node bin/rasen.js validate` green for each; specs baseline still 96/96). Durable discoveries from reading the actual upstream diffs against the current fork state:

### Real conflict points confirmed (apply-stage will hit exactly these)

- **A archive-fixes — cleanest pick.** `5956a8e` `src/core/archive.ts` (3× `process.exitCode = 1;`) and `7e21cc5` `src/core/specs-apply.ts` (scenario-drift guard) pre-images match the fork verbatim; all context brand-neutral. Only adaptation is **dropping `.changeset/fix-archive-exit-code.md`**. Apply `5956a8e` before `7e21cc5` (the `7e21cc5` archive.test.ts hunk is cut against the post-`5956a8e` blob `d0d5868`).
- **B lockfile-cleanup.** `package-lock.json` still present (~179 KB, stale) → `git rm`. Fork ci.yml has **3** `version: 9` blocks (jobs `test_pr`/`test_matrix`/`lint`), not 4 — the upstream 4th (changesets-gated) hunk and the entire `release-prepare.yml` hunk are **dropped** (both absent on fork). `package.json` `author` is `DumoeDss` (diverged) but the `packageManager` hunk anchors on `"type": "module"` and does not touch it. `.gitignore` insert point clean.
- **C win-flake — highest risk, two real conflicts + one key discovery.**
  - **KEY: `vitest.config` already reads `VITEST_MAX_WORKERS`** (`resolveMaxWorkers()` → `maxWorkers`). The upstream CI env is already consumed at runtime; C only wires CI. Locally reproducible: `VITEST_MAX_WORKERS=2 pnpm test`.
  - **run-cli.ts env merge is a manual port:** fork's `runCLI` already injects `XDG_CONFIG_HOME`/`XDG_DATA_HOME` isolation upstream lacks; the upstream `env`-object rewrite must be merged by hand, and upstream **`OPENSPEC_TELEMETRY: '0'` → `RASEN_TELEMETRY: '0'`** (fork opts out on `RASEN_TELEMETRY===0` in `src/telemetry/index.ts`). Exact merged block is in the child's design.md.
  - **ci.yml is a manual port** on the post-B fork workflow (extra Nix job + two `required-checks` jobs); 8 enumerated edits in the child's design/tasks. Leave the Nix job byte-identical.
  - **Two test-file 3-way conflicts on rebranded context:** `workset.test.ts` (`RASEN_ENABLE_CLI_AGENT_OPENERS`, not `OPENSPEC_`) and `store-lifecycle.test.ts` (`Using Rasen root` / `rasen new change`). Changed lines are brand-neutral; only context diverged.
  - `vitest.setup.ts` teardown is upstream's pre-image verbatim → clean.
- **D store-fix.** `openspec-root.ts` and `operations.ts` pre-images + internal codes match verbatim → clean refactor. `project-config.ts` already exports `classifyOpenSpecDir`/`storePointerProblem` with the expected shape (`hasPlanningShape`, `pointer.{filePath,malformed,value}`). **Two source conflicts:** the `fs.access` "No … changes directory found" throw is rasen-worded on the fork (`archive.ts` ~L200-202, `list.ts` ~L88-90) — resolve by deleting the rasen-worded block. **All `docs/**` hunks dropped.** Added tests use **retained** workspace conventions (`openspec/`, `.openspec-store/store.yaml`, `config.yaml`) and brand-neutral assertions (the empty-store message `Change 'x' not found. No active changes exist in this root.` already exists in fork `archive.ts`), so tests need **no brand adaptation** and should pass as-is.

### Capability mapping decisions (for consistency across children)

- A → `cli-archive` (MODIFIED `Archive Validation`, `Spec Update Process`).
- B → `fork-release-preparation` (ADDED `Single Package-Manager Source of Truth`).
- C → new capability `ci-test-harness` (ADDED: matrix-on-PR, hardened CLI-spawn harness, retrying temp cleanup).
- D → new capability `store-registration` (ADDED: optional planning dirs, reject config-only pointer, commands tolerate missing changes dir) + `cli-list` (MODIFIED `Error Handling`). **D deliberately does NOT claim `cli-archive`** (owned by A) even though it edits `archive.ts` — the archive missing-dir behavior is specced under `store-registration` to avoid overlapping capability claims. Serial edge A→D still holds at the file level.

### Self-consistency gotcha baked into the deltas

Because `7e21cc5` (child A) is exactly the fix that aborts archive when a MODIFIED block drops a currently-present scenario, every MODIFIED requirement in these proposals reproduces the **full** current requirement text (all existing scenarios) and only *appends* new scenarios — otherwise the children would fail to archive once the fix is live.
