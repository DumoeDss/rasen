# Verification Report: detect-omp-host-runtime

**Schema:** spec-driven
**Branch:** `feature/detect-omp-host-runtime` (base `dev/0.1.7`, forked at `588afca1`; verified content committed — see the tested-subtree hashes in TEST EVIDENCE)
**Verified:** 2026-08-06

## Summary

| Dimension | Status |
|---|---|
| Completeness | 29/29 tasks complete; 5/5 requirements implemented |
| Correctness | 26/26 scenarios covered by code + test evidence |
| Coherence | D1–D7 followed; D8 added to design.md to match reality |

```
VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:1 Trivial:0
```

## Completeness

### Task completion

`tasks.md`: 29 checkboxes, 29 marked `- [x]`, 0 incomplete.

### Requirement implementation

| Requirement | Spec | Implementation |
|---|---|---|
| Runtime adapters declare independent capabilities | runtime-adapter-registry | `src/core/runtime-adapters.ts:36-40` (`omp` row, all capabilities false) |
| LEAD host runtime detection is canonical and provenance-bearing | runtime-adapter-registry | `src/core/runtime-adapters.ts:61` (`HostRuntime` widened), `:67` (`omp-code` source), `:134-135` (override accepts any registered id), `:143-144` (`OMPCODE` fingerprint) |
| Dispatchability is resolved for a host and target pair | runtime-adapter-registry | `src/core/runtime-adapters.ts:92` (`KnownHostRuntime = DispatchRuntime`), `:161` (capability-gated `legacy-fallback`); `src/core/pipeline-registry/execution-validation.ts:259-267` (fallback report) |
| Implicit latest-session discovery refuses a host with no context-probe adapter | cli-agent-context | `src/core/agent-context.ts:579` (`unsupported-host` reason), `:599-611` (gate before any store read) |
| Effective stage runtime resolves independently from other stage fields | opsx-pipeline-registry | `src/core/pipeline-registry/types.ts:614` (stage host inheritance), `:961-963` (session-reuse fallback); `src/core/pipeline-registry/stage-overrides.ts:205-208` (role host inheritance) |

## Correctness

### Scenario coverage

**runtime-adapter-registry — capabilities (3/3)**

| Scenario | Evidence |
|---|---|
| Shipped capability matrix is reported consistently | `test/core/runtime-adapters.test.ts:14-37` (exact matrix), `:49-53` (derived tuples: probe/dispatch unchanged at `['claude','codex']`, audit at `['claude','codex','zed']`) |
| Capabilities remain independent | `test/core/runtime-adapters.test.ts:55-63` (`zed` audit-only) |
| A registered runtime with no capability is still recognized | `test/core/runtime-adapters.test.ts:39-47` (registered, absent from all three sets); rejection with accepted-runtime error: `test/core/agent-context.test.ts:600-606`, `test/core/token-audit/audit.test.ts:123-130` |

**runtime-adapter-registry — detection (6/6)**

| Scenario | Evidence |
|---|---|
| Unrestricted Codex is detected from its thread id | `test/core/runtime-adapters.test.ts:76-81` |
| Codex wins over inherited Claude fingerprints | `test/core/runtime-adapters.test.ts:83-91` |
| Oh My Pi is detected from its own fingerprint | `test/core/runtime-adapters.test.ts:117-122` (asserts `omp` with `CLAUDECODE` also present) |
| Codex launched from Oh My Pi is still Codex | `test/core/runtime-adapters.test.ts:124-132` |
| Explicit diagnostic override wins | `test/core/runtime-adapters.test.ts:93-100` (claude), `:134-143` (any registered id, incl. `zed`) |
| No recognized host is explicit | `test/core/runtime-adapters.test.ts:111-115` (also proves `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` does not identify a host) |

Additional guard beyond spec: `test/core/runtime-adapters.test.ts:145-150` asserts a whitespace-only `OMPCODE` does not identify the host (`hasText` semantics).

**runtime-adapter-registry — dispatch routes (6/6)**

| Scenario | Evidence |
|---|---|
| Same-host dispatch is native | `test/core/runtime-adapters.test.ts:155,158` |
| Claude can bridge to Codex | `test/core/runtime-adapters.test.ts:172-183` |
| Codex can bridge to Claude | `test/core/runtime-adapters.test.ts:172-183` |
| Unknown host remains diagnosable | `test/core/runtime-adapters.test.ts:159-160`; notice at `test/core/pipeline-registry/execution-validation.test.ts:268-284` |
| Recognized host with no dispatch adapter is diagnosable | `test/core/runtime-adapters.test.ts:161-163,185-188`; notice naming the host and asserting the unknown-host variant does NOT fire: `test/core/pipeline-registry/execution-validation.test.ts:286-306` |
| Fallback report copy is available in every shipped locale | `test/commands/pipeline-messages.test.ts:98-112` (all three locales contain the host, the override, and no unresolved placeholders); `test/locales/catalog.test.ts:205-215` (key parity); JSON locale-neutrality preserved by `test/commands/pipeline.test.ts:300-418` (passing) |

