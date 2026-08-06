# Design — detect-omp-host-runtime

## Context

`omp` (Oh My Pi) is a coding-agent harness that discovers skills from multiple providers, including Claude's (`claude` provider, priority 80). Rasen's existing Claude install therefore already serves `omp`: the running session loaded `.claude/skills/rasen-explore` while `rasen/config.yaml` listed only `tools: [claude]`. Installation is consequently NOT the gap, and no `AI_TOOLS` entry is part of this change.

The gap is orchestration-layer identity. `src/core/runtime-adapters.ts:1-7` already states the governing principle — installing a tool and having a context probe, token auditor, or dispatcher for it are separate contracts — and the two registries are already fully orthogonal in practice: `hermes` is `adapted: true` in `AI_TOOLS` with no runtime adapter, and `zed` is a runtime adapter absent from `AI_TOOLS`. This change makes `omp` zed-shaped: registered, with no operation capability.

## Evidence

Verified in an `omp` session at this repository on 2026-08-05.

| Fact | Evidence |
|---|---|
| `omp` sets both fingerprints | `OMPCODE=1` and `CLAUDECODE=1` both present |
| Detection has no `omp` branch | `runtime-adapters.ts:109-122` checks `RASEN_AGENT_RUNTIME`, `CODEX_THREAD_ID`, `CODEX_SANDBOX`, `CLAUDECODE`, then unknown |
| Probe returns a foreign transcript | `rasen agent context --latest --json` returned a `2026-07-29` Claude transcript as the live session's occupancy |
| Transcript format is unrecognized | `omp` session line 1 is `{"type":"title",…}`, line 2 `{"type":"session","version":3,…}`; `sniffTranscriptKind` (`agent-context.ts:191-216`) matches neither `session_meta` nor a `payload` envelope and defaults to `claude` |
| Keepalive fail-safe is bypassed | `keepalive/index.ts:272` defaults `runtimes.claude: true`; `:337-342` falls through to `false` only for a runtime that is not claude/codex |
| Session files live outside Claude's tree | `~/.omp/agent/sessions/<scope>-<basename>-<sha256(cwd)>/<timestamp>_<sessionId>.jsonl` |

## Decisions

### D1 — Host identity is decoupled from dispatch capability

`HostRuntime = DispatchRuntime | 'unknown'` (`runtime-adapters.ts:51`) makes a non-dispatch-capable runtime **unrepresentable as a host**. With `canDispatch: false`, `omp` cannot be returned by `detectHostRuntime` at all. Widening host identity to the full adapter registry is therefore a prerequisite, not a convenience:

```ts
export type HostRuntime = RuntimeAdapterId | 'unknown';   // was DispatchRuntime | 'unknown'
type KnownHostRuntime = DispatchRuntime;                  // route table keyed on dispatch-capable hosts only

export function resolveDispatchRoute(host: HostRuntime, target: DispatchRuntime): DispatchRoute {
  if (!hasRuntimeCapability(host, 'canDispatch')) {
    return { host, target, mode: 'legacy-fallback' };
  }
  return { host, target, ...KNOWN_DISPATCH_ROUTES[host][target] };
}
```

Redefining `KnownHostRuntime` as `DispatchRuntime` is semantically stronger than the current `Exclude<HostRuntime, 'unknown'>`: only a dispatch-capable host can own a route row. `KNOWN_DISPATCH_ROUTES` keeps its `satisfies` check unchanged.

Rejected: giving `omp` `canDispatch: true`. That would widen `AgentRuntimeSchema` (`pipeline-registry/types.ts:37`), the `pipelines.<name>.runtimes.<role>` enum (`config-keys.ts:534`), and the management catalog, and would require a `DispatchBridge` literal plus a host×target row and column for a bridge that does not exist. It would also make `run-state.ts` a shared file with `standalone-retention-context-freeze`, destroying the parallelism between the two changes.

### D2 — `legacy-fallback`, not `unsupported`, for a recognized non-dispatch host

`legacy-fallback` is what an unknown host already resolves to, and `execution-validation.ts:255-259` throws on `unsupported`. Reusing `legacy-fallback` keeps every pipeline that works today working, while provenance becomes more honest than the current state: "omp host, legacy fallback" instead of "claude host, native".

### D3 — Fingerprint precedence: after Codex, before Claude

```
RASEN_AGENT_RUNTIME → CODEX_THREAD_ID → CODEX_SANDBOX → OMPCODE → CLAUDECODE → unknown
```

`OMPCODE` must come **before** `CLAUDECODE` because that inheritance is the bug. It must come **after** the Codex fingerprints because a `codex exec` child spawned from `omp` inherits `OMPCODE` while being a genuine Codex process — the same nesting hazard the existing comment at `runtime-adapters.ts:103-104` documents for Claude.

Known residual: a `claude -p` child spawned from `omp` would inherit `OMPCODE` and be detected as `omp`. Unreachable today, because an `omp` host resolves to `legacy-fallback` rather than spawning the `claude-print` bridge. If `omp` ever gains dispatch, the bridge must inject `RASEN_AGENT_RUNTIME=claude` into the child environment.

`RASEN_AGENT_RUNTIME` also stops hardcoding `claude|codex` and accepts any registered adapter id, so the override can name the new host.

