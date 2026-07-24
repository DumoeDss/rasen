## ADDED Requirements

### Requirement: Audit skill covers the Zed runtime
The `rasen-audit` skill SHALL cover Zed sessions: when a user's session was run through Zed, the skill SHALL help them identify it — by thread id or by the session's first command — route to `rasen agent audit --runtime zed`, and interpret the resulting report in Zed's own terms (the token totals Zed stores and its cache-effectiveness signal) together with its disclosed limits, rather than describing it with the Claude- or Codex-specific vocabulary (billed-equivalent, churn-cause, per-request timeline) that does not apply. It SHALL disclose that Zed support is experimental before relying on it.

#### Scenario: User identifies a Zed session by its first command
- **WHEN** a user invokes the skill for a Zed session and knows only the first command they gave that session
- **THEN** the skill SHALL help resolve the thread from that first-command text and run `rasen agent audit --runtime zed` for it

#### Scenario: Skill routes Zed sessions to the Zed runtime
- **WHEN** a user's session was run through Zed rather than Claude Code or Codex CLI
- **THEN** the skill SHALL recognize this and route to `rasen agent audit --runtime zed` accordingly

#### Scenario: Skill interprets a Zed report in its own terms
- **WHEN** a user asks the skill to explain a generated Zed report
- **THEN** the skill SHALL explain Zed's stored token totals and cache-effectiveness ratio and state the report's disclosed limits (no reasoning-output/cache-write totals, retained-entry request counts, descendant-only scope)
- **AND** SHALL NOT describe it with Claude-specific billed-equivalent or churn-cause vocabulary
