# Planning Context — fork-phase1 portfolio

## User intent (verbatim)

「首先阅读交接文档：openspec/handoff/fork-release-design.md，然后开始完成整个phase1的开发，不用停下，直到全部完成。」

Phase 1 = `openspec/office-hours/fork-publish-strategy.md` 的阶段 1（身份切换批次 + tgz 发布准备）：批次 A（browse→chrome-use）、批次 B（遥测迁移自有 CF Worker）、批次 C（发布基础）。用户已明确授权不停顿跑完全程（gates 视为预先 Continue）。

## Canonical design sources (READ THESE FIRST — do not re-research what they settle)

- `openspec/office-hours/browse-to-chrome-use.md` (r3) — 批次 A 的完整设计：6 步实施路径、功能映射表、缺口端点、Chrome 前置引导、成功标准。
- `openspec/office-hours/fork-publish-strategy.md` (r5) — Phase 1 全景：任务 1-21、Premises、成功标准。
- `openspec/handoff/fork-release-design.md` — 决策记录 + dead ends + working set（行号已核查）。

## Locked decisions (不要重新讨论或反转)

1. 分阶段发布 Approach B；阶段 1 不改名、不上 npm、bin/config/品牌沿用 `openspec`。
2. browse 直接移除（不是降级），chrome-use（CDP）替换。
3. chrome-use 自写、vendor 进 fork（`skills/experts/<id>/scripts/`）；fork vendor 副本为 canonical。来源：`C:\Users\Sayo\.claude\skills\chrome-use`（cdp-proxy.mjs / check-deps.mjs / match-site.mjs）。
4. 缺口端点 `/snapshot` `/perf` `/viewport` `/responsive` 必须补齐（首发要求完整就位，不退化为先发后补）。加在 vendor 副本上。
5. 不做浏览器扩展。
6. 遥测迁移自有 CF Worker + Analytics Engine；B-1 后端先行（部署+验证 endpoint）再 B-2 客户端；保留 opt-out（OPENSPEC_TELEMETRY=0 / DO_NOT_TRACK=1 / CI）；只发 command+version+匿名UUID（可选 os+node_version）；不加路径/参数/项目信息。
7. 版本 0.1.0，首个 tag v0.1.0。
8. LICENSE 双版权行：保留 OpenSpec Contributors + 新增 `Copyright (c) 2026 DumoeDss`。
9. 仓库 `DumoeDss/OpenSpec` 已 public。
10. 新建 Release Action（不要复用 release-prepare.yml——它有上游 repo gate 永久 skip）。

## LEAD defaults for the design doc's open questions

- **专家 skill 命名**：新 expert id `chrome-use`（browse 全删，不复用 openspec-browse 名）。planner 可依代码证据微调注册细节，但不得恢复 browse 品牌。
- **/snapshot、/perf API 形态**：优先复刻 browse 输出格式以最小化模板改动；只有零成本时才顺手优化。
- **Chrome 协助下载**：按设计文档——官方下载源锁定，安装本身用户手动。
- **targetId 生命周期**：沿用 chrome-use 既有约定（/new 建 tab、/close 关、按 targetId 隔离；sticky proxy 常驻共享、多专家按 tab 隔离）。

## Gotchas (来自 handoff，实施必读)

