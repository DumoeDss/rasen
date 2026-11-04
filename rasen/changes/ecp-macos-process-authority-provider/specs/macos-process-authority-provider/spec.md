## ADDED Requirements

### Requirement: macOS hosted sessions declare best-effort limits before the scope starts
A macOS hosted-session workload SHALL start only under a process scope whose hosted-session record already declares `exactCancel: false` and `scopeEmptyProof: false`. The declaration SHALL be recorded at prepare time, before activation, so the limits are visible before any workload code runs.

#### Scenario: Limits are visible before start
- **WHEN** a macOS hosted session prepares its workload scope
- **THEN** the hosted-session record shows `exactCancel: false` and `scopeEmptyProof: false`
- **AND** the workload has not started

#### Scenario: A scope without the declaration does not start on this tier
- **WHEN** the best-effort tier declaration cannot be recorded before activation
- **THEN** activation fails with a typed error and no workload code runs

#### Scenario: Exact-tier scopes are unaffected
- **WHEN** a hosted session runs under a scope that carries no best-effort declaration
- **THEN** it keeps the existing exact-tier contract, including release only from a proven scope-empty receipt

### Requirement: The workload runs as leader of its own process group
The provider SHALL start the workload as the leader of its own POSIX session and process group, so cancel and observation address the whole group the workload's descendants are born into. Preparation SHALL stay inert: the workload process is created only at activation, and aborting a prepared scope reports honestly that nothing ran.

#### Scenario: Workload starts in its own group
- **WHEN** a prepared macOS scope is activated
- **THEN** the workload runs as the leader of a new process group whose id equals the leader pid
- **AND** descendants the workload spawns are born into that group

#### Scenario: Prepare is inert
- **WHEN** a scope is prepared but not yet activated
- **THEN** no workload process exists
- **AND** aborting the prepared scope succeeds without signalling anything and reports that no workload ran

#### Scenario: Command path is used exactly
- **WHEN** prepare receives the server-resolved absolute command, arguments, working directory, and explicit environment allowlist
- **THEN** activation launches exactly that command without PATH resolution and with only the allowlisted environment
- **AND** a non-absolute command is refused with a typed error before any process is created

### Requirement: Cancel delivers group signals with escalation keyed off whole-group emptiness
Cancellation SHALL deliver SIGTERM to the whole process group, wait a bounded grace period, and then deliver SIGKILL to the whole group if the group is not yet empty. The escalation decision SHALL read whole-group emptiness, never leader exit: a leader that exits immediately while a descendant survives still results in group SIGKILL at grace expiry.

#### Scenario: Graceful cancel reaches the whole group
- **WHEN** a live macOS scope is cancelled
- **THEN** SIGTERM is delivered to the process group, not only to the leader

#### Scenario: Leader exit does not end the grace protocol
- **WHEN** the leader exits immediately after group SIGTERM while a descendant in the group survives
- **THEN** the provider continues the bounded grace wait keyed on group emptiness
- **AND** delivers group SIGKILL at grace expiry because the group is not empty

#### Scenario: Group observed empty within grace avoids force
- **WHEN** every group member is gone before the grace period expires
- **THEN** no SIGKILL is delivered
- **AND** the terminal state still reports emptiness as unproven

#### Scenario: Descendant ignores SIGTERM
- **WHEN** a group member ignores or traps SIGTERM and is still present at grace expiry
- **THEN** group SIGKILL is delivered
- **AND** one bounded final group-emptiness observation follows

#### Scenario: Every cancel phase is bounded
- **WHEN** any cancel phase cannot complete before its deadline
- **THEN** the provider settles that phase once with a typed timeout outcome
- **AND** never hangs the session on an unbounded wait

### Requirement: The cancel terminal state is cancelled with emptiness unproven
Every completed cancellation on this tier SHALL terminate in `cancelled / emptiness-unproven`. The provider SHALL never report a cancellation as cleanly cancelled or as proven scope-empty, because group emptiness does not prove scope emptiness: a descendant can leave the process group and survive group signals.

#### Scenario: Terminal state after cancel
- **WHEN** the cancel protocol completes, with or without force
- **THEN** the terminal state is `cancelled / emptiness-unproven`
- **AND** the diagnostic records whether the group was observed empty and whether SIGKILL was used

#### Scenario: Group observed empty still reports unproven
- **WHEN** the final observation finds no group member remaining
- **THEN** the terminal state remains `cancelled / emptiness-unproven`
- **AND** the group observation is recorded as diagnostic detail, not as scope-emptiness proof

#### Scenario: Escaped descendant does not falsify the record
- **WHEN** a descendant leaves the process group during execution and survives a completed cancel
- **THEN** the hosted-session record shows `cancelled / emptiness-unproven`
- **AND** no record ever claimed the scope was proven empty

