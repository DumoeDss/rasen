## Why

Rasen reports another agent's data as the current session's own when it runs inside the Oh My Pi (`omp`) harness. `omp` sets `CLAUDECODE`, and host detection has no `omp` fingerprint, so an `omp` session is identified as Claude Code. Observed on 2026-08-05 in an `omp` session at this repository:

```console
$ rasen agent context --latest --json
{"available":true,"runtime":"claude","contextTokens":75948,"pct":0.37974,
 "transcript":"~/.claude/projects/-Users-…-rasen/213ab582….jsonl","shouldHandoff":false}

$ stat <that transcript>    # today is 2026-08-05
2026-07-29 10:25:24
```

The probe answered `available: true` with the occupancy of an unrelated Claude Code session from a week earlier. This is a silent wrong answer, not a refusal: every consumer that reads context occupancy — handoff timing, threshold bindings, the keepalive gate — acts on a foreign session's numbers. The same misidentification lets keepalive beats run under Claude's enabled-by-default gate, bypassing the fail-safe that holds for an unrecognized host, and makes a pipeline stage with no explicit runtime record a Claude worker identity that does not exist in this session.

An agent cannot detect this itself, because nothing reports an error. Identifying the host correctly and refusing to answer where no adapter exists is worth more than any new capability, so this change delivers only that: `omp` becomes a recognized host, and every surface with no `omp` adapter says so instead of guessing. Context probing, token auditing, and worker dispatch for `omp` remain out of scope.

## What Changes

- Recognize the Oh My Pi harness as its own LEAD host runtime, so status, pipeline, and diagnostic output name the harness the session is actually running in.
- Resolve the harness a session runs in independently of whether Rasen can dispatch workers to that harness, so a recognized host no longer has to claim dispatch support to be nameable.
- Report context occupancy as unavailable, with a reason naming the host, when the session's harness has no context-probe adapter and the user named neither a transcript nor a runtime — replacing the current foreign-transcript reading.
- Keep an explicitly named transcript or an explicitly named runtime working unchanged, so a user who deliberately points at a Claude Code transcript from any harness still gets a reading.
- Warn when a recognized host has no dispatch adapter and the run falls back to the legacy compatibility route, so the fallback is visible rather than silent.
- State in the dispatch fallback warning that forcing a host runtime also makes context probing report that runtime, so a user following the advice knows what else it changes.
- Withhold keepalive beats in a harness with no dispatch adapter, through the existing unrecognized-host fail-safe.
- Continue to reject `omp` wherever a context-probe, token-audit, or dispatch-capable runtime is required, with the existing actionable error naming the accepted runtimes.

## Capabilities

### Modified Capabilities

- `runtime-adapter-registry`: Adds Oh My Pi to the shipped adapter registry with no operation capabilities, separates host identity from dispatch capability, adds the harness fingerprint and its precedence, and extends the dispatch fallback notice to any recognized host with no dispatch adapter.
- `cli-agent-context`: Requires the implicit latest-transcript path to refuse with a host-named reason when the session's harness has no context-probe adapter, while preserving explicit transcript and explicit runtime selection.
- `opsx-pipeline-registry`: Requires a detected host with no dispatch adapter to take the annotated legacy Claude fallback for implicit stage runtimes and session-reuse threshold fallbacks, instead of becoming a target Rasen cannot dispatch to.

## Impact

- Affects host detection, capability derivation, and dispatch route resolution in `src/core/runtime-adapters.ts`; the implicit transcript resolution path in `src/core/agent-context.ts`; the execution notice in `src/core/pipeline-registry/execution-validation.ts`; the pipeline message contract in `src/commands/pipeline-messages.ts`; and English, Japanese, and Simplified Chinese copy in `src/locales/`.
- Preserves every existing runtime value, serialized value, configuration value, and dispatch route unchanged; Claude and Codex detection, probing, auditing, and dispatch behave exactly as before.
- Requires no new configuration key and no change to keepalive gating, pipeline runtime schemas, config-key enums, or management wire contracts, because no operation capability becomes true for the new host.
- Requires updates to runtime adapter registry tests, host detection tests, agent context availability tests, pipeline execution notice tests, and locale catalog parity.
- Leaves token-audit runtime sniffing unchanged: an Oh My Pi session file passed explicitly to the audit command is still read as a Claude Code transcript. That path requires an explicit target rather than answering silently, so it is recorded as a known gap for a later capability change.
