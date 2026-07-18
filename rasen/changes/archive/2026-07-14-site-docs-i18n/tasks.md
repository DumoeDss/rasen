# Tasks

Actor notes are binding (design D5): tasks in section 3 are NOT performed by the apply-stage implementer — the LEAD dispatches them to the stated model/worker. The implementer builds infrastructure only.

## 1. Locale docs infrastructure (implementer, sonnet)

- [x] 1.1 Baseline: build and snapshot the current `dist/` (en docs tree hash list) for the D7 diff
- [x] 1.2 Add docs i18n chrome keys to `src/i18n/*.mjs` (`docs.untranslated` marker text, index heading/description, `docs.sections` label map with English pass-through per design D4) — completeness check green in all four locales
- [x] 1.3 Parameterize the docs pipeline by locale (design D1): locale loop from `localeTable`, per-locale output roots (`dist/docs` for en, `dist/<dir>/docs` otherwise), link rewriter prefixed to the current locale's tree; en output unchanged
- [x] 1.4 Implement per-entry content resolution with English fallback (design D2): `content/docs/<locale>/<source path>` hit → render translated (title/nav label from its H1); miss → English body + visible localized untranslated marker + `[docs-i18n]` build warning, exit 0; add the per-locale coverage report line to build output
- [x] 1.5 Add the docs language switcher + metadata (design D3): same-page cross-locale `.lang-switch` links on every docs page and index, `<html lang>` per locale, hreflang ×4 + `x-default` (absolute rasen.io form), fallback pages carrying their locale-URL metadata
- [x] 1.6 Style the untranslated marker (hairline notice block, existing palette, radius 0) and create the `content/docs/{zh,ja,ko}/` skeleton + README section documenting the content layout, fallback semantics, and translation workflow

## 2. Infra verification at zero coverage (implementer, sonnet)

- [x] 2.1 Build twice with EMPTY content trees: idempotent; all three locale trees render as marked fallback pages; every switcher/index/prev-next/sidebar path works; en tree diff vs 1.1 baseline shows only intended chrome deltas; coverage report reads 0/26 per locale
- [x] 2.2 Spot-verify under `wrangler dev`: `/zh/docs/<slug>/` internal links stay in the zh tree, lang/hreflang sets correct on a sampled page in each locale, docs header (with the site-gh-links icon cell) doesn't overflow at ≤720px

## 3. Translation production (LEAD-dispatched workers — NOT the implementer)

- [x] 3.1 [sonnet worker] Produce `content/docs/GLOSSARY.md`: en→zh/ja/ko term table (floor list per design D5, extended as discovered), DO-NOT-TRANSLATE list, per-language style notes — seeded from `rasen/docs/zh/` usage and `src/i18n/{zh,ja,ko}.mjs`
  - RESOLVED by LEAD — the glossary WAS produced (sonnet worker, 65 terms + DO-NOT-TRANSLATE + per-locale style rules + adjudicated traps) but staged at the portfolio workDir (glossary.md), not among the translations; LEAD copied it to content/docs/GLOSSARY.md. It was the binding contract handed to all fleet translators.
- [x] 3.2 [sonnet worker] zh align-import: copy all 26 `rasen/docs/zh/` sources to `content/docs/zh/`, fix the 9 stale files' claims against current en (install command, workspace paths, self-references — en canonical for claims, zh canonical for terminology/voice), mechanical touch-ups only elsewhere; rasen repo untouched (produced by LEAD-dispatched fleet, imported)
- [x] 3.3 [haiku fleet, one file per worker, LEAD-batched] Translate the 26 en sources to ja under `content/docs/ja/`, each worker given the en file + glossary + per-file contract (prose only; heading/code/link-target/table structure verbatim; relative .md links unchanged; no additions/omissions) (produced by LEAD-dispatched fleet, imported)
- [x] 3.4 [haiku fleet, one file per worker, LEAD-batched] Same for ko under `content/docs/ko/` (produced by LEAD-dispatched fleet, imported)
- [x] 3.5 Rebuild after each batch lands: coverage report climbs, no build warnings for delivered files, translated pages render with their translated H1 as title/nav label — rebuilt once after importing all 78 files at once (LEAD delivered the full set together, not in incremental batches); coverage report reads `en 26/26, zh 26/26, ja 26/26, ko 26/26` with zero `[docs-i18n]` warnings

## 4. Review and close

- [x] 4.1 [fable reviewer] Spot-check per design D5.4: ≥2 files per locale (incl. one zh-aligned stale file and one code-heavy file) against the per-file contract; fix violations (delete-to-fallback is an acceptable interim remedy for a rejected file); note systematic issues for batch re-dispatch
  - DONE via LEAD-dispatched fable reviewer (rev-site): round-1 spot-check found 3 Major (zh over-replacements, ja word-mapping, anchors) → fixed by sonnet re-translation + renderer root-cause fix → rounds 1-2 re-reviewed CLEAN. Full trail in review-report.md.
  - NOT DONE — this is the fable reviewer's task, not the implementer's; left for the LEAD to dispatch. Implementer spot-checked link-target and code-fence-structure verbatim-ness incidentally during infra verification (see handoff notes) but that is not a substitute for the design D5.4 gate.
- [x] 4.2 Final build + verification sweep (design D7): idempotence, coverage report, per-locale sampled pages (translated + fallback + index) for marker/switcher/metadata correctness, `wrangler dev` smoke; commit in the rasen-site repo (content + infra may be separate commits per batch)
  - Idempotence, coverage, and `wrangler dev` smoke all verified at full coverage. NOT committed — no git commits were made per the apply-stage instruction; commit is left for ship.
