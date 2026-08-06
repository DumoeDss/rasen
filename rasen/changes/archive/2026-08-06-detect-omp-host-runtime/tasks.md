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

## 8. Review-round fixes (`/rasen-review`, pre-landing)

- [x] 8.1 Blocker — the fallback notice claimed forcing `RASEN_AGENT_RUNTIME` "makes context probing report the forced runtime". Verified false: the override feeds `detectHostRuntime` only, so `RASEN_AGENT_RUNTIME=codex` + implicit `--latest` reports runtime `claude` from the Claude store. Restate what it actually does (lifts the refusal, resumes the Claude-store read) in `execution-validation.ts` and all three locales, and pin the exact copy per locale in `test/commands/pipeline-messages.test.ts`
- [x] 8.2 Blocker — the host gate returned before `probeAgentContext`'s `--limit` validation, so a `--limit` typo answered exit-0 `unsupported-host` instead of the documented hard error. Extract `validateProbeLimit` and call it before the gate; regression-test all four invalid forms
- [x] 8.3 Major — `throwRuntimeUnavailable`'s `hostOverride` still keyed on `=== 'unknown'`, advising "override the affected role to omp" — a value `AgentRuntimeSchema` rejects. Gate it on `canDispatch` and regression-test the advice
- [x] 8.4 Major — the shipped LEAD playbook asserted invariants D1/D6 falsified: "legacy-fallback only when the host is unknown" (`_orchestration.ts:41`) and a route matrix with no non-dispatch-host row (`:45`). Reword both and add the H.1 unavailable arm (`:345`) covering `unsupported-host`
- [x] 8.5 Major — shipped prompts prescribed the implicit `--latest` pre-flight with no unavailable branch: `auto.ts` (enumerated only `no-transcript`), `goal-command.ts`, `handoff.ts` (reported occupancy fields unconditionally and recorded `pct`), `audit.ts` (asserted the probe "will report"). Add the branch to each; `handoff.ts` omits the optional `pct` instead of inventing one
- [x] 8.6 Minor — cover the reporter-less `unlocalizedNoticeMessage` variant, and make `formatPipelineExecutionNotice` an exhaustive `switch` so a fourth notice kind fails compilation in both renderers instead of rendering as a stale-profile warning
- [x] 8.7 Minor — refresh the docs and docstrings the change falsified: the route matrix in `docs/artifact-workflow-guide.md` and `docs/zh/artifact-workflow-guide.md`, the fingerprint-precedence comment in `keepalive/index.ts`, and `AgentCommand.context`'s failure-mode list
- [x] 8.8 Minor — complete the D8 scrub: `vitest.setup.ts` cleared only two of the five inputs `detectHostRuntime` reads, so a developer running from Codex still leaked a host. Scrub the override and all four fingerprints
- [x] 8.9 Minor — extend D8's reasoning to the other two pieces of developer machine state the suite reads indirectly, discovered by running the full suite: a global `commit.gpgsign` broke 26 fixture-commit assertions and `LANG=ja_JP.UTF-8` broke 3 English-output assertions, both local-only. Add a fourth `vitest.setup.ts` net layer neutralizing global/system git config (with identity moved to `GIT_*`) and pinning the Unix locale variables, so `pnpm test` is green with no environment overrides
- [x] 8.10 Refresh the `skill-templates-parity` baselines for the four templates 8.4/8.5 edited (`auto`, `goal-command`, `handoff`, `review-cycle`), verifying the recomputation against the 20 untouched templates first
- [x] 8.11 Re-verify: `npx tsc --noEmit`, `pnpm lint`, bare `pnpm test` (345/345 files, 6034 passed, 27 skipped), and re-smoke `agent context --latest` plus the `--limit` hard error from this `omp` session
