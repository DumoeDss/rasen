## Why

The rasen.io landing page speaks four languages, but the 26 documentation pages behind it are English-only — a zh/ja/ko visitor who follows the DOCS link falls off the localized experience entirely, with no language switcher on any docs page (user request, 2026-07-14). Human-curated Chinese translations already exist for all 26 manifest sources in the rasen repo's `docs/zh/` (9 of them stale, predating the docs accuracy pass), while ja/ko have nothing — so this change needs both a locale-aware docs renderer and a translation production workflow.

## What Changes

- **Docs renderer locale support** in `/Users/sayo/repos/rasen-site`: emit four docs trees — `/docs/<slug>/` (en, unchanged) plus `/{zh,ja,ko}/docs/<slug>/` — with a per-locale docs index, `<html lang>` per page, hreflang alternates across the four variants of each page, and a language switcher on every docs page linking to the SAME page in the other locales (reusing the landing's switcher idiom and the existing locale registry / `:lang()` CJK typography).
- **English fallback with a visible marker:** a locale page whose translated source is missing renders the English content with a clearly visible localized "not yet translated" marker, plus a build warning naming locale+slug — build exits 0. The infrastructure ships and works with PARTIAL translation coverage; translation production can lag deployment.
- **Translation storage in the rasen-site repo:** translated markdown lives at `content/docs/{zh,ja,ko}/<same relative path as the manifest source>` — machine/website translations do NOT enter the rasen product repo. The build reads en from the rasen repo's `docs/` (via `RASEN_DOCS_DIR`, as today) and the locale trees from rasen-site's own `content/`.
- **Translation production workflow (actors are binding — the implementer does NOT translate):**
  - a **sonnet** worker builds a terminology glossary (en→zh/ja/ko product terms seeded from the existing `docs/zh/` term choices and the landing i18n files, plus a DO-NOT-TRANSLATE list: code, CLI commands, file paths, flags, brand tokens);
  - the LEAD dispatches a fleet of **haiku** workers in parallel batches — one file per worker — each bound to a per-file translation contract (glossary adherence; preserve markdown structure, code blocks, and link targets verbatim; no invented or dropped content);
  - **zh is aligned, not re-translated:** import the 26 existing `docs/zh/` files and fix the 9 stale files' claims against the current English docs (en is canonical for CLAIMS, the zh files are canonical for TERMINOLOGY/style);
  - a sample-based spot-check review closes the loop (not all 78 files).
- Note: the reported "Korean page shows Chinese" issue is a verified stale-cache artifact with no defect on disk or in the live build — no work is planned for it.

## Capabilities

### New Capabilities
- `website-docs-l10n`: the multilingual docs experience and its production pipeline — locale docs trees at stable URLs, per-page cross-locale switching, language metadata, English-fallback-with-marker fault tolerance under partial coverage, translation storage layout, and the glossary-driven translation fidelity contract.

### Modified Capabilities

None — the English docs pipeline's existing requirements (`website-docs-rendering`, `website-docs-navigation`) are untouched: en output stays as-is and the locale trees are additive. The landing-header switcher requirement in `website-l10n` already tolerates docs pages with or without a switcher.

## Impact

- **rasen-site (all writes):** `build.mjs` / `src/docs.mjs` (locale loop, fallback resolution), `src/pages/doc.mjs` (switcher, marker, lang plumbing), `src/i18n/*.mjs` (docs chrome keys: switcher labels exist; add untranslated-marker text etc.), `src/styles/site.css` (marker styling only — reuse everything else), new `content/docs/{zh,ja,ko}/**` translated markdown (up to 78 files), README (content layout + workflow).
- **rasen repo:** read-only (en docs + manifest; `docs/zh/` is read as import source, never modified).
- **Dependencies:** none new. **Ordering:** strictly after `site-gh-links` (shared shell/i18n files).
- **Scale/delivery:** 26 pages × 3 locales target; partial coverage ships thanks to the fallback. Ships LOCAL; portfolio delivery deploys to rasen.io.
