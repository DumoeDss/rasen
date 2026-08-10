# durable-agent-session-host Specification

## Purpose
Define stable, recoverable hosted agent Sessions whose bounded turns, exact ownership, durable lifecycle state, and process generations remain safe across caller and daemon replacement.

## Requirements
### Requirement: A hosted agent Session keeps one stable identity across bounded turns
Rasen SHALL let a caller create a hosted agent Session, submit a bounded first turn, and later wake that exact Session for additional bounded turns. Rasen SHALL mint a stable Session id distinct from the backend's Session id and process id; replacement drivers and replacement backend process generations SHALL continue addressing the stable Rasen Session id. At least one production backend SHALL execute through a resident bidirectional stream-json process, while backend-specific flags and event shapes remain hidden behind the host lifecycle contract.

#### Scenario: Create and wake reuse one hosted Session
- **WHEN** a caller executes a first turn and then executes a second turn with the returned Rasen Session id
- **THEN** both receipts name the same Rasen Session and backend Session identity, and the second turn is sent through the live hosted transport when that generation remains healthy

#### Scenario: A replacement driver reattaches logically
- **WHEN** the CLI process that created an idle Session exits and another CLI process addresses that Session through the same resident daemon
- **THEN** the new driver observes and wakes the same hosted Session without creating a duplicate backend Session or replaying an earlier turn

#### Scenario: Unsupported backend is rejected before launch
- **WHEN** a caller requests a backend not present in the host's explicit backend registry
- **THEN** the host returns a typed unsupported-backend outcome and starts no process

### Requirement: Exact Session ownership is single-flight and bound to one canonical working directory
The host SHALL allow at most one unfinished request and one writer/process generation for an exact Session across processes. The Session's cwd SHALL be canonicalized when created and SHALL remain immutable across wake, restart, and recovery. Filesystem aliases that resolve to the same existing checkout SHALL compare as the same cwd, including case-insensitive identity on Windows; a different or unavailable checkout SHALL fail before a backend process receives input.

#### Scenario: Concurrent wake is rejected without duplicate input
- **WHEN** one request is active and a second process attempts to wake the same Session
- **THEN** the second request returns `session-busy`, no second process generation is opened, and its input is not sent

#### Scenario: Different cwd cannot resume the Session
- **WHEN** a caller addresses a known Session from a cwd that resolves to a different checkout
- **THEN** the host returns a typed cwd-mismatch outcome before spawn or stdin write

#### Scenario: Windows aliases preserve exact cwd identity
- **WHEN** the recorded and requested cwd identify the same existing Windows directory but differ in drive-letter case, separator spelling, junction, or other canonical alias
- **THEN** the host recognizes one cwd identity and does not reject or retarget the Session

#### Scenario: Removed checkout fails closed
- **WHEN** the Session's recorded cwd no longer exists at wake or restart time
- **THEN** the host reports the unavailable recorded checkout and does not guess another clone or working directory

### Requirement: Hosted lifecycle facts survive restart in an atomic machine-local registry
Rasen SHALL persist hosted Session lifecycle under the per-user machine data home in the owner-restricted `rasen-session-host-registry/2` schema. A record SHALL include stable Session identity, backend identity, canonical cwd, lifecycle state, process generation, an opaque runtime ref with optional display PID, bounded request-state metadata, and recovery/retirement diagnostics. Every mutation SHALL publish atomically under exclusive ownership so readers observe a complete previous or complete next record. Invalid schema or corrupt bytes SHALL fail closed and remain available for diagnosis rather than being silently replaced with an empty registry. Owner-free v1 documents MAY remain read-only until the next mutation; v1 live/uncertain PID facts SHALL NOT be promoted into a v2 runtime ref.

#### Scenario: Idle and retired Sessions remain inspectable after restart
- **WHEN** the daemon restarts after recording idle and retired Sessions
- **THEN** both Sessions retain their stable ids, cwd, backend facts, and lifecycle states in list/detail output

#### Scenario: Crash at a registry publication boundary exposes no partial state
- **WHEN** the writer crashes before or during atomic publication
- **THEN** the next reader observes either the last complete generation or the next complete generation and never parses a partial mixture

#### Scenario: Concurrent registry mutation has one winner
- **WHEN** multiple processes contend to mutate the same Session generation
- **THEN** exclusive ownership serializes one mutation and every loser receives a typed busy/stale-generation result without overwriting the winner

#### Scenario: Corrupt registry fails closed
- **WHEN** the durable registry has an unknown schema, invalid digest, malformed JSON, or an invalid canonical path
- **THEN** hosted Session mutation is refused with a diagnostic, the original bytes are preserved, and Rasen does not invent an empty lifecycle

#### Scenario: Registry records lifecycle rather than sensitive execution content
- **WHEN** a Session executes turns and the registry is inspected
- **THEN** it contains request/result digests and bounded sanitized lifecycle diagnostics but contains no prompt body, arbitrary result body, environment dump, executable Action, completion claim, canonical Run state, credential, or signing private key

