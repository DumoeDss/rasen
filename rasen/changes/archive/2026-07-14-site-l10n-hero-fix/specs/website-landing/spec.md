# website-landing Delta Specification

## MODIFIED Requirements

### Requirement: Responsive single page
The landing page SHALL be usable from 360px-wide mobile viewports through wide desktop: no horizontal page scroll, hero typography scaling fluidly via clamp, telemetry grids reflowing to fewer columns, and code/install blocks scrolling within their own container when narrow. The hero wordmark ("RASEN" with its blinking caret) SHALL render as a single unbroken line at every supported viewport width: it never wraps or fragments mid-word, and its size adapts fluidly so it is as large as its container allows while still fitting on one line.

#### Scenario: Mobile viewport
- **WHEN** the page is viewed at 360px width
- **THEN** all content is readable without horizontal page scrolling and interactive targets remain usable

#### Scenario: Desktop viewport
- **WHEN** the page is viewed at ≥1440px width
- **THEN** content is constrained to a designed max-width with the substrate/hairline system extending gracefully

#### Scenario: Hero wordmark stays on one line
- **WHEN** the page is viewed at any width from 360px through 1440px and beyond (including the two-column hero layout between the mobile breakpoint and desktop)
- **THEN** "RASEN" and the caret render together on a single line, fully visible, with no mid-word break, no clipping, and no horizontal page scroll caused by the wordmark

#### Scenario: Wordmark remains specimen-scale
- **WHEN** the one-line fix is applied
- **THEN** the wordmark still reads as the page's dominant specimen element — fluidly scaled to near its container's width at each viewport, not reduced to a small static size — and the caret keeps its blink animation and hazard-red color