### Requirement: Natural completion reports the exact root exit with the same emptiness honesty
When the workload leader exits on its own, the provider SHALL report the exact exit code or exact terminating signal (exactly one of the two), distinct from any emptiness statement, and the completion terminal SHALL carry the same unproven-emptiness honesty as cancellation.

#### Scenario: Exact exit code
- **WHEN** the leader exits normally
- **THEN** the record shows the exact exit code and a null signal

#### Scenario: Exact terminating signal
- **WHEN** the leader is terminated by a signal
- **THEN** the record shows the exact signal and a null exit code

#### Scenario: Root exit while a descendant remains
- **WHEN** the leader has exited but the group is not yet observed empty
- **THEN** the scope reports the root as exited while remaining controllable
- **AND** a subsequent cancel still runs the full group-signal protocol

#### Scenario: Completion terminal is honest about emptiness
- **WHEN** the session ends by natural completion
- **THEN** the completion terminal records emptiness as unproven, with any group-empty observation as diagnostic detail only

### Requirement: A declared unproven terminal releases hosted-session authority honestly
The hosted-session close path SHALL release durable authority from a declared-unproven terminal state only when the session's record carries the best-effort declaration made before start. The released session's record SHALL keep the unproven terminal state permanently; release SHALL never rewrite it into a clean or proven-empty outcome.

#### Scenario: Declared best-effort session releases after cancel
- **WHEN** a macOS hosted session with the pre-start declaration reaches `cancelled / emptiness-unproven`
- **THEN** the host releases the session's durable authority
- **AND** the record keeps the unproven terminal state

#### Scenario: Exact-tier release rule is unchanged
- **WHEN** a session without the best-effort declaration presents anything other than a proven scope-empty receipt
- **THEN** the host retains the authority exactly as before this change

#### Scenario: Undeclared scope cannot use the unproven terminal
- **WHEN** an unproven terminal is presented for a session whose record lacks the pre-start declaration
- **THEN** the host refuses release and retains the authority

### Requirement: Daemon death is reported as loss, never bridged by reattach
When the daemon dies while a best-effort scope is live, the detached workload group may keep running; a later daemon SHALL report the stale session honestly as lost or uncertain and SHALL take no destructive action against a process identity it cannot confirm. The provider SHALL never reattach to or revalidate a scope across daemon lifetimes.

#### Scenario: Stale record after daemon restart
- **WHEN** a later daemon encounters a hosted-session record from a previous daemon lifetime
- **THEN** it reports the scope as foreign or uncertain
- **AND** delivers no signal to any process based on that stale record

#### Scenario: No reattach is attempted
- **WHEN** a stale best-effort scope reference is inspected or closed
- **THEN** the provider performs no identity revalidation and no recovery of live authority
- **AND** the record reflects the loss honestly

### Requirement: The best-effort tier never claims the exact recursive capability
The macOS best-effort provider SHALL NOT register under the exact recursive process-scope capability and SHALL NOT emit any proven scope-empty receipt. The frozen common provider contract, its registry, and its manifest validation remain unchanged by this capability.

#### Scenario: No registration under the recursive capability
- **WHEN** the common process-authority registry and manifest are inspected after this change
- **THEN** they contain no macOS best-effort entry
- **AND** their subset-rejection behavior is unchanged

#### Scenario: No proven scope-empty receipt exists on this tier
- **WHEN** any observation or control result of the best-effort provider is examined
- **THEN** no result states or implies proven scope emptiness

### Requirement: Acceptance requires real macOS receipts with demonstrated failing counterparts
Acceptance evidence for this capability SHALL include receipts taken on a real macOS host exercising the production hosted-session path, and every guard test SHALL have a demonstrated failing counterpart (a mutation receipt) proving it discriminates. Evidence taken on another POSIX system or through deterministic fixtures SHALL be labelled as non-acceptance evidence.

#### Scenario: Production-path receipt on real macOS
- **WHEN** a hosted session is started and cancelled on a real macOS host through the production entry path
- **THEN** the receipts show the pre-start declaration, the group-signal protocol, and the `cancelled / emptiness-unproven` terminal in the hosted-session record

#### Scenario: Guard discrimination is proven by mutation
- **WHEN** a guard test for this capability is presented as green
- **THEN** a matching mutation receipt shows the guard failing against the defect it names

#### Scenario: Non-macOS evidence is labelled
- **WHEN** POSIX pre-flight evidence is taken on Linux or through a deterministic fixture
- **THEN** it is recorded as non-acceptance evidence and does not satisfy the macOS acceptance gate