- `isSidecarFile`（`src/core/shared/skill-generation.ts:105-109`）只放行 `.md`/`.sh` —— `.mjs` proxy 会被 `copySidecarTree` 静默跳过。**ship-blocker，A1 必须先扩过滤器**。
- `_shared.ts` 的 `$B` 大头在 `QA_METHODOLOGY`(:325-601, ~270行)、`DESIGN_METHODOLOGY`(:603-932, ~330行)、`DESIGN_SKETCH`(:1402-1458) —— 52 个 `$B` 绝大多数在此，是 A2 工作量大头。
- `find-browse` 不是 bin（package.json bin 只有 `browse`:29-32；find-browse 由 build:browse 编译但未注册）。
- 含 emoji 的 old_string Edit 会失败（码点不一致）——避开 emoji 做 Edit。
- browse 导入链：`experts/index.ts:8` export、`skill-templates.ts:38` import、`skill-generation.ts:187` 注册、`:143` copySkillSidecars 跳过。
- 消费模板分两类：重写类 7 个（browse/qa/qa-only/design-review/design-consultation/benchmark/office-hours，真有 $B）；纯文字类 2 个（navigator/verify-enhanced，只改描述）。investigate.ts 不在列。
- 遥测现状：`src/telemetry/index.ts` POSTHOG key/host :17/:19，`isTelemetryEnabled()`:46。
- chrome-use proxy 实际端点（404 帮助）：/new /navigate /click /clickAt /eval /text /screenshot /cookies /network/* /console/* /wait /scroll /info /resources /iframes。绑 3456 端口，日志写 os.tmpdir()，SKILL.md 用 ${CLAUDE_SKILL_DIR}——路径模型须验证在 OpenSpec 安装位置能解析。
- 首次 CDP 连接触发 Chrome"允许"弹窗（check-deps.mjs:131）——SETUP 必须写明预期。

## Environment facts (LEAD verified 2026-07-08)

- wrangler 4.86.0 已登录（ws11579@gmail.com，account 5cc51d8388c780c03fb4c6161bd403c4，workers write scope）→ B-1 可以真部署。
- 分支 dev-harness；children ship 一律 local 模式（只 commit），portfolio 级最后统一交付决策。
- Tier A（agent-teams 可用）。

## Decomposition plan

| Child | 内容 | 依赖 |
|---|---|---|
| fork-phase1-chrome-use-core (A1) | vendor proxy + isSidecarFile 扩展 + /snapshot /perf /viewport /responsive 端点 + chrome-use 专家 skill 注册/SETUP | — |
| fork-phase1-expert-templates (A2) | _shared.ts 六块重写 + 7 重写类 + 2 纯文字类模板 | A1 |
| fork-phase1-browse-removal (A3) | 删 browse/ 目录、skills/experts/browse、package.json bin/build:browse/playwright、模板导入链 | A2 |
| fork-phase1-telemetry-backend (B1) | telemetry-backend/ CF Worker 项目 + AE binding + wrangler 部署 + endpoint 验证 | — |
| fork-phase1-telemetry-client (B2) | 重写 src/telemetry/index.ts（去 posthog-node、原生 fetch、opt-out 保留、notice 文案） | B1 |
| fork-phase1-release-prep (C) | version 0.1.0、LICENSE、README（fork 声明+CI badge+INSTALL）、CHANGELOG、新 Release Action、npm pack 验证 | A3, B2 |

A 链与 B 链并行（无文件交集）；C 最后（package.json 与 A3 交集 + pack 验证需 browse 已删）。

## Durable findings from completed children (planner: consume these when proposing dependents)

**From A1 (fork-phase1-chrome-use-core) implementation — relayed verbatim for A2/A3 planning:**
1. Expert-skill count is now 20 (was 19). Any sibling adding/removing an expert must update the 4 count assertions in test/core/shared/skill-generation.test.ts (all-templates total, +filter variants) — command counts (19) are separate. A3 removing browse will drop it back toward 19; adjust the same 4 assertions.
2. chrome-use.ts is fully self-contained (only PREAMBLE + STORE_SELECTION_GUIDANCE). A2 can rewrite _shared.ts BROWSE_SETUP/SNAPSHOT_FLAGS/COMMAND_REFERENCE with zero chrome-use collision; A3 can delete browse without touching chrome-use.
3. The parity golden-master (skill-templates-parity.test.ts) uses EXPLICIT pinned lists, not registry iteration, for its two hash maps — adding a skill does NOT require a golden entry, but any A2 edit to an EXISTING expert template WILL require regenerating that template's hash in both EXPECTED_FUNCTION_HASHES and EXPECTED_GENERATED_SKILL_CONTENT_HASHES.
4. Install path for the claude tool is .claude/skills/openspec-<name>/ (not .openspec/skills/); ${CLAUDE_SKILL_DIR} resolves to whichever dir holds SKILL.md, so script paths are host-agnostic.
5. Environment caveat: live CDP smoke of the 4 new proxy endpoints is blocked on this machine (Chrome hangs on all CDP commands, baseline included). Structural verification done (node --check, /resources & /screenshot pattern parity). Outstanding manual step: curl smoke once a responsive Chrome is available.

## Planner findings after fork-phase1-chrome-use-core propose

- **Registration seam is 4 files (verified line numbers)**: expert templates wire as `experts/<name>.ts` → export in `experts/index.ts` → re-export block in `skill-templates.ts:36-56` → entry in `getSkillTemplates` `expertSkills` array `skill-generation.ts:185-205`. Top-of-file import in `skill-generation.ts:54-73` also required. A2/A3 touching these must account for all four hops.
- **A1↔A2 seam decision (locked in A1's design D3)**: the new `chrome-use.ts` expert template is SELF-CONTAINED — it does NOT import browse's `_shared.ts` constants (`BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE`). So A1 does not touch `_shared.ts` at all. A2 owns the full `_shared.ts` rewrite (6 blocks) + the 7 rewrite-class + 2 prose-class consumer templates with no A1 collision. A3 can delete browse without breaking chrome-use.
- **cdp-proxy.mjs routing (verified)**: single `if/else if (pathname === '…')` chain inside `http.createServer` at `:658`, ending in `404` help block at `:1244-1291`. New endpoints insert before `:1244`. Helpers: `sendCDP(method, params={}, sessionId=null)` → `{result}`; `ensureSession(targetId)` → sessionId; `waitForLoad(sid)`; `enableNetworkCapture(sid,{captureBody})`. `/resources` (`:1200`, `Runtime.evaluate` over `performance.getEntriesByType`) is the model for `/perf`; `/screenshot` (`:907`, `Page.captureScreenshot`) is the retry model. Real endpoints confirmed: /health /targets /new /close /navigate /back /eval /click /clickAt /setFiles /scroll /screenshot /network/{enable,disable,clear,events,body,wait} /wait /console{/enable,/clear} /cookies /localStorage /text /attribute /resources /iframes /info.
- **check-deps.mjs is path-portable**: resolves `ROOT = path.resolve(dirname, '..')` and `PROXY_SCRIPT`/site-patterns relative to itself, logs to `os.tmpdir()`, port 3456 (env `CDP_PROXY_PORT`). No hardcoded absolute paths → vendoring verbatim is safe. First-CDP-popup message is at `check-deps.mjs:131`.
- **Do NOT vendor `references/site-patterns/`** — personal browsing data (xiaohongshu, stripe, airbnb, etc.). Only `references/cdp-api.md` (211 lines, documents endpoints) is a legitimate sidecar. `check-deps.mjs`/`match-site.mjs` already tolerate an absent site-patterns dir.
- **New capability introduced**: `chrome-use-integration` (specs/chrome-use-integration/spec.md). Existing `browse-integration` spec is UNTOUCHED here — its REMOVED delta belongs to A3 (browse-removal), which should reference it explicitly by requirement name.
- **`isSidecarFile` fix is the ship-blocker and lands first** (task 1.1); it's a general filter widening to `.mjs`/`.js`, independent of chrome-use — verified no non-browse skill ships stray `.js`, browse is skipped wholesale by `copySkillSidecars`.

## Planner findings after fork-phase1-telemetry-backend propose

- **npm pack seam is SAFE (verified)**: CLI `package.json` uses a `files` WHITELIST = `["dist","bin","schemas","pipelines","scripts/postinstall.js","!dist/**/*.test.js","!dist/**/__tests__","!dist/**/*.map"]`. A repo-root `telemetry-backend/` is not whitelisted → auto-excluded from `npm pack`. No `.npmignore` needed. C (release-prep) should still confirm pack contents but no action expected. (Same whitelist means A1's `skills/` tree is NOT packed either — relevant if any child expects skills in the tarball; skills install from source dir, so fine for local/repo installs.)
- **Current telemetry contract (upstream, for B2 rewrite)**: `src/telemetry/index.ts` posts event name `command_executed` with `{ distinctId, command, version, surface:'cli', $ip:null }` to `https://edge.openspec.dev` via `posthog-node` (dep `posthog-node ^5.20.0`). Opt-out logic `isTelemetryEnabled()` :46 (OPENSPEC_TELEMETRY=0 / DO_NOT_TRACK=1 / CI==='true'); anon UUID persisted via `getTelemetryConfig`/`updateTelemetryConfig` (`./config.js`); first-run notice `maybeShowTelemetryNotice()` :142. B2 keeps all this, swaps the transport to native fetch → B1 Worker URL, drops posthog-node.
- **B1→B2 handoff is the deployed Worker URL** — B1 task 4.3 records it in the change notes/ship-log. B2 MUST read that URL; do not hardcode a guess. Worker name `openspec-telemetry`, default URL shape `openspec-telemetry.<subdomain>.workers.dev`.
- **B1 payload/AE mapping (keep consistent in B2)**: POST JSON `{command, version, distinctId, os?, node_version?}`; Worker writes `writeDataPoint({ blobs:[command,version,os,node_version], indexes:[distinctId] })`. DAU = `count(DISTINCT index1)`; breakdown = `GROUP BY blob1, blob2`. B2's client payload must match these field names exactly.
- **B1 is additive/isolated**: does NOT touch `src/telemetry/` or CLI package.json deps — clean seam; independently revertable via `wrangler delete`. Real deploy + write-path smoke test (POST→2xx, optional `wrangler tail`) is the verification gate; SQL-API reads are documented-not-gated (need a separate CF API token, Account Analytics read scope).
- **wrangler env note**: local wrangler run emits a proxy-env warning (proxy vars detected) but still works — cosmetic, not a failure.

