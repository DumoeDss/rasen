## Context

Step 1 (locked decision 11) reopened this child as an explicitly declared best-effort hosted provider, modelled on the comparison product's POSIX containment (`server/pkg/agent/proc_other.go` in multica, roughly 60 lines): own process group, group SIGTERM, grace, group SIGKILL, with escalation keyed off whole-group emptiness rather than leader exit. The LEAD attached non-negotiable honesty conditions: `exactCancel: false` and `scopeEmptyProof: false` declared visibly before a scope starts, and a cancel terminal of `cancelled / emptiness-unproven` - never "cleanly cancelled". The protected invariant is "the Record must not lie", not "processes must never leak".

Verified current-state facts this design rests on (checked 2026-08-07 in this worktree):

- The frozen common contract rejects subset providers. `registry.ts` (`src/core/session-host/process-authority/registry.ts:105-112`) and `manifest.ts` (`:61-62`, `:119`) hard-require the exact capability id `rasen-recursive-process-scope/1` plus the complete ordered ten-semantics list. The accepted `process-authority-provider` spec makes this a requirement ("Capability subset would weaken authority" rejects negotiation). A best-effort provider therefore cannot and must not register there.
- `RECURSIVE_PROCESS_SCOPE_SEMANTICS` (`src/core/session-host/process-authority/types.ts:25-36`) currently lists ten semantics and has two pending edits that have NOT landed: a `workload-non-escape` wording narrow (to "descendants the workload itself forks cannot escape"; wording only) and the `replacement-recovery` re-tier (criterion 4, moved to the upgrade path by Step 1). Decision D2 below is written to survive both.
- The hosted-session seam is `ProcessScope` (`src/core/session-host/process-scope.ts`): `prepare/inspect/terminate`, receipt vocabulary `closed | retained | uncertain`, and a live scope whose `closed` promise resolves with a proven scope-empty receipt. The host's close path (`src/core/session-host/host.ts:614-638`, `closeDurableProcess`) releases durable authority only from a `closed` receipt; anything else retains the session as live-or-uncertain.
- Construction sites: `createSessionHost` is invoked in `src/` only at `src/core/management-api/router.ts:642`; `createNativeProcessScope` at `router.ts:639` plus two internal default fallbacks (`host.ts:299`, `claude-backend.ts:395`) whose only reachable `src/` entry is `router.ts`. Host-native Tier A dispatch never enters ProcessScope.
- Governing decisions: locked decision 11 (daemon lifetime; no reattach, no identity revalidation; criterion-4 machinery on the upgrade path) and locked decision 12 (threat model is our own mistakes; janitor, not sandbox).

## Goals / Non-Goals

**Goals:**

- Cancellable macOS hosted sessions in 0.2.0 whose records are honest: declared limits before start, group-signal cancel with whole-group-emptiness-keyed escalation, and unproven-emptiness terminals.
- A release rule that lets a declared best-effort scope reach a terminal state without wedging the session and without fabricating a proven-empty receipt.
- Real macOS evidence exercising the production path, with mutation receipts for every guard.

**Non-Goals:**

- Exact recursive authority on macOS (0.3.0 research), Endpoint Security, VM approaches, minimum macOS version, entitlements, code signing.
- Replacement recovery, reattach, or identity revalidation after daemon death (upgrade path; decision 11).
- Any change to the frozen common provider contract, its registry/manifest validation, or the Linux/Windows providers.
- Registering this provider in the common process-authority registry.
- An edge into `ecp-native-process-capsule-closure` (deliberately cut by Replan 4; closure `dependsOn` stays `[linux, windows]`).

## Decisions

### D1: Integrate at the ProcessScope seam, not the frozen provider registry

The provider implements the `ProcessScope` interface directly and is selected for darwin hosted sessions at the existing construction sites. Alternatives considered:

- Register under `rasen-recursive-process-scope/1` with a semantics subset: rejected by the frozen registry and by the accepted spec's subset-rejection scenario - and it would be dishonest to try.
- Add a second, best-effort capability id to the common registry/manifest: additive in principle, but it edits exactly the files (`types.ts`, `registry.ts`, `manifest.ts`) that the pending `workload-non-escape`/`replacement-recovery` contract change targets, declares capability against a mid-flight contract, drags in publication phases that decision 11 makes inapplicable here, and still lands in the same host close path anyway (providers reach the host through the ProcessScope adapter). All cost, no benefit for a tier with one platform.
- Chosen: ProcessScope-level integration with an additive tier declaration. Zero textual or semantic collision with the pending contract edit; closure's atomic Linux/Windows integration neither needs nor waits for it.

