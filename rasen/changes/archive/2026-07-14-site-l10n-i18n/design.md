## Context

Builds strictly on `site-l10n-hero-fix` (same files, serial). Current shape: `landing.mjs` exports `landingPage({version})` with all copy inline (including the hardcoded zh tagline at line 13); `shell.mjs` `renderPage({title, description, content, version, assetBase='.'})` hardcodes `lang="en"` and English header/footer chrome; `build.mjs` renders the landing once at `dist/index.html` (relative asset hrefs, file://-openable) and docs at `dist/docs/<slug>/` (root-relative hrefs via `assetBase: ''`). Site is LIVE at rasen.io; zone routes `rasen.io/*` + `www.rasen.io/*`; deploy happens at portfolio end.

## Goals / Non-Goals

**Goals:**
- 4 static landing variants from one template + per-locale string modules; switcher; correct lang/hreflang; en page fully English.
- Zero behavior change to docs output; build idempotent; no new dependencies; no client i18n JS.

**Non-Goals:**
- Localizing docs content or doc-page chrome; locale auto-detection/redirects (static links only); sitemap (none exists); webfonts; translating brand/technical tokens.

## Decisions

**D1 — String modules: `src/i18n/{en,zh,ja,ko}.mjs`, en is the schema.** Each exports a flat(ish) strings object grouped by section (`hero`, `briefing`, `thesis`, `telemetry`, `transcript`, `install`, `coexist`, `chrome`). `en.mjs` carries today's copy verbatim (the extraction is a pure refactor — the built English page should be near-identical to current output except the tagline swap and new head/switcher markup). A tiny build-time completeness check walks en's keys and fails the build naming locale+key on any gap (spec "No missing strings"). ESM modules over JSON: template literals with embedded `<code>`/`<span class="red">` markup stay readable, and no parser code is needed. Trusted first-party strings; HTML-bearing strings are inserted as-is (same trust model as today's inline literals), while attribute-context values keep going through `escapeHtml`.

**D2 — Template signature: `landingPage({version, t, locale})`** — copy comes only from `t`. The transcript session block stays English in ALL locales (it is a verbatim tool-output specimen — commands and AI output are product surface, like code; translating it would fabricate UI the tool doesn't have). Section prose around it is translated. The en hero tagline: an English rendering of the spiral line (e.g. "Not a circle — a spiral.", already the README's own English phrasing) — implementer takes taglines from README-equivalent real copy, zh keeps 「不是循环，是螺旋」.

**D3 — Locale emission & URL/asset scheme.** `build.mjs` loops `[{code:'en', dir:''}, {code:'zh', dir:'zh'}, {code:'ja', dir:'ja'}, {code:'ko', dir:'ko'}]`, writing `dist/index.html` and `dist/<dir>/index.html`. The en page keeps `assetBase: '.'` (file:// support preserved); locale pages pass `assetBase: '..'` — one level deep, relative like the landing, so file:// keeps working for all four (docs keep `''`). Switcher/hreflang URLs are root-relative (`/`, `/zh/`, `/ja/`, `/ko/`) — correct on the live site and under `wrangler dev`; under file:// the cross-locale links won't resolve, accepted (same trade-off class as docs pages, noted in README).

**D4 — Shell extension is additive with byte-safe defaults.** `renderPage` gains optional `{lang = 'en', headExtra = '', chrome = EN_CHROME, switcher = ''}` (exact names implementer's): docs callers unchanged → docs output byte-identical (verified by diffing `dist/docs` before/after). Landing callers pass locale chrome + hreflang links (built once from the locale table) + switcher markup. `hreflang` links: `<link rel="alternate" hreflang="en|zh|ja|ko" href="...">` + `x-default` → `/`, identical set on all four variants, root-relative consistently (spec allows it; if the reviewer prefers absolute `https://rasen.io/...`, it is a one-constant change — implementer may use the absolute form since the domain is known and stable; pick ONE form and keep it consistent).

**D5 — Switcher placement & form.** A new cell in the existing `.site-header .shell` register strip: four links `EN 中文 日本語 한국어`, current locale wrapped in the existing marker idiom (e.g. `.red` or inverted cell — consistent with the docs-sidebar current-page marker style). Pure links, no JS. Docs pages MAY omit the switcher (LEAD allows English chrome on docs); simplest compliant path: only landing passes `switcher`, docs pass nothing → docs header identical to today, satisfying "must not break docs nav" by not touching it.

**D6 — CJK font fallbacks via `:lang()` in `site.css`.** Base stacks unchanged. Add e.g. `:lang(zh) { --mono: ..., 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; }` (and display stack equivalents) per locale — ja: `'Hiragino Sans', 'Yu Gothic', 'Meiryo'`; ko: `'Apple SD Gothic Neo', 'Malgun Gothic'`; all with `'Noto Sans CJK *'` family names included for Linux. Redefining the custom properties under `:lang()` localizes the change to variables instead of re-declaring every rule. Latin/code spans inside CJK text still hit the leading mono families (correct — tokens stay mono). Letter-spacing tweaks for CJK (tracking designed for Latin caps can look wrong on ideographs) are allowed on prose classes only.

**D7 — Verification: per-locale invariants.** For each of the 4 variants: hero wordmark one line at 360/768/1024/1440 (inherits hero-fix's D4 method); no horizontal scroll; switcher marks current locale; `lang`/hreflang correct; en page passes a CJK-sentence scan (regex for CJK-range chars outside the 螺旋 gloss); zh/ja/ko pages contain no untranslated English prose paragraphs (technical tokens exempt). Plus: `dist/docs` byte-diff clean vs pre-change build; build-twice idempotence; `wrangler deploy --dry-run` (or `wrangler dev` smoke) passes. Translation fidelity: implementer translates faithfully; the pipeline's reviewer (fable) audits section-by-section against en as the bilingual check.

## Risks / Trade-offs

- [Translation quality/nuance in ja/ko] → source is short marketing copy of concrete technical claims; keep sentences close to literal, keep all technical tokens verbatim; reviewer audits fidelity per spec scenario. If a phrase is untranslatable without inventing meaning, prefer plainer literal phrasing.
- [String extraction regresses the English page] → en.mjs carries current copy verbatim and verification diffs the rendered en page against the pre-change page allowing only the intended deltas (tagline, head links, switcher).
- [Shell changes accidentally alter docs output] → additive defaults + byte-diff of `dist/docs` in verification (D4/D7).
- [CJK metrics break headings/grids (glyphs ~2× Latin width)] → `:lang()` stacks + explicit 360px/1440px CJK layout scenario; headings already have viewport-scaled clamps and the h2 mobile step-down; fix per-locale with prose-class-scoped tweaks, never by changing the shared Latin rules.
- [hreflang URL form (root-relative vs absolute) debated late] → D4 pre-authorizes either, one consistent form; absolute `https://rasen.io` preferred if touched during review.
- [file:// cross-locale links dead] → accepted; each variant still renders standalone via file://, and the live site + wrangler dev resolve everything.

## Open Questions

- ja/ko tagline final wording — implementer proposes, reviewer (fable) confirms fidelity; zh and en taglines are already fixed by user intent and README copy respectively.
