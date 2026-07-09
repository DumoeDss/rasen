# Planning Context — chrome-use-parity-followups

## Origin

2026-07-08 LEAD 对 fork vendor 的 chrome-use proxy 做了完整 browse→chrome-use 功能映射 live 验证（15 项全过），过程中发现 3 个需要修复的缺口。本 change 关闭它们。用户意图原话："保证 browse 的所有功能，我们都能够实现"。

## Live parity sweep results (LEAD 实测，2026-07-08，Chrome 149 + proxy ready)

全部通过：/new /navigate /back /info、/click（JS 层）、/clickAt（真实鼠标，含 visible/text 过滤，返回坐标）、fill via /eval + /text value 回读、/text、/attribute、links via /eval、/console（console+exception 两类都抓到，level/contains 过滤正常）、/network（events 含完整 request/response headers+status+mime；wait 无匹配时 408 语义正确）、/screenshot（后台 tab 也能截，且反映 viewport 模拟）、/cookies 写→读回环、/localStorage 写→读回环、/snapshot mode=i/C/D（D 正确检出注入的 button）、/viewport（innerWidth 实测生效）、/responsive（三断点+override 残留行为与文档一致）。

## The 3 gaps to fix

### Gap 1 — 代理环境变量劫持 localhost curl（最高优先）
本机（及任何设了 HTTP(S)_PROXY 的机器）上，`curl http://localhost:3456/...` 被代理劫持返回 502。这正是 fork-phase1 期间"Chrome 对所有 CDP 命令挂起"误判的根因。修复：专家模板里所有 chrome-use curl 示例加 `--noproxy '*'`。
- 落点：`src/core/templates/experts/_shared.ts` 的 CHROME_USE_SETUP / CHROME_USE_SNAPSHOT / CHROME_USE_ENDPOINTS 及 QA_METHODOLOGY / DESIGN_METHODOLOGY / DESIGN_SKETCH 里的每一条 `curl localhost:3456` 示例；`src/core/templates/experts/chrome-use.ts`（自包含模板，含自己的端点参考）；vendored `skills/experts/chrome-use/references/cdp-api.md` 基础信息段加一条说明。
- 注意：改 _shared.ts / 专家模板 ⇒ 必须重新生成受影响 skill 在 test/core/templates/skill-templates-parity.test.ts 两张 golden map（EXPECTED_FUNCTION_HASHES + EXPECTED_GENERATED_SKILL_CONTENT_HASHES）里的 hash（改哪个 skill 换哪个 hash，别动其他）。

### Gap 2 — /perf 在后台 tab 上 fp/fcp/lcp 恒 null
实测根因：chrome-use 开的是后台 tab，后台 tab 不渲染 ⇒ paint entries 物理不存在（visibility:hidden、paintEntries=0）；且 `getEntriesByType('largest-contentful-paint')` 按 Web 规范恒空（LCP 只能 buffered PerformanceObserver 取）。browse 的 headless Chromium 总是"前台"渲染，所以这是真 parity 缺口。修复方向（design 决定）：
- (a) /perf 里用 `new PerformanceObserver(...).observe({type:'largest-contentful-paint', buffered:true})` 取 LCP（前台/曾前台 tab 立即受益）；paint(fp/fcp) 用现有 getEntriesByType 即可（曾渲染过就有）。
- (b) 新增 opt-in 参数 `/perf?target=ID&activate=true`：先 `Target.activateTarget` 把 tab 提前台、短等（~1-1.5s）让 paint 发生、采样后可选切回原 active tab（记录 activate 前的 active target 再 activateTarget 回去，尽量少打扰用户）。默认不激活（保持不抢焦点原则）。
- (c) 响应里加一个说明字段（如 `visibility` 或 `note`），后台 tab 且未 activate 时明示 paint 指标为何缺失。
- 落点：vendored `skills/experts/chrome-use/scripts/cdp-proxy.mjs` `/perf` 块（:1333-1367 附近）+ cdp-api.md /perf 文档 + benchmark/qa 模板文本若有涉及。

### Gap 3 — /eval 文档与实现不符（裸 await 报 Uncaught）
实现（cdp-proxy.mjs :747 Runtime.evaluate，无 replMode）不支持裸 `await`，必须 async IIFE `(async()=>{...})()`；cdp-api.md 却写"支持 await：可以写 async 表达式"。修复二选一（design 决定）：实现加 `replMode: true`（Chrome DevTools console 同款，裸 await 直接可用，改动一行、风险极低），或文档改为明示 async IIFE 写法。倾向前者+文档补充示例。
- 若模板里有 /eval 示例含 await 写法，同步核对。

## Constraints / conventions（沿用 fork-phase1 惯例）

- fork vendor 副本是 canonical，改 vendor 副本；不碰 `C:\Users\Sayo\.claude\skills\chrome-use`。
- 改模板 ⇒ 重新生成对应 parity golden hashes（只换受影响 skill 的）。专家数保持 19，count assertions 不动。
- node --check 校验 .mjs；pnpm build + 相关 vitest（skill-generation / skill-templates-parity / skill-sidecar-install）+ openspec validate。
- ship local 模式（只 commit 不 push），沿用 fork-phase1 的 scope-hygiene（只 stage 本 change 文件）。
- Windows：EBUSY/CLI-spawn 测试偶发 flake，隔离重跑再判定。
- proxy 正在本机 3456 运行，Chrome 已连接——实施者可以直接 live 验证修改后的 /perf（curl 记得 --noproxy '*'）。改完 proxy 代码需重启 proxy 进程才生效（sticky proxy 会重新触发 CDP 授权弹窗——实测本机 Chrome 当前无弹窗直接连上；若挂起需等用户点 Allow）。
