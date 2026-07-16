## Context

Live site, 4 commits, rasen.io. The defect: `src/styles/site.css` `.hero .specimen` uses `font-size: clamp(72px, 12vw, 200px)` + `letter-spacing: -0.05em` + `word-break: break-word`. The specimen sits in the left column of `.hero .grid` (`grid-template-columns: 1.15fr 1fr`, collapsing to one column at ≤880px). Five heavy-grotesque uppercase glyphs at the 72px floor are ~300px+ wide — wider than the left column at many real widths (and than a 360px phone's content box), so `break-word` splits RASE/N. Two failure regimes: (a) narrow single-column where 72px floor is too big, (b) two-column 880–1200px where 12vw outruns the ~45%-wide column.

## Goals / Non-Goals

**Goals:**
- One-line RASEN+caret at every width ≥360px, with the wordmark still specimen-scale (fills its column, not a fixed small size).
- Stay inside the CRT contract: same font stack, uppercase, tight tracking, fluid clamp scaling, caret blink untouched.

**Non-Goals:**
- Any copy/markup redesign, tagline changes (that's `site-l10n-i18n`), hero grid restructuring, or touching docs/shell.

## Decisions

**D1 — `white-space: nowrap` replaces `word-break: break-word` on the specimen.** The wordmark must never fragment; break-word was a wrong safety valve for this element (it exists for prose, and the specimen is a fixed 5-glyph brand token whose width we control by sizing). With nowrap, any sizing mistake shows up as visible overflow in verification rather than a silent wrap — fail loud.

**D2 — Size from the container, not the viewport: container query units with a vw fallback.** The root cause is sizing against `vw` while living in a grid column whose fraction of the viewport changes across breakpoints. Preferred implementation: make the specimen's column a size container (`container-type: inline-size`) and set `font-size: clamp(48px, 26cqw, 200px)` (coefficient tuned so 5 glyphs + caret + tracking ≈ 100cqw at the widest fitting size; exact number tuned during implementation against the real Archivo Black/fallback metrics, then verified at 360/768/1024/1440). `cqw` support is universal in current evergreen browsers; as belt-and-braces the rule keeps a plain `clamp(48px, …vw, 200px)` declaration before the `cqw` one so old engines still get a working (viewport-tuned) size. Alternative considered: pure per-breakpoint `vw` retuning with media queries mirroring the grid fractions (works everywhere but duplicates layout knowledge in three magic numbers); kept as the fallback layer, which is why the cascade order matters.
Floor drops from 72px to ~48px: at 360px the old floor could NOT fit on one line — the floor must be below "fits at 360px", and fluid terms carry sizes upward from there.

**D3 — Caret counts toward the measured width.** The caret `▌` is inline within the specimen; all fit-tuning treats the wordmark as six advance widths (5 glyphs + caret), so the caret can never be the character that wraps. No markup change expected; if implementation finds a wrapper helps (e.g. `display: inline-block` guard), it stays inside `landing.mjs:12`'s existing element.

**D4 — Verification is rendered-truth, not arithmetic.** Check the built page in a real engine at 360, 420, 768, 880±1 (breakpoint edges), 1024, 1200, 1440, and one ultra-wide width, asserting single-line rendering (element scrollWidth ≤ clientWidth and one line box) — chrome-use/CDP if available, manual `wrangler dev` + devtools otherwise. CSS-only change, so no build assertions beyond the standard idempotent-build check.

## Risks / Trade-offs

- [`cqw` unsupported in an old engine] → the preceding `vw` clamp declaration still applies (graceful, tuned-per-breakpoint); nowrap guarantees no fragment in either path — worst case is slight overflow on ancient browsers, judged acceptable for a dev-tool landing page.
- [Font-stack metric variance (Archivo Black absent → Arial Black/system 900)] → tune the cqw/vw coefficients against the widest fallback's metrics and leave ~4% slack; verification at real widths catches misses.
- [Smaller floor makes the mobile hero less imposing] → at 360px "imposing but wrapped" is strictly worse; 48px floor × fluid growth keeps specimen dominance (spec scenario "Wordmark remains specimen-scale" guards this).
- [i18n change later restructures the hero markup] → the invariant is spec'd (delta scenario), so the i18n reviewer checks it per locale; wordmark stays Latin "RASEN" in all locales so glyph metrics don't shift.

## Open Questions

None — small, self-contained fix; coefficient values are implementation-tuned within D2's structure.