#### Scenario: Legacy live PID facts fail closed
- **WHEN** a v1 registry contains process PID/start facts that may still name a live generation
- **THEN** Rasen preserves the original bytes, refuses to invent an opaque runtime ref, and requires exact absence or operator handling before mutation

### Requirement: Hosted process authority is opaque and activation follows durable publication
Each production hosted generation SHALL be prepared by a packaged source-built ProcessCapsule that returns an opaque ProcessRef while backend work remains inert. SessionHost SHALL persist that ref under generation/revision compare-and-swap before exactly-once activation. Host, backend, ownership, reconcile, cancel, restart, retire, and shutdown SHALL NOT parse the ref or use PID, process-group, Job, or native-handle values as control arguments. Missing helper, integrity/capability mismatch, failed containment, publication failure, foreign identity, or unobserved close SHALL fail closed without releasing retained authority.

#### Scenario: Publication failure never activates backend work
- **WHEN** ProcessCapsule preparation succeeds but durable runtime-ref publication loses CAS or fails
- **THEN** the prepared scope is aborted without activation, and any unobserved close remains retained rather than being reported clean

#### Scenario: Windows controller death closes detached descendants
- **WHEN** the unique native controller dies after publishing a Windows generation whose backend created a detached descendant
- **THEN** closure of its unnamed non-inherited kill-on-close Job terminates the supervisor, backend root, and descendant without daemon PID signalling

#### Scenario: Platform identity capability is exact or unsupported
- **WHEN** Linux pidfd plus boot/start identity or macOS kernel unique-birth identity cannot be established
- **THEN** preparation or recovery fails closed and does not fall back to PATH helpers, PowerShell, generic `ps lstart`, or PID-only signalling

### Requirement: Recovery resumes exact backend identity without replaying an ambiguous turn
After host or daemon replacement, an idle Session with a known backend Session id SHALL be recoverable by opening a new stream transport for that exact backend identity in the recorded cwd. Recovery SHALL increment the process generation and SHALL NOT change the stable Rasen Session id. If a generation dies with a prepared/sent request but no durably settled terminal result, the host SHALL mark the request ambiguous, return `turn-outcome-unknown`, and SHALL NOT automatically resend its input.

#### Scenario: Idle Session resumes after daemon restart
- **WHEN** a daemon restarts while a Session was durably idle and the next caller wakes it
- **THEN** the host opens an exact-resume stream transport in the recorded cwd, increments generation, and sends only the new turn

#### Scenario: Active crash does not replay input
- **WHEN** the host generation dies after accepting or sending a turn but before recording one validated terminal result
- **THEN** restart classifies that turn as ambiguous, returns `turn-outcome-unknown`, and never automatically sends the turn again

#### Scenario: Crash before backend identity is known is not guessed
- **WHEN** creation dies before a valid backend Session id is captured
- **THEN** the Session becomes failed with a typed missing-resume-identity diagnostic and no replacement identity is invented

#### Scenario: Unattachable surviving tree is cleaned before recovery
- **WHEN** startup finds a positively-owned old process tree whose pipes cannot belong to the replacement daemon
- **THEN** Rasen terminates and awaits that exact tree before opening another generation, then classifies any unfinished turn by its durable request state

### Requirement: Cancel, restart, and retire control exact process generations
Rasen SHALL expose bounded cancel, restart, and retire operations for hosted Sessions. Control intent SHALL be recorded before signalling. Process-tree cleanup SHALL attempt graceful termination and force termination after a grace period when the exact tree has not closed. Capacity and writer ownership SHALL be released only after observed close. Restart SHALL require no live owner, a known backend Session id, and the original cwd. Retire SHALL be terminal.

#### Scenario: Cancel reaps a resistant process tree
- **WHEN** a caller cancels an active Session whose backend process or descendant ignores graceful termination
- **THEN** forced tree termination occurs after the grace period, the host waits for close, and the request is recorded cancelled or ambiguous according to observed backend evidence

#### Scenario: Restart opens a new exact generation
- **WHEN** an idle or interrupted Session has no live owner and has a valid backend Session id and cwd
- **THEN** restart increments generation and opens the exact backend Session without replaying the previous input

#### Scenario: Live owner blocks restart
- **WHEN** restart is requested while the exact Session still has a live writer/process owner
- **THEN** restart returns `session-busy` and neither displaces the owner nor spawns another generation

#### Scenario: Retired Session never wakes again
- **WHEN** retirement completes and a later caller executes or restarts that Session
- **THEN** the host returns `session-retired` and starts no process

### Requirement: Stream protocol handling is bounded, deterministic, and injection-safe
The production backend SHALL receive turn content over stdin using its structured stream input, never by concatenating prompt text into a shell command or durable argv. The host SHALL decode UTF-8 and NDJSON across arbitrary chunk boundaries, accept one validated init identity and one terminal result for the active request, and bound input, line, output, diagnostic, and wall-clock sizes. Malformed, oversized, duplicate-terminal, identity-mismatched, or out-of-order protocol events SHALL produce typed failure and cleanup rather than partial success.