### D4 — The refusal is scoped to implicit resolution only

The gate applies only where the runtime is *inferred*: `--latest` with no `--runtime`. An explicit `--transcript <path>` and an explicit `--runtime claude` remain fully functional from any harness, because both are deliberate user statements rather than an inference Rasen made.

The tagged-union plumbing already exists — `agent-context.ts:572-573` defines `{ available: false; reason: … }` and `agent.ts:286-292` already renders `reason` generically in both JSON and text modes. This change adds one reason literal; the CLI layer needs no edit.

### D5 — Keepalive requires no change

`AgentRuntime` is a type alias of `HostRuntime` (`keepalive/index.ts:25`) and `isRuntimeGated` returns `false` for any runtime that is not claude/codex (`:341`). Once detection reports `omp`, the existing fail-safe engages by itself. Deliberately **no** `keepalive.runtimes.omp` key: adding one would mean claiming beats are meaningful for a harness with no dispatch adapter, and would drag in `config-keys.ts`, `config-schema.ts`, `project-config.ts`, and their exact-equality tests.

### D6 — The fallback notice must widen, or D1 creates a silent regression

`execution-validation.ts:229` fires the notice only when `host.runtime === 'unknown'`. After D1, an `omp` host is `'omp'`, takes the `legacy-fallback` route, and emits **nothing**:

| State | Detection | Route | Warning |
|---|---|---|---|
| Today | claude (wrong) | native | none |
| D1 alone | omp (right) | legacy-fallback | none — silent degradation |
| D1 + D6 | omp | legacy-fallback | emitted |

The condition becomes "recognized host with no dispatch adapter", and the notice carries the host so the message can name it.

### D7 — The override coupling is documented, not split

`RASEN_AGENT_RUNTIME` is a single global override feeding one detector, consumed by dispatch routing and (after D4) the context-probe gate. The current fallback warning tells the user to set it for deterministic dispatch; following that advice from `omp` re-enables the foreign-transcript reading this change fixes.

Splitting the override per consumer is rejected as scope inflation for a diagnostic escape hatch. Instead the warning states the coupling. Two message variants are needed, because the existing copy is doubly wrong for a recognized host — it asserts the host "is unknown", and it recommends `claude|codex` without naming the consequence:

- host unknown → existing guidance
- host recognized, no dispatch adapter → name the host, and state that forcing a runtime also redirects context probing

### D8 — The test suite must pin the host, or this change breaks it locally

Discovered during implementation, not anticipated above. Host detection reads
the environment directly, and nothing in the test harness scrubs it: a
developer running the suite from inside a harness leaks that harness into
every host-sensitive assertion. Today `CLAUDECODE` silently makes local runs
resolve `claude` while CI (which sets neither fingerprint) resolves
`unknown` — the two already disagree, invisibly. After D3, the same leak
resolves `omp` and fails a large set of unrelated suites locally only.

`vitest.setup.ts` therefore deletes `CLAUDECODE` and `OMPCODE` alongside the
existing `RASEN_HOME`/`XDG_DATA_HOME` safety nets: `globalSetup` runs before
the forks pool spawns, workers inherit `process.env`, and `runCLI` passes
that same scrubbed environment to spawned CLIs. The default host becomes
`unknown` everywhere, matching CI; a suite that exercises a specific host
sets the fingerprint itself and wins (`test/commands/agent-wait.test.ts`
adds `OMPCODE` to its `ENV_KEYS` save/delete/restore list for exactly this).

Rejected: patching each affected suite. One setup-level scrub is smaller than
N per-file patches and removes the local/CI divergence instead of encoding it.

## Constraints

- `src/locales/{en,ja,zh-cn}.json` currently hold 1358 keys each (verified). `test/locales/catalog.test.ts:208-213` asserts every locale's pipeline message keys equal `PIPELINE_MESSAGE_KEYS` exactly, so a new or renamed key lands in all three catalogs plus `pipeline-messages.ts:43-44,159-160,373-376` together.
- JSON output is locale-neutral by contract (`test/commands/pipeline.test.ts:300-301`), so no JSON payload changes shape because of the copy work.
- `test/core/runtime-adapters.test.ts:14-48` holds three exact-equality assertions (the capability matrix, the derived runtime tuples, and the `hasRuntimeCapability` table) that must gain the new registry row.
- `test/core/config-keys.test.ts:470-482` asserts `['claude','codex']` and must stay untouched — a diff there means an operation capability was flipped true, contradicting D1 and D5.

## Out of scope

- Context-probe and token-audit adapters for `omp` (its session JSONL already carries per-message `usage` with `input`/`output`/`cacheRead`/`cacheWrite`/`cost`, which makes a later probe adapter tractable).
- Worker dispatch to `omp`, any `DispatchBridge` literal, and any host×target route row.
- An `AI_TOOLS` install entry. `omp` already consumes `.claude/skills`; an entry is one line whenever a project-local `.omp/skills` tree becomes desirable, and it would pull in tool cases across `test/core/init.test.ts`, `test/cli-e2e/basic.test.ts`, `test/core/shared/tool-detection.test.ts`, and `test/core/edit-boundary-lifecycle.test.ts` for no present benefit.
- `token-audit` runtime sniffing, which is a separate implementation from the context-probe sniff and requires an explicit target rather than answering silently.
