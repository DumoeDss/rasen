## ADDED Requirements

### Requirement: Profile-selected retention execution

`rasen-retain` SHALL resolve exactly one retention mode from the active profile: `off`, `report`, or `codify`. `off` SHALL complete without producing retention output or changing learned-skill state. `report` SHALL preserve the existing retrospective reporting behavior without codifying skills. `codify` v1 SHALL require a specific change and SHALL evaluate that change for managed learned-skill creation, full rewrite, retirement, or a successful no-op.

#### Scenario: Retention is off
- **WHEN** `rasen-retain` runs with the active profile retention mode set to `off`
- **THEN** it SHALL complete without writing a retrospective report
- **AND** it SHALL leave project and global learned-skill registries unchanged

#### Scenario: Report mode preserves retrospective reporting
- **WHEN** `rasen-retain` runs with the active profile retention mode set to `report`
- **THEN** it SHALL run the retrospective reporting contract defined by `opsx-retro-command`
- **AND** it SHALL NOT create, update, promote, or retire a learned skill

#### Scenario: Codify is change-scoped in v1
- **WHEN** `rasen-retain` runs with retention mode `codify` and a change name
- **THEN** it SHALL evaluate only evidence associated with that change
- **AND** it MAY create, rewrite, retire, or leave unchanged managed learned skills according to the accepted candidates

#### Scenario: Codify without a change is rejected
- **WHEN** `rasen-retain` runs with retention mode `codify` and no change can be resolved
- **THEN** it SHALL fail with an actionable error stating that codify v1 requires a change-scoped invocation

#### Scenario: No accepted candidates is success
- **WHEN** codify evaluates a change and no candidate satisfies every acceptance criterion
- **THEN** the operation SHALL succeed with a result stating that no learned skill was created, updated, or retired
- **AND** it SHALL NOT create a placeholder skill merely to demonstrate that codify ran

### Requirement: Evidence-gated learned-skill candidates

A learned-skill candidate SHALL be accepted only when it is durable, reusable, actionable, evidenced, novel, and bounded. Evidence SHALL come from completed change material such as planning artifacts, review and verification findings, shipping records, or regression tests, and SHALL identify the source change and supporting records. A lesson that is transient, change-specific, speculative, already covered, or too broad SHALL be rejected.

#### Scenario: Candidate satisfies every criterion
- **WHEN** completed change evidence supports a stable procedure that can guide future work, names concrete actions and completion conditions, is not already covered, and has a bounded context of use
- **THEN** codify SHALL accept it as a learned-skill candidate
- **AND** the candidate SHALL retain evidence references sufficient to explain why it was accepted

#### Scenario: Candidate fails one criterion
- **WHEN** a proposed lesson is not durable, reusable, actionable, evidenced, novel, or bounded
- **THEN** codify SHALL reject that candidate
- **AND** the rejection result SHALL identify the failed criterion

#### Scenario: Regression evidence makes a lesson actionable
- **WHEN** a regression test demonstrates a recurring failure and the evidence supports a concrete prevention or verification procedure
- **THEN** codify MAY accept a bounded learned-skill candidate that includes that procedure and its observable completion condition

### Requirement: Learned-skill names are semantic and portable

Each learned-skill name SHALL use lowercase kebab-case, contain three to six semantic tokens, and be at most 64 characters. The first tokens SHALL identify the applicable context before the action or lesson. Names SHALL NOT contain dates, change IDs, or generic memory words such as `memory`, `lesson`, `learning`, or `notes`. The `name` in `SKILL.md` SHALL exactly equal the generated skill directory basename.

#### Scenario: Valid context-first name
- **WHEN** a candidate for validating profile package retention is named `profile-package-retention-validation`
- **THEN** the name SHALL be accepted when it also satisfies uniqueness and ownership checks

#### Scenario: Invalid learned-skill name
- **WHEN** a candidate name is not lowercase kebab-case, has fewer than three or more than six semantic tokens, exceeds 64 characters, starts with a generic memory concept, or contains a date or change ID
- **THEN** codify SHALL reject the name with an error identifying each violated naming rule

#### Scenario: Skill name and directory stay equal across platforms
- **WHEN** a learned skill is stored or materialized on Windows, macOS, or Linux
- **THEN** platform-native path handling SHALL create a directory whose basename exactly equals the lowercase kebab-case `SKILL.md` name
- **AND** no path separator or filesystem case normalization SHALL alter that identity

### Requirement: Codification deduplicates before writing

