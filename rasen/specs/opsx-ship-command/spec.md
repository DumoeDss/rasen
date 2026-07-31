# opsx-ship-command Specification

## Purpose
Provide the `/rasen-ship` command — pre-flight checks, delivery-mode resolution (pr / push / local), commit-with-hooks, an evidence-based test gate, a PR body derived from the proposal, a mode-aware ship log, and optional land-and-deploy.
## Requirements
### Requirement: Ship Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for ship in `src/core/templates/workflows/ship.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getShipCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxShipCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates

### Requirement: Pre-Flight Checks

Pre-flight checks SHALL verify readiness before shipping. A dirty working tree SHALL NOT block shipping — committing is the ship phase's own responsibility.

#### Scenario: Verification status check

- **WHEN** the ship command starts
- **THEN** the system SHALL check whether verification has been run for the change
- **AND** if no verification report exists, the system SHALL warn the user and prompt for confirmation to proceed

#### Scenario: Task completion check

- **WHEN** the ship command starts
- **THEN** the system SHALL read `tasks.md` and verify all tasks are marked complete
- **AND** if incomplete tasks exist, the system SHALL list them and prompt the user for confirmation

#### Scenario: Working tree state check

- **WHEN** the ship command starts with uncommitted changes in the working tree
- **THEN** the system SHALL NOT require the user to commit or stash beforehand — the ship phase commits them itself
- **AND** if HEAD is detached, the system SHALL warn and suggest creating a branch

#### Scenario: All pre-flight checks pass

- **WHEN** all pre-flight checks pass
- **THEN** the system SHALL proceed to the ship phase without additional prompts

### Requirement: Ship Execution

Ship SHALL commit, integrate, and deliver according to the resolved delivery mode, using a self-contained execution contract absorbed into the `/rasen-ship` workflow template. Tests SHALL be gated on evidence rather than run unconditionally. It SHALL NOT delegate to a legacy `/ship` expert skill.

#### Scenario: Merge base branch only in pr mode

