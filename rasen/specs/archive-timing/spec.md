# archive-timing Specification

## Purpose
Define the `archive.timing` config axis (`on-merge` default, or `in-ship`) that decides WHEN archive's two responsibilities — delta-spec sync and change-directory bookkeeping — run relative to ship, without changing WHAT either step does. Covers merge confirmation for on-merge PR deliveries, honest degradation when merge state can't be verified, immediate chaining for local/push deliveries, in-ship archiving folded into the ship commit, and the rule that facts already recorded in a ship log always outrank a later re-resolved config value.

## Requirements
### Requirement: Archive timing is a config axis with on-merge as the default

The project config (`rasen/config.yaml`) SHALL support an optional `archive` block with a `timing` field accepting exactly `on-merge` or `in-ship`. When the block or field is absent or invalid, the resolved timing SHALL be `on-merge`. Every consumer SHALL resolve the timing through one shared resolution rule so the default is applied identically everywhere. The timing axis decides only WHEN archive's two responsibilities — spec sync (delta specs into main specs) and directory bookkeeping (moving the change directory to the archive) — run; it SHALL NOT change what either step does.

#### Scenario: Default resolves to on-merge

- **WHEN** the config has no `archive` block
- **THEN** the resolved archive timing SHALL be `on-merge`
- **AND** no warning SHALL be logged for the absent optional block

#### Scenario: Explicit in-ship is honored

- **WHEN** the config contains `archive:` with `timing: in-ship`
- **THEN** the resolved archive timing SHALL be `in-ship`

#### Scenario: Invalid timing value degrades to the default

- **WHEN** the config contains `archive:` with `timing: sometimes`
- **THEN** a warning SHALL identify the invalid field
- **AND** the resolved timing SHALL be `on-merge` and the rest of the config SHALL still parse

### Requirement: On-merge archives of PR-delivered changes are gated on merge confirmation

When the resolved timing is `on-merge` and the change's ship log records a `pr`-mode delivery, an archive attempt SHALL verify the merge before syncing or bookkeeping: it checks the recorded PR's state (via `gh pr view <url> --json state,mergedAt` using the ship-log's PR URL). A merged PR SHALL allow archive to proceed. An open PR SHALL cause a refusal by default, overridable only by an explicit acknowledgment that names the unmerged condition; non-interactive or dispatched contexts SHALL refuse outright. A PR closed without merging SHALL cause a refusal that surfaces the rejected-delivery state rather than archiving it away. The change SHALL remain fully active (status, resume, loop, fix-forward) while the PR is open. Confirmation is check-on-invocation only: no continuous polling, no background process.

#### Scenario: Merged PR archives

- **WHEN** archive runs for an on-merge change whose ship-log PR reports state MERGED
- **THEN** spec sync and bookkeeping SHALL proceed normally

#### Scenario: Open PR refuses by default

- **WHEN** archive runs and the PR reports state OPEN
- **THEN** the archive SHALL be refused with a message naming the unmerged PR
- **AND** SHALL proceed only on an explicit override naming the unmerged condition
- **AND** SHALL refuse outright when running non-interactively

#### Scenario: Closed-unmerged PR is surfaced, not archived

- **WHEN** archive runs and the PR reports CLOSED without a merge
- **THEN** the archive SHALL be refused and the rejected-delivery state surfaced for human decision

#### Scenario: Change stays active during review

- **WHEN** a change has shipped in `pr` mode under on-merge timing and its PR is still open
- **THEN** the change SHALL remain active — `rasen status`, `pipeline resume`, and further fix-forward work SHALL behave as for any active change

### Requirement: Merge verification degrades honestly without gh or network

When the PR state cannot be determined — `gh` missing or unauthenticated, network failure, unparseable output, or a ship log without a PR URL — the archive workflow SHALL say it cannot verify the merge and SHALL ask the human to explicitly confirm the merge state, treating that confirmation as the check; in a non-interactive or dispatched context it SHALL refuse outright with the reason, leaving the archive re-attemptable. An unverifiable state SHALL NEVER be treated as merged.

#### Scenario: gh unavailable falls back to human confirmation

- **WHEN** archive runs for an on-merge PR-delivered change and `gh` is not available
- **THEN** the workflow SHALL state that it cannot verify the merge and prompt the human to confirm it
- **AND** SHALL proceed only on that explicit confirmation

#### Scenario: Non-interactive cannot verify means refuse

- **WHEN** the same situation occurs in a non-interactive or dispatched context
- **THEN** the archive SHALL be refused with the cannot-verify reason and remain re-attemptable later

### Requirement: On-merge archives chain immediately for local and push deliveries

When the resolved timing is `on-merge` and the change's delivery completed at ship time with no merge event to await — `push` mode, or `local` mode's deferred-to-portfolio commit — archive SHALL proceed without any merge gate, and ship's post-delivery guidance SHALL direct archiving immediately, preserving today's ship-then-archive flow.

#### Scenario: Push delivery archives right after ship

- **WHEN** a change ships in `push` mode under on-merge timing
- **THEN** the subsequent archive SHALL run its normal gates with no merge-confirmation step

### Requirement: In-ship timing runs sync and bookkeeping inside the ship stage

When the resolved timing is `in-ship`, the ship workflow SHALL run spec sync and directory bookkeeping as part of shipping, ordered so their results ride the same delivery: content needed by later ship steps is captured first, then delta specs are synced to main specs, then the change directory is moved to the archive location, and then the ship commit includes all of it. The ship log SHALL record the archived location. A subsequent archive invocation for that change SHALL recognize the recorded state and report it as already archived instead of failing or repeating work.

#### Scenario: One delivery carries code, synced specs, and the archived change

- **WHEN** a change ships in `pr` mode with timing `in-ship`
- **THEN** the delivered branch SHALL contain the code, the synced main specs, and the change directory moved to the archive location, in the shipped commit(s)
- **AND** the ship log SHALL record the archived path

#### Scenario: Archive after in-ship is an idempotent no-op

- **WHEN** `/rasen:archive` runs for a change whose ship log records an in-ship archive
- **THEN** it SHALL report the change as already archived at the recorded location and stop cleanly

### Requirement: Recorded delivery facts outrank re-resolved config

Timing decisions about a delivery that already happened SHALL be driven by the facts recorded in the ship log (delivery mode, PR URL, archived-in-ship marker), not by re-resolving the config after the fact; the config axis is consulted only for decisions not yet taken. Editing the timing mid-flight SHALL NOT reinterpret a recorded delivery.

#### Scenario: Config flipped after ship does not rewrite history

- **WHEN** a change shipped under `in-ship` (ship log records the archived path) and the config is later changed to `on-merge`
- **THEN** an archive attempt SHALL still report already-archived from the ship log rather than attempting a merge check
