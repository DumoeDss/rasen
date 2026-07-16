# Tasks

## 1. Externalize strings (pure refactor first)

- [x] 1.1 Capture a baseline: build and save the current `dist/index.html` and a `dist/docs` listing/hash for later diffs (design D7)
- [x] 1.2 Create `src/i18n/en.mjs` with ALL user-visible landing strings verbatim from `src/pages/landing.mjs` (grouped hero/briefing/thesis/telemetry/transcript/install/coexist/chrome per design D1), plus the shell chrome labels the landing uses
- [x] 1.3 Refactor `landingPage({version, t, locale})` to consume the strings object with zero copy inline; keep the transcript block as an English verbatim specimen in all locales (design D2)
- [x] 1.4 Rebuild and diff the rendered English page against the 1.1 baseline — identical except deliberate deltas (none yet at this step)

## 2. Locale content

- [x] 2.1 Write `src/i18n/zh.mjs` — faithful zh translation of every key; hero tagline 「不是循环，是螺旋」; brand/technical tokens untranslated
- [x] 2.2 Write `src/i18n/ja.mjs` and `src/i18n/ko.mjs` — faithful translations, native taglines, tokens untranslated
- [x] 2.3 Set the en hero tagline to the README's own English phrasing of the spiral line (replacing the Chinese tagline on the en page) and add the build-time key-completeness check that fails naming locale+key on any gap (design D1)

## 3. Multi-locale build and shell

- [x] 3.1 Extend `renderPage` additively per design D4: optional lang / head-extras / chrome / switcher parameters whose defaults reproduce today's output exactly for existing callers (docs untouched)
- [x] 3.2 Loop locales in `build.mjs` per design D3: emit `dist/index.html` (en, `assetBase: '.'`) and `dist/{zh,ja,ko}/index.html` (`assetBase: '..'`), passing per-locale strings, `lang`, hreflang alternates (all four + x-default, one consistent URL form), and localized title/description meta
- [x] 3.3 Add the header language switcher cell (EN / 中文 / 日本語 / 한국어 links, current locale marked in the existing CRT marker idiom) rendered on landing variants only (design D5)
- [x] 3.4 Add `:lang()`-scoped CJK font-stack custom-property overrides for zh/ja/ko in `site.css` (design D6) and switcher styles within the CRT contract; prose-scoped letter-spacing adjustments where CJK needs them

## 4. Verify

- [x] 4.1 Build twice: idempotent; all four variants present; key-completeness check passes; `dist/docs` byte-identical to the 1.1 baseline; en page diff vs baseline shows only tagline + head links + switcher
- [x] 4.2 Language scan: en page contains no CJK sentences (螺旋 gloss only, per delta spec scenario); zh/ja/ko pages contain no untranslated English prose paragraphs (technical tokens/transcript exempt); `html lang` and hreflang sets correct and consistent on every variant
- [x] 4.3 Per-locale layout check at 360/768/1024/1440: RASEN hero wordmark one line on ALL four variants (hero-fix invariant), no horizontal scroll, CJK headings/grids intact, switcher marks the current locale and all its links navigate correctly, docs link works from every variant
- [x] 4.4 CJK font sanity on at least one OS: zh/ja/ko text legible in system fonts, no tofu in page copy, no font files in `dist/`; then `wrangler deploy --dry-run` (or `wrangler dev` smoke) and commit in the rasen-site repo (commit deferred to ship stage per LEAD — matches the hero-fix child's convention; not yet committed as of this checkbox)
