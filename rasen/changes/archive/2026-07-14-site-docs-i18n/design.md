## Context

Serial after `site-gh-links`. Current machinery (rasen-site @ 1884b81+): `src/docs.mjs` resolves the manifest (`RASEN_DOCS_DIR` override, dev fallback), builds `published` entries, renders via `marked` with link rewriting to `/docs/<slug>/`; `src/pages/doc.mjs` composes sidebar/prev-next/index through `renderPage()`; `src/i18n/index.mjs` exports `locales` + `localeTable` (`{code, dir}`) + `assertLocaleComplete`; `:lang()` CJK font stacks and the `.lang-switch` idiom exist. Landing switcher links are landing-URLs only. Translation source situation: `rasen/docs/zh/` has all 26 manifest sources (9 stale, pre-rebrand); ja/ko don't exist. The reported ko-shows-Chinese issue is CLOSED as a cache artifact — explicitly no work here.

## Goals / Non-Goals

**Goals:**
- 4 docs trees, per-page cross-locale switcher, lang/hreflang, en-fallback-with-marker; ships correctly at ANY coverage level (including zero for ja/ko).
- Translation production as a repeatable, actor-separated workflow (glossary → fleet → align → spot-check) whose outputs live in `content/docs/`.

**Non-Goals:**
- Localizing docs CONTENT semantics beyond faithful translation; per-locale manifests or curation differences; localized slugs (slugs identical across locales); translating the site README; any change to the rasen repo (including its `docs/zh/`); machine-translating the 26 docs "in-line" by the implementer (prohibited — actors below).

## Decisions

**D1 — Locale loop reuses `localeTable`; URL scheme `/{dir}/docs/<slug>/`.** `build.mjs` builds docs once per locale: en exactly as today (`dist/docs/...`), others to `dist/<dir>/docs/...`. The published-entry pipeline (manifest→flatten→resolvePublished) runs ONCE; per-locale only the content source and output root differ. Link rewriting maps to the CURRENT locale's tree (`/zh/docs/<slug>/` inside zh pages) so readers stay in their language; the existing rewriter is parameterized by a URL prefix rather than duplicated.

**D2 — Content resolution with fallback per entry.** For locale L ≠ en and entry source `p`: try `content/docs/<L>/<p>`; on hit render it; on miss render the ENGLISH source with `fallback: true`. Marker: a hairline notice block right under the page's H1 slot, text from new i18n keys (`docs.untranslated` — e.g. ja「このページはまだ翻訳されていません。英語版を表示しています。」), plus `console.warn('[docs-i18n] ja missing: getting-started.md')`. Exit 0 always (mirrors the existing missing-source semantics). Titles: a translated page's sidebar/nav label and `<title>` come from its own first H1 when present, else the manifest title; fallback pages use the manifest (English) title — honest labeling of English content.

**D3 — Docs switcher = same-page cross-locale links.** `doc.mjs` renders the `.lang-switch` cell (same markup/CSS as landing) with hrefs computed from the page slug: `/docs/<slug>/`, `/zh/docs/<slug>/`, etc. Since every locale emits every page (fallback guarantees existence), switcher targets NEVER 404 — this is why fallback pages are published rather than skipped. Docs index pages cross-link likewise (`/docs/` ↔ `/{L}/docs/`). hreflang: four alternates + `x-default` → the en URL of the same page, absolute `https://rasen.io` form (consistent with the landing decision).

**D4 — Docs chrome i18n keys** added under a `docs` group in `src/i18n/*.mjs` (index heading/description, untranslated marker, any prev/next or section labels currently hardcoded in `doc.mjs`): completeness check enforces all four locales. Section labels in sidebars stay the manifest's English labels on en, and get locale values via a small `docs.sections` key map keyed by the manifest's section label strings — with a pass-through to the English label when a key is absent (section labels are 5 strings, not content; pass-through keeps the manifest decoupled).