Before accepting a create or rewrite, codify SHALL compare the candidate with active and retired learned skills, existing `quality-rules`, repository documentation, and repository or installed skill guidance. Semantically equivalent guidance SHALL be consolidated into an owned learned skill by a full rewrite or treated as already covered; it SHALL NOT be appended as another instruction or emitted as a duplicate skill.

#### Scenario: Existing learned skill covers the candidate
- **WHEN** an existing managed learned skill already covers the candidate's bounded procedure
- **THEN** codify SHALL either leave it unchanged or rewrite that complete managed skill when the new evidence materially improves it
- **AND** it SHALL NOT append a duplicate instruction or create a second equivalent skill

#### Scenario: Existing quality rule or repository guidance covers the candidate
- **WHEN** equivalent guidance already exists in `quality-rules`, repository documentation, or a repository or installed skill
- **THEN** the candidate SHALL be rejected as not novel
- **AND** the existing human-authored guidance SHALL remain unchanged

#### Scenario: Duplicate discovery is cross-platform
- **WHEN** duplicate sources are discovered from repository or skill locations on POSIX or Windows
- **THEN** their paths SHALL be resolved and compared with platform-native canonicalization rather than hardcoded separators
- **AND** case-insensitive Windows path aliases SHALL NOT cause the same guidance source to be evaluated as distinct files

### Requirement: Learned skills have separate project and global registries

Learned skills SHALL be registry records distinct from workflow IDs, expert IDs, and profile selections. New accepted skills SHALL default to project scope in the registered project's machine home. Global learned skills SHALL be stored in a separate registry under the global data directory. Neither registry SHALL add learned-skill identities to workflow dependency closure or profile workflow arrays.

#### Scenario: Project scope is the default
- **WHEN** codify accepts a candidate for a registered project and no global promotion is approved
- **THEN** the canonical learned skill SHALL be stored in that project's registry-backed machine home
- **AND** its identity SHALL NOT appear as a workflow, expert, or profile selection ID

#### Scenario: Global registry is separate
- **WHEN** a learned skill is approved for global scope
- **THEN** its canonical record SHALL be stored in the learned-skill registry under the global data directory
- **AND** project registry records SHALL refer to it without copying it into workflow or profile registries

#### Scenario: Registry paths are portable
- **WHEN** project or global learned-skill storage is resolved on POSIX or Windows
- **THEN** the location SHALL be derived from the existing project-machine-home or global-data resolver with platform path operations
- **AND** Windows drive letters, separators, and case-insensitive aliases SHALL resolve consistently without changing the stable project ID

#### Scenario: Profile picker excludes learned skills
- **WHEN** the profile picker lists selectable workflows and experts
- **THEN** project and global learned-skill names SHALL NOT appear as selectable profile entries

### Requirement: Global creation and promotion require cross-project evidence and approval

A global learned skill SHALL be created or promoted only when equivalent evidence supports the same bounded procedure in at least two distinct stable project IDs and the user explicitly approves the global operation. Repeated evidence from multiple changes or clones sharing one project ID SHALL count as one project. An active `codify` profile SHALL authorize project-scope create, rewrite, and retirement operations without an additional prompt, but SHALL NOT authorize a global create or promotion.

#### Scenario: Two distinct projects and approval permit promotion
- **WHEN** equivalent accepted evidence exists for at least two distinct project IDs
- **AND** the user explicitly approves global promotion
- **THEN** codify SHALL create or update the canonical global learned-skill record with provenance for both projects

#### Scenario: Repeated evidence from one project is insufficient
- **WHEN** equivalent evidence comes from multiple changes or clones that resolve to only one stable project ID
- **THEN** global creation or promotion SHALL remain blocked
- **AND** the accepted lesson MAY remain project-scoped

#### Scenario: Approval is required after evidence threshold
- **WHEN** equivalent evidence exists for at least two distinct project IDs but the user does not explicitly approve the global operation
- **THEN** no global learned-skill state SHALL be created or changed
- **AND** the result SHALL state that global approval was not granted

#### Scenario: Codify profile authorizes project scope
- **WHEN** an active `codify` profile yields an accepted project-scoped create, rewrite, or retirement
- **THEN** the project-scoped operation SHALL proceed without an additional approval prompt

### Requirement: Managed learned-skill lifecycle preserves ownership

Codify SHALL create, rewrite, or retire only learned skills whose canonical manifest identifies them as generated and Rasen-managed. An update SHALL replace the complete managed skill content rather than append instructions. Retirement SHALL preserve canonical provenance and set a non-active status while removing managed materializations. A name collision with a human-authored or otherwise unmanaged skill SHALL block the operation; codify SHALL NOT overwrite, rename, update, or retire the human-owned skill.