**cli-agent-context (5/5)**

| Scenario | Evidence |
|---|---|
| Implicit probe on a host with no probe adapter is unavailable | `test/core/agent-context.test.ts:414-434` (a readable transcript exists in `dir` yet the result is `unsupported-host` — proves no store read); `test/core/commands/agent-command.context.test.ts:365-383` (exit 0, exact JSON shape, no `runtime`/`contextTokens`/`limit`/`pct`) |
| Unsupported host is refused in text mode | `test/core/commands/agent-command.context.test.ts:384-398` (one line, names the host, no occupancy figures) |
| Explicit transcript still works from an unsupported host | `test/core/agent-context.test.ts:436-443` |
| Explicit runtime still works from an unsupported host | `test/core/agent-context.test.ts:445-455`; `test/core/commands/agent-command.context.test.ts:400-421` |
| Hosts with a probe adapter are unaffected | `test/core/agent-context.test.ts:457-468` (Claude host, Codex host, and unidentified host all resolve unchanged) |

**opsx-pipeline-registry (6/6)**

| Scenario | Evidence |
|---|---|
| Model-only stage inherits the Codex host | `test/core/pipeline-registry/pipeline.test.ts:479-514` (unchanged, passing) |
| Model-only role object does not manufacture Claude | `test/core/pipeline-registry/pipeline.test.ts:479-514` |
| Explicit runtime layers retain precedence | `test/core/pipeline-registry/pipeline.test.ts:516-546`; `test/core/pipeline-registry/stage-overrides.test.ts:220-240` |
| Unknown host uses the annotated legacy default | `test/core/pipeline-registry/pipeline.test.ts:544-545`; `test/core/pipeline-threshold-bindings.test.ts:198` |
| Host with no dispatch adapter uses the annotated legacy default | `test/core/pipeline-registry/pipeline.test.ts:548-561` (stage: `claude`/`legacy-default`); `test/core/pipeline-registry/stage-overrides.test.ts:242-252` (role: `claude`/`legacy-default`/`legacy-fallback`, NOT `host`) |
| Session-reuse threshold host fallback matches stage resolution | `test/core/pipeline-threshold-bindings.test.ts:193-236` — the `omp` row was added during this verification; it asserts both `resolveStageHandoffConfig` and `resolvePipelineReuseConfig` resolve the `claude` binding row from an `omp` host |

### Behaviour-neutrality of the new registry row

Every other `hasRuntimeCapability(..., 'canDispatch')` call site was checked for
an unintended change of meaning. `omp` returned `false` before the change (absent
from the registry) and returns `false` after (registered, `canDispatch: false`),
so all of these are provably unchanged:

- `src/core/pipeline-registry/run-state.ts:358-359` — raw worker `runtime` demotion to `runtimeRaw`
- `src/core/pipeline-registry/stage-overrides.ts:273` — config `runtimes` override bucketing
- `src/core/project-config.ts:661` — `pipelines.<name>.runtimes.<role>` validation

`HostRuntimeSource` is not serialized into any config or management wire enum
(no matches in `src/core/management-api`, `config-keys.ts`, `config-schema.ts`),
so adding `omp-code` requires no schema change.

## Coherence

### Design adherence

| Decision | Followed | Evidence |
|---|---|---|
| D1 — host identity decoupled from dispatch capability | Yes | `runtime-adapters.ts:61,98,161`; `KNOWN_DISPATCH_ROUTES` `satisfies` unchanged |
| D2 — `legacy-fallback`, not `unsupported` | Yes | `runtime-adapters.ts:161-162`; no `unsupported` throw reachable from an `omp` host |
| D3 — fingerprint precedence after Codex, before Claude | Yes | `runtime-adapters.ts:137-144`; residual `claude -p` nesting hazard now recorded at `:124-128` |
| D4 — refusal scoped to implicit resolution only | Yes | `agent-context.ts:599`; `src/commands/agent.ts` unmodified, confirming the predicted "CLI layer needs no edit" |
| D5 — keepalive requires no change | Yes | `src/core/keepalive/index.ts` unmodified; `test/core/config-keys.test.ts` unmodified and passing; smoke run returns `{"standDown":true,"reason":"runtime-not-gated"}` |
| D6 — the fallback notice must widen | Yes | `execution-validation.ts:259-267` |
| D7 — override coupling documented, not split | Yes | all three locale strings state that forcing a runtime redirects context probing |

### Design constraints

