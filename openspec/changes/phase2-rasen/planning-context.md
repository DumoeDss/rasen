# Planning Context — phase2-rasen portfolio

## User intent (verbatim)

「auto-decompose 读 openspec/handoff/phase2-rasen-kickoff.md，开始 phase 2。全权由你推进，不用停下。」— 用户已预授权连续推进（gates 视为已 Continue）；LEAD 全权决策，run 末尾集中汇报待用户确认的外部动作。

## What Phase 2 is

rasen 品牌化：fork 从 openspec 身份切换到 rasen（螺旋，"loops that ascend"）。域名 rasen.io（已注册挂 Cloudflare），npm `rasen` 可用（占位包 0.0.1 已备好待用户 publish），GitHub repo 将改名 DumoeDss/rasen（用户手动操作）。设计源头：`openspec/office-hours/fork-publish-strategy.md`（阶段 2 节）+ `openspec/handoff/phase2-rasen-kickoff.md`。

## Decomposition & DAG

- **C1 `phase2-rasen-rename-core`** — 全局改名核心：package.json 身份字段（name=rasen、bin openspec→rasen、repository/homepage→DumoeDss/rasen、publishConfig.access=public、version 保持 0.1.0）、src 全局 "openspec" 品牌字样（136/213 文件量级）、GLOBAL_CONFIG_DIR_NAME→rasen + config/anonymousId 一次性迁移、环境变量 OPENSPEC_*→RASEN_*、LICENSE 版权行品牌化、parity golden-master hash 全量重生成。
- **C2 `phase2-rasen-docs`** — **已推迟（docs/** 由用户渐弃并自行重写，本 run 不做；任何 child 不要动 docs/**）**。
- **C2b `phase2-rasen-readme`** — **用户 2026-07-09 重新拍板：README 要写，且是全新项目 README（从零写，不是旧文案改名）**。与 C1 并行（README.md 在 C1 touch-set 之外，命名决策已全部定死）。用户给定的品牌叙事（verbatim，写进 README 的灵魂）：
  - 叙事线：从 openspec 出发到 rasen——「spec 是起点、loops 是形态、每圈上升（harness）、直到突破（goal）。」
  - Tagline（双语，用户定稿）：**Rasen — loops that ascend** ／ **「不是循环，是螺旋」**
  - 其余应含：fork 血缘声明（forked from OpenSpec (MIT) by Fission-AI, independently maintained, not affiliated）、INSTALL（npm i -g rasen）、核心能力介绍（spec-driven workflow / opsx pipeline 家族 / harness 自主迭代 / goal-loop / chrome-use / handoff）、遥测说明与 opt-out（RASEN_TELEMETRY=0 / DO_NOT_TRACK=1）、License MIT 双版权、「当前对齐上游 v1.5.0」。
- **C3 `phase2-rasen-release`** — release.yml tag 触发改 `rasen-v*`、移除 changesets（.changeset/ + 相关 scripts/devDeps）、npm pack 验证、USPTO 商标 5 分钟复核记录。依赖 C1。
- **C4 `phase2-rasen-telemetry-domain`** — **已取消（用户 2026-07-09：客户端 endpoint 切换归另一 session 管，本 portfolio 不做，propose 产物废弃）**。取消时事实：src/telemetry/index.ts:30 仍指向 workers.dev（服务端该路由永久保留作 fallback，功能无碍）。切换配方已留档于下方「Planner findings — telemetry-domain」（2 行源码 + 1 行测试 mirror 常量），归属方随时可执行。本 portfolio 任何 child 不得动 src/telemetry。

调度：C1 串行先行 → C2/C3/C4 并行 cohort（touch-set 两两不相交：C2=README+docs/**，C3=.github/workflows+.changeset+package.json scripts，C4=src/telemetry/index.ts+其测试）。

## LEAD decisions（已定，勿重新讨论）

1. **Tag 方案 = `rasen-v*` 新命名空间**，首发 `rasen-v0.1.0`。原因：fork 的本地+远端都继承了上游 v0.1.0…v1.5.0 全部 tag，v0.1.0 已撞车不可用；独立命名空间同时根治 `git push --tags` 误触发 release.yml 的大脚枪（上游 tag 永远匹配不到 `rasen-v*`）。release.yml 触发条件同步改。
2. **changesets 移除**：单人维护 + phase-1 已建 tag 触发 release 流水线；改简单 semver + GitHub Release notes。（fork-publish-strategy Open Question #3 的裁决）
3. **项目工作区目录名 `openspec/` 保持不变**（用户项目里的 `openspec/` 目录、`opsx:*` 斜杠命令前缀均不动）——改它是生态断裂级变更，与品牌化解耦，留待未来单独决策。改名范围 = 包名/bin/配置目录/文档/用户可见品牌字样。
4. **环境变量干净切换、无兼容 shim**：fork 从未发布过任何 release（phase-1 交付未执行），无外部用户；OPENSPEC_TELEMETRY 等直接改 RASEN_*。但 **DO_NOT_TRACK=1 / CI 自动关保留**（业界通用约定，不是品牌变量）。
5. **config 目录一次性迁移仍要做**（维护者自己机器上有 ~/.config/openspec 的 anonymousId）：启动时若旧目录存在且新目录不存在则迁移，勿静默丢配置。
6. **Phase-1 未执行的交付（push/tag/Release）并入本 portfolio 的一次性交付**：直接以 rasen 名义首发 rasen-v0.1.0，跳过 openspec 名义的 0.1.0 Release。portfolio 交付（push、tag、GitHub repo 改名、npm publish）是外部动作，run 末尾交用户执行/确认。
7. **children 一律 local 交付**（只 commit，不 push、不 tag）。

## Hard constraints & gotchas（来自 phase-1 实战，违反 = 回归）

- 遥测传输必须保持 `node:https` + `agent:false` + guard timer（原生 fetch/undici keep-alive 会挂起 CLI 退出 ~10s，实测定案）。任何动 src/telemetry 的人不得改回 fetch。
- 遥测 privacy 契约：只发 command + version + 匿名 UUID（+os/node_version），不加路径/参数/项目信息。
- LICENSE 必须保留 `Copyright (c) 2024 OpenSpec Contributors` 行（MIT 强制）；已有 `Copyright (c) 2026 DumoeDss` 行。
- skill-templates-parity.test.ts 对每个模板 pin 两张 hash 表——任何模板文案动了都要重生成 hash（全局改名会全量触发，这是预期）。
- 另一 session 正在 `openspec/changes/telemetry-admin-console/` + `telemetry-backend/` 工作——**本 portfolio 不得触碰 telemetry-backend/ 目录**。workers.dev ingest URL 语义他们承诺保持不变。
- localhost curl 一律 `--noproxy '*'`；外网 curl 不要加（本机代理环境如此）。
- run-state 文件是 gitignore 的，不要提交。
- Windows CLI-spawn 测试 EBUSY flake：隔离重跑确认，非逻辑回归。
- 含 emoji 的 old_string 用 Edit 会失败，避开 emoji 选子串。
- **本 repo 嵌在上层 pnpm workspace 内**（`…/VibeCodingProjects/pnpm-workspace.yaml`）——repo 内裸 `pnpm install` 会被父 workspace 捕获、不会更新本 repo 的 lockfile；CI 是 standalone checkout，正确做法是 `CI=true pnpm install --ignore-workspace [--no-frozen-lockfile]` 重生成/校验。此次 regen 顺带修正了 pre-existing 的 `diff@^7.0.0` lockfile 漂移。（implementer-c3 实测，2026-07-09）
- **并发 child 在共享工作树上 ship 时，commit 必须带 pathspec**（`git commit -- <paths>`）——无 pathspec 的 `git commit` 提交整个共享 index，会把 sibling staged 的改动扫进来（readme ship 实测踩过，已恢复）。后续每个 ship/archive dispatch 都要带这条。

## LEAD decisions（追加，2026-07-09 apply 后）

8. **skill 命名空间保留（LEAD 批准 implementer 的 scope call）**：skill 目录名 `openspec-*`、skill `name: openspec:*`、`author: 'openspec'` 本次不改——它们是安装/检测契约（update/迁移/legacy-cleanup 靠 `openspec-*` 前缀匹配），改名=断检测，需带迁移的独立 change（进 backlog，用户后续拍板）。后果：`rasen init` 装的 skill 仍叫 `openspec:*`。
9. **update.test.ts 的 1 个失败是 pre-existing 版本标记问题**（测试硬编码 `generatedBy: "0.1.0"` 当"过期"标记，而 fork 版本恰好就是 0.1.0）——与改名无关。**C3 release child 顺手修**：把测试标记降为 "0.0.1"（不动版本号）。

## Implementer durable findings — rename-core（C3/C4 planner 直接消费）

- 精确大小写 `\bOpenSpec\b` 永远是品牌 → 换 Rasen 全库安全；小写 `openspec` 天然歧义，需动词锚定（`openspec <verb>`→rasen）+ 路径感知拆分（保留 `openspec/`、`'openspec'` 目录常量、`.openspec.yaml`、`openspec.root`/`openspec_*` 诊断键）。
- 全局 config/data/schemas/stores/pipelines/worksets 目录现在解析到 `rasen`；但 skill 命名空间仍是 `openspec` 契约——不要假设磁盘上已完全去品牌。
- vitest 在 ESM 下不能 spy `node:fs` 具名导出（"Module namespace is not configurable"）——fs 错误路径要用真实文件系统状态测，别用 `vi.spyOn(fs,...)`。
- bin 改名在 git status 里呈现为 delete `bin/openspec.js` + untracked `bin/rasen.js`（rename staging 未持久化）——C1 的 ship 必须显式 `git add bin/ -- <其余 touch-set>`。
- shell completions 已全量重品牌到 `rasen`（注册对真实二进制才有效）；bashrc 块标记保留 `# OPENSPEC:START` 全大写标记。

## Verification conventions

`pnpm build`；vitest 三件套（skill-generation / skill-templates-parity / skill-sidecar-install）；`openspec validate --specs`（当前基线 93/93）；全量 `pnpm test` 期望 2172+ 绿（modulo Windows flake）。

## External state (probed 2026-07-09)

- `https://openspec-telemetry.ws11579.workers.dev/` → 405 on GET（正常，ingest 活着）。
- `https://telemetry.rasen.io/` → **405 on GET（2026-07-09 复探：custom domain + TLS 已就绪，与 workers.dev ingest 语义一致）——C4 外部门槛已打开**。另一 session 的 telemetry-admin-console 已 ship（4b37644）。
- 本地 tag v0.1.0 指向上游 02fe5b3；本地有上游全部历史 tag。HEAD=7c8bc37（dev-harness，全部未 push）。

## Planner findings — rename-core (C1，2026-07-09)

「openspec」token 有 **七类角色**，只有部分是品牌，禁止全局 sed（design D1 有分类表）。实测锚点（供 C2/C3/C4 复用，勿重新探测）：

- **真·环境变量只有 4 个**（`grep process.env.OPENSPEC_ src` = 5 处）：`OPENSPEC_TELEMETRY`(telemetry/index.ts:99)、`OPENSPEC_CONCURRENCY`(validate.ts:344 / cli/index.ts:370 / command-registry.ts:96)、`OPENSPEC_ENABLE_CLI_AGENT_OPENERS`(openers.ts:41,44)、`OPENSPEC_NO_AUTO_CONFIG`(bash/zsh-installer.ts)。其余 `OPENSPEC_*` grep 命中全是**工作区目录常量**（openspec-root.ts 的 OPENSPEC_ROOT_DIR/CONFIG_YAML/SPECS_DIR/CHANGES_DIR/ARCHIVE_DIR + config.ts 的 OPENSPEC_DIR_NAME，值都=`'openspec'`，**保留**）或**模板占位 token**（`__OPENSPEC_PROACTIVE__`/`__OPENSPEC_REPO_MODE__`、`OPENSPEC_VERSION` JS const，substitute-away 内部量，保留以省 churn）。
- **保留清单（改了=断已初始化用户项目）**：工作区目录 `openspec/`、`opsx:` 前缀、`OPENSPEC_MARKERS` = `<!-- OPENSPEC:START/END -->`（写进用户文件、update/cleanup 靠它匹配，config.ts:3 + legacy-cleanup.ts）、schema id `spec-driven`(`DEFAULT_OPENSPEC_SCHEMA`)。
- **上游 repo 硬编码 3 处需 repoint 到 DumoeDss/rasen**：feedback.ts:101,133（`Fission-AI/OpenSpec`，feedback 命令默认发到上游 issue tracker — 真 bug）；init.ts:820-821 与 update.ts:313 的 `https://github.com/Fission-AI/OpenSpec` learn-more/feedback 链接。**C2 docs 也应扫这个模式**。
- **bin**：`bin/openspec.js` 内容仅 `runCli()`；bin KEY 决定安装命令名。C1 决定连文件一起改名 `bin/rasen.js`（design D4），live 引用 = package.json bin+dev:cli、scripts/pack-version-check.mjs、test/ 下 ~7 个 CLI-spawn 测试（spec/show/change.interactive-* / validate.enriched-output）。
- **config 迁移**：global-config.ts 的 `GLOBAL_CONFIG_DIR_NAME`/`GLOBAL_DATA_DIR_NAME` 翻 rasen；新增 startup `migrateLegacyBrandConfig()`（copy-not-move、不覆盖、吞错）。注意 telemetry/config.ts 已有的 `migrateLegacyTelemetryConfig`（XDG↔~/.config 同品牌内迁移）改名后仍生效（它 key off GLOBAL_CONFIG_DIR_NAME）。
- **LICENSE 已双版权行齐全**（2024 OpenSpec Contributors + 2026 DumoeDss）→ C1 verify-only 无需改。
- **parity**：skill-templates-parity.test.ts 两张表（EXPECTED_FUNCTION_HASHES + EXPECTED_GENERATED_SKILL_CONTENT_HASHES，test 内 line 234/242 toEqual），无 auto-update flag，手动跑→抄 diff→回填。
- **spec 落点**：新 capability `rasen-cli-identity`；MODIFIED `telemetry`(env var+notice)、`global-config`(dir+新增迁移 req)、`cli-feedback`(repo→fork)。C2/C3 若动这些 capability 注意 delta 叠加。change 已 validate 通过，4/4 artifacts。品牌 casing 决策（design D2）：机器标识符 lowercase `rasen`，prose 专有名词 `Rasen`。

## Planner findings — readme (C2b，2026-07-09)

- **现 README = 上游 OpenSpec landing 轻改**（295 行）：仍带 OpenSpec logo（`assets/openspec_bg.png` + dashboard png）、`@fission-ai/openspec` npm/downloads/stars/contributors badges、上游 Discord + `@0xTab` social block、phase-1 tgz-only「Install (fork release)」段（还叫用户跑 `openspec init`）、~20 条 `docs/` deep-link map、「most loved spec framework」上游营销语。新 README **整体替换**，不是改名。
- **CI badge 可用**：`.github/workflows/ci.yml` 存在（另有 release.yml / release-prepare.yml / deploy-docs.yml / workflows/README.md）。badge 现指向 `DumoeDss/OpenSpec/actions`，repo 改名后 → `DumoeDss/rasen`。**决定省掉 npm-version badge 直到 publish**（否则 day-one 404），只留 CI + License badge。
- **capability 文案已 vetted**：现 README「What this fork adds」段（line 52-63）对 `/opsx:auto`、`/opsx:goal`、pipeline registry、auto-decompose、context/handoff、session-relay、review-loop 的描述准确，C2b 直接复用其 substance 改品牌即可，别新造 claim。in-action 片段（explore→propose→apply→archive，line 105-133）也可搬。chrome-use 前置清单（line 94-101）准确可搬。
- **品牌 vs 工作区的唯一矛盾点（design D4，务必别被 reviewer「修正」成错）**：README 要展示 `rasen init`（CLI 命令）创建 **`openspec/`** 工作区目录、斜杠命令仍 `opsx:` 前缀——这仨是 rename-core 保留清单，不能改成 `rasen/`。
- **install 措辞软化**：rename-core 把 bin 改成 `rasen` 后，与上游 `openspec` bin **不再冲突**，故 uninstall 提示从「first-installer-wins 警告」软化为「若你曾以旧 `openspec` bin 装过本 fork 则卸载」（design D6）。
- **spec 落点**：新 capability `project-readme`（README 内容契约，7 条 requirement 全部 greppable：taglines verbatim / lineage / install / capabilities / telemetry / license+alignment / CI badge）。无 MODIFIED。change validate 通过，4/4。
- **语言决策（design D2）**：English-primary + 双语 tagline 置顶（`Rasen — loops that ascend` / `「不是循环，是螺旋」` 均 verbatim 固定）；zh-primary README 推迟。
- **touch-set 铁律**：C2b 只准动 `README.md`。docs/** 用户渐弃，任何 child 不碰。

## Planner findings — release (C3，2026-07-09)

- **release.yml 只需改 trigger `- 'v*'`→`- 'rasen-v*'`**：内部已品牌中立——`npm pack | tail -n1` 现自动产 `rasen-0.1.0.tgz`（unscoped name=rasen），`softprops/action-gh-release` 从 tag 命名 Release，无 tgz 硬编码 / 无 openspec bin 假设 / 无 bun/browse/playwright 步骤。整文件通读确认。
- **ci.yml 有 rename-core 漏掉的 stale 品牌引用（C1 touch-set 不含 workflows，归 C3）**：nix job line ~209 `result/bin/openspec`（bin 改名后此路径不存在→nix CI job 会挂）→ `result/bin/rasen`；line ~210「openspec binary」+ line ~218「OpenSpec version:」echo 同改。deploy-docs.yml 只有注释掉的 Fission-AI 引用（已禁用）→ 不动。
- **changesets 移除面**：`.changeset/`（config.json pin 到 Fission-AI/OpenSpec + README.md + 4 个 pending `*.md`）整删；`package.json` 删 `release`/`release:ci`/`changeset` 三 script（`release:ci`=`check:pack-version && changeset publish`）+ 删 devDeps `@changesets/cli`、`@changesets/changelog-github`；**保留 `check:pack-version` + scripts/pack-version-check.mjs**（非 changesets 专属，已重品牌 `Packing rasen@`，是 pre-publish guard）。删 devDeps 后必须 `pnpm install` 重同步 lockfile，且 CI 的 `pnpm install --frozen-lockfile` 要仍过。
- **release-prepare.yml**：既 dead（`if: github.repository == 'Fission-AI/OpenSpec'`）又 changesets-coupled（整个 job 就是 changesets version-PR + release:ci publish）→ 直接删（repoint 等于重新拥抱 changesets，违反 #2）。
- **update.test.ts（=`test/core/update.test.ts`，非 test/commands/）sentinel 三处**：line 653（"Old version content"）、782（"Cursor with old version"）、836（`.replace(...,'generatedBy: "0.1.0"')` 让 Claude 变 stale）全是硬编码 stale 标记，需降 `"0.1.0"`→`"0.0.1"`；line ~770 的 `generatedBy: "${version}"`（动态当前版本，代表 up-to-date 工具）**不动**。不改包版本。
- **spec 落点**：MODIFIED `fork-release-preparation`（Tag-Triggered Release Workflow→rasen-v* + 删 release-prepare.yml；Verified Clean Pack Inventory→rasen 残留检查；Release Delivery Is Escalated→加 npm publish）+ ADDED「Changeset-Free Release Process」。无新 capability。USPTO 商标复核 + pack inventory 记录是 task-only（一次性尽调，不进 SHALL）。change validate 通过，4/4。
- **交付**：portfolio-run.json 的 delivery.pending 已列全部外部动作（repo rename / push / tag rasen-v0.1.0 / GitHub Release / npm publish）——C3 本身零 push/tag/publish，local commit only，ship 带 pathspec。

## C4 telemetry-domain — CANCELLED (2026-07-09)

用户决定：遥测 endpoint 切换归另一 session（telemetry-admin-console 线）所有，本 portfolio 不做、不得重复。`src/telemetry/index.ts:30` 保持 workers.dev（server 端永久启用的 ingest route），as-is 出货功能上 OK。propose 产物已删除，无 findings 保留。