## Planner findings after fork-phase1-telemetry-client propose

- **B2 targets an EXISTING spec capability `telemetry`** (openspec/specs/telemetry/spec.md, 9 requirements written in PostHog terms). B2's delta = MODIFIED (6: command-execution-tracking, privacy-preserving-event-design, first-run-notice, immediate-event-sending, graceful-shutdown, silent-failure-handling) + ADDED (1: maintainer-owned telemetry destination / no-PostHog / no posthog-node). Requirements NOT touched (kept as-is): environment-variable opt-out, CI auto-disable, anonymous user identification. Note there's also a separate `eureka-telemetry-removal` spec — unrelated, don't touch.
- **Live endpoint is confirmed**: `https://openspec-telemetry.ws11579.workers.dev` (from B1 notes.md, Worker `openspec-telemetry`, dataset `openspec_telemetry`, account 5cc51d…). B2 pins it as `TELEMETRY_ENDPOINT` constant. Worker returns 202 even on internal error, truncates fields at 256B, never echoes -> client stays fire-and-forget, no retry, no body parse.
- **Telemetry public interface (must stay stable — consumed by src/cli/index.ts:42,130,135,140)**: `maybeShowTelemetryNotice()`, `trackCommand(commandPath, version)`, `shutdown()` + internal `isTelemetryEnabled()`:46 / `getOrCreateAnonymousId()`. B2 preserves all signatures so cli/index.ts needs NO edits. `shutdown()` becomes a fast no-op (no batched client to flush). `safeTelemetryFetch` already exists as a native-fetch silent-failure wrapper — reuse it, don't add a new helper.
- **Config module unchanged**: `src/telemetry/config.ts` `TelemetryConfig { anonymousId, noticeSeen }`, persisted under `getGlobalConfigDir()` (`GLOBAL_CONFIG_DIR_NAME` = 'openspec', stays — phase-2 rename concern). B2 does not touch config.ts.
- **Red-line grep for B2/review**: after rewrite, `grep -rn 'posthog|edge.openspec.dev|POSTHOG_|\$ip' src/` must be empty. `posthog-node ^5.20.0` removed from package.json dependencies (only posthog consumer is src/telemetry/index.ts — no other file imports it).
- **Test discipline (LEAD mandate)**: telemetry unit tests mock `globalThis.fetch`; NO live-Worker call in the automated suite. One separate MANUAL live smoke-test task (real command -> deployed Worker -> CLI no error, optional `wrangler tail`).
- **os/node_version dimensions**: `os = process.platform`, `node_version = process.versions.node`. Payload field names must match B1 exactly: `{command, version, distinctId, os?, node_version?}` — drop PostHog-only `surface`/`$ip`.

