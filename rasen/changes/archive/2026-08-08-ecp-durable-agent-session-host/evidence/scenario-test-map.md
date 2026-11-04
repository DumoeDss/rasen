# Spec scenario to evidence map

| Spec area | Automated evidence |
| --- | --- |
| Stable create/wake identity; replacement driver | `host.test.ts`; built `cli-e2e/session-host.test.ts` with two short-lived CLI drivers and one resident ProcessScope |
| Unsupported backend and invalid public fields | `contracts.test.ts`; `host.test.ts`; `hosted-sessions-api.test.ts` |
| Canonical cwd, alias, mismatch, missing checkout | `host.test.ts`; `registry.test.ts`; existing Claude session-state/runner tests |
| Single-flight and request idempotency | `host.test.ts`; `ownership.test.ts`; real cross-process registry lease contender in `registry.test.ts`; pruned-id Bloom mutation discriminator in `mutation-discriminator.md` |
| Atomic registry, permissions, corruption, retention | `registry.test.ts`, including all seven injected mutation boundaries and injected Windows rename retries |
| Exact idle resume and generation | `host.test.ts`; Claude exact `--resume` assertion in `claude-backend.test.ts` |
| Active crash ambiguity/no replay | `host.test.ts` startup sent-turn case, cancel/retire late-result fences, and transport-close-on-cancel mapping; built CLI E2E asserts the waiting caller receives `turn-outcome-unknown` |
| Opaque stale-scope cleanup / uncertain owner refusal | `process-scope-contract.test.ts`; v1 migration tests; `host.test.ts` closed, foreign/live-or-uncertain reconciliation cases |
| Bounded NDJSON/UTF-8/event ordering | `protocol.test.ts`; `claude-backend.test.ts` malformed, oversized, delayed, crash, identity-drift and duplicate scripts |
| Metacharacters/CJK over stdin, no prompt argv | production spawn unit test; real `.cmd` replay in `claude-backend.test.ts`; built CLI daemon journey |
| Authenticated Management compatibility | `hosted-sessions-api.test.ts`; existing `sessions-api.test.ts` 22/22; `server-shutdown.test.ts` |
| Daemon adoption, foreign-listener refusal, cleanup | built `daemon-lifecycle.test.ts` 4/4; CLI Session journey; server shutdown retry; retained prepared/live authority cases; real Windows controller-death Job containment plus duplicate-handle mutation |
| Native package trust and activation ordering | `process-capsule-package.test.ts`; `process-capsule-native.test.ts`; exact hash/platform/arch/capability resolver; inertness and early-activation mutation |
| No Run/trust mutation or signer custody | `security-boundary.md` static scan; module import graph; registry sensitive-shape checks |
| Additive UI wire compatibility | UI typecheck; full UI 651/651; production UI build |

## Named environment-limited observation

The current host was Windows. Real Windows process spawn, `.cmd` shim,
registry, daemon, CLI, and tree-kill paths ran. Injected Windows rename/sharing
and process-tree branches ran deterministically. No actual Linux/macOS machine
was available; actual non-host platform execution remains an explicit ECP-8
remote CI obligation rather than a claimed child result.

## Deliberate contract boundary

Request idempotency is exact within retained history. The registry retains the
newest 64 settled requests plus every unfinished or ambiguous request. Terminal
ids removed from detailed history enter a fixed-size Bloom tombstone: a hit is
a safe `turn-outcome-unknown` refusal, including possible false positives, and
inserted ids have no false negatives. The discriminator proves removing this
guard permits the forbidden second write.
