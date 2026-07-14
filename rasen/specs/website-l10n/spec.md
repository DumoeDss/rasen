# website-l10n Specification

## Purpose
Define the rasen website's localization: four-locale landing page variants at stable URLs, faithful externalized translations, a language switcher, correct language metadata, and graceful CJK typography, all within the existing brutalist-CRT visual contract.

## Requirements

### Requirement: Landing page in four locales at stable URLs
The website SHALL serve the landing page in English, Chinese, Japanese, and Korean as build-time static variants at stable paths: `/` (English default), `/zh/`, `/ja/`, `/ko/`. One build pass emits all variants; the build stays idempotent. Docs pages remain English and are not localized.

#### Scenario: All variants emitted by one build
- **WHEN** the site build runs
- **THEN** `dist/` contains the English landing at the root plus complete landing pages under `zh/`, `ja/`, and `ko/`, and running the build again produces the same output with no stale locale files

#### Scenario: Locale URLs serve the right language
- **WHEN** a visitor opens `/zh/` (or `/ja/`, `/ko/`)
- **THEN** the full landing page renders in that language — hero tagline, section headings, feature copy, install-block prose — with the same section structure, version data, and visual system as the English page

#### Scenario: Docs remain unaffected
- **WHEN** the localized build runs and any docs page is viewed
- **THEN** docs output is unchanged from the pre-localization behavior (English content, working navigation), and following a docs link from any locale's landing page reaches the docs

### Requirement: Faithful externalized translations
All user-visible landing strings SHALL live in per-locale string sources (not inline in templates), with English as the reference locale carrying the canonical copy. This includes chrome affordance labels such as the GitHub link label and its icon's accessible name — every locale supplies its own. Translations are faithful renderings of the English copy — same claims, same features, nothing added or dropped — while brand and technical tokens (the RASEN wordmark, slash commands, CLI commands, code snippets, `@atelierai/rasen`, file paths, repository URL) stay untranslated. Every locale provides a value for every string key, so no variant renders a missing-string artifact or silently falls back mid-page.

#### Scenario: Translation fidelity review
- **WHEN** a bilingual reviewer compares any locale variant against the English page section by section
- **THEN** each section conveys the same factual claims with no invented or omitted features, and commands/code render identically to the English page

#### Scenario: No missing strings
- **WHEN** any locale variant is rendered at build time
- **THEN** every string slot is filled from that locale's source — a locale missing a key fails the build with an error naming the key rather than emitting a blank or mixed-language page

#### Scenario: New chrome affordances are localized
- **WHEN** the GitHub icon's accessible name or the hero GitHub link label is inspected on any locale variant
- **THEN** it is rendered from that locale's string source (not hardcoded English), while the repository URL itself is identical across locales

### Requirement: Language switcher in the landing header
Every landing variant SHALL show a language switcher in the header: plain links to all four variants (no JavaScript required), labeled in each target language's own name (EN / 中文 / 日本語 / 한국어 or equivalent), with the current locale visibly marked, styled within the CRT contract (monospace, hairlines, zero radius, existing palette only).

#### Scenario: Switching locales
- **WHEN** a visitor on any landing variant clicks another language in the switcher
- **THEN** they land on that locale's landing page with the switcher now marking the new locale as current

#### Scenario: Switcher does not disturb docs navigation
- **WHEN** the switcher is present in the landing header
- **THEN** the docs link and all existing header items keep working, and docs pages' own headers remain functional whether or not they display the switcher

### Requirement: Correct language metadata
Each landing variant SHALL declare its language: `<html lang>` set to the variant's BCP-47 code (`en`, `zh`, `ja`, `ko`), and `hreflang` alternate link elements in the head pointing to all four variants plus an `x-default` pointing at the English page — present and mutually consistent on every variant. No sitemap is introduced (the site has none).

#### Scenario: Metadata per variant
- **WHEN** the head of any landing variant is inspected
- **THEN** its `html lang` matches the page language and its alternate links enumerate all four locale URLs plus `x-default`, identical across variants (absolute or root-relative consistently)

### Requirement: CJK typography degrades gracefully
Chinese, Japanese, and Korean text SHALL render legibly using system-installed CJK fonts (no webfonts shipped): locale-scoped font stacks append appropriate system CJK families so CJK prose falls back cleanly from the mono/display stacks while Latin technical tokens keep the mono aesthetic. The CRT visual contract (palette, hairlines, radius 0, scanline, motion rules) and layout integrity hold on CJK pages — including the hero wordmark's one-line invariant, which applies to every locale since the wordmark stays the Latin "RASEN".

#### Scenario: CJK page renders offline without webfonts
- **WHEN** `/zh/`, `/ja/`, or `/ko/` is rendered with no network access on a standard OS install
- **THEN** all CJK text is legible in system fonts, no tofu/placeholder glyphs appear for the page's own copy, and no font files were added to the build output

#### Scenario: Layout holds under CJK metrics
- **WHEN** a CJK landing variant is viewed at 360px and ≥1440px
- **THEN** headings and grid cells accommodate CJK glyph widths and line-break behavior without overflow or horizontal page scroll, and the RASEN hero wordmark still renders on one line
