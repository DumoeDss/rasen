# Planning context: OmniCross inference routing

## User intent

The user explicitly selected `$rasen-auto small-feature`, requested a new isolated worktree and a development
branch based on `dev/0.2.0`, and asked implementation to begin from
`docs/architecture/omnicross-inference-routing.md`.

The product intent is:

- Run one long-lived OmniCross daemon instead of starting a proxy for every workflow stage.
- Users configure only OmniCross upstream resources: BYO Providers/API keys and subscription accounts,
  account groups, or account pools.
- A Rasen workflow stage selects an agent runtime (`claude` or `codex`), an OmniCross upstream reference,
  and a model.
- Rasen automatically requests an ephemeral Route Lease that acts as the stage's downstream API key and
  in-memory binding; users do not manually create a persistent Gateway Key or GatewayBinding for Rasen.
- OmniCross derives the ingress and transformer chain from the runtime and selected upstream.
- Rasen launches and owns the Claude/Codex child process, while OmniCross owns upstream credentials,
  routing, protocol conversion, route token lifecycle, and account/key scheduling.

## Authoritative design input

Read `docs/architecture/omnicross-inference-routing.md` in this worktree before proposing. It is the primary
design baseline and was copied byte-for-byte from the user's source checkout when this worktree was created.

The companion OmniCross-side implementation requirements live in the sibling OmniCross repository at
`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia\omnicross\docs\design\rasen-managed-route-lease-requirements.md`.
Rasen implementation must consume that contract but must not edit the OmniCross repository in this change.

## Known Rasen seams

- `src/core/codex/invocation.ts` already defines `ModelProviderOverride` with `name`, `baseUrl`, `wireApi`,
  and `envKey`, and emits per-invocation `-c model_providers.*` overrides.
- `src/core/codex/runner.ts` and `src/core/claude/runner.ts` already accept child-process environments.
- The missing work includes typed OmniCross configuration/discovery and a Route Lease client, workflow/stage
  inference schema and frozen execution-profile semantics, runner/dispatch wiring, lease lifecycle handling,
  secret redaction, failure classification, resume behavior, tests, and architecture-index updates.
- Rasen must use the Codex custom-provider `env_key` contract and never read or modify Codex `auth.json` or
  global `config.toml` for stage routing.

## Constraints and decisions

- Work only in the new worktree on branch `feat/omnicross-inference-routing`, based on `dev/0.2.0`.
- Pipeline is explicitly `small-feature`; do not decompose or substitute another pipeline.
- Gate policy is `off` from global config; auto-approved gates must still be recorded.
- This Rasen change must not implement the OmniCross daemon endpoints themselves.
- Preserve existing workflows when OmniCross inference is not configured.
- Do not persist route tokens in Run Record, receipts, logs, evidence, telemetry, config files, or argv.
- Resume preserves the frozen logical route but may acquire a new ephemeral lease/token.
- Unknown/expired routes and broker errors fail closed; do not silently fall back to a user's default CLI login.
- Author and verifier must remain separate through the pipeline.

## Planning focus

Produce a coherent small-feature slice that is implementable and testable in this repository. If the full design
contains later productization work, distinguish the minimum end-to-end Rasen integration from explicitly deferred
follow-ups instead of weakening the core security and lifecycle invariants.
