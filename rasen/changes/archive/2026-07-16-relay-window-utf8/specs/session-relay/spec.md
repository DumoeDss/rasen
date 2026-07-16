## MODIFIED Requirements

### Requirement: Cross-platform successor launch permissions
The successor launch SHALL bypass permission prompts on every supported platform and for a Codex-hosted relay LEAD, so an authorized unattended relay is never blocked by an approval prompt regardless of host. For a Claude Code successor the launch SHALL use `claude --dangerously-skip-permissions` on Windows, macOS, and Linux (the flag placed before shell quoting/encoding so the delivered command is `claude --dangerously-skip-permissions "$(<bootstrap prompt>)"`). For a future Codex-hosted relay LEAD, the interactive resume/fork relay primitives SHALL carry the verified full-access flag `--dangerously-bypass-approvals-and-sandbox` (accepted by `codex resume` and `codex fork`), documented as the Codex analogue of `--dangerously-skip-permissions`.

The successor launch SHALL ALSO deliver the bootstrap prompt free of character-encoding corruption and produce a window that renders CJK output correctly, regardless of the machine's ANSI codepage or user profile. On Windows the launch command SHALL read the bootstrap prompt as UTF-8 (not the system ANSI codepage) and SHALL set the successor console to UTF-8 before starting the CLI — both applied inline in the launched command so they hold even when the shell is started without loading a user profile. This same UTF-8 console setup SHALL apply to a future Codex-hosted relay window on Windows, keeping the two host recipes consistent.

#### Scenario: Each platform launch bypasses permission prompts
- **WHEN** a relay spawns a Claude Code successor on Windows, macOS, or Linux
- **THEN** the platform launch command SHALL invoke `claude --dangerously-skip-permissions`, with the flag applied before any base64 (`-EncodedCommand`) or shell-quote wrapping so the successor actually receives it

#### Scenario: Codex-hosted relay guidance
- **WHEN** the workflow documents the relay primitives for a future Codex-hosted LEAD
- **THEN** it SHALL record that `codex resume`/`codex fork` carry `--dangerously-bypass-approvals-and-sandbox` for the same unattended full-permissions outcome, as the documented Codex equivalent of the Claude flag

#### Scenario: Windows successor receives CJK bootstrap prompt intact
- **WHEN** a relay spawns a Windows successor on a machine whose ANSI codepage is not UTF-8 (e.g. a Chinese-locale machine at codepage 936) and the bootstrap prompt contains CJK text
- **THEN** the launch command SHALL read the prompt as UTF-8 so the successor receives the intact CJK text rather than mojibake produced by decoding UTF-8 bytes as the ANSI codepage

#### Scenario: Windows successor console renders CJK output
- **WHEN** a Windows successor window is launched and the successor CLI emits CJK output
- **THEN** the launch command SHALL have set the successor console to UTF-8 inline (without depending on a user profile, since the shell is launched with the profile suppressed) so that CJK output renders correctly

#### Scenario: Encoding fix holds without a user profile
- **WHEN** the Windows relay shell is started with its user profile suppressed
- **THEN** the UTF-8 read encoding and console setup SHALL still take effect because they are carried inline in the launched command rather than relying on profile configuration
