# opsx-ship-command Specification

## Purpose
Provide the `/opsx:ship` command — pre-flight checks, delivery-mode resolution (pr / push / local), commit-with-hooks, an evidence-based test gate, a PR body derived from the proposal, a mode-aware ship log, and optional land-and-deploy.
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

Ship SHALL commit, integrate, and deliver according to the resolved delivery mode, using a self-contained execution contract absorbed into the `/opsx:ship` workflow template. Tests SHALL be gated on evidence rather than run unconditionally. It SHALL NOT delegate to a gstack `/ship` expert skill.

#### Scenario: Merge base branch only in pr mode

- **WHEN** the ship phase executes in `pr` mode
- **THEN** the system SHALL fetch and merge the resolved integration base (the existing PR's base, an explicit base argument, or fork-point inference — never a blind repository default) into the current branch before the test gate
- **AND** if the merge produces conflicts that cannot be resolved automatically, the system SHALL stop and surface the conflicts

#### Scenario: No base merge outside pr mode

- **WHEN** the ship phase executes in `push` or `local` mode
- **THEN** the system SHALL NOT fetch or merge any base branch

#### Scenario: Evidence-based test gate

- **WHEN** the ship phase reaches the test gate
- **THEN** the system SHALL run the project's detected test command only if at least one holds: (a) the base merge introduced new commits, (b) no green test evidence exists for the current code state — i.e. no recorded passing test run (review report, review-cycle report, or run-state) whose recorded content tree fingerprint (`git rev-parse HEAD^{tree}`) matches the current tree fingerprint, or (c) the user explicitly requests it
- **AND** if tests run and any in-branch test fails, the system SHALL stop and NOT deliver

#### Scenario: Tests skipped on fresh evidence

- **WHEN** green test evidence exists for the current code state and the base merge introduced nothing new
- **THEN** the system SHALL skip the test run
- **AND** SHALL record the skip and the evidence source in the ship log

#### Scenario: Fresh-verification gate before delivery

- **WHEN** code changed after the last green test run (for example, from review fixes or lint fixes during commit)
- **THEN** the system SHALL re-run the tests and require fresh passing evidence before delivering

#### Scenario: Deliver per mode

- **WHEN** the test gate is satisfied
- **THEN** in `pr` mode the system SHALL push the branch with upstream tracking and create a pull request via `gh pr create`; in `push` mode it SHALL push the current branch without creating a PR; in `local` mode it SHALL NOT push and SHALL record that delivery is deferred to the portfolio/parent level
- **AND** the ship phase SHALL complete without invoking any gstack `/ship` expert skill

#### Scenario: Documentation sync is inline, not delegated

- **WHEN** the ship workflow reaches its post-ship documentation-sync step
- **THEN** it SHALL carry a minimal inline instruction to update project documentation to match the release
- **AND** it SHALL NOT reference or point at a `/document-release` skill

### Requirement: PR Body from Proposal

PR body SHALL include the proposal summary from the change's `proposal.md`.

#### Scenario: PR body generation with proposal

- **WHEN** creating a pull request
- **AND** `openspec/changes/<name>/proposal.md` exists
- **THEN** the PR body SHALL include the "Why" and "What Changes" sections from `proposal.md`
- **AND** the PR title SHALL be derived from the change name or proposal summary

#### Scenario: PR body generation without proposal

- **WHEN** creating a pull request
- **AND** no `proposal.md` exists for the change
- **THEN** the PR body SHALL be generated from commit messages and change name
- **AND** the system SHALL note that no proposal was available

### Requirement: Ship Log

`ship-log.md` SHALL be written to the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback) with shipping details, aware of the delivery mode. Ship's pre-flight evidence reads (verification reports, expert reports, cycle reports) SHALL look in the same resolved location, falling back to the change directory.

#### Scenario: Ship log written after delivery in any mode

- **WHEN** the ship phase completes delivery (PR created, branch pushed, or local commit recorded)
- **THEN** the system SHALL write `ship-log.md` to the work directory (or the legacy location per the fallback)
- **AND** the log SHALL include: the delivery mode, branch name, commit, the content tree fingerprint (`git rev-parse HEAD^{tree}`) of that commit, timestamp, the test decision (ran green, or skipped with the evidence source and the matched tree fingerprint), the PR URL in `pr` mode, and the deferral note in `local` mode

#### Scenario: Ship log updated after deployment

- **WHEN** the optional land-and-deploy phase completes
- **THEN** the system SHALL update `ship-log.md` in the same resolved location with deployment status and production verification results

#### Scenario: Evidence read from the work directory

