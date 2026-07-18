# website-l10n Delta Specification

## MODIFIED Requirements

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
