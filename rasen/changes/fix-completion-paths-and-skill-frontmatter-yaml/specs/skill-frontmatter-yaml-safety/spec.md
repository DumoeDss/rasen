## ADDED Requirements

### Requirement: Generated Skill Frontmatter Is Valid YAML

Every `SKILL.md` that `rasen init` and `rasen update` generate SHALL have YAML frontmatter that parses cleanly under a strict YAML parser, regardless of the characters in the skill's authored field values.

Frontmatter scalar values (name, description, license, compatibility, and metadata entries) SHALL be emitted so that YAML-significant content — most notably a colon followed by a space (`: `) inside a value — does not change the meaning of the frontmatter. A value that would be ambiguous or invalid as an unquoted (plain) YAML scalar SHALL be quoted; a value that is already safe as a plain scalar MAY remain unquoted. This SHALL apply uniformly to built-in skills and to user-authored skills.

#### Scenario: Description containing a colon-space sequence stays valid

- **WHEN** a skill's description contains a `: ` sequence (for example `rasen-audit`'s description, "…Experimental: parses an internal transcript format.")
- **THEN** the generated `SKILL.md` frontmatter SHALL parse without error under a strict YAML parser
- **AND** the parsed `description` value SHALL equal the authored description text

#### Scenario: All shipped skills parse under a strict parser

- **WHEN** `rasen init` or `rasen update` generates the `SKILL.md` files for the installed skills
- **THEN** the frontmatter of every generated file SHALL parse without error under a strict YAML parser

#### Scenario: Safe values are not rewritten unnecessarily

- **WHEN** a frontmatter value is already valid as an unquoted YAML plain scalar
- **THEN** the generator MAY emit it without quotes
- **AND** regenerating a skill whose values are all safe SHALL NOT change that skill's frontmatter beyond the version stamp