- **WHEN** the ship phase executes in `pr` mode
- **THEN** the system SHALL fetch and merge the resolved integration base (the existing PR's base, an explicit base argument, or fork-point inference — never a blind repository default) into the current branch before the test gate
- **AND** if the merge produces conflicts that cannot be resolved automatically, the system SHALL stop and surface the conflicts

#### Scenario: No base merge outside pr mode

- **WHEN** the ship phase executes in `push` or `local` mode
- **THEN** the system SHALL NOT fetch or merge any base branch

#### Scenario: Evidence-based test gate

- **WHEN** the ship phase reaches the test gate
- **THEN** the system SHALL derive the required verification scope from the delivered diff, project instructions, and any merged commits
- **AND** SHALL accept green evidence only when its recorded commands and scope rationale cover that required scope and its content tree fingerprint (`git rev-parse HEAD^{tree}`) matches the current tree
- **AND** SHALL run only uncovered checks from the required scope
- **AND** if any required check fails, the system SHALL stop and NOT deliver

#### Scenario: Tests skipped on fresh evidence

- **WHEN** scoped green evidence covers the required verification scope and matches the current tree
- **THEN** the system SHALL skip the checks already covered
- **AND** SHALL record the scope, rationale, skip, evidence source, and matched tree in the ship log

#### Scenario: Localized change stays focused

- **WHEN** the delivered diff is confined to one behavior with a regression test and directly affected module checks
- **AND** no cross-cutting risk trigger or project instruction requires broader coverage
- **THEN** the ship gate SHALL accept that focused scope
- **AND** SHALL NOT escalate missing evidence to the full project test command

#### Scenario: Full-suite escalation is explicit and cost-aware

- **WHEN** the user or project instructions require a full suite, or affected behavior cannot be bounded more narrowly
- **THEN** the ship gate SHALL state the trigger and expected cost before starting a run expected to exceed 60 seconds
- **AND** SHALL NOT repeat an unchanged full-suite command that already timed out
- **AND** SHALL instead shard it, use CI, or ask for direction

#### Scenario: Merge recalculates scope without forcing full

- **WHEN** the pr-mode base merge introduces new commits
- **THEN** the ship gate SHALL recalculate the required verification scope against the merged diff
- **AND** SHALL NOT treat the merge alone as proof that a full repository suite is necessary

#### Scenario: Fresh-verification gate before delivery

- **WHEN** code changed after the last scoped green evidence (for example, from review fixes or lint fixes during commit)
- **THEN** the system SHALL re-run invalidated checks from the same required verification scope and require fresh passing evidence before delivering
- **AND** SHALL widen the scope only if a newly introduced full-suite trigger applies

#### Scenario: Deliver per mode

- **WHEN** the test gate is satisfied
- **THEN** in `pr` mode the system SHALL push the branch with upstream tracking and create a pull request via `gh pr create`; in `push` mode it SHALL push the current branch without creating a PR; in `local` mode it SHALL NOT push and SHALL record that delivery is deferred to the portfolio/parent level
- **AND** the ship phase SHALL complete without invoking any legacy `/ship` expert skill

#### Scenario: Documentation sync is inline, not delegated

- **WHEN** the ship workflow reaches its post-ship documentation-sync step
- **THEN** it SHALL carry a minimal inline instruction to update project documentation to match the release
- **AND** it SHALL NOT reference or point at a `/document-release` skill

### Requirement: PR Body from Proposal

PR body SHALL include the proposal summary from the change's `proposal.md`.

#### Scenario: PR body generation with proposal

- **WHEN** creating a pull request
- **AND** `rasen/changes/<name>/proposal.md` exists
- **THEN** the PR body SHALL include the "Why" and "What Changes" sections from `proposal.md`
- **AND** the PR title SHALL be derived from the change name or proposal summary

#### Scenario: PR body generation without proposal

- **WHEN** creating a pull request
- **AND** no `proposal.md` exists for the change
- **THEN** the PR body SHALL be generated from commit messages and change name
- **AND** the system SHALL note that no proposal was available

### Requirement: Ship Log

`ship-log.md` SHALL be written to the change's evidence directory (`<changeRoot>/evidence/`, the `evidenceDir` reported by the CLI per the `file-placement` capability), with the sticky-legacy fallback for a log that already exists in the legacy work directory or change directory. Ship's pre-flight evidence reads SHALL check evidence first, then the legacy work directory, then the change directory.

When archive timing is `in-ship`, ship SHALL finalize every delivery/deployment fact that will belong in the log before invoking the archive engine. The engine SHALL finalize the archive section in its stage, and no ship step SHALL mutate that evidence after the engine hashes it.

#### Scenario: Ship log written after delivery in any mode

- **WHEN** the ship phase completes delivery (PR created, branch pushed, or local commit recorded)
- **THEN** the system SHALL write `ship-log.md` to the evidence directory or resolved legacy location
- **AND** the log SHALL include delivery mode, branch, commit, tree fingerprint, timestamp, verification scope/rationale/results, PR URL in `pr` mode, and the deferral note in `local` mode

#### Scenario: Ship log updated after deployment

- **WHEN** the optional land-and-deploy phase completes before archive
- **THEN** the system SHALL update the same resolved ship log with deployment status and production verification results
- **AND** under `in-ship` timing this update SHALL precede archive engine invocation

#### Scenario: Evidence read from the work directory

- **WHEN** ship's pre-flight checks look for verification or test-skip evidence
- **THEN** they SHALL check the evidence directory first, then the legacy work directory, then the change directory

#### Scenario: In-ship evidence is immutable after archive

- **WHEN** the in-ship archive engine reports success
- **THEN** ship SHALL perform no later ship-log append or deployment-status rewrite
- **AND** the ship-log digest recorded in `archive.json` SHALL remain valid

### Requirement: Optional Land-and-Deploy

Optional land-and-deploy SHALL merge the PR, wait for CI, deploy, and verify production.

#### Scenario: Land-and-deploy invocation

- **WHEN** the user opts into land-and-deploy after PR creation
- **THEN** the system SHALL merge the PR after CI passes
- **AND** SHALL wait for deployment to complete
- **AND** SHALL run production verification checks

#### Scenario: CI failure during land-and-deploy

- **WHEN** CI checks fail after merge
- **THEN** the system SHALL report the failure
- **AND** SHALL NOT proceed with deployment
- **AND** SHALL update `ship-log.md` with the failure details

#### Scenario: User declines land-and-deploy

- **WHEN** the user declines land-and-deploy
- **THEN** the system SHALL stop after PR creation
- **AND** `ship-log.md` SHALL reflect that deployment was deferred

### Requirement: Delivery Mode Resolution

The ship workflow SHALL resolve exactly one of three delivery modes before integrating or delivering: `pr` (deliver via pull request), `push` (commit to the current branch and push directly, no PR), and `local` (commit only — no push, no PR; delivery deferred to a portfolio/parent-level ship). Resolution SHALL follow this precedence: explicit argument or pipeline stage metadata > an existing open PR for the current branch (mode `pr`, base = that PR's base) > repository convention (project instructions, git history of the current branch) > prompting the user. The workflow SHALL NOT select an integration base by defaulting to the repository's default branch.

#### Scenario: Explicit mode wins

- **WHEN** the invocation or the pipeline stage metadata specifies a delivery mode (and optionally a base)
- **THEN** the workflow SHALL use that mode (and base) without further inference

#### Scenario: Existing PR implies pr mode and its base

- **WHEN** no explicit mode is given and an open PR exists for the current branch
- **THEN** the workflow SHALL resolve mode `pr` with that PR's base branch as the integration base

#### Scenario: Repository convention infers push mode

- **WHEN** no explicit mode and no open PR exist
- **AND** project instructions or the branch's git history show the current branch is routinely pushed to directly
- **THEN** the workflow SHALL resolve mode `push`

#### Scenario: Ambiguity prompts the user instead of defaulting

- **WHEN** the mode cannot be resolved from arguments, an existing PR, or repository convention
- **THEN** the workflow SHALL ask the user
- **AND** SHALL NOT fall back to merging or targeting the repository's default branch

### Requirement: Commit Is Part of Ship

The ship workflow SHALL commit the change's working-tree modifications as part of the ship phase in every delivery mode, honoring commit hooks.

#### Scenario: Uncommitted changes are committed by ship

- **WHEN** the ship phase runs with uncommitted changes in the working tree
- **THEN** the workflow SHALL stage the change's files and create the commit itself

#### Scenario: Hook failure is fixed and retried

- **WHEN** a pre-commit hook (e.g. lint or format) rejects the commit
- **THEN** the workflow SHALL fix the reported issues and retry the commit
- **AND** SHALL NOT bypass hooks (e.g. `--no-verify`)

### Requirement: Ship honors the archive timing axis

The ship workflow SHALL resolve `archive.timing` from status JSON. Under `in-ship`, ship SHALL keep the change active while it commits/tests/delivers, resolves any PR URL, completes or declines optional deployment, and writes final ship-side evidence. It SHALL then invoke the authoritative archive engine, inspect the complete plan, and commit/push the resulting archive bookkeeping as required by delivery mode. It SHALL NOT sync and move the change independently.

Under `on-merge`, ship SHALL NOT invoke archive during PR review. Its guidance SHALL leave PR-delivered changes active until merge confirmation and direct `push`/`local` deliveries to archive after delivery.

#### Scenario: In-ship delivery uses the archive engine after evidence finalization

- **WHEN** generated ship runs with timing `in-ship`
- **THEN** it SHALL finalize delivery facts and `ship-log.md` while the change is active
- **AND** SHALL invoke the same archive engine used by direct and skill archive
- **AND** SHALL use the engine's spec sync, staging, disposition, accounting, and publication result

#### Scenario: In-ship PR may require a follow-up archive push

- **WHEN** `pr` delivery must create the PR before its URL can be finalized in evidence
- **THEN** ship SHALL push/create the PR, finalize the ship log, run/archive-commit through the engine, and push the non-force follow-up commit
- **AND** SHALL report both the recorded ship commit and archive bookkeeping commit through stable Git history

#### Scenario: On-merge pr delivery leaves the change active

- **WHEN** ship completes a `pr` delivery with timing `on-merge`
- **THEN** its guidance SHALL state the change remains active during PR review and archive follows merge confirmation
- **AND** SHALL NOT sync specs, stage an archive, or remove the active change

#### Scenario: On-merge local or push delivery chains to archive

- **WHEN** ship completes a `push` or `local` delivery with timing `on-merge`
- **THEN** its guidance SHALL direct running the authoritative archive flow immediately

#### Scenario: Clean tree skips only the code commit

- **WHEN** the working tree is clean before the code commit
- **THEN** ship MAY skip that code commit
- **AND** under `in-ship` timing it SHALL still run and commit archive bookkeeping after final evidence

### Requirement: Ship stamps the delivery chain and embeds store review material

Ship SHALL source its PR-body proposal read from the CLI-resolved change root and, in store mode, embed proposal/delta review material with honest store stamps as defined by `sha-cross-stamping`. Under `in-ship`, ship SHALL record the delivered commit and tree in the ship-side log, then let the archive engine finalize the archive outcome before hashing. The stable archive-side link SHALL be the subsequent archive commit message/Git history; ship SHALL NOT insert the containing archive commit SHA into hashed evidence.

#### Scenario: Proposal read is store-safe

- **WHEN** the generated ship workflow builds a PR body
- **THEN** it SHALL read the proposal from status JSON's `changeRoot`, not a repo-relative literal path

#### Scenario: Store-mode ship log carries the store stamp

- **WHEN** ship delivers a store-rooted change in `pr` mode
- **THEN** the ship log SHALL record the store identity and honest store repo state in addition to code commit/tree
- **AND** the PR body SHALL carry review material with the same stamps

#### Scenario: In-ship ship finalizes a non-self-referential chain

- **WHEN** ship runs under `in-ship` timing
- **THEN** the finalized ship log SHALL contain delivery facts and the engine-written archive outcome
- **AND** SHALL omit a self-referential archive commit field
- **AND** the archive commit guidance SHALL reference the recorded ship commit
