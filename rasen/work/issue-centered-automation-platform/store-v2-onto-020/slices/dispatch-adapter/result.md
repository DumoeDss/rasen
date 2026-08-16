# Result: dispatch-adapter (L4)

**Status:** passed
**Outcome:** Multi-runtime dispatch on 0.2.0 goes through the `DISPATCH_ADAPTERS` registry
(locked decision D3 — no second hardcoded dispatch): SessionSupervisor and the management-api
resolve runtimes by adapter, omp runs as the fourth runtime with its own context reader, and
per-bridge isolation holds (D6/D7) — the codex entry deliberately declares no `binaryEnvVar`,
so the codex branch keeps this line's own `RASEN_CODEX_BIN` surface while every other runtime's
binary facts come from the registry.

Delivered as a direct git port in three commits: `7cb155c9` (core, riding the L3+L5 CI round),
`9cc328bf` ("stage the L4 core's type providers — the previous commit shipped consumers without
them"; the third silent narrow-`git add` drop on this branch, caught by CI), and the tail
`e61c499d` in PR #162 ("route the claude-print availability facts through DISPATCH_ADAPTERS").
PR #162 merged first-try green (`222eb0f6`).

## Evidence

- `src/core/runtimes/dispatch-adapters.ts` — the registry; claude declares
  `binaryEnvVar: 'RASEN_CLAUDE_BIN'`, codex declares none (documented in-source as
  playbook-owned, D7).
- `src/core/runtimes/context-readers.ts` / `session-stores.ts` — the omp runtime's context
  reader and session store (`id: 'omp'`).
- `src/commands/agent.ts` routes availability facts through `DISPATCH_ADAPTERS`
  (`claudeAdapter.binaryEnvVar`, `installHint`, `cliLabel`) with the codex branch explicitly
  keeping `RASEN_CODEX_BIN`.
- Post-merge review 2026-08-16: commit ledger verified (`7cb155c9`, `9cc328bf`, `e61c499d` all
  present with matching subjects); no hardcoded second dispatch found in the supervisor or
  management-api paths.

## Attempts / history

- 2026-08-13..16 - Core landed with PR #160 (including the type-provider CI round); the tail
  (claude-print facts) shipped separately as PR #162, first-try green.
- 2026-08-16 - Post-merge review verified the registry routing; slice closed `passed`.