- Locale catalogs: parity holds after adding `hostRuntimeWithoutDispatchAdapterWarning` — all three at **1386 leaf keys** and **111 `pipeline.messages` keys**. (The design's "1358 keys each" was measured when it was written; the drift to 1386 comes from other changes landing since, not from this one. What this change must preserve is equality across the three catalogs, and it does.)
- `test/core/config-keys.test.ts` — **untouched**, as required. No operation capability was flipped true.
- `test/core/runtime-adapters.test.ts` exact-equality assertions — all three gained the `omp` row.
- JSON output remains locale-neutral (`test/commands/pipeline.test.ts` passing).

### Empirical validation of the design's evidence table

Re-measured on the live `omp` session rather than trusted:

| Design claim | Measured |
|---|---|
| `omp` sets both fingerprints | `OMPCODE=1`, `CLAUDECODE=1`, no Codex fingerprint |
| Probe returned a foreign transcript | `213ab582….jsonl` mtime **2026-07-29** vs. now **2026-08-06** — 8 days stale while the session is live |
| Session files live outside Claude's tree | `~/.omp/agent/sessions/<scope>-<basename>-<sha256(cwd)>/` — nothing under the Claude projects dir |
| Keepalive fail-safe engages by itself | `agent wait` → `runtime-not-gated` with no new config key |

No design claim needed to be overturned.

## Findings

### Blocker (0)

None.

### Major (0)

One Major was found and **fixed during this verification**, so it is closed:

- *Session-reuse threshold fallback had no `omp` scenario coverage* — `types.ts:961-963` was implemented but untested; the existing host-parameterized table at `test/core/pipeline-threshold-bindings.test.ts:193` covered only claude/codex/unknown, and encoded the production fallback rule inline as `runtime === 'unknown' ? 'claude' : runtime`. **Fixed**: added an explicit `row` column to the table (so it asserts the expected row instead of restating the rule) and an `['omp','omp-code','claude','claude-policy',0.52]` case covering both `resolveStageHandoffConfig` and `resolvePipelineReuseConfig`.

### Minor (1)

- **Token-audit still reads an Oh My Pi session file as a Claude transcript.** `src/core/token-audit/audit.ts` sniffs transcript kind independently of `agent-context.ts`, and this change deliberately left it alone. Declared out of scope in `proposal.md` ("Impact", final bullet) and `design.md` ("Out of scope"), and materially lower risk than the fixed defect because that path requires an explicit target rather than answering silently. *Recommendation:* file a follow-up capability change to give `omp` a probe/audit adapter — its session JSONL already carries per-message `usage` with `input`/`output`/`cacheRead`/`cacheWrite`/`cost`, so the adapter is tractable. No action required before archive.

### Trivial (0)

None.

## Coherence corrections applied during verification

Both are documentation-only and were made to remove drift the report would
otherwise have to flag:

1. `design.md` gained **D8** recording the `vitest.setup.ts` host-fingerprint
   scrub. The scrub was a necessary implementation discovery absent from the
   design; an undocumented test-infrastructure decision would have been
   inexplicable to the next maintainer.
2. `src/core/runtime-adapters.ts:124-128` now records D3's residual nesting
   hazard (a `claude -p` child spawned from Oh My Pi would inherit `OMPCODE`)
   and the mitigation required of whoever adds Oh My Pi dispatch, at the site
   where that mistake would be made.

## Checks skipped

- `rasen validate` / `pipeline show --for-execution` could not exercise the
  fallback notice through the real CLI on this machine: its profile disables
  `rasen-ship`, so every shipped pipeline fails the skill gate before reaching
  the host preflight. Environmental, not a defect. Verified instead by driving
  `validatePipelineForExecution` from the built `dist/` against the real `omp`
  environment (no injected host), which emitted
  `{kind:'host-runtime-without-dispatch-adapter',host:'omp',override:'RASEN_AGENT_RUNTIME'}`
  and rendered correctly in en/ja/zh-cn plus the unlocalized console fallback.

## Final assessment

No critical issues. The one Major found was fixed in place. One documented,
out-of-scope Minor remains. Ready for archive.

TEST EVIDENCE
- scope: full repository test suite, plus targeted re-runs of every suite touched by this change
- rationale: the change widens a core type (`HostRuntime`) consumed by pipeline dispatch, keepalive, and management-API code paths, and alters shared test-harness environment setup, so blast radius is repository-wide rather than package-local
- command: `pnpm lint && npx tsc --noEmit && pnpm test`
- result: pass — 5996 passed, 27 skipped, 26 failed; all 26 failures verified pre-existing by re-running the same 7 files on a stashed clean tree (22 in `test/core/store/bootstrap-obtain.test.ts` + `test/commands/bootstrap.test.ts` + `test/core/session-runtime-context-e2e.test.ts`, 4 in `learned-skills/store-scope`, `management-api/session-launch-context`, `management-api/sessions-space`, `store/bootstrap-bundle-import`), all git-clone/linked-worktree environment failures unrelated to this change. Zero regressions; net +3 passing tests.
- tree: `src/`=`a875f00dc770a423fe661bac5ada69822a7041b4`, `test/`=`2f8fd412eeb165b888b1e0be44f4b5345c70f526`, `vitest.setup.ts`=`186437a197034b6b61137d62580a88fe5333f10a` (subtree/blob hashes of the tested content, as committed on `feature/detect-omp-host-runtime`). The commit's own `HEAD^{tree}` is deliberately NOT recorded: this report is inside that tree, so writing the hash here would change it — an unclosable self-reference. These three cover everything the suite exercised and are unaffected by later edits to planning artifacts.
