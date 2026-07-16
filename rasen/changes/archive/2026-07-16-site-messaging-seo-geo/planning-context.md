# Planning context — site-messaging-seo-geo

## User intent (verbatim core)
两个目标，同一个 change：
1. **官网措辞校准**：官网现在写 `Rasen is a spec-driven development workflow with an autonomous orchestration harness on top — you write a spec, and the harness drives the change through propose → apply → archive, iterating on its own until the work is done.` 这是错的定位。实际上**用户不需要写 spec**——用户提的是需求（intent/requirement），rasen 来实现。核心口号：**"Control the ideas, not the code."** 主旨是更高的自动化（自动挡 vs 手动挡）。
2. **SEO/GEO 调研与优化**：调研并优化官网的 SEO（搜索引擎）与 GEO（generative engine optimization，让 LLM/AI 搜索正确引用与推荐 rasen）。需要充分调研 + 实测。

## Product positioning facts (from the user's promo post — authoritative)
- 项目：https://github.com/DumoeDss/rasen；文档站 https://rasen.io；安装 `npm i -g @atelierai/rasen`。
- rasen 是 openspec 的 fork 魔改，从"手动挡"升级为"自动挡"的 **harness/loops 框架**。
- harness 定义（作者版）：在 agent 内循环之外创建流程化的**外循环**。每个任务（propose/apply/archive 各自）是内循环；harness 把任务串起来持续推进是外循环。
- 标准自动化 pipeline：planner(propose) → implementer(apply) → reviewer → fix-cycle → ship → archive。
- 核心机制：主 agent(LEAD)-subagent 架构；SendMessage 热恢复 + transcript 冷恢复；planner/implementer/reviewer session 复用；auto-decompose（复杂任务拆多 change，LEAD 管大循环）；自动 handoff（按角色配 context 上限，如 planner 40%/implementer 50%，达限写 handoff 文档由新 session 续接）。
- 名字寓意：rasen（螺旋）——loops 不是圆，是螺旋上升。
- 实战数据点：C# 大型项目（单文件几百 KB）交给 rasen 全自动处理（glm-5.2），handoff 功能出现前可自主工作 26+ 小时，LEAD 上下文仅 ~40%。
- 用法示例：`/opsx:auto small-feature xxx` 一条命令走完规划到提交/PR；`full-feature` 先跑 grill-me 式 office-hours 细化需求。（注意：现品牌命名空间是 /rasen:*，官网文案应使用 rasen 命名空间。）
- spec 的角色：是 pipeline 的**内部产物/知识积累**（每任务产出 spec 文档指导后续开发），不是用户的输入负担。措辞上 spec-driven 可以作为 heritage/机制描述，但 headline 定位必须是 intent 驱动 / 自动化 harness。

