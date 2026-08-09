## ADDED Requirements

### Requirement: One Canvas-authored v2 Definition drives the canonical Run

Rasen SHALL be able to launch the exact connected Definition v2 value that a user creates from a blank Canvas and saves through Management when that value contains a Custom Composite bounded loop and a paired FanOut/Join. Authoritative preparation, canonical serialization, execution-profile freezing, immutable lowering, and launch SHALL consume that saved source without translating it into a second Definition or plan model. The source, capability, policy, plan, and profile digests shown at each boundary SHALL remain stable until the user makes a semantic edit.

#### Scenario: Saved loop-plus-parallel definition launches unchanged
- **WHEN** a user starts from blank Canvas, uses visible controls to create and connect a Custom Composite `BoundedLoop`, required FanOut member, paired Join, and successful Finish path, validates it, and saves it through Management
- **THEN** Management detail SHALL return the same authored meaning and preparation digests
- **AND** a reconciler launch SHALL freeze an immutable plan derived from that saved source with the same source, capability, policy, and plan digests
- **AND** the Run SHALL retain stable `RunId`, `ActionId`, and `InvocationId` values for its committed identities

#### Scenario: Semantic wiring edit changes only authoritative digests
- **WHEN** a typed connection in the saved Definition is intentionally changed and the Definition is prepared and saved again
- **THEN** the source and plan digests SHALL reflect that semantic change and stabilize on the next no-op reload
- **AND** no UI-local or runtime-local serializer SHALL provide a competing digest

### Requirement: The public completion seam records trusted effect and infrastructure observations

The public versioned completion seam SHALL accept its declared `effect-observation` and `infrastructure-observation` variants for the exact active action, verify their receipt digest, actor attestation, invocation, evidence, and effect identity, and commit them through the canonical immutable Record. An observation SHALL update only its owned action/effect state; it SHALL NOT fabricate a domain result or advance work whose required effects remain unresolved. Identical replay SHALL be idempotent, while a conflicting or malformed observation SHALL fail without changing the Record.

#### Scenario: Trusted workspace effect is observed before domain success
- **WHEN** a granted workspace-writing action performs a scoped effect and a trusted host submits the matching effect observation with actual evidence through `pipeline complete`
- **THEN** the canonical Record SHALL mark that exact effect with the observed status and receipt
- **AND** a later valid domain result for the same `ActionId` SHALL be allowed to settle through the ordinary reconciler path

#### Scenario: Domain success before a required effect fails closed
- **WHEN** a caller submits a successful domain result while a required effect for that action remains admitted and unobserved
- **THEN** completion SHALL be rejected without changing the Record version or action result
- **AND** the same action SHALL remain exactly recoverable for a valid observation and completion

#### Scenario: Conflicting observation does not mutate the Run
- **WHEN** an observation names the wrong effect, action, invocation, actor binding, or receipt digest, or conflicts with an already committed receipt
- **THEN** the public completion seam SHALL reject it with an actionable contract error
- **AND** subsequent status SHALL show the same Record head and outstanding identity as before the request

#### Scenario: Infrastructure failure remains distinct from domain failure
- **WHEN** the trusted host submits a valid infrastructure observation for an active action
- **THEN** the Record and projected view SHALL retain the infrastructure-failed classification and adapter evidence
- **AND** Rasen SHALL NOT rewrite it as a domain `failed` result

### Requirement: A canonical Run recovers deterministically in fresh processes

Every committed boundary of the Canvas-authored loop-plus-parallel Run SHALL be recoverable by a new process from the filesystem-backed plan and Record. Fresh CLI processes SHALL derive the same outstanding waits/actions and next reconciler decision from the stored head, and SHALL preserve exact Run, Action, effect, and plan identities. In-memory objects, private reducer mutation, or a JSON-only plan replay SHALL NOT count as fresh-process acceptance evidence.

#### Scenario: Resume after a loop action and before Join settlement
- **WHEN** one process launches the Run and commits at least one bounded-loop action/effect, then exits before the required parallel member and Join have settled
- **THEN** a new process SHALL load the same sealed plan and canonical Record from disk
- **AND** status/resume SHALL expose the same exact outstanding identity and grant only the deterministic next action
- **AND** later fresh processes SHALL be able to complete the required member and reach the declared terminal outcome

#### Scenario: Repeated inspection is non-mutating
- **WHEN** multiple fresh processes inspect the same committed Run without submitting a control or completion
- **THEN** every process SHALL report the same Record version, identifiers, digests, waits, and projected sections
- **AND** inspection SHALL not advance or rewrite the Run

### Requirement: Loop-plus-parallel completion and failure are fail-closed across product planes

The connected Run SHALL reach success only after its bounded loop exits through the authored domain mapping, its FanOut condition selects the declared required member, that member completes with all required effects observed, the paired Join proceeds, and the authored Finish is reached. A malformed FanOut result or failed required member SHALL never be treated as optional or allow the success path. CLI status, Management Run detail, and Operations SHALL consume the same canonical `ChangeRunView` and agree on identifiers, action/effect state, loop lifecycle, parallel membership/Join state, waits, controls, and terminal meaning.

#### Scenario: Successful Run has one cross-plane explanation
- **WHEN** the trusted host drives every granted action and effect of the saved Definition to its authored success outcome through public CLI/facade commands
- **THEN** the canonical Run SHALL reach the declared successful terminal outcome
- **AND** CLI JSON and Management Run detail at the same Record version SHALL be identical for the canonical view fields and versioned sections
- **AND** Operations SHALL render those same root, loop, parallel, action/effect, wait, and terminal facts without recomputing lifecycle or Join decisions

#### Scenario: Required parallel member failure blocks success
- **WHEN** FanOut selects its declared required member and that member completes with a failed domain result after its effect receipt is recorded
- **THEN** the reconciler SHALL apply the required-member/Join failure contract and SHALL NOT reach the successful Finish
- **AND** CLI, Management, and Operations SHALL agree on the failed or escalated terminal meaning and the exact member that caused it

#### Scenario: Required member cannot be suppressed by malformed selection
- **WHEN** a successful FanOut completion omits or marks inactive a member declared required by the frozen plan
- **THEN** completion SHALL be rejected before Record mutation
- **AND** the Run SHALL retain the original FanOut action as the outstanding recoverable identity

#### Scenario: Windows and POSIX process paths preserve the same Run
- **WHEN** the vertical journeys create their isolated project, evidence, plan, and Run-store paths on Windows, macOS, or Linux
- **THEN** every process SHALL resolve the same canonical artifacts using platform-native paths
- **AND** path separator or filesystem case behavior SHALL not change Definition bytes, digests, identities, or projections
