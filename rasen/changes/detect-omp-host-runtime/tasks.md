## 1. Host-deterministic test baseline

- [x] 1.1 Scrub `OMPCODE` and `CLAUDECODE` from the worker environment in `vitest.setup.ts`, so host-sensitive suites resolve `unknown` by default (matching CI) instead of inheriting the developer's harness fingerprints
- [x] 1.2 Pin the Claude host explicitly in `test/commands/agent-wait.test.ts` setup so its gating assertions no longer depend on ambient fingerprints

## 2. Runtime adapter registry (`src/core/runtime-adapters.ts`)

- [x] 2.1 Add the `omp` registry row with `canProbeContext`, `canAudit`, and `canDispatch` all false
- [x] 2.2 Widen `HostRuntime` to `RuntimeAdapterId | 'unknown'` and redefine `KnownHostRuntime` as `DispatchRuntime`
- [x] 2.3 Add the `omp-code` value to `HostRuntimeSource`
- [x] 2.4 Accept any registered adapter id in the `RASEN_AGENT_RUNTIME` override instead of the hardcoded `claude|codex` pair
- [x] 2.5 Insert the `OMPCODE` fingerprint after the Codex fingerprints and before `CLAUDECODE`, with the nesting rationale in the doc comment
- [x] 2.6 Resolve `legacy-fallback` in `resolveDispatchRoute` for any host without `canDispatch`, not only `unknown`

## 3. Dispatch-capability gates in pipeline resolution

- [x] 3.1 Gate stage host inheritance in `resolveStageRuntimeConfig` (`src/core/pipeline-registry/types.ts`) on `canDispatch`, so a non-dispatch host takes the `legacy-default` branch
- [x] 3.2 Gate the session-reuse threshold fallback runtime in `src/core/pipeline-registry/types.ts` on `canDispatch`
- [x] 3.3 Gate role host inheritance in `resolvePipelineRoleRuntimes` (`src/core/pipeline-registry/stage-overrides.ts`) on `canDispatch`, keeping `legacy-default` as the reported source

## 4. Visible dispatch fallback notice

- [x] 4.1 Add the `host-runtime-without-dispatch-adapter` notice variant to `PipelineExecutionNotice` in `src/core/pipeline-registry/execution-validation.ts`
- [x] 4.2 Emit the new variant for a recognized host without `canDispatch` and keep `unknown-host-runtime` for an unidentified host
- [x] 4.3 Extend the non-localized console fallback in `reportPipelineExecutionNotice` to render the new variant
- [x] 4.4 Add the `hostRuntimeWithoutDispatchAdapterWarning` key to the message contract and `PIPELINE_MESSAGE_KEYS` in `src/commands/pipeline-messages.ts`, and branch on it in `formatPipelineExecutionNotice`
- [x] 4.5 Add the new key's copy to `src/locales/en.json`, `ja.json`, and `zh-cn.json`, each stating that forcing a host runtime also redirects context probing

## 5. Implicit context probe refusal (`src/core/agent-context.ts`)

- [x] 5.1 Add the `unsupported-host` reason to `ProbeAgentContextResult` and an `env` seam to `ProbeOptions`
- [x] 5.2 Refuse in `probeAgentContextSafe` before any transcript-store read when `--latest` is implicit (no `transcript`, no `runtime`) and the detected host is recognized without `canProbeContext`
- [x] 5.3 Leave explicit `transcript`, explicit `runtime`, and `unknown`-host resolution byte-identical

## 6. Tests

- [x] 6.1 Extend `test/core/runtime-adapters.test.ts` exact-equality assertions with the `omp` row, derived tuples, and capability table
- [x] 6.2 Add host detection tests for the `OMPCODE` fingerprint, its precedence over `CLAUDECODE`, Codex precedence over `OMPCODE`, and the widened override
- [x] 6.3 Add `resolveDispatchRoute` route tests for an `omp` host
- [x] 6.4 Add stage/role/threshold resolution tests asserting an `omp` host yields runtime `claude` with source `legacy-default`
- [x] 6.5 Add execution-notice tests for the recognized-host-without-dispatch variant
- [x] 6.6 Add agent-context tests for the implicit refusal, explicit transcript, explicit runtime, and unaffected Claude/Codex hosts
- [x] 6.7 Add a command-layer test asserting the CLI exits 0 and prints the unavailable shape under an `omp` host

## 7. Verification

- [x] 7.1 Run `pnpm lint` and the affected test files
- [x] 7.2 Run the full test suite
- [x] 7.3 Smoke test `rasen agent context --latest --json` from this `omp` session and confirm the refusal replaces the foreign-transcript reading
