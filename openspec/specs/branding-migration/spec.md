# branding-migration Specification

## Purpose
Replace legacy Claude Code + gstack branding — prose mentions and garryslist.org URLs — with OpenSpec branding across generated content.

## Requirements
### Requirement: CC+gstack branding replaced
All occurrences of "CC+gstack" in `gen-skill-docs.ts` generator functions and `.tmpl` files SHALL be replaced with "AI-assisted".

#### Scenario: No CC+gstack in generated files
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain the string "CC+gstack"
- **AND** effort estimation tables SHALL use "AI-assisted" instead

### Requirement: garryslist.org URLs removed
All `garryslist.org` URLs SHALL be removed from generator functions and `.tmpl` files.

#### Scenario: No garryslist URLs in generated files
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain `garryslist.org`

### Requirement: gstack branding in prose replaced
Prose text referencing gstack as a product (not as a binary name) SHALL be updated:
- "gstack follows the **Boil the Lake** principle" → "**Completeness Principle**: always do the complete thing when AI makes the marginal cost near-zero"
- "gstack skills" (when referring to suggestions) → "expert skills"
- "gstack browse" (when referring to the tool) → "browse"

#### Scenario: Completeness section uses OpenSpec branding
- **WHEN** the completeness section is generated
- **THEN** it SHALL NOT attribute the principle to "gstack"
- **AND** it SHALL present it as a general engineering principle

#### Scenario: Proactive suggestion text updated
- **WHEN** the proactive suggestion section is generated
- **THEN** it SHALL say "expert skills" instead of "gstack skills"