## Planner findings after fork-phase1-expert-templates propose

- **New capability `chrome-use-expert-methodology`** (specs/chrome-use-expert-methodology/spec.md, 6 ADDED requirements). Chose NEW (not MODIFY) because A1's `chrome-use-integration` isn't in main specs until A1 archives, and browse-integration removal is A3's. A3 owns the `browse-integration` REMOVED delta.
- **browse.ts FREEZE decision (A2 design D1 — seam for A3)**: A2 moves byte-identical copies of BROWSE_SETUP/SNAPSHOT_FLAGS/COMMAND_REFERENCE INTO browse.ts as file-local consts and drops its `_shared` imports of them. Result: browse's generated output + BOTH parity hashes stay unchanged, and `_shared.ts` has ZERO residual browse content. So A3's `_shared.ts` cleanup = nil; A3 just deletes browse.ts + skills/experts/browse + package.json wiring wholesale. If browse's parity hash changes during A2, the inline copy diverged — fix the copy, don't re-pin.
- **_shared.ts rename map (A2 D2)**: BROWSE_SETUP→CHROME_USE_SETUP, SNAPSHOT_FLAGS→CHROME_USE_SNAPSHOT, COMMAND_REFERENCE→CHROME_USE_ENDPOINTS. Methodology block names unchanged (QA_METHODOLOGY/DESIGN_METHODOLOGY/DESIGN_SKETCH — not browse-branded). 6 rewrite-class consumers update imports; browse.ts no longer imports them.
- **Consumer import map (verified)**: benchmark(BROWSE_SETUP), design-consultation(BROWSE_SETUP), design-review(BROWSE_SETUP+DESIGN_METHODOLOGY), office-hours(DESIGN_SKETCH), qa(BROWSE_SETUP+QA_METHODOLOGY), qa-only(BROWSE_SETUP+QA_METHODOLOGY), browse(all 3, being frozen). Prose-only: navigator (`/browse` bullet at :53), verify-enhanced (generic "browser" — likely no-op).
- **60 `$B` occurrences in _shared.ts** (not 52 — recount), concentrated in QA_METHODOLOGY/DESIGN_METHODOLOGY. Endpoint map pinned in A2 design D3; must match shipped proxy / cdp-api.md exactly (chrome-use has NO /fill → use /eval; clicks via /click|/clickAt with CSS selector, not @e refs).
- **Parity test mechanism (A2 D7)**: test/core/templates/skill-templates-parity.test.ts has TWO manually-pinned maps — EXPECTED_FUNCTION_HASHES (:57, raw payload sha256) + EXPECTED_GENERATED_SKILL_CONTENT_HASHES (:103, generateSkillContent(t,'PARITY-BASELINE') sha256). NO env auto-update; run vitest, it prints actual vs expected, paste new hashes for changed skills only. Expected-changed by A2: qa, qa-only, design-review, design-consultation, benchmark, office-hours, navigator (+verify-enhanced iff edited). browse must NOT change.
- **Count assertions**: 4 expert-count assertions in test/core/shared/skill-generation.test.ts stay at 20 (A2 adds/removes no experts). A3 removing browse drops toward 19 — A3 updates those 4.
- **/perf caveat (A1 accepted Minor, A2 D5)**: /perf returns LCP/FCP/CLS/resource-timing but long-task count is 0 without an active PerformanceObserver. Methodology perf text must not promise long-task numbers or must caveat.

