# website-landing Delta Specification

## MODIFIED Requirements

### Requirement: Landing page content is real and complete
The landing page SHALL present rasen truthfully using copy sourced from the repo's actual README and docs, in the language of the locale variant being viewed. Every locale variant MUST include: a hero stating what rasen is (spec-driven workflow + autonomous orchestration, "loops that ascend" / 螺旋 identity) with a hero tagline in that variant's own language (the English page carries an English tagline; the Chinese page carries 「不是循环，是螺旋」); a visible link to the project's GitHub repository (`github.com/DumoeDss/rasen`) in the hero area, directly above the version/license/requires/package meta grid, with a localized label in the CRT idiom; the spiral thesis (spec origin → loop form → ascending turns → goal breakthrough); a feature section covering the real capability set (spec-driven change workflow, pipeline family, `/rasen:auto` autopilot, `/rasen:goal` goal loops, auto-decompose, chrome-use, context sensing & handoff); an install block with the real command `npm i -g @atelierai/rasen` plus `rasen init`; the OpenSpec lineage/coexistence statement; and a footer colophon with license, version, and repository link. The site header additionally carries a GitHub icon link to the same repository on every page (landing variants and docs). Apart from the untranslated brand and technical tokens (the RASEN wordmark, command names, code, package names) and the 螺旋 gloss of the brand name, a locale variant does not carry full sentences in another language.

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

#### Scenario: Repository is reachable from the hero
- **WHEN** a visitor views the hero of any locale variant
- **THEN** a GitHub link with a localized label appears above the meta grid, navigates to `https://github.com/DumoeDss/rasen`, and renders in the CRT idiom (monospace, existing palette, zero radius)

#### Scenario: Repository is reachable from every page's header
- **WHEN** any page of the site is viewed — any locale landing variant or any docs page — at any supported viewport width
- **THEN** the header shows a GitHub icon link (inline monochrome SVG mark, phosphor at rest, red on hover, no external assets) with a localized accessible name, navigating to the repository