**D5 — Translation workflow, actor-separated (binding; the apply-stage implementer does NOT translate):**
1. **Glossary (sonnet worker):** produce `content/docs/GLOSSARY.md` — per-term table en→zh/ja/ko (change, spec, delta, proposal, apply, ship, archive, store, pipeline, gate, workflow, skill, slash command, change folder, workspace, artifact, handoff, …), seeded from existing `docs/zh/` term usage and `src/i18n/{zh,ja,ko}.mjs`; plus the DO-NOT-TRANSLATE list (code spans/blocks, CLI commands, flags, file paths, `/rasen:*`, `rasen-*`, `@atelierai/rasen`, RASEN/OpenSpec brand tokens, URLs) and style notes (zh: follow existing docs/zh voice; ja: です/ます体; ko: 합니다체).
2. **Fleet (haiku workers, one file per worker, parallel batches dispatched by the LEAD):** ja 26 + ko 26 fresh translations from the CURRENT en sources. Each worker gets: the en file, the glossary, and the per-file contract (translate prose only; keep heading hierarchy, code fences/spans, link TARGETS, image refs, tables' structure verbatim; relative `.md` links unchanged — the renderer handles locale mapping; no summarizing, no additions; output to `content/docs/<L>/<path>`).
3. **zh align (sonnet worker, not haiku):** copy the 26 `rasen/docs/zh/*` into `content/docs/zh/`, then diff-align: fix the 9 stale files' claims against current en (install command `@atelierai/rasen`, `rasen/` workspace, self-references) while preserving curated zh terminology/voice; the other 17 import with at most mechanical touch-ups. Sonnet because alignment is judgment work, not bulk translation.
4. **Spot-check (fable reviewer):** sample ≥2 files per locale including at least one zh-aligned stale file and one code-heavy file; audit against the per-file contract; violations found → fix the offending files (and, if systematic, re-dispatch that batch) before ship.
Rationale: user-directed model assignment; one-file-per-worker keeps each haiku context small and failures independently retryable; batching is LEAD-side orchestration, invisible to this change's artifacts beyond task structure.

**D6 — Infra-first task order.** Renderer + fallback + switcher land and verify BEFORE any translation exists (everything renders as marked fallbacks); zh import lands next (real content proves the happy path); ja/ko fleet last. Every intermediate state is shippable by construction.

**D7 — Verification:** build twice idempotent; en tree diff vs pre-change build shows only intended chrome deltas; per-locale spot URLs (translated page, fallback page, index) checked for lang/hreflang/switcher/marker; link-rewrite check inside a zh page stays in `/zh/docs/`; coverage report (per-locale counts of translated vs fallback) printed by the build as the partial-coverage dashboard; `wrangler dev` smoke.

## Risks / Trade-offs

- [78-file fleet output quality varies] → glossary + rigid per-file contract + spot-check gate; one-file-per-worker isolates failures; fallback means a rejected file can simply be deleted and its page reverts to marked English.
- [zh alignment accidentally erases curated voice] → explicit canon split (en=claims, zh=terminology/style) in spec + sonnet actor + spot-check includes a stale-file sample.
- [Emitting fallback pages triples page count (~104 docs pages) and creates near-duplicate content across locales] → hreflang + `x-default` declare the relationship; page weight is static text; acceptable. Alternative (skip missing pages) breaks the never-404 switcher and was rejected.
- [Locale prefix regressions in link rewriting (zh page linking to en tree)] → dedicated verification check; rewriter parameterization is a single prefix argument, small surface.
- [Manifest section labels as i18n keys couple site strings to manifest label text] → pass-through default degrades to English labels, never breaks; labels change rarely.
- [Build time ×4 docs rendering] → still static `marked` rendering of ≤104 small files; negligible.

## Open Questions

- Whether the docs switcher shows all four labels on ≤720px mobile exactly like the landing (expected yes — same cell/CSS; verify the docs header variant doesn't overflow with the GitHub icon cell from `site-gh-links`).
- Glossary term list completeness — the sonnet glossary worker owns finalizing it; the list in D5 is the floor, not the ceiling.
