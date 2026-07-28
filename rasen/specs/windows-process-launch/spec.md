# windows-process-launch Specification

## Purpose
Define how the session supervisor launches the agent CLI on Windows across the executable shim types npm installs produce (native `.exe` vs. `.cmd`/`.bat`), so a stock installation can start a supervised session without command injection or truncation risk.
## Requirements
### Requirement: Agent CLI spawn works across Windows executable shim types

The session supervisor SHALL launch the resolved agent CLI on Windows regardless of which executable form the install provides — a native `.exe`, or an npm-generated `.cmd`/`.bat` shim — so that a stock installation (including npm-global installs, which create `claude.cmd`) can start a supervised session. The supervisor SHALL NOT fail a launch merely because the resolved binary is a `.cmd`/`.bat` shim.

When the resolved binary is a `.cmd` or `.bat` on Windows, the supervisor SHALL invoke it through the command interpreter (`ComSpec`/`cmd.exe`) with the command line escaped for `cmd.exe`'s own re-parsing, so that the task/prompt argument — which may contain shell metacharacters and originates from a request — is delivered to the agent CLI as one inert literal argument and can never break out to execute an additional command (no command injection). Node's default per-argument quoting is insufficient for this, because `cmd.exe /S /C` re-parses the command line as shell grammar and a literal `"` toggles its quote state; the supervisor SHALL therefore apply `cmd.exe`-aware escaping and pass the arguments verbatim (not re-quoted by the runtime). The escaping SHALL remain correct even when the shim re-expands its arguments through a second `cmd.exe` parse (as npm-generated `.cmd`/`.bat` shims do when proxying `%*` to node). On POSIX, and for a native `.exe` on Windows, the spawn SHALL remain a direct `shell:false` invocation of the binary.

A raw newline (line feed or carriage return) cannot be represented as argument data through `cmd.exe`, which truncates its command line at the first newline. When the resolved binary is a `.cmd`/`.bat` shim on Windows and the task/prompt argument contains a newline, the supervisor SHALL fail the launch loudly (surfaced as `503 agent_cli_unavailable` with a message naming the multi-line limitation) rather than spawn a silently truncated command line. This restriction SHALL apply ONLY to the Windows shim transport: on POSIX and for a native `.exe`, a newline is passed to the agent CLI literally and multi-line task text SHALL remain accepted.

`503 agent_cli_unavailable` SHALL remain reserved for the case where no agent CLI can be resolved (or an explicit override does not exist); it SHALL NOT be produced as a side effect of the host's executable-shim type.

#### Scenario: npm-installed `.cmd` shim launches a session on Windows

- **WHEN** the agent CLI resolves to a `.cmd` (or `.bat`) shim on Windows and a session launch is requested
- **THEN** the supervisor spawns the shim through the command interpreter without a shell over the args, the child process starts, and the launch resolves successfully (not `503 agent_cli_unavailable`)

#### Scenario: task text with shell metacharacters is not interpreted (command injection prevented)

- **WHEN** a session is launched on Windows via a `.cmd`/`.bat` shim and the task/prompt argument contains `cmd.exe` metacharacters — including a literal double-quote `"` alongside a command separator such as `&`, `&&`, `|`, `%VAR%`, `^`, or parentheses (e.g. `foo" & echo INJECTED>PWNED.txt & "bar`)
- **THEN** no additional process or command is executed by the interpreter (no injected side effect), AND the entire metacharacter-bearing prompt is delivered to the agent CLI as a single intact literal argument — even though the shim re-expands `%*` through a second `cmd.exe` parse

#### Scenario: newline in task text is rejected on the Windows shim, accepted on POSIX

- **WHEN** a session launch supplies task text containing a newline (`\n` or `\r`)
- **THEN** on Windows via a `.cmd`/`.bat` shim the launch fails loudly with `503 agent_cli_unavailable` naming the multi-line limitation, and no (truncated) child process is spawned
- **AND WHEN** the same newline-bearing task is launched on POSIX (or a native `.exe`), the session launches normally with the multi-line text delivered to the agent CLI intact

#### Scenario: no resolvable agent CLI still yields 503

- **WHEN** no agent CLI can be resolved (no override and nothing on PATH)
- **THEN** the launch resolves with `503 agent_cli_unavailable`, unchanged from prior behavior and independent of platform

#### Scenario: POSIX and native `.exe` spawn unchanged

- **WHEN** the resolved agent CLI is a POSIX executable, or a native `.exe` on Windows
- **THEN** the supervisor spawns the binary directly with `shell:false`, exactly as before this change

### Requirement: Process-tree termination reaps the interpreter-hosted child on Windows

When a Windows session was launched through the command interpreter (so the tracked process is the interpreter and the agent CLI runs as its child), tree termination SHALL reap the whole tree — the interpreter and its descendant agent process — so that killing, shutdown, and concurrency-slot release observe the child actually closing rather than leaking the descendant.

#### Scenario: killing an interpreter-hosted session reaps the descendant

- **WHEN** a Windows session launched via `cmd.exe` is killed or the server shuts down
- **THEN** process-tree termination ends both the interpreter and its agent-CLI descendant, and the session finalizes on the observed close

### Requirement: Background child processes never flash a console window on Windows

Every non-interactive child process the tool starts on Windows — including the per-space enablement apply's `update` subprocess, the management API's CLI bridge subprocesses, supervised agent CLI launches, daemon and browser launches, git helpers, and version probes — SHALL be started with the console window hidden, so no console window flashes or lingers on the user's desktop. The sole exception is a child process that is interactive by design (the configuration editor spawned into the user's editor), which SHALL keep its window. The codebase SHALL enforce this with an automated guard that fails when a child-process call site neither hides the window nor appears on the explicit interactive allowlist, so future spawn sites cannot silently regress.

#### Scenario: Profile switch apply is windowless

- **WHEN** a space's profile is switched through the UI on Windows and the bounded `update` subprocess runs
- **THEN** no console window appears during the apply

#### Scenario: Interactive editor keeps its window

- **WHEN** the user opens the configuration editor path that spawns their editor
- **THEN** that child process is not hidden

#### Scenario: New spawn sites are guarded

- **WHEN** the test suite runs against a source tree containing a child-process call site that neither hides the console window nor is on the interactive allowlist
- **THEN** the guard test fails naming the offending site