## Site working set (from handoff rasen/handoff/rasen-website-three-portfolios.md)
- 站点仓库：/Users/sayo/repos/rasen-site（独立 git 仓库，main，无 remote）。
- build：`node build.mjs`（构建输出含 coverage 行 26/26×4）；预览 `npx wrangler dev`；部署 `CLOUDFLARE_ACCOUNT_ID=5cc51d8388c780c03fb4c6161bd403c4 npx wrangler deploy`（zone routes rasen.io/* + www.rasen.io/*；wrangler 偶发首刺 fetch failed，重试即过）。
- 四语言：/=en /zh/ /ja/ /ko/；26 篇文档 ×4 语言（/docs/ 及 /{zh,ja,ko}/docs/<slug>/）。
- 措辞改动是四语言联动：en 改定位文案后 zh/ja/ko 首页/文档相应句子须同步；zh 有术语规范（content/docs/GLOSSARY.md，65 条+禁译清单）。
- 头部网格规则：新单元格只追加 auto 列，绝不重调 5 个手调 fr 份额；移动端 nth-child(n+3) 隐藏规则会吞新单元格。
- 本机 DNS 被 fake-IP 代理污染（198.18.x.x）：验证线上用 `dig @1.1.1.1` 或 `curl --resolve rasen.io:443:104.21.70.218`。
- 已知产品侧遗留：13+4 entity-class 锚点 bug（先转义后切 slug）——属产品仓，不在本 change 范围，但 SEO 审计若撞到应记录不修。

## Constraints & decisions already made
- 版本号归用户管，不 bump。
- rasen-site 无 remote——ship 交付模式必然是 local commit（部署 = wrangler deploy，可算交付动作之一，但需在 goal-plan 里明确 ship 是否含 deploy；建议：iterate 轮内即可 build+deploy 验证线上，ship 只做 commit 收口）。
- SEO/GEO 优化范围提示（planner 自行调研细化，不限于）：title/meta description 每页每语言、canonical、hreflang 四语言互指、sitemap.xml、robots.txt、Open Graph/Twitter cards、JSON-LD 结构化数据（SoftwareApplication/FAQ 等）、语义化标题层级、llms.txt / llms-full.txt（GEO 惯例）、内容可被 AI 引擎抓取（无 JS 依赖渲染——本站是静态 HTML，天然有利）、GitHub/npm 链接一致性。
- 测试手段可用：curl --resolve 抓线上、node build.mjs 本地构建产物检查、rasen-chrome-use 浏览器审计、Lighthouse SEO 检查项等。评估门 rubric 应包含"措辞校准四语言一致"与"SEO/GEO 检查清单逐项过"两大块。

## Baseline audit (planner, 2026-07-16 — live probes via curl --resolve rasen.io:443:104.21.70.218)

### Messaging surfaces (repo /Users/sayo/repos/rasen-site)
- All landing copy lives in `src/i18n/{en,zh,ja,ko}.mjs`; en is the completeness schema (build fails on any locale gap). Old-positioning keys: `meta.description`, `chrome.specBadge`, `hero.eyebrow`, `hero.lede` (the exact "you write a spec" sentence, all 4 locales), `briefing.h2`, `thesis.items[0]` ("The spec is the origin."), `telemetry.cells[0]` ("Spec-driven workflow").
- Docs with old-positioning phrasing (grep hits, need per-file judgment + en counterparts): content/docs/{zh/README.md, zh/writing-specs.md, zh/reviewing-changes.md, zh/team-workflow.md, ja/faq.md, ko/faq.md, ko/writing-specs.md, ko/existing-projects.md}. `spec-driven` also appears massively as the **schema name / CLI literal** — GLOSSARY.md marks those as untranslatable literals; they are NOT messaging targets.

### SEO/GEO baseline (live)
- Present: title, meta description, og:title/og:description/og:type, full hreflang cluster (en/zh/ja/ko + x-default) on landing AND docs pages; `<html lang>` per locale; static HTML (no JS needed to read).
- Missing: canonical (0 anywhere), sitemap.xml (404), llms.txt (404), JSON-LD (none), og:url/og:image/og:locale/og:site_name, twitter:* (none).
- **robots.txt is Cloudflare-managed and blocks AI crawlers**: `Disallow: /` for GPTBot, ClaudeBot, CCBot, Google-Extended, Bytespider, meta-externalagent, CloudflareBrowserRenderingCrawler; ends at "# END Cloudflare Managed Content" — no origin robots.txt exists. Fix = disable the zone's managed-robots/AI-bot-blocking setting (dashboard or CF API; wrangler is authed to account 5cc51d8388c780c03fb4c6161bd403c4) + serve first-party robots.txt with Sitemap line. This is the single biggest GEO blocker.
- Page inventory: dist has 112 HTML pages (4 landing + 4 docs indexes + 26 docs × 4 locales) — sitemap target ~112 URLs, not 108.
- Docs meta descriptions are boilerplate templates ("<Title> — rasen documentation, section X") — locale audit needed but not old-positioning; landing meta.description IS old positioning in all 4 locales.

### GEO conventions (web research 2026-07)
- llms.txt format: H1 site name first, 1–3 sentence blockquote, sections of markdown links grouped by purpose; strongest use case is developer tooling; Anthropic recommends it, OpenAI publishes them; it is an AI-agent signal, not a Google ranking lever. Sources: getmint.ai/resources/llms-txt, llmrefs.com/generative-engine-optimization, derivatex.agency/blog/llms-txt-guide.

### Decisions
- Gate = evaluate (quality judgment vs rubric; live-probe-backed). maxRounds 4, loopStallLimit 2. Deploy happens inside iterate rounds; ship = local commit only (no remote).
- og:image required (1200×630 self-hosted brand card); if CF zone setting can't be changed with available creds, escalate to user rather than passing B4.
