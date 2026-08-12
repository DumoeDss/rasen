## Why

Rasen answers three questions per runtime — how full is this session, what did it spend, how do I run a worker on it — and it answers them today for three runtimes through **eighteen hand-written branch sites of seven different shapes**: implicit `else` defaults, binary ternaries, hand-copied literal arrays, identity sentinels, and a hand-maintained N×N route table. Seventeen of the eighteen are invisible to the type checker. Adding a fourth runtime means finding all eighteen, and missing one produces a confidently wrong answer rather than a failure.

That is not a forecast. Three defects of exactly this shape are live today, before any new runtime is added:

- Pointing `rasen agent context --transcript` at an Oh My Pi session file reports `available: true` with `contextTokens: 0` forever, because the format sniff falls through to its implicit Claude default and then reads Claude's field names. The handoff threshold can never fire, and the pipeline warm-continue guard silently sees an empty worker.
- Pointing `rasen agent audit` at the same file writes a schema-valid, all-zero Claude report at exit 0. The session it came from spent 87,848 tokens on its first request. Every subagent transcript is dropped by a swallowed error.
- A Claude worker dispatched from a Codex host inherits the Codex environment fingerprints and identifies itself as Codex, because the bridge spawns its child with the parent's environment unchanged.
- Any session running `claude-opus-5` is measured against a 200k window instead of its real 1M, reporting 17% occupancy as 85% and recommending a handoff that is not needed.

The registry that was supposed to prevent this holds only booleans. `canProbeContext: true` means "someone typed true", not "a probe exists" — so the declaration and the implementation can drift in either direction with nothing to catch it.

This change makes the capability's truth value **be** the presence of its implementation, and replaces the eighteen branch sites with lookups that are exhaustive by construction. The four defects above are fixed as a direct consequence, not as separate patches.

## What Changes

- Report an honest, named refusal when a session file belongs to a harness Rasen recognizes but has no reader for it, instead of measuring it with another harness's reader and reporting a confident zero. This applies to both context probing and token auditing.
- Identify a dispatched worker as the runtime it actually is, regardless of which harness spawned it, so a Claude worker started from a Codex host is not reported as Codex.
- Measure a session against its model's real context window, so occupancy and handoff advice for current Anthropic models stop being computed against a stale default.
- Resolve which worker route serves a host/target pair from the shipped adapters rather than from a hand-maintained matrix, so the supported set stays correct as adapters are added and no pair silently resolves to another runtime's binary, label, or install advice.
- Make a runtime's declared capability and its shipped implementation one fact: a capability that no implementation backs, or an implementation no capability declares, becomes a build failure rather than a runtime surprise.
- Preserve every serialized value byte-for-byte. Configuration keys, wire contracts, run-state, report schemas, CLI output, and the accepted runtime sets for probe, audit, and dispatch are unchanged by this change.

Not in scope: giving Oh My Pi a context probe, a token auditor, or worker dispatch. This change makes those additions a matter of registering an adapter; the adapters themselves are the follow-on changes named in `design.md`.

## Capabilities

### Modified Capabilities

- `runtime-adapter-registry`: A runtime's capability set is derived from the operation implementations registered for it rather than declared beside them; recognizing which harness owns a session file becomes a first-class registry concern independent of what Rasen can do with that file; host/target route resolution derives from the shipped dispatch adapters instead of an enumerated matrix; host fingerprint precedence becomes an ordered, inspectable declaration.
- `cli-agent-context`: A transcript belonging to a recognized harness with no context reader is refused with a reason naming that harness, instead of being read with another harness's reader.
- `cli-agent-audit`: An audit target belonging to a recognized harness with no auditor is refused with a reason naming that harness, instead of producing a zeroed report attributed to another runtime.
- `claude-exec-runtime`: A bridged Claude worker identifies itself as Claude to every Rasen surface it invokes, independent of the harness that spawned it.
- `model-presets`: The shipped preset table resolves the current Anthropic Opus generation to its real context window.

## Impact

- Concentrates runtime-specific behavior behind four declared contracts in `src/core/runtime-adapters.ts` and a new implementation registry, with the existing `src/core/claude/`, `src/core/codex/`, `src/core/token-audit/`, and `src/core/agent-context.ts` implementations kept in place and registered rather than moved.
- Touches every current branch site: transcript format detection and probe path resolution in `src/core/agent-context.ts`; runtime selection, dispatch, and report validation in `src/core/token-audit/`; bridge labelling, install advice, and availability probing in `src/core/pipeline-registry/execution-validation.ts`; child environment construction in `src/core/claude/runner.ts`; the keepalive gate and the hand-written runtime list in the project configuration loader.
- Requires no configuration migration, no schema version bump, and no report schema change; existing reports, run-state files, and pipeline configurations continue to load unchanged.
- Requires updating the exact-equality assertions that pin the current capability matrix, derived tuples, and route table, plus the three-locale copy and shipped playbook sentences that state the route matrix and the probe refusal in prose.
- Leaves the two typecheck-free mirrors — the audit viewer's runtime allow-list and the management UI's hand-copied runtime union — as declared follow-up work, because they are separate typecheck realms that an interface cannot reach.
- Removes the need for the temporary project knowledge that currently warns agents about the four live defects; that knowledge is retired once this change ships and its behavior is observed.
