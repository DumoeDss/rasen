## Why

On the live rasen.io landing page, the hero wordmark wraps at common viewport widths — "RASE" on one line and "N" (with the caret) on the next — because `.hero .specimen` sizes with `clamp(72px, 12vw, 200px)` and carries `word-break: break-word`: the 72px floor times five wide uppercase glyphs exceeds the hero's left grid column on narrow and mid-size screens, and break-word lets the wordmark fragment instead of shrinking. A broken brand wordmark on the front door is the most visible defect on the site (user report, 2026-07-14).

## What Changes

- Retune the hero specimen typography in `/Users/sayo/repos/rasen-site` (`src/styles/site.css` hero block; markup at `src/pages/landing.mjs:12` stays semantically the same) so **RASEN plus the blinking caret render on one line at every viewport width from 360px through 1440px and beyond**.
- The wordmark never fragments: word-breaking is removed from the specimen in favor of a size that provably fits its container, keeping fluid clamp-based scaling within the CRT title contract (heavy grotesque, uppercase, tight tracking, giant scale — as large as fits, not a timid fixed size).
- No content, copy, or layout-structure changes beyond what the specimen sizing needs; no new colors, effects, or fonts.
- This is the serial prerequisite for `site-l10n-i18n` (same files); the fix must hold for the hero as-is so the i18n change can preserve the invariant per locale.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `website-landing`: the "Responsive single page" requirement gains the hero wordmark integrity rule — fluid hero scaling now explicitly includes "the wordmark renders as a single unbroken line at all supported viewports" rather than merely "scales fluidly via clamp".

## Impact

- **Files:** `rasen-site/src/styles/site.css` (hero/specimen rules; possibly a narrow-viewport media rule), at most a class/attribute touch in `src/pages/landing.mjs` if a wrapper is needed. Nothing else.
- **Systems:** none — static CSS; build (`node build.mjs`) unchanged; docs pages unaffected (specimen styles are landing-only).
- **Downstream:** `site-l10n-i18n` builds directly on the fixed hero and must keep the one-line invariant on all locale variants (the wordmark stays the Latin "RASEN" in every locale, so the invariant transfers).
- **Delivery:** ships LOCAL (commit in rasen-site); the live rasen.io deploy happens once at portfolio end.