#### Scenario: Fragmented multibyte protocol succeeds
- **WHEN** valid init and result events arrive split across arbitrary byte boundaries, including inside a multibyte character
- **THEN** the host reconstructs the events exactly and returns one valid turn receipt

#### Scenario: Malformed or oversized event fails safely
- **WHEN** a backend emits malformed JSON or exceeds a configured event/output bound
- **THEN** the host returns a typed protocol/output-limit failure, retains only bounded sanitized diagnostics, and terminates the affected generation

#### Scenario: Duplicate terminal result is not double-settled
- **WHEN** a backend emits more than one terminal result for the active request
- **THEN** the host records no second success, reports protocol violation, and does not advance another request

#### Scenario: Metacharacters and multiline input remain data on every platform
- **WHEN** turn content includes quotes, newlines, Unicode, shell metacharacters, or option-like prefixes on Windows, Linux, or macOS
- **THEN** the complete content reaches backend stdin as data, no additional command is executed, and the input is absent from process argv

### Requirement: Session CLI exposes one-receipt lifecycle control through the resident daemon
The CLI SHALL provide `rasen session exec`, `list`, `inspect`, `cancel`, `restart`, and `retire`. `exec` SHALL create when no Session id is supplied and wake the exact Session when one is supplied. Machine-oriented operations SHALL emit exactly one JSON receipt with the stable Session id, request id where applicable, host state, and typed result/failure. The CLI SHALL validate ids, backend name, prompt-file size, cwd, and bounds before contacting a backend. It SHALL adopt or start the identified same-version local daemon and SHALL never run a supposedly resident transport inside the short-lived caller process.

#### Scenario: Fresh exec and wake return stable receipts
- **WHEN** a user runs `session exec` for a new turn and later runs it with the returned Session id
- **THEN** each command emits one parseable receipt and both receipts name the same Session

#### Scenario: Invalid input starts nothing
- **WHEN** a command receives an invalid id, missing/oversized prompt file, unavailable cwd, invalid timeout, or unknown backend
- **THEN** it emits one typed invalid-input receipt, exits non-zero, and starts no backend process

#### Scenario: Caller exit does not end the hosted Session
- **WHEN** `session exec` completes and its CLI process exits while the hosted Session is idle
- **THEN** the resident daemon retains ownership and a later list/inspect/wake observes the Session

### Requirement: Host outcomes never become canonical execution or trust authority
The Session host SHALL publish lifecycle/turn outcomes to its caller without directly claiming an Action, mutating a canonical Run/Record, writing trusted completion evidence, or accepting a signing private key. A host result SHALL remain untrusted execution input until a later authoritative executor validates and commits it.

#### Scenario: Successful turn leaves canonical Run unchanged
- **WHEN** a hosted Session completes a turn while no Action executor is involved
- **THEN** host lifecycle/result facts are returned and recorded, but no canonical Run/Record or EvidenceStore completion is created or mutated

#### Scenario: Signing material has no host input or output path
- **WHEN** host command, registry, wire, and diagnostics shapes are inspected
- **THEN** none accepts, stores, or returns a signing private key or trusted-producer credential

### Requirement: Deterministic protocol replay covers cross-platform lifecycle faults
The repository SHALL provide deterministic protocol/process fixtures that exercise the same host interface and spawn path as the production adapter without requiring a network or account. The fixtures SHALL cover multi-turn success, protocol fragmentation, delayed/duplicate/malformed output, failure before and after init/input, stale ownership, descendant processes, cancellation resistance, and restart. Path expectations SHALL use canonical platform-aware construction. This child SHALL execute real registry/process lifecycle gates on its current host and deterministically inject every defined Windows and POSIX platform branch. A non-host platform SHALL be recorded honestly as deferred remote evidence rather than treated as a child-local blocker or represented as real OS execution. ECP-8 SHALL own the final actual Windows, Linux, and macOS remote CI matrix.

#### Scenario: Replay produces the same lifecycle from the same script
- **WHEN** a named protocol script is executed repeatedly in isolated temporary directories
- **THEN** it yields the same ordered request digests, protocol events, lifecycle transitions, and terminal classification aside from explicitly normalized ids/timestamps/pids

#### Scenario: Current-host gates exercise real operating-system behavior
- **WHEN** the child verification suite runs on its available host platform
- **THEN** it executes the real registry, process spawn, protocol, cancellation, and process-tree lifecycle gates on that host

#### Scenario: Non-host platform branches remain deterministic and explicit
- **WHEN** Windows-specific or POSIX-specific behavior cannot execute on the current host
- **THEN** injected deterministic fixtures exercise the corresponding defined branches and the evidence identifies them as branch simulations rather than real execution on the unavailable platform

#### Scenario: Portfolio delivery closes the real platform matrix
- **WHEN** this child reaches local ship and archive without one or more non-host platforms being available
- **THEN** the missing actual platform runs are recorded as ECP-8 remote evidence obligations and do not block this child's local terminal lifecycle

#### Scenario: Network absence does not skip correctness gates
- **WHEN** tests run without backend credentials or network access
- **THEN** all registry, protocol, recovery, single-flight, cwd, and process-tree correctness gates still execute against deterministic fixtures
