## REMOVED Requirements

### Requirement: chrome-use covered by the parity golden master

**Reason**: Retire mandatory template hashes for chrome-use.
**Migration**: Use generated chrome-use delivery validation below without changing verification or ship contracts.

## ADDED Requirements

### Requirement: Generated chrome-use skill is validated through delivery

`chrome-use` SHALL remain covered by generation and installation validation through the normal product path. Changes to its template or shared blocks SHALL be verified in the affected installed instructions, with proportionate behavioral evidence rather than permanent prompt-string, wiring, or template hash assertions. This replacement SHALL NOT change canonical verification severities, verdicts, test-evidence fields, or ship's evidence-consumption rules.

#### Scenario: chrome-use is generated and installed

- **WHEN** changes affecting `chrome-use` are verified
- **THEN** validation SHALL generate and install the skill from `getChromeUseSkillTemplate` through the normal product path
- **AND** it SHALL record exercised commands, observed results, and unverified scope
- **AND** inspection of emitted guidance SHALL NOT itself authorize browser execution