#### Scenario: Managed skill is rewritten in full
- **WHEN** new accepted evidence materially improves an existing generated managed learned skill
- **THEN** codify SHALL atomically replace the complete generated skill content and update its manifest evidence
- **AND** it SHALL NOT append the new lesson to the old instructions

#### Scenario: Managed skill is retired
- **WHEN** bounded evidence shows that an existing generated managed learned skill is obsolete, contradicted, or no longer applicable
- **THEN** codify SHALL set its canonical status to retired and remove only its recorded managed materializations
- **AND** it SHALL retain provenance and retirement evidence in the canonical manifest

#### Scenario: Human-authored collision blocks mutation
- **WHEN** a candidate name collides with a human-authored skill or a skill without the generated managed ownership marker
- **THEN** codify SHALL block the candidate with an actionable collision error
- **AND** it SHALL leave the existing skill byte-for-byte unchanged

### Requirement: Canonical manifests preserve auditability

Every canonical learned skill SHALL have a manifest recording its stable identity, scope, generated managed ownership, provenance, evidence references, applicability, and lifecycle status. Provenance SHALL include the contributing stable project IDs and change identities needed to audit project creation or global promotion. The canonical status SHALL determine whether the skill is eligible for materialization.

#### Scenario: Active manifest is complete
- **WHEN** a learned skill is created or rewritten
- **THEN** its canonical manifest SHALL record provenance, evidence, applicability, ownership, scope, and active status
- **AND** the manifest SHALL contain enough source identifiers to audit the decision without embedding the source artifacts verbatim

#### Scenario: Retired status prevents materialization
- **WHEN** a canonical manifest has retired status
- **THEN** the learned skill SHALL NOT be materialized on a subsequent reconciliation
- **AND** any recorded managed copies SHALL be eligible for exact ledger-based removal

### Requirement: Applicability gates project-local materialization

Every learned skill SHALL declare explicit `path-exists` marker predicates as its applicability contract. For project-local AI-tool homes, a global learned skill SHALL materialize only for a project whose predicate expression matches, and a project-scoped learned skill SHALL materialize only into configured project-local tool homes for its owning project when its predicates match. A global-only tool home cannot enforce project applicability: it SHALL skip project-scoped skills and reconcile all active approved global learned skills through a machine-global learned-skill ledger, independent of the current project's marker result. Rasen SHALL use managed generation and explicit artifact-ledger entries for creation, replacement, and removal; it SHALL NOT infer deletion targets by filename patterns.

#### Scenario: Matching global skill materializes locally
- **WHEN** a registered project satisfies a global learned skill's explicit `path-exists` predicates
- **AND** a project-local AI-tool skill home is already configured
- **THEN** reconciliation SHALL materialize the managed skill into that matching project-local tool home and record the exact artifact in the ledger

#### Scenario: Non-matching global skill is skipped
- **WHEN** a project does not satisfy a global learned skill's explicit `path-exists` predicates
- **THEN** reconciliation SHALL leave every configured project-local tool home unchanged for that skill

#### Scenario: Project skill is not installed into a global-only tool home
- **WHEN** reconciliation targets an AI tool configured only with a global tool home and a project-scoped learned skill is eligible
- **THEN** Rasen SHALL skip that project-scoped learned skill
- **AND** it SHALL emit a warning explaining that project-scoped learned skills require a project-local tool home

#### Scenario: Global-only tool home uses global scope rather than project markers
- **WHEN** reconciliation targets an AI tool configured only with a global tool home
- **THEN** Rasen SHALL reconcile every active approved global learned skill through the machine-global learned-skill ledger
- **AND** one project's non-matching marker result SHALL NOT remove a global copy installed for the shared tool home

#### Scenario: Materialization paths are cross-platform
- **WHEN** marker predicates and configured tool homes are evaluated on Windows, macOS, or Linux
- **THEN** path existence checks and materialization targets SHALL use platform-native path resolution
- **AND** a Windows marker using the platform separator and its canonical case-insensitive path SHALL produce the same applicability result

### Requirement: Knowledge CLI mediates learned-skill mutations

The localized `rasen knowledge` command group SHALL provide `apply`, `list`, `show`, and `retire` operations over canonical learned-skill state. `apply` SHALL accept a strict versioned candidate from an absolute JSON file, produce the deterministic mutation plan, and commit through the managed learned-skill lifecycle; `rasen-retain` and other agents SHALL NOT write canonical stores or tool skill directories directly. Global create or promotion SHALL require the cross-project evidence gate plus interactive approval or an explicit global-approval flag, while project mutations SHALL be authorized by an active codify profile. Human and JSON results SHALL distinguish create, rewrite, promote, retire, collision, rejection, and no-op outcomes.

