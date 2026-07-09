# branding-migration Specification

## Purpose
Replace legacy Claude Code + gstack branding — prose mentions and garryslist.org URLs — with Rasen branding across generated content.
## Requirements
### Requirement: CC+gstack branding replaced
All occurrences of "CC+gstack" in `gen-skill-docs.ts` generator functions, `.tmpl` files, AND static (non-generated) skill content files under `skills/gstack/review/` SHALL be replaced with "AI-assisted".

#### Scenario: No CC+gstack in generated files
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain the string "CC+gstack"
- **AND** effort estimation tables SHALL use "AI-assisted" instead

#### Scenario: No CC+gstack in static review checklists
- **WHEN** the static files `skills/gstack/review/checklist.md`, `design-checklist.md`, `greptile-triage.md`, and `TODOS-format.md` are inspected
- **THEN** none SHALL contain the string "CC+gstack"
- **AND** effort wording SHALL read "AI-assisted"

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

#### Scenario: Completeness section uses Rasen branding
- **WHEN** the completeness section is generated
- **THEN** it SHALL NOT attribute the principle to "gstack"
- **AND** it SHALL present it as a general engineering principle

#### Scenario: Proactive suggestion text updated
- **WHEN** the proactive suggestion section is generated
- **THEN** it SHALL say "expert skills" instead of "gstack skills"

### Requirement: Personal-brand founder prose removed
The system SHALL NOT contain first-person founder-endorsement prose attributed to Garry Tan or GStack in any skill source or generated output. This targets the three "A personal note from me, Garry Tan, the creator of GStack" cards in `office-hours`, replacing each with neutral wording or removing it.

#### Scenario: No Garry Tan attribution in office-hours source
- **WHEN** `skills/gstack/office-hours/SKILL.md.tmpl` is inspected
- **THEN** it SHALL NOT contain the string "Garry Tan"
- **AND** it SHALL NOT contain "the creator of GStack"

#### Scenario: No Garry Tan attribution in generated output
- **WHEN** all SKILL.md files are regenerated and inspected
- **THEN** none SHALL contain the string "Garry Tan"

### Requirement: Personal referral links removed
The system SHALL NOT contain Y Combinator referral links carrying the gstack ref parameter in any skill source or generated output.

#### Scenario: No ycombinator ref link in office-hours
- **WHEN** `skills/gstack/office-hours/SKILL.md.tmpl` and its generated `SKILL.md` are inspected
- **THEN** neither SHALL contain the string `ycombinator.com/apply?ref=gstack`
- **AND** neither SHALL open or recommend that URL

### Requirement: gstack attribution cards and example data removed
The system SHALL NOT contain gstack product-attribution footers or `garrytan/gstack` example data in skill source, generated output, or static checklist files. This covers the `Powered by gstack · github.com/garrytan/gstack` card in `retro`, the `garrytan/...` EUREKA and remote-URL example data in `retro`, and the `garrytan/myapp` example rows in `review/greptile-triage.md`. The reference to a prior automated review reply SHALL be genericized (e.g. "prior automated review reply") rather than branded "GStack reply".

#### Scenario: No Powered-by-gstack card
- **WHEN** `skills/gstack/retro/SKILL.md.tmpl` and its generated `SKILL.md` are inspected
- **THEN** neither SHALL contain the string "Powered by gstack"

#### Scenario: No garrytan example identifiers
- **WHEN** `skills/gstack/retro/SKILL.md.tmpl`, `skills/gstack/review/greptile-triage.md`, and generated `SKILL.md` files are inspected
- **THEN** none SHALL contain the string "garrytan/"
- **AND** example owner/repo identifiers SHALL use a neutral placeholder such as `owner/myapp`

#### Scenario: Automated-reply prose genericized
- **WHEN** `skills/gstack/review/greptile-triage.md` is inspected
- **THEN** it SHALL NOT describe replies as "GStack reply"
- **AND** it SHALL refer to a "prior automated review reply" instead
- **AND** functional detection markers (`**Fixed**`, `**Not a bug.**`, `**Already fixed**`) SHALL be preserved unchanged

#### Scenario: gstack state directory normalized
- **WHEN** `skills/gstack/review/greptile-triage.md` is inspected
- **THEN** it SHALL NOT reference `~/.gstack`
- **AND** it SHALL reference `~/.openspec` for the equivalent state directory