## LEAD-relayed durable findings from A2 (fork-phase1-expert-templates) implementation

1. browse.ts is now FULLY SELF-CONTAINED (imports only PREAMBLE from _shared.js; its 3 browse constants are file-local). A3 deletes browse.ts + skills/experts/browse/ + package.json browse bin/build:browse/playwright + the browse registration hops (experts/index.ts export, skill-templates.ts re-export, skill-generation.ts import + expertSkills entry) with ZERO _shared.ts cleanup needed.
2. A3 removing browse drops expert count 20->19: update the SAME 4 assertions in test/core/shared/skill-generation.test.ts (41->40 total, 24->23, 20->19, 21->20) and REMOVE openspec-browse + getBrowseSkillTemplate from BOTH parity hash maps and GENERATED_SKILL_FACTORIES.
3. _shared.ts has zero browse-branded content left; browser-driving blocks are CHROME_USE_SETUP / CHROME_USE_SNAPSHOT / CHROME_USE_ENDPOINTS, endpoint names/params match the A1 vendored proxy + cdp-api.md exactly.

## Planner findings after fork-phase1-browse-removal propose

- **A3 spec = browse-integration REMOVED delta** (specs/browse-integration/spec.md, all 4 requirements: Browse Directory Inclusion / Browse Binary Availability / Playwright as Optional Dependency / Skill Browser Path Resolution, each with Reason + Migration → chrome-use). Retires the capability.
- **Exact deletion set (verified fresh)**: dirs `browse/` + `skills/experts/browse/`; file `src/core/templates/experts/browse.ts`. src edits: index.ts:8 export, skill-templates.ts:38 re-export, skill-generation.ts:56 import + :195 expertSkills entry + :151 dead `workflowId==='browse'` skip + copySkillSidecars doc comment ~:135-137.
- **package.json touchpoints (GATED on B2 ship)**: :31 bin `browse`, :60 `build:browse` (compiles browse + find-browse; find-browse is NOT a bin), :88 `playwright` optionalDependency + pnpm-lock regen. Task 4.1 is a hard gate: verify B2 shipped + `git status` package.json clean before editing. (Portfolio-run already carries applyGate on this child.)
- **Test edits (3 files, verified line numbers)**: skill-generation.test.ts — decrement toHaveLength 24→23/20→19/21→20 + :15 comment (20→19 expert) + DELETE the :283 `copySkillSidecars('browse')` skip test. skill-templates-parity.test.ts — remove browse from import:31, EXPECTED_FUNCTION_HASHES:83 (key `getBrowseSkillTemplate`), EXPECTED_GENERATED_SKILL_CONTENT_HASHES:117 (`openspec-browse`), GENERATED_SKILL_FACTORIES:152, functionFactories:219. skill-sidecar-install.test.ts — drop browseSrc/openspec-browse assertions (:37,61,67-76); optionally retarget to chrome-use (ships .mjs sidecars) for ongoing .mjs-path coverage.
- **No CI/gitignore browse refs** (verified: .github/ and .gitignore clean). Docs in scope = docs/grill-gstack-absorption.md + docs/zh mirror (browse-as-current-tool lines only, history-aware minimal edit). OUT: README.md:173 / docs/cli.md English-verb "browse", and INSTALL/fork README (C).
- **NOTE for C (release-prep)**: B2 shipped a DESIGN DEVIATION — used `node:https` transport (NOT native fetch) because undici keep-alive kept CLI exit alive ~11s (fix → ~1.8s); reviewer APPROVED. Known-trivial: node:https ignores HTTP(S)_PROXY so telemetry silently drops behind egress proxies. C's README/telemetry docs should describe the actual node:https behavior if it documents transport.
- **After A3 ships, expert count = 19** (was 20 with chrome-use added, browse removed). Command count (22 workflow per skill-generation.test :15 "22 workflow") unaffected.

