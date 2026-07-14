# Planning Context — site-gh-docs-i18n portfolio

## User intent (verbatim, 2026-07-14)

> 1. 上方导航栏增加github链接（icon） 2. 在首屏的介绍（VERSION LICENSE REQUIRES PACKAGE）上方也加上github的链接 3. 当前韩语切换还是显示中文 4. 文档缺少语言切换（可以先使用sonnet检查准备翻译用词表，然后让haiku的subagent去翻译多语言）

## Item 3 disposition (LEAD-verified, CLOSED — no child needed)

Live /ko/ is byte-identical to the local build and fully Korean (title 상승하는 나선형 루프; only Han chars are the 螺旋 brand gloss + switcher labels). User saw a stale edge/proxy cache from the deploy window. No defect exists. Do NOT plan work for this.

## Grounding (LEAD-verified)

- GitHub repo: https://github.com/DumoeDss/rasen (package.json homepage/repository).
- rasen-site: /Users/sayo/repos/rasen-site, main @ 1884b81 (4-locale landing live at rasen.io). Landing i18n: src/i18n/{en,zh,ja,ko}.mjs + index.mjs registry with build-time completeness check. Header register strip = hard 6-column grid, fractions tuned to the 4 locales' string lengths (adding cells/strings requires re-checking wrap at 900-1200px; the mobile `nth-child(n+3)` hide rule swallows new header cells — exempt explicitly). Docs renderer: src/docs.mjs, manifest-driven (rasen/docs/website-manifest.json, 26 pages, 5 sections), output dist/docs/<slug>/index.html, English only today.
- **docs/zh coverage: ALL 26 manifest sources exist under /Users/sayo/repos/rasen/docs/zh/ (human-curated translations)** — but STALE: 9 files still contain pre-rebrand content (@fission-ai/openspec install lines, "OpenSpec 是" self-references) predating the docs-refresh accuracy pass. zh needs an alignment pass against the refreshed en docs, not fresh translation.
- No ja/ko docs exist anywhere. These are fresh machine translations.

## LEAD decisions & constraints

- **C1 `site-gh-links`** (small): (a) GitHub icon link in the header register strip, all 4 locale landings + docs pages (shell chrome) — inline SVG mark (GitHub Octocat mark is fine as inline SVG path, monochrome phosphor, hover red, radius 0, no external assets), aria-label via i18n keys; (b) a GitHub link above the briefing strip (the VERSION/LICENSE/REQUIRES/PACKAGE grid) on the landing — visible text link (e.g. `>>> github.com/DumoeDss/rasen`) in the CRT idiom, localized label. Mind the 6-column header math + mobile hide rule.
- **C2 `site-docs-i18n`** (feature): docs in 4 languages with a language switcher on docs pages.
  - URL scheme: `/docs/<slug>/` = en (unchanged), `/{zh,ja,ko}/docs/<slug>/` for translations. Docs index per locale too.
  - **Source strategy**: zh = translate-align from rasen repo `docs/zh/` (fix staleness against current en during import; the en docs are canonical for CLAIMS, zh files are canonical for TERMINOLOGY/style); ja/ko = fresh machine translation of the 26 en sources.
  - **Translation storage: in rasen-site repo** (e.g. `content/docs/{zh,ja,ko}/<same relative path as manifest source>`) — machine/website translations do NOT enter the rasen product repo. Build reads en from ../rasen/docs (RASEN_DOCS_DIR) as today, and the three locale trees from rasen-site's own content dir.
  - **Translation workflow (user-directed models, LEAD-orchestrated — the implementer does NOT translate)**: (1) a sonnet worker builds a terminology glossary en→zh/ja/ko (seeded from the existing zh docs' term choices + landing i18n files; covers product terms: change/spec/delta/proposal/apply/ship/archive/store/pipeline/gate/workflow/skill/slash command etc., plus DO-NOT-TRANSLATE list: code, CLI commands, file paths, flag names, brand tokens); (2) LEAD dispatches a fleet of HAIKU workers in parallel batches, one file per worker, each given the glossary + rules (preserve markdown structure/code blocks/links verbatim; rewrite relative .md links unchanged — the renderer handles slug mapping; frontmatter if any stays); (3) spot-check review by a fable reviewer (sample-based, not all 78 files).
  - Fault tolerance: a missing translated file for a locale → that page falls back to English WITH a visible untranslated marker, build warns, exit 0 (never blocks); switcher on docs pages links across locales of the SAME page.
  - hreflang on docs pages across the 4 variants; html lang per page; CJK :lang() typography already exists — reuse.
  - Scale note: 26 pages × 3 locales = 78 translated pages target, but ship is allowed with partial coverage thanks to the fallback (translation fleet may lag the infra).
- DAG: C1 → C2 strictly serial (both touch shell.mjs/i18n; C2 is much bigger).
- Ship local per child; portfolio delivery = deploy to rasen.io at the end (CLOUDFLARE_ACCOUNT_ID=5cc51d8388c780c03fb4c6161bd403c4; wrangler deploy may fetch-fail once, retry).
- Models: planner/reviewer fable; implementer/fixer/shipper sonnet; glossary sonnet; bulk translation haiku (user directive).

## Durable findings log (planner appends)

- **C1 header solution: 7th `auto` column, not fraction re-tuning.** The icon cell appends `auto` to the tuned `1.4fr 0.9fr 0.6fr 0.6fr 0.9fr 1.6fr` grid (icon width is locale-invariant ~18px), placed AFTER `.lang-switch`; mobile exemption uses the same after-the-hide-rule equal-specificity pattern as the M1 lang-switch fix. Icon = inline GitHub mark SVG with `currentColor` + `aria-hidden`, aria-label from new `chrome.githubLabel` key; hero link label from `hero.githubLabel`. The SVG mark's curves are brand imagery, not UI radius — pre-noted for the reviewer so the radius-0 audit doesn't flag it.
- **C2 architecture: fallback pages are PUBLISHED, not skipped** — every locale emits every manifest page (missing translation → English body + localized visible marker + build warning, exit 0). This is what makes the same-page cross-locale switcher never-404 and partial coverage shippable, including zero-coverage ja/ko at infra-land time. Coverage report line in build output is the partial-coverage dashboard.
- **C2 content resolution:** `content/docs/<locale>/<manifest source path>` in rasen-site; manifest pipeline runs once, per-locale only content root + output root + link-rewrite prefix differ; translated page's title/nav label = its own H1 (fallback pages keep the English manifest title — honest labeling). Docs chrome via new `docs.*` i18n keys; manifest section labels localize through a `docs.sections` map with English pass-through.
- **Actor separation is spec-level, not just task annotation:** the translation fidelity contract (glossary adherence, structure/code/link-targets verbatim, no additions/omissions, zh = en-claims + zh-terminology canon split, sample spot-check gate) lives in the `website-docs-l10n` delta spec, so review can enforce it regardless of who executes. Tasks section 3 is LEAD-dispatched (sonnet glossary, sonnet zh-align — judgment work; haiku one-file-per-worker fleets for ja/ko); implementer builds infra only.
- **No existing capability modified by C2:** en docs output unchanged, and `website-l10n`'s switcher scenario already tolerates docs pages with or without a switcher — C2 is one new capability (`website-docs-l10n`); C1 modifies `website-landing` + `website-l10n` (GitHub affordances + localized chrome keys).
- **Delete-to-fallback is the cheap remedy** for a rejected translation file: removing it reverts that page to marked English without touching infra — useful during review rounds.
