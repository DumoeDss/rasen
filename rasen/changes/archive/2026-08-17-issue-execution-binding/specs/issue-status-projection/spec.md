# issue-status-projection Specification (Delta)

## MODIFIED Requirements

### Requirement: Run-state visibility is located and labelled

An Issue's status SHALL be computed from the run-state of its referenced Changes located through
the same state-file placement a pipeline resume reads — the execution root's ephemera directory
first, then the legacy work directory, then the change directory — on the machine the read runs
from, and additionally through the execution root recorded for a Change's instance in the Store's
workspace index, searched after the working directory's own execution root so a read from the
Store root or any unrelated directory still finds a member project's recorded activity. Each
node's status SHALL label which locator found its run-state. When neither the working directory's
execution root nor a workspace index entry provides a Change's run-state, the projection SHALL
say so: such a node reports not-started with no local run-state, the answer labels its run-state
visibility, and absence SHALL NOT be presented as a failure. A run-state file that exists but
cannot be parsed SHALL be reported as a status problem naming the file and the reason, with the
node reported unknown rather than guessed.

#### Scenario: An unrelated working directory sees committed evidence only

- **WHEN** an Issue's status is read from a directory that resolves no project execution root and the Change's instance has no workspace index entry
- **THEN** phase and progress derive from the plan revision and committed Store evidence
- **AND** the answer labels that no local run-state was visible

#### Scenario: A live execution root sees the real run-state

- **WHEN** the same Issue's status is read from the execution root where a referenced Change is running
- **THEN** the Change's node reflects the recorded stage statuses
- **AND** the answer labels the execution root it consulted

#### Scenario: A workspace-indexed Change is observed from anywhere

- **WHEN** an Issue's status is read from a directory that resolves no project execution root, and a referenced Change's instance has a workspace index entry recording an execution root where its run-state lives
- **THEN** the Change's node reflects the recorded stage statuses found through that entry
- **AND** the node's status labels the workspace index as the locator that found it

#### Scenario: A corrupt run-state is reported, not guessed

- **WHEN** a Change's `auto-run.json` exists but cannot be parsed
- **THEN** the node is reported unknown with a status problem naming the file and reason
- **AND** no phase or health value is fabricated from the unreadable file
