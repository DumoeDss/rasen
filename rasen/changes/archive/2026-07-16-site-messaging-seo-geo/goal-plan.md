# Goal Plan — site-messaging-seo-geo

## Goal

rasen.io presents rasen as an **intent-driven autonomous harness** ("Control the ideas, not the code.") instead of a "you write a spec" spec-driven workflow — consistently across all four locales (en/zh/ja/ko) on the landing page and every docs page that repeats the old positioning — AND the site meets a concrete SEO/GEO checklist (canonical, hreflang, sitemap, AI-crawler-friendly robots, OG/Twitter cards, JSON-LD, llms.txt), verified against the **live** deployed site.

## Gate

### evaluate

- goal: The live rasen.io site (verified via `curl --resolve rasen.io:443:104.21.70.218` / `dig @1.1.1.1`) carries the intent-driven positioning in all four locales with zero remaining old-positioning copy, and every item of the SEO/GEO rubric below checks out on the deployed pages, not just in the repo.
- rubric:

  **A. Messaging recalibration (all four locales: / /zh/ /ja/ /ko/)**
  - [ ] A1. Old spec-driven headline positioning is absent: the sentence "Rasen is a spec-driven development workflow … you write a spec …" (and its zh/ja/ko renderings "你写下规格…"/"仕様を書けば…"/"스펙을 작성하면…") appears nowhere on the live site. Known current surfaces in `/Users/sayo/repos/rasen-site/src/i18n/{en,zh,ja,ko}.mjs`: `meta.description`, `chrome.specBadge` ("SPEC-DRIVEN" badge), `hero.eyebrow`, `hero.lede`, `briefing.h2` ("Spec is where you start…"), `thesis.items[0]` ("The spec is the origin."), `telemetry.cells[0]` ("Spec-driven workflow"). All recalibrated, not merely deleted — replaced with intent-driven copy.
  - [ ] A2. The new headline positioning centers: **"Control the ideas, not the code."**; automation framing (自动挡 vs 手动挡 / automatic vs manual transmission); harness = engineered **outer loop** around the agent's inner loops; standard pipeline planner(propose) → implementer(apply) → reviewer → fix-cycle → ship → archive; user supplies intent/requirements, rasen implements. Spec appears only as heritage/internal mechanism (pipeline artifact & knowledge accretion), never as the user's input burden.
  - [ ] A3. Product facts stay accurate: GitHub https://github.com/DumoeDss/rasen, docs https://rasen.io, install `npm i -g @atelierai/rasen`, OpenSpec (MIT, Fission-AI) fork lineage + not-affiliated notice, `/rasen:*` command namespace (never `/opsx:*` in site copy).
  - [ ] A4. Four-locale consistency: zh/ja/ko say the same thing as en (no locale left on old positioning); zh copy obeys `content/docs/GLOSSARY.md` (65-term table + do-not-translate list); `node build.mjs` completeness check (en as schema) passes; header grid rule respected (new cells append `auto` columns only; watch the mobile `nth-child(n+3)` hiding rule).
  - [ ] A5. Docs pages repeating old positioning are recalibrated: grep-verified zero remaining "you write a spec"-style positioning in `content/docs/**` (known hits: zh/README.md, zh/writing-specs.md, zh/reviewing-changes.md, zh/team-workflow.md, ja/faq.md, ko/faq.md, ko/writing-specs.md, ko/existing-projects.md — plus their en counterparts must be re-checked). Mechanical literals stay untouched: `spec-driven` as schema name, CLI output blocks, file paths (per GLOSSARY literal-path rule).

  **B. SEO (verified on live pages after `wrangler deploy`)**
  - [ ] B1. Self-referencing `<link rel="canonical">` on every one of the ~112 pages (currently missing everywhere).
  - [ ] B2. hreflang cluster (en/zh/ja/ko + x-default) still valid and mutually consistent on every page (already present — must not regress; x-default → en).
  - [ ] B3. `/sitemap.xml` serves 200 with all ~112 URLs (4 landing + 4 docs indexes + 26 docs × 4 locales), lastmod optional; referenced from robots.txt. (Currently 404.)
  - [ ] B4. robots.txt no longer blocks AI crawlers: the Cloudflare **managed robots.txt / AI-bot blocking** currently serves `Disallow: /` for GPTBot, ClaudeBot, CCBot, Google-Extended, Bytespider, meta-externalagent, CloudflareBrowserRenderingCrawler — this zone setting must be disabled (Cloudflare dashboard or API) and a first-party robots.txt served that allows crawling and points at the sitemap. If the zone setting cannot be changed with available credentials, escalate to the user — do not silently pass this item.
  - [ ] B5. Open Graph completed: existing og:title/description/type kept in sync with new copy; add `og:url`, `og:locale` (+ `og:locale:alternate`), `og:site_name`, and an `og:image` (1200×630 brand card, self-hosted); add Twitter card meta (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`).
  - [ ] B6. Unique `<title>` + locale-correct meta description per page per locale (docs titles already unique; descriptions currently templated — acceptable if locale-correct, but any description carrying old positioning must be rewritten).
  - [ ] B7. `<html lang>` correct per locale on every page; heading hierarchy sane (one h1 per page).

  **C. GEO (generative engine optimization)**
  - [ ] C1. `/llms.txt` serves 200 and follows the convention: H1 site name first, blockquote of 1–3 sentences (new intent-driven positioning), sections grouping docs links by purpose; content factually matches the positioning facts. Optionally `/llms-full.txt` with fuller doc content.
  - [ ] C2. JSON-LD on the four landing pages: `SoftwareApplication` (or `SoftwareSourceCode`) with name, description (new positioning), url, license MIT, codeRepository/downloadUrl (GitHub + npm), operatingSystem/applicationCategory — parses as valid JSON and passes a structural check against schema.org expectations (no required-field errors).
  - [ ] C3. Content reachable without JS (static HTML — already true; must not regress) and AI crawlers permitted per B4.

  **D. Process**
  - [ ] D1. Every rubric claim about the live site is backed by an actual probe (`curl --resolve rasen.io:443:104.21.70.218 …` — local DNS is fake-IP-polluted, never trust it) run after the latest deploy.
  - [ ] D2. If the audit trips over the known product-side 13+4 entity-class anchor bug (escape-then-slug), record it in notes.md; do NOT fix it here (product repo, out of scope).
  - [ ] D3. No version bumps anywhere (user owns versioning).

## Work Product

code — edits in the site repo `/Users/sayo/repos/rasen-site` (i18n modules, `src/shell.mjs`/`src/docs.mjs` head templates, `build.mjs` for sitemap/llms.txt/robots emission, `content/docs/**` positioning passes), built with `node build.mjs` and deployed inside iterate rounds via `CLOUDFLARE_ACCOUNT_ID=5cc51d8388c780c03fb4c6161bd403c4 npx wrangler deploy` (first attempt may flake "fetch failed" — retry once) so the evaluate gate judges the live site. **Ship = local commit only** — the repo has no remote; deploy is an iterate-round action, not a ship action.

## maxRounds

4

## loopStallLimit

2
