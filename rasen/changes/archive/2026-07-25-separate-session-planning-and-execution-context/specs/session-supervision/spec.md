## MODIFIED Requirements

### Requirement: Platform can launch a supervised agent session
The management server SHALL accept `POST /api/v1/sessions` with a JSON body `{ kind, task }` (plus optional `changeName`, `space`, `execution`, `timeoutMs`, `noOutputTimeoutMs`) and launch a headless agent session by spawning the `claude` CLI as a supervised subprocess in the server-resolved launch context. The spawned command SHALL be built entirely server-side from the whitelist entry for `kind` and the resolved launch context: a single prompt token composed of the entry's skill invocation followed by the task text, the non-interactive print flag, the skip-permissions flag, streaming JSON output, and any resolved attached planning-root option, using an argv array and no shell. On successful spawn the server SHALL respond 201 with the session record without waiting for the run to progress. The agent CLI binary SHALL be resolved server-side (environment override, then PATH); client input SHALL never directly provide the executable, a working directory, an attached directory, or an argv fragment.

#### Scenario: Launching a session spawns a real supervised run
- **WHEN** a client sends an authorized `POST /api/v1/sessions` with `kind: "auto"`, a valid task, and a valid launch context
- **THEN** the server responds 201 with a session record carrying a server-minted id, the kind, the task, resolved planning attribution, resolved cwd, and a live state, and a real agent CLI process is running in that cwd

#### Scenario: Option-like task text cannot inject flags
- **WHEN** a client submits a task that begins with `--` or contains shell metacharacters
- **THEN** the task is bound verbatim inside the single prompt token, no additional CLI option is parsed, and no shell interpretation occurs

#### Scenario: Task text is validated before spawning
- **WHEN** a client submits an empty task, a task exceeding the length cap, or a task containing control characters other than tab or newline
- **THEN** the server responds 400 with a validation error and spawns nothing

#### Scenario: Missing agent CLI degrades clearly
- **WHEN** no agent CLI binary can be resolved on the server machine
- **THEN** `POST /api/v1/sessions` responds 503 with error code `agent_cli_unavailable` and spawns nothing, while read endpoints continue to work

#### Scenario: Launching outside a project is rejected
- **WHEN** the server was launched outside any Rasen project and the request supplies no resolvable planning and execution selection
- **THEN** `POST /api/v1/sessions` responds 409 with error code `no_project` and no subprocess is spawned

### Requirement: Sessions carry a planning-space attribution derived from their working directory
Each supervised session SHALL record, at launch, the planning space selected for the run independently from its execution working directory. An explicit `space` selector SHALL become the record's planning attribution; when `space` is omitted, attribution SHALL be derived from the trusted launch-project cwd by the shared cwd-to-space rule of the planning-space-addressing capability. A repo with its own planning shape attributes to that project's space, a pointer repo attributes to the Store its config names, and a working directory with no derivable space leaves the session unattributed rather than failing the compatible launch. The attribution SHALL be frozen on the record and reported on every session read (`{ type, id, root }`), so it does not mutate retroactively if registries or pointers later change.

#### Scenario: Store-attributed session runs in a member
- **WHEN** a session launch explicitly selects planning space `store:team-store` and a valid member project as execution
- **THEN** the session record reports space `store:team-store` and reports the member project or selected linked worktree as its cwd

#### Scenario: Session launched in a pointer repo attributes to the store
- **WHEN** a compatible launch omits `space` while the daemon launch cwd is inside a repo whose config externalizes planning to registered Store `team-store`
- **THEN** the session record reports space `store:team-store` while its cwd remains the pointer repo

#### Scenario: Attribution survives later pointer changes
- **WHEN** a running session's repo changes its Store pointer after the session started
- **THEN** the session's recorded space is unchanged

#### Scenario: Unattributable cwd does not block launch
- **WHEN** a compatible omitted-space launch uses a working directory that yields no derivable space
- **THEN** the session launches normally and its record carries no space attribution

## REMOVED Requirements

### Requirement: Session launch accepts a space selector that sets the working directory
**Reason**: A planning-space root and the code execution root are distinct for a Store; using `space` as both values silently runs Store sessions in the wrong directory.

**Migration**: Project-space clients may continue omitting `execution`. Clients that explicitly launch in a Store must send `execution: "project:<registered-project-or-worktree-selector>"` or explicitly choose `execution: "planning"` for a planning-only run.

## ADDED Requirements

