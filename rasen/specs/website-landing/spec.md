# website-landing Specification

## Purpose
Define the rasen marketing landing page: truthful content sourced from the repo's own docs, the brutalist-CRT visual system, offline self-contained rendering, and responsive layout.

## Requirements

### Requirement: Landing page content is real and complete
The landing page SHALL present rasen truthfully using copy sourced from the repo's actual README and docs, in the language of the locale variant being viewed. Every locale variant MUST include: a hero stating what rasen is (spec-driven workflow + autonomous orchestration, "loops that ascend" / 螺旋 identity) with a hero tagline in that variant's own language (the English page carries an English tagline; the Chinese page carries 「不是循环，是螺旋」); the spiral thesis (spec origin → loop form → ascending turns → goal breakthrough); a feature section covering the real capability set (spec-driven change workflow, pipeline family, `/rasen:auto` autopilot, `/rasen:goal` goal loops, auto-decompose, chrome-use, context sensing & handoff); an install block with the real command `npm i -g @atelierai/rasen` plus `rasen init`; the OpenSpec lineage/coexistence statement; and a footer colophon with license, version, and repository link. Apart from the untranslated brand and technical tokens (the RASEN wordmark, command names, code, package names) and the 螺旋 gloss of the brand name, a locale variant does not carry full sentences in another language.

#### Scenario: No fabricated content
- **WHEN** any locale variant of the landing page is reviewed against README.md and docs/
- **THEN** every named feature, command, version number, and claim traces to the real docs — no lorem ipsum, no invented metrics, benchmarks, testimonials, or features

#### Scenario: Version display is accurate
- **WHEN** the page shows a version number
- **THEN** it matches the rasen `package.json` version current at build time (read or pinned at build, never hand-invented)

#### Scenario: Install command is copyable
- **WHEN** a visitor reads the install block on any locale variant
- **THEN** the exact command `npm i -g @atelierai/rasen` is shown as selectable text (not an image), inside the page's single hazard-stripe alert block

#### Scenario: English page has no Chinese sentences
- **WHEN** the default English landing page is reviewed
- **THEN** its hero tagline and all prose are English; no full Chinese (or other non-English) sentences appear anywhere on the page — the only CJK characters permitted are the 螺旋 gloss attached to the brand name

### Requirement: Brutalist-CRT visual system
The landing page SHALL implement the tactical-telemetry / CRT-terminal visual system: charcoal substrate `#0A0A0A`/`#121212` (never pure black); phosphor foreground `#EAEAEA` with secondary `#9A9A98`; hazard red `#E61919` as the only accent; at most one terminal-green `#4AF626` element; monospace body type with a heavy grotesque reserved for titles at `clamp(56px, 7vw, 96px)` uppercase; `border-radius: 0` everywhere; 1px hairlines `#2A2A28`; at least one `display: grid; gap: 1px` telemetry-grid module; a fixed pointer-events-none scanline overlay at opacity ≤ 0.08; ASCII decoration (`[ ... ]`, `>>>`, `///`) in at least four places; exactly one diagonal hazard-stripe block; numeric data in tabular-nums; a blinking caret in the hero. Shadows, gradients (other than scanline/hazard stripes), glassmorphism, glow, emoji, stock imagery, rounded corners, and light-mode sections are excluded.

#### Scenario: Style pre-flight passes
- **WHEN** the rendered page is audited against the visual-system checklist
- **THEN** every rule above is observed: palette limited to charcoal/phosphor/red (+ ≤1 green element), zero border-radius, hairline grids present, scanline overlay present at ≤0.08 opacity, ≥4 ASCII decorations, exactly one hazard-stripe block, no banned effects

#### Scenario: Motion is mechanical
- **WHEN** the page is idle
- **THEN** the only animations are the hero's blinking caret and at most one pulsing status dot — no scroll-triggered fades, parallax, or easing-heavy transitions

### Requirement: Self-contained runtime
The landing page SHALL render completely without any network request to a third-party origin: no CDN scripts, stylesheets, remote fonts, or remote images. Display fonts are self-hosted via `@font-face` with local files, or the page falls back to a system monospace/sans stack that preserves the design's character.

#### Scenario: Offline render
- **WHEN** the built page is opened with network access disabled
- **THEN** it renders with correct layout, styling, and legible typography (self-hosted or fallback fonts)

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
