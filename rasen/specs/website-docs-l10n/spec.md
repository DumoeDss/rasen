# website-docs-l10n Specification

## Purpose
Define localization of the rasen website's documentation section: four-locale docs trees driven by the same publication manifest as English, translated content stored in the site repository, graceful English fallback under partial coverage, cross-locale navigation and metadata, and a glossary-governed translation fidelity contract.

## Requirements

### Requirement: Docs in four locales at stable URLs
The website SHALL serve the documentation in English, Chinese, Japanese, and Korean as build-time static trees: `/docs/<slug>/` (English, unchanged from today) and `/{zh,ja,ko}/docs/<slug>/` for translations, each locale with its own docs index page. One build pass emits all trees and stays idempotent. The English tree remains byte-stable except for deliberate shared-chrome changes.

#### Scenario: Locale trees emitted
- **WHEN** the site build runs
- **THEN** `dist/` contains the English docs as today plus `zh/docs/`, `ja/docs/`, and `ko/docs/` trees each with one page per manifest entry and a locale docs index, and a second build run produces identical output

#### Scenario: Same manifest drives every locale
- **WHEN** the build renders any locale's docs tree
- **THEN** pages, order, and navigation derive from the same publication manifest as the English tree — no per-locale manifest, no globbing of translation directories

### Requirement: Translated content lives in the site repository
Translated docs SHALL be stored in the rasen-site repository under `content/docs/<locale>/<same relative path as the manifest source>` (forward-slash manifest paths mapped cross-platform). The rasen product repo is read-only to this pipeline: English sources and the manifest are read from it, and its `docs/zh/` tree may be read as an import source, but no translation output is ever written there.

#### Scenario: Locale content resolution
- **WHEN** the build renders `/zh/docs/getting-started/` for a manifest entry with source `getting-started.md`
- **THEN** it reads `content/docs/zh/getting-started.md` from the site repo, and the English source of truth in the rasen repo is not modified by any part of the pipeline

### Requirement: English fallback with visible marker under partial coverage
A locale docs page whose translated source file is missing SHALL still be published: it renders the English content inside the locale's page shell with a clearly visible, localized "not yet translated" notice, and the build prints a warning naming the locale and slug while exiting successfully. Translation coverage is allowed to be partial at any ship point — infrastructure and translations are decoupled.

#### Scenario: Missing translation falls back
- **WHEN** `content/docs/ja/<path>.md` does not exist for a published manifest entry
- **THEN** `/ja/docs/<slug>/` is still emitted, shows the English body with a visible Japanese-language untranslated notice near the top, appears in the ja sidebar/index, and the build warns naming `ja` and the slug with exit code 0

#### Scenario: Zero-coverage locale still works
- **WHEN** a locale has no translated files at all
- **THEN** its entire docs tree builds as marked English-fallback pages and every navigation path (index, sidebar, prev/next, switcher) works

#### Scenario: Malformed translation cannot break the build
- **WHEN** a translated file contains arbitrary valid markdown that diverges structurally from its English source
- **THEN** the page renders from the translated content as-is — structural divergence is a content-review concern, never a build failure

### Requirement: Cross-locale switching and language metadata on docs pages
Every docs page in every locale SHALL show a language switcher linking to the SAME page in the other three locales (styled in the site's existing switcher idiom, current locale marked), and SHALL declare correct language metadata: `<html lang>` matching the locale, and hreflang alternate links enumerating the four locale URLs of that page plus `x-default` pointing at the English page. Fallback pages carry the metadata of their locale URL, not of English.

#### Scenario: Switching locales on a docs page
- **WHEN** a reader on `/docs/getting-started/` selects 中文 in the switcher
- **THEN** they land on `/zh/docs/getting-started/` — the same page, not the docs index — with the switcher now marking zh as current

#### Scenario: Metadata per docs page
- **WHEN** the head of any locale variant of any docs page is inspected
- **THEN** `html lang` matches the page's locale and the hreflang set lists all four variants of that same page plus `x-default`, mutually consistent across the variants

### Requirement: Glossary-governed translation fidelity
Translations SHALL be produced under a terminology glossary that maps rasen's product terms per target language and lists what must never be translated (code spans and blocks, CLI commands and flags, file paths, slash commands, brand and package tokens). Each translated file is a faithful rendering of its English source: same claims and structure (headings, lists, tables, code blocks, link targets preserved verbatim), glossary terms used consistently, nothing invented or dropped. Chinese translations are derived by aligning the existing human-curated `docs/zh/` files — English is canonical for CLAIMS, the existing zh text is canonical for TERMINOLOGY and style — including correcting any stale pre-rebrand content against the current English docs. Fidelity is checked by sample-based review before the translated set ships.

#### Scenario: Per-file translation contract
- **WHEN** any translated file is compared against its English source
- **THEN** heading structure, code blocks, and link targets match verbatim; prose conveys the same claims with glossary-consistent terminology; and no content is added or omitted

#### Scenario: zh alignment fixes staleness
- **WHEN** an imported zh file's source predates the English docs' accuracy pass (e.g. old install commands or upstream self-references)
- **THEN** the shipped zh file's claims match the CURRENT English doc (correct package name, commands, workspace paths) while keeping the curated zh terminology and voice

#### Scenario: Spot-check gate
- **WHEN** the translated set is reviewed before ship
- **THEN** a sample across locales and file types is audited against the per-file contract, and contract violations found in the sample block ship until fixed