#### Scenario: Apply commits a valid project candidate
- **WHEN** `rasen knowledge apply --from <absolute-json-file>` receives a valid accepted project candidate while the active profile uses codify
- **THEN** it SHALL display or emit the planned mutation and commit it through the learned-skill core
- **AND** it SHALL return the resulting canonical identity, scope, status, and affected materializations

#### Scenario: Agent direct writes are not part of the workflow
- **WHEN** `rasen-retain` prepares an accepted candidate
- **THEN** it SHALL submit the strict candidate to `rasen knowledge apply`
- **AND** it SHALL NOT directly create, rewrite, retire, or materialize a learned-skill directory

#### Scenario: Global apply requires explicit consent
- **WHEN** a valid candidate requests global creation or promotion with evidence from at least two distinct project IDs
- **THEN** the command SHALL prompt for approval in an interactive terminal
- **AND** outside an interactive terminal it SHALL require the explicit global-approval flag
- **AND** absent consent SHALL leave global state unchanged

#### Scenario: List show and retire expose managed state
- **WHEN** a user runs `rasen knowledge list`, `rasen knowledge show <id>`, or `rasen knowledge retire <id>` with a project or global scope
- **THEN** the command SHALL resolve the corresponding canonical registry and expose or retire only the exact managed identity
- **AND** retirement SHALL require confirmation unless the explicit confirmation flag is supplied

#### Scenario: Candidate paths are cross-platform
- **WHEN** `knowledge apply` receives an absolute candidate path on POSIX or Windows
- **THEN** it SHALL resolve and read that one file with platform-native path handling
- **AND** Windows drive-letter and separator forms SHALL remain one argument and SHALL NOT be interpreted as learned-skill identity text

### Requirement: Persistent learned-skill content is treated as untrusted

Planning artifacts, reports, logs, tests, and other candidate inputs SHALL be treated as untrusted data. Codify SHALL synthesize bounded procedural guidance and SHALL NOT copy source instructions verbatim into persistent skill instructions. Source content that attempts to redirect codification, broaden applicability, claim ownership, or request execution SHALL be ignored as instruction and retained only as evidence data when relevant. In v1, generated learned skills SHALL NOT contain or materialize executable sidecars or scripts.

#### Scenario: Prompt-like source text is not persisted as instruction
- **WHEN** an evidence artifact contains text instructing the codifier to ignore policy, create a global skill, execute a command, or copy the text into `SKILL.md`
- **THEN** codify SHALL treat that text as untrusted evidence content rather than an instruction
- **AND** it SHALL NOT reproduce the instruction verbatim in the learned skill

#### Scenario: Generated guidance is synthesized
- **WHEN** evidence supports an accepted candidate
- **THEN** the generated skill SHALL express the bounded procedure, applicability, and checkable completion conditions in newly synthesized language
- **AND** its manifest SHALL reference the evidence without embedding complete source records

#### Scenario: Executable sidecars are forbidden in v1
- **WHEN** a candidate would require a shell script, JavaScript module, executable file, or executable sidecar
- **THEN** codify SHALL reject or restate the candidate as non-executable declarative guidance
- **AND** no executable sidecar or script SHALL be written to canonical or materialized learned-skill state

### Requirement: Codification enforces named context budgets

Codification SHALL enforce named `LEARNED_SKILL_CONTEXT_BUDGET` and `LEARNED_SKILL_CONTENT_BUDGET` limits before persistent state is changed. The concrete values MAY evolve without changing the contract, but an exceeded limit SHALL produce an actionable error that names the limit, identifies the affected candidate or evidence set, and explains how to reduce or split the input. Codify SHALL NOT silently truncate evidence or generated instructions in a way that changes their meaning.

#### Scenario: Evidence context exceeds its budget
- **WHEN** the selected evidence exceeds `LEARNED_SKILL_CONTEXT_BUDGET`
- **THEN** codify SHALL stop before changing canonical or materialized learned-skill state
- **AND** the error SHALL name the budget, identify the oversized evidence set, and recommend narrowing the evidence or splitting the candidate

#### Scenario: Generated content exceeds its budget
- **WHEN** an accepted candidate would produce content exceeding `LEARNED_SKILL_CONTENT_BUDGET`
- **THEN** codify SHALL reject that output before persistence
- **AND** the error SHALL name the candidate and recommend bounding or splitting the procedure
