# Planning Context — site-l10n portfolio

## User intent (verbatim, 2026-07-14)

> 几个问题进行修复：1. 主视觉当前RASE在一行，N在一行，看着很怪，RASEN放到一行，可以调整字体大小 2. 当前是英文版，会存在中文标语，比如"不是循环，是螺旋". 3. 处理本地化！增加语言切换，包含中英日韩四种语言切换。

## Grounding (LEAD-verified on disk)

- Site: /Users/sayo/repos/rasen-site (own git repo, main, 4 commits, LIVE at rasen.io via zone routes `rasen.io/*` + `www.rasen.io/*`; deploy = `CLOUDFLARE_ACCOUNT_ID=5cc51d8388c780c03fb4c6161bd403c4 npx wrangler deploy`).
- Hero: `src/pages/landing.mjs:12` `<div class="specimen">RASEN<span class="caret">▌</span></div>`; specimen CSS at `src/styles/site.css:189` — current size lets RASEN wrap (RASE/N) at common widths. FIX: keep RASEN on ONE line at all viewports (e.g. size via `clamp()` with vw terms tuned so 5 glyphs + caret fit, and/or `white-space: nowrap` + container-relative font size).
- Chinese tagline hardcoded on the English page: `landing.mjs:13` `「不是循环，是螺旋」` (class .thesis-cn) and `landing.mjs:42` "Rasen (螺旋) is the shape…". Issue 2 resolves via i18n: each locale carries its OWN tagline (en gets an English tagline; zh keeps 不是循环，是螺旋; the (螺旋) gloss in the en h2 is acceptable as a name gloss — planner decides, but no full Chinese SENTENCES on non-zh pages).
- Existing architecture: `build.mjs` renders pages via `src/shell.mjs` renderPage({title, description, content, version}); docs pipeline `src/docs.mjs` renders 26 English doc pages to `dist/docs/<slug>/`; root-relative URLs; CRT brutalist contract (see the archived rasen-website planning-context; palette/radius/motion rules still binding).

## LEAD decisions & constraints

- **Scope of localization: the LANDING page + shell chrome (header/footer/nav labels) in en/zh/ja/ko.** Docs pages stay English content (unchanged), but doc-page shell chrome MAY stay English too — keep docs out of scope except that the language switcher on the landing page must not break docs nav. NO machine-translation of the 26 docs.
- **URL scheme: static build-time locales** — `/` = en (default), `/zh/`, `/ja/`, `/ko/` (landing only). Language switcher = simple links (no JS state needed; minimal JS or pure links acceptable), visible in the landing header, styled inside the CRT contract (mono, hairlines, current-locale marker, radius 0, no new colors).
- **Strings externalized** (e.g. `src/i18n/<locale>.mjs|json`): landing copy per locale; translations must be faithful to the REAL English copy (no invented claims); zh/ja/ko renders need `lang` attributes set correctly per page (`<html lang="zh">` etc.) and font stacks that degrade gracefully for CJK (system CJK fonts; keep mono aesthetic where possible — CJK in the mono stack falls back to system sans-CJK, acceptable; do NOT ship webfonts).
- **hreflang/SEO niceties**: alternate links between locale variants; sitemap update if a sitemap exists (check; there may be none — do not invent one).
- **Serial DAG: hero-fix → i18n** (both touch landing.mjs + site.css; i18n restructures landing copy so the hero fix must land first and i18n must preserve it).
- **Build/verify**: `node build.mjs` stays idempotent; all locale pages emitted; wrangler dry-run passes. Deploy at portfolio end (account id above; wrangler deploy may fetch-fail once — retry).
- **Models**: planner/reviewer = fable; implementer/fixer/shipper = sonnet. Children ship LOCAL; ONE portfolio-level delivery decision at the end (deploy to rasen.io is part of the end delivery since the site is live).

## Decomposition & dependency rationale

- **C1 `site-l10n-hero-fix`** (bug-fix pipeline): one-line RASEN at all viewports (360→1440+), font-size retune within the CRT title contract. Tiny, independently reviewable.
- **C2 `site-l10n-i18n`** (small-feature): locale extraction + 4-locale landing builds + header language switcher + per-locale taglines (closes issue 2) + lang/hreflang attributes.
- Same files → dependency edge; strictly serial C1 → C2.

## Durable findings log (planner appends)

- **Hero-wrap root cause (verified in css):** `.hero .specimen` = `clamp(72px, 12vw, 200px)` + `word-break: break-word` inside the `1.15fr` hero grid column (collapses ≤880px). Two failure regimes: 72px floor too wide for narrow single-column; 12vw (viewport-based) outruns the ~45%-wide column at 880–1200px. Fix design: `white-space: nowrap` (fail loud, never fragment) + container-query sizing (`container-type: inline-size`, `cqw` clamp) with a retuned `vw` clamp as the preceding fallback declaration; floor drops ~72→48px. Caret counts as a 6th advance width.
- **Hero invariant transfers to all locales for free:** the wordmark stays Latin "RASEN" in every locale, so i18n cannot change its metrics; the invariant is spec'd in the hero-fix delta and re-verified per locale in i18n task 4.3.
- **i18n architecture pinned:** `src/i18n/{en,zh,ja,ko}.mjs` ESM string modules (en = schema, verbatim current copy; build-time key-completeness check fails naming locale+key); `landingPage({version, t, locale})`; `renderPage` gains additive optional params (lang/headExtra/chrome/switcher) with byte-safe defaults — docs output verified byte-identical via dist/docs diff. Locale pages emit at `dist/{zh,ja,ko}/index.html` with `assetBase: '..'` (file:// still works per-variant); switcher/hreflang URLs root-relative or absolute `https://rasen.io` — one consistent form, absolute preferred.
- **Transcript block stays English in ALL locales** (verbatim tool-output specimen — translating it would fabricate UI the tool doesn't have). The en tagline uses the README's own English spiral phrasing; `(螺旋)` gloss on the brand name is the only CJK allowed on the en page (en-page CJK-scan is a verification task).
- **CJK fonts:** `:lang()`-scoped redefinition of the font custom properties (PingFang/Hiragino/YaHei; Hiragino Sans/Yu Gothic/Meiryo; Apple SD Gothic Neo/Malgun; + Noto Sans CJK for Linux) — variables, not per-rule re-declaration; Latin/code tokens keep hitting the leading mono families. No webfonts (confirmed spec'd).
- **No sitemap exists in rasen-site** (checked dist + grep) — hreflang alternates only, none invented, per LEAD constraint.
- **Capability mapping:** hero-fix = MODIFIED `website-landing`/"Responsive single page" (one-line wordmark scenarios added); i18n = new `website-l10n` capability + MODIFIED `website-landing`/"Landing page content is real and complete" (locale-appropriate tagline, per-locale truthfulness, no-foreign-sentences rule). The five website-* specs from the rasen-website portfolio are now live in rasen/specs/.
