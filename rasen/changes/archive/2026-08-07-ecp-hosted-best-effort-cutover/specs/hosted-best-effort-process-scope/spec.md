## ADDED Requirements

### Requirement: Linux hosted sessions run under the declared POSIX best-effort tier
A Linux hosted-session workload SHALL start only under the POSIX best-effort process scope, with `exactCancel: false` and `scopeEmptyProof: false` recorded in the hosted-session record at prepare time, before activation. The legacy ProcessCapsule's exact tier SHALL no longer be constructed for Linux hosted sessions on the production path.

#### Scenario: Declaration is visible before start on Linux
- **WHEN** a Linux hosted session prepares its workload scope
- **THEN** the hosted-session record shows `exactCancel: false` and `scopeEmptyProof: false`
- **AND** the workload has not started

#### Scenario: Cancel terminal on Linux is honest
- **WHEN** a Linux hosted session is cancelled and the cancel protocol completes
- **THEN** the terminal state is `cancelled / emptiness-unproven`
- **AND** no record states or implies proven scope emptiness

#### Scenario: setsid escape is a declared limitation
- **WHEN** a descendant leaves the process group via `setsid()` and survives a completed cancel
- **THEN** the hosted-session record shows `cancelled / emptiness-unproven`
- **AND** the surviving process is a declared limitation of the tier, not a defect finding against it

### Requirement: The POSIX best-effort tier is one implementation shared by darwin and linux
The POSIX best-effort scope SHALL be a single platform-neutral implementation selected for both darwin and linux hosted sessions, using the same cancel protocol: group SIGTERM, a bounded grace period keyed on whole-group emptiness (never on leader exit), group SIGKILL at grace expiry, and one bounded final observation. Platforms other than darwin, linux, and win32 SHALL keep their prior routing unchanged.

#### Scenario: Same declaration on both POSIX platforms
- **WHEN** hosted-session scopes are prepared on darwin and on linux
- **THEN** both record the same POSIX best-effort declaration before start

#### Scenario: darwin behaviour is preserved by the generalisation
- **WHEN** a darwin hosted session runs under the generalised module
- **THEN** its protocol, bounds, receipt shapes, and release behaviour are unchanged from the darwin-only implementation

#### Scenario: Non-cutover platforms are untouched
- **WHEN** a hosted-session scope is constructed on a platform other than darwin, linux, or win32
- **THEN** the selection routes exactly as before this change

### Requirement: Windows hosted sessions keep Job kill mechanics under an honest declaration
A Windows hosted-session workload SHALL run under a scope that retains the legacy ProcessCapsule's Job-object termination mechanics unchanged, while declaring `exactCancel: false` and `scopeEmptyProof: false` before start. Every terminal at the hosted seam SHALL use the declared-unproven vocabulary; the scope SHALL NOT emit a proven scope-empty claim or a clean-cancel claim, and any containment-primitive emptiness observation SHALL be recorded as diagnostic detail only.

#### Scenario: Declaration is visible before start on Windows
- **WHEN** a Windows hosted session prepares its workload scope
- **THEN** the hosted-session record shows `exactCancel: false` and `scopeEmptyProof: false`
- **AND** the workload has not started

#### Scenario: Cancel terminal on Windows is honest
- **WHEN** a Windows hosted session is cancelled and the capsule acknowledges scope-empty
- **THEN** the hosted seam records `cancelled / emptiness-unproven`
- **AND** the Job-accounting emptiness observation is diagnostic detail, not a proof claim

#### Scenario: Legacy capsule bytes are unchanged
- **WHEN** the byte-hash pin guards for the legacy ProcessCapsule run after this change
- **THEN** every pinned digest is unchanged and no rebaseline has occurred

### Requirement: Transport or controller loss never becomes a clean terminal
Loss of the control transport, a protocol violation, or a control timeout SHALL surface as a typed uncertain outcome with authority retained. A declared-unproven terminal SHALL be mintable only from an actual protocol outcome of the underlying scope, and an uncertain outcome SHALL NOT authorise release of durable authority regardless of the declaration.

#### Scenario: Controller loss is retained uncertainty
- **WHEN** the capsule controller is lost before acknowledging scope-empty
- **THEN** the hosted seam reports a typed uncertain outcome
- **AND** the session's durable authority is retained on both host release paths

#### Scenario: No error path fabricates an honest terminal
- **WHEN** any transport failure or timeout occurs during cancel
- **THEN** no declared-unproven terminal is produced from that failure path

### Requirement: Windows daemon death tears down the hosted workload via the Job
The Windows hosted tier SHALL retain the `KILL_ON_JOB_CLOSE` teardown property: when the daemon dies, the closing of the Job handle chain SHALL cause the kernel to terminate remaining Job members. A later daemon SHALL report the stale session honestly and SHALL NOT reattach or revalidate identity across daemon lifetimes.

#### Scenario: Daemon death kills the workload Job
- **WHEN** the daemon process dies while a Windows hosted workload and its descendants are running
- **THEN** the workload Job's members are terminated by the kernel via the closed Job handle

#### Scenario: Stale record after restart is honest
- **WHEN** the next daemon encounters the hosted-session record from the dead daemon
- **THEN** it reports the scope honestly without reattaching
- **AND** any release from that record keeps emptiness-unproven language

### Requirement: Acceptance requires real Linux and Windows receipts with demonstrated failing counterparts
Acceptance evidence for this capability SHALL include receipts taken on a real Linux host and a real Windows host exercising the production hosted-session path, and every guard test SHALL have a demonstrated failing counterpart proving it discriminates. Deterministic or fixture-mediated evidence SHALL be labelled non-acceptance. Kernel-enforced exact-cancel or scope-empty proofs SHALL NOT be acceptance criteria for this tier. Linux test runs SHALL execute in an isolated external run tree, never the repository checkout.

#### Scenario: Production-path receipt on real Linux
- **WHEN** a hosted session is started and cancelled on a real Linux host through the production entry path
- **THEN** the receipts show the pre-start declaration and the `cancelled / emptiness-unproven` terminal in the hosted-session record

#### Scenario: Production-path and teardown receipts on real Windows
- **WHEN** hosted sessions are exercised on a real Windows host
- **THEN** receipts show the pre-start declaration, the honest cancel terminal, and the daemon-death Job teardown

#### Scenario: Guard discrimination is proven by mutation
- **WHEN** a guard test for this capability is presented as green
- **THEN** a matching mutation receipt shows the guard failing against the defect it names

#### Scenario: Kernel-enforced proof is not demanded
- **WHEN** acceptance for this capability is evaluated
- **THEN** no criterion requires exact recursive termination or a proven scope-empty receipt