If a second best-effort platform ever appears, the tier declaration can be lifted into the common contract then, as its own capability id - explicitly not now.

### D2: Semantics declaration - what this provider declares and what it explicitly does not

This provider never claims the `rasen-recursive-process-scope/1` capability id and therefore declares NONE of the `RECURSIVE_PROCESS_SCOPE_SEMANTICS` as capability claims. Per-semantic honesty, written so it survives both pending contract edits:

| Semantic | This provider | Reason |
| --- | --- | --- |
| `workload-non-escape` | NOT provided | A descendant can leave the process group with `setsid()`/`setpgid()`. This holds under the current wording ("workload cannot escape") AND under the pending narrowed wording ("descendants the workload itself forks cannot escape") - the declaration does not depend on which wording lands. |
| `publish-before-activate` | Not claimed | No durable publication on this tier (decision 11, daemon lifetime). Behavioral inertness before activation exists (D4) but is not claimed as this semantic. |
| `root-exit-distinct` | Substance provided, not claimed under the recursive capability | Exact leader exit code XOR signal, reported distinctly from any emptiness statement. Restated in the best-effort declaration vocabulary instead. |
| `natural-exact-empty` | NOT provided | Group-emptiness observation is not scope-emptiness proof; hence `scopeEmptyProof: false`. |
| `recursive-terminate` | NOT provided | Group signals reach current group members only; escaped descendants are unreachable; hence `exactCancel: false`. |
| `recursive-abort` | NOT provided | Same reason as `recursive-terminate`. |
| `replacement-recovery` | NOT provided | Criterion 4; decision 11 moved it to the upgrade path, and this semantic is in flux (slated to leave the frozen array). This provider provides it under NEITHER version of the constant: no reattach, no identity revalidation, ever. Nothing in this change reads or depends on this array entry. |
| `bounded-controls` | Substance provided, not claimed under the recursive capability | Every control phase is bounded with a typed timeout. |
| `identity-drift-detection` | NOT provided | No kernel birth-identity binding. Structural mitigation only: within one daemon lifetime the leader is our own child process, and there is no reattach across daemons. |
| `event-completeness` | NOT provided | Group emptiness is polled sampling, not a complete event stream. Leader exit is exact, but that alone is not this semantic. |

The tier's own declared vocabulary (descriptive, in the best-effort declaration; deliberately NOT added to the frozen constant): own-process-group, group-signal-cancel, emptiness-keyed-escalation, exact-root-exit, bounded-controls, honest-unproven-terminal, plus the two limit flags `exactCancel: false` and `scopeEmptyProof: false`.

### D3: Node-only implementation, no native helper

The darwin scope is implemented entirely in Node: `spawn` with `detached: true` (POSIX `setsid()`: new session implies new process group; group id equals the leader pid), group signals via `process.kill(-leaderPid, sig)`, group-emptiness probe via `process.kill(-leaderPid, 0)` and ESRCH. This is a strict superset of the modelled product's `setpgid` shape with identical group-signal semantics. Rationale: no macOS build infrastructure, no cross-compiled artifact that this environment could exercise only through fixtures (the systemic pattern that produced two Blockers on this portfolio), and the production code paths are the same ones every test runs.

### D4: Prepare stays inert by spawning at activate

`prepare()` validates the input (server-resolved absolute command - refused if not absolute, no PATH resolution; explicit env allowlist only), records the tier declaration (D6), and mints the opaque ref. `activate()` performs the actual spawn and wires stdio. Abort before activate has nothing to kill and honestly reports that nothing ran. macOS `POSIX_SPAWN_START_SUSPENDED` was considered and rejected: it needs native code for a guarantee this tier does not claim.

### D5: Cancel protocol - escalation keyed off whole-group emptiness

1. Deliver group SIGTERM (`kill(-leaderPid)`). ESRCH on this first delivery means the group is already gone; the terminal is still emptiness-unproven.
2. Bounded grace: poll whole-group emptiness (`kill(-leaderPid, 0)` until ESRCH or grace expiry). Leader exit is observed and recorded during this window but is NOT the escalation input. RC-002's lesson is honoured: an unreaped member holds the group visible, so the poll tolerates transient zombie visibility - Node reaps our leader automatically and launchd reaps reparented descendants, so a truly empty group eventually reports ESRCH.
3. At grace expiry the escalation decision reads group emptiness only: group still present means group SIGKILL, then one bounded final emptiness poll. A leader that exited instantly while a descendant survives still gets the full grace-then-SIGKILL treatment.
4. The terminal receipt is always `cancelled / emptiness-unproven` - even when the group observed empty, because group emptiness does not prove scope emptiness. The diagnostic carries `groupObservedEmpty` and whether force was used.

