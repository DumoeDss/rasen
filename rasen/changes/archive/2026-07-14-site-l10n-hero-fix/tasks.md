# Tasks

## 1. Fix

- [x] 1.1 In `rasen-site/src/styles/site.css` `.hero .specimen`: remove `word-break: break-word`, add `white-space: nowrap`
- [x] 1.2 Make the specimen's container a size container and retune the font-size cascade per design D2: `vw`-based clamp fallback declaration first, `cqw`-based clamp second, floor lowered so the wordmark fits at 360px; tune coefficients against the real rendered width (5 glyphs + caret + -0.05em tracking, widest fallback font) with ~4% slack
- [x] 1.3 Confirm no markup change is needed in `src/pages/landing.mjs` (add a minimal inline-block guard inside the existing specimen element only if rendering proves it necessary)

## 2. Verify

- [x] 2.1 Rebuild (`node build.mjs`) and verify in a real browser at 360, 420, 768, 879/881 (grid-collapse edges), 1024, 1200, 1440, and ~1920px: RASEN + caret on one line, no clipping, no page horizontal scroll, at every width (per design D4: assert scrollWidth ≤ clientWidth / single line box)
- [x] 2.2 Confirm the wordmark still reads specimen-scale at each checked width (near container width, dominant element) and the caret blink + hazard-red color are untouched
- [x] 2.3 Spot-check a docs page and the rest of the landing page for regressions (specimen rules are landing-scoped; verify nothing else picked up nowrap/container changes), then commit in the rasen-site repo
