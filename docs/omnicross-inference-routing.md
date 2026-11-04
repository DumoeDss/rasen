# OmniCross inference routing

Rasen can route different Pipeline stages through one installed agent tool while selecting different Providers and accounts per stage. OmniCross runs as one resident loopback daemon; Rasen creates a short-lived route lease for each agent attempt and releases it afterward.

This is opt-in. A Pipeline without `inference` keeps its existing native/bridge behavior.

## What users configure

Configure upstream Providers and accounts once in OmniCross. Do **not** create an OmniCross downstream API key, downstream binding, or persistent GatewayBinding for Rasen. Rasen derives an ephemeral downstream route from each stage's runtime, upstream, and effective model.

Start the compatible OmniCross daemon, then configure its loopback control origin and put the Admin credential in an environment variable:

```powershell
rasen config set --scope global omnicross.endpoint http://127.0.0.1:8765
rasen config set --scope global omnicross.controlTokenEnv OMNICROSS_ADMIN_TOKEN
rasen config set --scope global omnicross.requestTimeoutMs 5000
rasen config set --scope global omnicross.leaseTtlSeconds 600
$env:OMNICROSS_ADMIN_TOKEN = '<admin-token>'
```

The endpoint must be an unauthenticated `http:` loopback origin (`localhost`, `127.0.0.0/8`, or `[::1]`). The token value is never written to Rasen config; only its environment-variable name is persisted.

## Pipeline example

`model` keeps the normal Rasen precedence chain. `inference` only selects OmniCross and a configured upstream:

```yaml
version: 1
name: multi-provider-delivery
stages:
  - id: plan
    skill: rasen-propose
    role: planner
    runtime: claude
    model: claude-opus-4-1
    inference:
      broker: omnicross
      upstream:
        kind: account
        providerId: anthropic
        accountId: planning-account

  - id: implement
    skill: rasen-apply-change
    role: implementer
    runtime: claude
    model: claude-sonnet-4-6
    requires: [plan]
    inference:
      broker: omnicross
      upstream:
        kind: account-group
        providerId: anthropic
        group: implementation

  - id: ship
    skill: rasen-ship
    role: shipper
    runtime: codex
    model: deepseek-chat
    requires: [implement]
    inference:
      broker: omnicross
      upstream:
        kind: provider
        providerId: deepseek
```

Supported upstream selectors are `provider`, `account`, `account-group`, and `account-pool`. Provider URLs, wire formats, transformers, API keys, and other transport details belong to OmniCross, not Pipeline YAML.

Inspect the final route before running:

```powershell
rasen pipeline show multi-provider-delivery --for-execution --json
```

A routed stage always uses an isolated `claude-print` or `codex-exec` process, including same-runtime routes. This is required because a native subagent cannot receive a per-stage environment safely.

## Failure and recovery behavior

- Configuration, Admin authentication, upstream/model/format, descriptor, or daemon failures stop before the agent binary spawns. Rasen never falls back to the user's Claude/Codex login.
- A long attempt renews its lease. If renewal can no longer prove the frozen route, Rasen terminates the full child process tree and reports `route-lost` / `route-lease-lost`.
- Fresh and exact-session resume attempts receive a new lease and token while retaining the frozen runtime, upstream, model, and endpoint identity.
- Editing the Pipeline after admission does not retarget an in-progress routed Action. Remove `inference` only for stages/runs that have not already frozen routed authority.
- Release is best effort. A release failure produces a redacted warning; daemon TTL remains the cleanup backstop.

## Security guarantees

- Admin and route tokens never appear in argv, Pipeline YAML, inference files, frozen Actions, run-state, evidence, or telemetry.
- Codex receives only `OMNICROSS_CODEX_ROUTE_TOKEN` plus an invocation-local `omnicross` Responses provider with response storage disabled. Rasen does not read or write `config.toml` or `auth.json`.
- Claude receives only the allowlisted proxy URL, route auth token, frozen model, and documented non-secret sentinel. Rasen does not modify Claude settings or credentials.
- Concurrent stages own independent leases and child environments; release or failure of one route does not mutate another.

## Developer integration map

The deep module is `src/core/omnicross/`: versioned contracts, loopback config resolution, bounded HTTP client, descriptor reduction, and the lease lifecycle. `rasen agent dispatch --inference-file` consumes a bounded credential-free `rasen.inference/1` file. Canonical frozen Actions use `frozen-action-executor/omnicross-lifecycle.ts`; both paths call the same lifecycle wrapper and runtime runners.

The minimum daemon contract is the versioned `omnicross.route-lease.request/1`, `omnicross.route-lease/1`, metadata, release, and `omnicross.error/1` envelopes described in [the architecture contract](architecture/omnicross-inference-routing.md). Until OmniCross publishes a released API version carrying those endpoints, treat real-daemon compatibility as experimental and use the opt-in smoke procedure below.

See [Real compatibility smoke](experiments/omnicross-real-smoke.md) for non-CI validation.