## Planner findings after fork-phase1-release-prep propose

- **C is the final child** — all 6 portfolio children now proposed. New capability `fork-release-preparation` (7 ADDED requirements: fork-baseline version, dual-copyright LICENSE, README fork-declaration+INSTALL, CHANGELOG baseline, tag-triggered release.yml, verified clean pack inventory, delivery-is-escalated).
- **package.json in C = version 1.5.0→0.1.0 ONLY.** repository/homepage stay pointing to Fission-AI/OpenSpec — fork-publish-strategy line 115 explicitly bundles that change with the PHASE-2 npm publish, so phase 1 leaves them. Flagged as an open question (C design D1) for LEAD/user to escalate if they want it moved earlier. name/bin also unchanged (phase-2). Verified current: name @fission-ai/openspec, engines.node >=20.19.0, files whitelist dist/bin/schemas/pipelines/scripts/postinstall.js.
- **HARD DELIVERY BOUNDARY (C design D7 + spec requirement)**: C does NOT git tag / push tags / gh release create. It prepares + locally pack-verifies only. The v0.1.0 tag + GitHub Release publish are OUTWARD-FACING actions the LEAD must escalate to the USER at run end. This is the portfolio's terminal escalation.
- **Release Action (C task 4)**: NEW .github/workflows/release.yml on v* tag → checkout / pnpm setup / setup-node 20.19.0 / pnpm install --frozen-lockfile (MUST include devDeps for pnpm build; no --prod) / pnpm build / npm pack / gh release upload. Do NOT touch release-prepare.yml (dead: `if: github.repository == 'Fission-AI/OpenSpec'` at :18). No bun/build:browse/playwright.
- **LICENSE**: currently single line `Copyright (c) 2024 OpenSpec Contributors` — ADD `Copyright (c) 2026 DumoeDss`, keep MIT body. CHANGELOG.md is changesets-format, top entry ## 1.5.0 — prepend ## 0.1.0 baseline, retain history.
- **README**: badges currently all point to Fission-AI/OpenSpec. C adds fork-declaration blockquote at top, repoints CI badge to DumoeDss/OpenSpec ci.yml, adds INSTALL (tgz, engines 20.19.0, chrome-use prereqs incl Node 22+, uninstall-upstream-openspec bin-conflict warning, "aligned with upstream v1.5.0"), no browse/playwright.
- **Pack verification is the release gate**: npm pack + tar -tzf → dist/bin/schemas/pipelines/scripts present, zero browse residue, no telemetry-backend/; inventory recorded in change notes.md. files whitelist auto-excludes telemetry-backend/ AND skills/ (verified) — C only confirms, does not edit whitelist.