### Requirement: Session launch separates planning space from validated execution context
`POST /api/v1/sessions` SHALL treat `space` as planning attribution and `execution` as the runtime working-directory selection. `execution` SHALL accept `project:<selector>`, resolved through the registered-project selector contract (including a linked worktree of that project), or the explicit Store-only value `planning`. The server SHALL resolve and canonicalize all roots from current machine registry, filesystem, Git worktree, and Store-pointer facts before spawn; it SHALL NOT use an arbitrary client path as cwd. For an explicit project space, omitted execution SHALL use that resolved project/worktree root for compatibility. For an explicit Store space, omitted execution SHALL return 409 `execution_required` and spawn nothing. Unresolvable or currently invalid execution selections SHALL return a specific 4xx error and spawn nothing.

#### Scenario: Project-space launch stays compatible
- **WHEN** a client launches with `space=project:<id-or-worktree-root>` and omits `execution`
- **THEN** the subprocess starts in that resolved project or linked-worktree root and the session record reports the same project planning space

#### Scenario: Explicit Store launch requires an execution choice
- **WHEN** a client launches with `space=store:team-store` and omits `execution`
- **THEN** the response is 409 `execution_required`, neither the Store root nor any member is guessed, and no agent process is spawned

#### Scenario: Current Store member resolves to execution cwd
- **WHEN** a client launches with `space=store:team-store` and `execution=project:member-a`, where `member-a` is a live registered pointer project whose current `store:` declaration names `team-store`
- **THEN** the subprocess cwd is member A's canonical project root, the session planning attribution is `store:team-store`, and the launch succeeds

#### Scenario: Registered root disambiguates same-id Store clones
- **WHEN** two live registered Store members share a project id and `execution=project:<absolute-registered-root-b>` selects the second clone
- **THEN** the server resolves and revalidates that exact registered root, and the subprocess and Session cwd use clone B rather than the first same-id registry entry

#### Scenario: Selected member worktree resolves without becoming ownership
- **WHEN** `execution=project:<absolute-worktree-root>` names a live linked worktree of a registered member whose current pointer names the selected Store
- **THEN** the subprocess cwd is that worktree's canonical root and the Session records it as a runtime fact without creating or changing a durable project target

#### Scenario: Non-member or stale pointer is rejected
- **WHEN** the execution selector resolves to a project outside the selected Store, a project whose pointer changed, a dead root, or a worktree that no longer belongs to the registered member
- **THEN** the response is 409 `execution_unavailable` with an actionable message and no agent process is spawned

#### Scenario: Missing execution project is rejected
- **WHEN** `execution=project:<selector>` matches no registered project or linked worktree
- **THEN** the response is 404 `execution_not_found` and no agent process is spawned

#### Scenario: Planning-only Store run is explicit
- **WHEN** a client launches with `space=store:team-store` and `execution=planning`
- **THEN** the subprocess cwd is the Store's canonical planning root, the session is attributed to that Store, and no duplicate attached root is supplied

#### Scenario: Different project cannot execute for a project planning space
- **WHEN** a request selects project planning space A but its explicit execution selector resolves to project B
- **THEN** the server rejects the incompatible execution selection and spawns nothing

#### Scenario: Windows worktree paths compare canonically
- **WHEN** a project or worktree execution selector on Windows differs from its registered form only by supported path casing or separator representation
- **THEN** the server resolves the same registered project identity and uses the canonical Windows root without a false non-member rejection

### Requirement: A distinct planning root is attached to the supervised agent
When the resolved planning-space root differs from the resolved execution cwd, the server SHALL attach exactly that planning root to the headless Claude launch so the agent can read and update the selected space's Change, spec, and run-state artifacts while executing project commands from cwd. When the two roots are the same, the launch SHALL omit the redundant attachment. Attached roots SHALL be server-resolved and supplied as literal argv tokens on macOS, Linux, and Windows; the request SHALL NOT accept client-provided CLI argv or additional directories.

#### Scenario: Store planning root is attached to member execution
- **WHEN** a session is attributed to a Store and executes in one of its member projects
- **THEN** Claude starts in the member cwd with exactly the Store root supplied as its additional directory

#### Scenario: Planning-only run has no duplicate attachment
- **WHEN** the Store planning root is also the execution cwd because the user explicitly selected planning-only
- **THEN** the server supplies no redundant additional-directory option

#### Scenario: Only the planning root is attached
- **WHEN** a Store has multiple members and the session executes in member A
- **THEN** the Store planning root is attached and neither member B nor any other sibling member is added to the agent's accessible-directory argv

#### Scenario: Windows shim receives the attached root literally
- **WHEN** a Windows session launches through an npm `.cmd` or `.bat` shim and the canonical planning root contains command-interpreter metacharacters valid in a path
- **THEN** the entire root reaches Claude as the single literal value of the server-built additional-directory option and no injected command or extra argv token is executed
