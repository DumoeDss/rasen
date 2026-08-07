# Planning context — ecp-macos-process-authority-provider

Seeded by the LEAD, 2026-08-07, before the first propose. Read this FIRST, then research only
what is missing.

## Why this change exists again

Architecture Replan 4 (2026-08-07, earlier the same day) removed macOS from 0.2.0 entirely and
registered macOS durable process authority as a 0.3.0 research item. Step 1 (locked decision 11)
then **reopened this child with a narrowed scope**. It is `pending`, `statusRaw:
reopened-narrowed-best-effort-only`.

What was reopened is NOT the durable authority. It is an explicitly declared **best-effort hosted
provider** only.

## Scope, as the operator chose it

Model it on the comparison product at `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\multica`
(Go; CLI + local daemon executing AI tasks). Its POSIX containment is roughly 60 lines in
`server/pkg/agent/proc_other.go`. Shape:

- `setpgid` to put the workload in its own process group
- group SIGTERM
- a grace period
- group SIGKILL
- **the escalation is keyed off whole-group emptiness, NOT leader exit**

That last point is the one that is easy to get wrong and is a hard requirement, not a detail.

## Honesty conditions — these are ACCEPTANCE, not decoration

The provider MUST, visibly, before a scope starts:

- declare `exactCancel: false`
- declare `scopeEmptyProof: false`

Its cancel terminal state MUST be `cancelled / emptiness-unproven`. It must **never** report
"cleanly cancelled".

The invariant being protected is **"the Record must not lie"**, not "processes must never leak".
An honest unproven state keeps the invariant; a false clean-cancel breaks it. This condition was
attached by the LEAD to the operator's choice and is not negotiable downward.

## DAG safety — do not undo Replan 4

This child has **no outgoing edge into `ecp-native-process-capsule-closure` and must not gain
one.** The macOS -> closure edge was the single edge Replan 4 cut, and cutting it is what
unblocked five downstream children. Re-adding it would undo that. Closure's `dependsOn` stays
`[ecp-linux-process-authority-provider, ecp-windows-process-authority-provider]`.

## Still unapproved, still 0.3.0 — do not propose any of these

Endpoint Security, a VM-based approach, a minimum macOS version requirement, Apple
entitlements, and code signing were **moved to research, not granted**. Note for accuracy:
`es_new_descendants_client` and `es_sync_client` **do exist** (macOS 27.0, beta; documented as
requiring neither root nor TCC approval) — an earlier survey claim that they were absent was
wrong. But they still require the Apple-approval-gated
`com.apple.developer.endpoint-security.client` entitlement, and they give observation plus
per-event authorization, never bulk termination. So they do not rescue this tier and are not a
0.2.0 option.

## Governing decisions this proposal sits under

**Locked decision 11 (Step 1) — daemon lifetime.** Daemon death => scope death => in-flight
action typed `execution-lost` => the Run resumes only from the last committed frontier. There is
**no reattach and no identity revalidation**. Criterion 4 (replacement-safe identity) and its
downstream machinery — opaque reference envelopes, identity binding whose purpose is surviving a
daemon restart, pidfd reopen-and-revalidate, the `prepared -> published -> activate` three-phase
protocol, registry v2 — moved to the upgrade path. Do not propose any of it here.

**Locked decision 12 — threat model.** The threat model is "we get it wrong ourselves", not
"someone attacks us". The agent already runs as the user, on the user's machine, with the user's
credentials, in the user's repository. **Process authority is a janitor, not a sandbox.** Defences
against our own mistakes stay; defences against a local attacker go. Concretely retired:
production Ed25519 producer signing and private-key custody (superseded by transactional
integrity), the `producerIsolation` field, byte-reproducible builds as a provenance claim
(manifest-to-adjacent-binary hash/length integrity **stays** — it catches install corruption),
and path-resolution TOCTOU hardening as acceptance.

**Retained regardless:** fail-closed typed uncertainty; capability honesty
(`authority-unavailable` never silently reroutes); programmatic actor separation; containment
and recursive termination of our OWN workers; complete-set evidence publication with re-read
verification.

## Open dependency at seed time — check before writing specs

A concurrent re-tiering wave is grading the shared contract against the two decisions above. The
frozen constant `RECURSIVE_PROCESS_SCOPE_SEMANTICS`
(`src/core/session-host/process-authority/types.ts`) currently lists ten semantics including
`replacement-recovery` — which is criterion 4, i.e. exactly what Step 1 moved to the upgrade path
— and `workload-non-escape`, whose wording is separately slated to narrow to "descendants the
workload itself forks cannot escape". **Read the current state of that constant and of
`rasen/changes/ecp-linux-process-authority-provider/evidence/step1-task-ledger-retier.md` before
declaring which semantics this provider supports.** Do not write a capability declaration against
a version of the contract that is mid-flight; if the re-tier record is not on disk yet, say so and
declare the dependency explicitly rather than guessing.

## Where this provider plugs in

`createSessionHost` and `createNativeProcessScope` are constructed nowhere in `src/` except
`src/core/management-api/router.ts`. Host-native Tier A dispatch — where the host's own tooling
starts workers and rasen owns no process — never enters ProcessScope at all. Verify this rather
than trusting it, but it is why platform authority work does not touch the in-tool execution path.

Beware a same-name trap: run-state's `legacy-fallback` is a **dispatch routing** compatibility
value for an unknown host; ProcessCapsule's "PGID fallback" is the **process authority** retreat
that review disproved. The prohibition on silent degradation targets the second only. This
change's `setpgid` work is a *declared best-effort tier*, which is a third thing again — it is
honest and declared, not a silent retreat, and the proposal must make that distinction explicit
so a reader does not mistake it for the disproved fallback.

## Evidence expectations

Real macOS run evidence is required; this repository does not accept a green assertion with no
demonstrated failing counterpart. Four separate guard tests in a single earlier wave turned out
not to test what they named, and three were caught only because someone chose to mutate rather
than accept green. **On this codebase an unmutated guard test should be assumed
non-discriminating.** Plan mutation receipts, not just passing suites.

Also plan for the systemic pattern that has produced two Blockers on this portfolio: **production
code exercised only through a stand-in.** Ask, for every production entry point this change adds,
"is this exercised only through a fixture or a `...ForTesting` twin?" Both Blockers so far were
found by running production code against a real kernel, not by any test.
