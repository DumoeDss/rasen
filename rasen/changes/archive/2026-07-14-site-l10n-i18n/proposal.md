## Why

The live rasen.io landing page is English-only yet carries hardcoded Chinese sentences (`「不是循环，是螺旋」` at `src/pages/landing.mjs:13`), which reads as a defect on an English page while leaving Chinese, Japanese, and Korean visitors with no native page at all (user request, 2026-07-14: fix the mixed-language tagline and add zh/ja/ko localization with a language switcher). All landing copy is currently string-literals inside `landing.mjs`, so localization requires externalizing it first.

## What Changes

- Externalize every user-visible landing-page string (plus the shell chrome labels the landing shares: header links, footer colophon labels) from `src/pages/landing.mjs`/`src/shell.mjs` into per-locale string modules (e.g. `src/i18n/en.mjs`, `zh.mjs`, `ja.mjs`, `ko.mjs`), with English as the reference locale carrying today's exact copy.
- Emit four landing variants at build time: `/` (English, default), `/zh/`, `/ja/`, `/ko/` — static pages from the same landing template, one pass of `node build.mjs`, still idempotent.
- Per-locale taglines resolve the mixed-language defect: the English page gets an English tagline in the hero (no full Chinese sentences on non-zh pages; the `(螺旋)` name gloss in the thesis heading stays, as a gloss of the brand name); the zh page keeps 「不是循环，是螺旋」; ja/ko get faithful native taglines.
- Header language switcher on landing pages: plain links to the four variants, CRT-styled (mono, hairlines, radius 0, no new colors), current locale visibly marked. It must not break docs navigation — docs pages and their content stay English and are otherwise untouched.
- Correct language metadata per variant: `<html lang="en|zh|ja|ko">`, `hreflang` alternate links (four locales + `x-default`) on every landing variant. No sitemap work — the site has none, and none is invented.
- Translations are faithful renderings of the real English copy — no invented features, claims, or metrics; brand tokens (RASEN wordmark, command names, code snippets, npm package name) stay untranslated.
- CJK rendering without webfonts: `:lang()`-scoped font-stack fallbacks appending system CJK fonts so zh/ja/ko text degrades gracefully while the mono/CRT aesthetic holds; the hero wordmark remains the Latin "RASEN" in every locale and must keep the one-line invariant established by `site-l10n-hero-fix` (this change builds on that fix — strictly serial).

## Capabilities

### New Capabilities
- `website-l10n`: the multilingual landing experience — locale variants at stable URLs, externalized locale strings with faithful translations, language switcher, per-locale language metadata (lang/hreflang), per-locale taglines, and CJK typography degradation rules.

### Modified Capabilities
- `website-landing`: the "Landing page content is real and complete" requirement changes — the hero tagline becomes locale-appropriate (English tagline on the English page) instead of the Chinese tagline being part of the canonical English page content; content-fidelity language is generalized so the truthfulness rules bind every locale variant, not just an implicitly-English page.

## Impact

- **Files (all in `/Users/sayo/repos/rasen-site`):** `src/pages/landing.mjs` (template consumes a strings object instead of literals), `src/shell.mjs` (lang attribute, hreflang head links, localized chrome labels, switcher — additive parameters defaulting to current English/docs behavior), `build.mjs` (loop over locales for the landing), new `src/i18n/*.mjs`, `src/styles/site.css` (switcher styles + `:lang()` CJK font fallbacks).
- **Docs pipeline:** unchanged output (English, `dist/docs/**`); shell changes must default such that doc pages render as today (chrome may stay English per LEAD decision).
- **Dependencies:** none added; no client-side i18n JS — switcher is links.
- **Ordering:** strictly after `site-l10n-hero-fix` (same files; must preserve its one-line hero invariant on every locale variant).
- **Delivery:** ships LOCAL; the portfolio-end delivery deploys all of it to rasen.io.