- **WHEN** ship's pre-flight checks look for verification or test-skip evidence
- **THEN** they SHALL check the work directory first and the change directory as fallback for the evidence report files

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

The ship workflow SHALL resolve the archive timing from the status JSON (`archive.timing`, default `on-merge`) and act on it. Under `in-ship`, ship SHALL run archive's two steps inside the ship stage, ordered before the ship commit so their results ride the same delivery: first capture content later ship steps need from the change directory (PR body sections, task completion), then sync delta specs to main specs, then move the change directory to the archive location, then commit — and record the archived location in the ship log. Under `on-merge`, ship SHALL NOT sync or move anything; its post-delivery guidance SHALL be mode-aware: after a `pr` delivery it states the change stays ACTIVE and archive follows merge confirmation; after a `push` or `local` delivery it directs archiving immediately.

#### Scenario: In-ship delivery carries sync and bookkeeping

- **WHEN** the generated ship workflow runs with resolved timing `in-ship`
- **THEN** it SHALL sync delta specs and move the change directory to the archive location before the ship commit
- **AND** the ship log SHALL record the archived path
- **AND** PR-body content SHALL be captured before the directory moves so later steps still have it

#### Scenario: On-merge pr delivery leaves the change active

- **WHEN** the generated ship workflow completes a `pr` delivery with resolved timing `on-merge`
- **THEN** its post-ship guidance SHALL state the change remains active during PR review and archive proceeds after merge confirmation
- **AND** SHALL NOT sync specs or move the change directory

#### Scenario: On-merge local or push delivery chains to archive

- **WHEN** the generated ship workflow completes a `push` or `local` delivery with resolved timing `on-merge`
- **THEN** its post-ship guidance SHALL direct running archive immediately, since delivery is complete at ship

#### Scenario: Clean tree skips the commit step

- **WHEN** the working tree is already clean at the commit step
- **THEN** the workflow SHALL skip committing and continue

### Requirement: In-ship bookkeeping honors the destination axis

When ship runs archive's bookkeeping inside the ship stage (timing `in-ship`), the bookkeeping SHALL follow the resolved destination from the status JSON: `in-repo` — move to the in-repo archive so the archived directory rides the delivery; `external` — move to the machine-home archive so the repo-side REMOVAL rides the delivery while the archive copy stays machine-local; `prune` — delete so the removal rides the delivery. The destructive-destination preconditions apply, except that the committed-state precondition is inherently satisfied because in-ship bookkeeping happens immediately before ship's own commit of the change's files. The ship log SHALL record the destination outcome (archived path or pruned state).

#### Scenario: In-ship external delivery carries the removal

- **WHEN** a change ships with timing `in-ship` and destination `external`
- **THEN** the change directory SHALL be moved to the machine-home archive before the ship commit
- **AND** the delivered commit SHALL contain the synced specs and the change-directory removal, with no archive-dir additions

#### Scenario: In-ship prune records the pruned state

- **WHEN** a change ships with timing `in-ship` and destination `prune`
- **THEN** the change directory SHALL be deleted before the ship commit after the prune confirmation
- **AND** the ship log SHALL record the pruned state so later archive invocations recognize the outcome

### Requirement: Ship stamps the delivery chain and embeds store review material

Ship SHALL source its PR-body proposal read from the CLI-resolved change root (status JSON `changeRoot`) in every mode, and in store mode (`root.store_id` present in the status payload) SHALL perform the `sha-cross-stamping` capability's PR-body embedding: proposal Why/What plus delta spec content in collapsed sections, stamped with the store path and store repo HEAD SHA (dirty tree and non-git store stamped honestly), recording the store identity and SHA in the ship log alongside the existing commit/tree stamps. Under in-ship timing, ship SHALL complete the chain record itself (the archive outcome and the commit SHA, which is the ship commit).

#### Scenario: Proposal read is store-safe

- **WHEN** the generated ship workflow builds a PR body
- **THEN** it SHALL read the proposal from the status JSON's `changeRoot`, not a repo-relative literal path

#### Scenario: Store-mode ship log carries the store stamp

- **WHEN** ship delivers a store-rooted change in `pr` mode
- **THEN** the ship log SHALL record the store identity and the store repo HEAD SHA in addition to the code commit and tree fingerprint
- **AND** the PR body SHALL carry the embedded review material with the same stamps

#### Scenario: In-ship ship writes the full chain

- **WHEN** ship runs under `in-ship` timing
- **THEN** the ship log SHALL record the archive outcome and identify the ship commit as the archive commit, leaving nothing for a later archive append