### D6: Honest terminal vocabulary and the declaration-gated release rule

Additive seam extension, exact-tier behavior byte-for-byte unchanged:

- The tier declaration (`exactCancel: false`, `scopeEmptyProof: false`) is recorded in the hosted-session record at prepare time, before activation. A scope without a declaration is the exact tier by default.
- `terminate` on this tier returns a distinct declared-unproven terminal receipt - not `closed` (that is a proven-empty claim and would make the Record lie) and not `uncertain` (that means a transient unknown awaiting reconciliation; unproven-by-design is terminal). The live scope's settled promise resolves with the same honest terminal rather than a fabricated scope-empty receipt.
- The host close path releases durable authority from the declared-unproven terminal only when the record carries the pre-start declaration. Exact-tier scopes keep the existing rule: only a proven scope-empty receipt authorizes release. An undeclared scope presenting an unproven terminal is refused release (fail closed).

Natural completion is symmetric: the exact root exit code or signal is recorded, group emptiness is observed (bounded, observational only), and the completion terminal carries the same unproven-emptiness honesty.

### D7: Daemon death - honest loss, no reattach

Daemon death on this tier means the detached workload group may keep running (declared cost; janitor, not sandbox). A later daemon that encounters a stale record takes no destructive action against an unknown identity: the existing inspect path reports the ref as foreign/uncertain and the record reflects loss honestly. No reattach and no identity revalidation are attempted (decision 11). The typed `execution-lost` outcome and committed-frontier resume belong to `ecp-frozen-action-session-executor`, not to this provider.

### D8: Three same-name things, disambiguated

- Run-state `legacy-fallback`: a dispatch-routing compatibility value for an unknown host. Not this.
- ProcessCapsule's "PGID fallback": the silent process-authority retreat that review disproved (RC-001). Not this - the prohibition on silent degradation targets exactly that.
- This change: a declared best-effort tier - selected explicitly for darwin hosted sessions, its limits written into the record before the scope starts, never a silent retreat from a stronger claim.

## Risks / Trade-offs

- [Group id reuse between the final emptiness observation and SIGKILL could target an unrelated group] -> bounded window; within one daemon lifetime the group id is our own child's pid; the residual race is part of why `exactCancel: false` is declared, and the modelled product carries the identical exposure. No identity-binding machinery is added (upgrade-path material).
- [A descendant escapes the group via `setsid()` and cancel never reaches it] -> by design and declared; the flagship escape-demonstration receipt proves on a real kernel that the record stays honest (`emptiness-unproven`) exactly when this happens.
- [Group-emptiness poll observes empty while an escapee lives] -> the tier never converts group observation into a scope-empty claim; `groupObservedEmpty` is diagnostic only.
- [Node auto-reaps the leader, so the zombie cannot hold the group id reserved] -> accepted; consistent with no identity binding on this tier.
- [Unmutated guard tests assumed non-discriminating on this codebase] -> every guard plans a mutation receipt: escalation keyed to leader exit instead of group emptiness, leader-only kill instead of group kill, forged "cleanly cancelled" receipt, release without declaration.
- [No macOS host in this planning/implementation environment] -> tasks are split so macOS-required work is unambiguous; POSIX pre-flight on Linux/WSL is allowed as labelled non-acceptance evidence; acceptance requires real macOS receipts on the production path.
- [Seam extension touches shared host code] -> additive with exact-tier default; the existing deterministic-scope suite must pass unchanged, and a dedicated regression assertion proves undeclared scopes see byte-identical release behavior.
- [Pending contract edit lands mid-implementation] -> this change touches none of `types.ts`/`registry.ts`/`manifest.ts`; D2 is worded to be true under both the current and the narrowed semantics.

## Migration Plan

Additive only. The darwin selection activates solely on `process.platform === 'darwin'` in hosted-session ProcessScope construction; Linux/Windows and the Tier A in-tool path are untouched. Rollback is deselecting the darwin branch, which restores the prior (legacy capsule) behavior.

## Open Questions

- None blocking. One coordination note: when the LEAD's `workload-non-escape`/`replacement-recovery` contract change lands, re-read D2 against the landed wording - it was written to require no edit in either outcome, and a reviewer should confirm that held.
