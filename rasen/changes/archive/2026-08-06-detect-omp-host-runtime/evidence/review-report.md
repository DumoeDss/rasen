# Pre-landing review — detect-omp-host-runtime

Base: `upstream/dev/0.1.7` · Branch: `feature/detect-omp-host-runtime` · Diff at review start: 672 / -34 over 23 files (large tier)

Passes run: Claude structured (two-axis Standards + Spec), Claude adversarial subagent, union/enum-completeness audit, test-quality audit. Codex CLI not installed — the two Codex passes of the large tier were skipped.

## Scope check

CLEAN. Intent (proposal.md): make `omp` a recognized host and refuse where no adapter exists; no new capability. Delivered: exactly that. No file outside the declared impact set, no capability flag flipped true, `test/core/config-keys.test.ts` untouched as design.md's constraint requires.

## Verified working (empirical, real `omp` session, `OMPCODE=1 CLAUDECODE=1`)

| Check | Result |
|---|---|
| `agent context --latest --json` | `{"available":false,"reason":"unsupported-host",...}` exit 0 — replaces the foreign-transcript reading |
| `agent context --latest --runtime claude --json` | reads normally — escape hatch intact (D4) |
| `detectHostRuntime()` | `{runtime:'omp', source:'omp-code'}` |
| `resolveDispatchRoute('omp','claude')` | `legacy-fallback`, no bridge |
| Notice copy, en/ja/zh-cn | renders with the host interpolated |
| Full suite | 345/345 files, 6034 passed, 27 skipped |

## Findings fixed in this review round

### Blockers

**B1 — the fallback notice made a false factual claim, in all four copies.**
`execution-validation.ts:90` + `en/ja/zh-cn.json:433` said forcing the override "makes context probing report the forced runtime". Reproduced false:

```
$ RASEN_AGENT_RUNTIME=codex rasen agent context --latest --json
{"available":true,"runtime":"claude", ... "transcript":"~/.claude/projects/.../213ab582….jsonl"}
```

The override feeds `detectHostRuntime` only; `probeAgentContext` takes its store from `options.runtime`, which an implicit probe never sets. So it reports `claude` from the Claude store — and this sentence is design D7's designated mitigation for the change's one known hazard, printed unprompted on every `omp` run. Rewritten in all four places to state the real coupling (the refusal is lifted, the Claude store is read). The underlying half-applied override is recorded as a known gap in `proposal.md`; closing it changes the `cli-agent-context` contract.

**B2 — the host gate bypassed `--limit` validation.**
The gate returned before `probeAgentContext`, where `--limit` is checked, so `--latest --limit 0` answered exit-0 `unsupported-host` instead of the hard error the same function's docstring mandates ("invalid `--runtime`/`--limit` … must stay hard errors"). A user with a typo was told their *host* was unsupported. Extracted `validateProbeLimit` and call it before the gate; regression test covers `0 / -1 / 1.5 / NaN`.

### Majors

**M1** — `throwRuntimeUnavailable`'s `hostOverride` still keyed on `=== 'unknown'`, so an `omp` host printed "Override the affected role to omp" — a value `AgentRuntimeSchema` (`z.enum(DISPATCH_RUNTIMES)`) rejects. Now gated on `canDispatch`; regression-tested.

**M2** — the shipped LEAD playbook asserted invariants D1/D6 falsified: `_orchestration.ts:41` ("Only when the host is unknown … `legacy-fallback`") and `:45` (route matrix with no non-dispatch-host row). A LEAD on `omp` reads `hostRuntime:'omp'` + `dispatchMode:'legacy-fallback'` — a pair its own instructions called impossible, while `:26` forbids second-guessing the execution view. Ships in `rasen-auto`, `rasen-goal`, `rasen-review-cycle` (module A is ungated). Both reworded.

**M3** — five shipped prompts prescribed the implicit `--latest` pre-flight with no unavailable branch: `_orchestration.ts:345` (H.1), `auto.ts:28` (enumerated only `no-transcript`), `goal-command.ts:30` (nothing at all), `handoff.ts:26,29` (reported occupancy fields unconditionally, recorded `pct`), `audit.ts:24` (asserted the probe "will report"). Each now branches on `available`, not on the reason literal or the presence of `pct`; H.1 carries the canonical arm the others defer to; `handoff.ts` omits the optional `pct` rather than inventing one.

### Minors

- `formatPipelineExecutionNotice` kept a trailing `return` while the same commit's `unlocalizedNoticeMessage` is an exhaustive `switch` — a fourth notice kind would compile and then read `workflowIds` off a notice that has none. Converted to a matching `switch`.
- `keepalive/index.ts:249-258` documented a fingerprint precedence without `OMPCODE`; `AgentCommand.context`'s docstring omitted the new refusal. Both refreshed.
- The published route matrix in `docs/artifact-workflow-guide.md` and `docs/zh/artifact-workflow-guide.md` still said the fallback happens only for an unidentified host. Row added in both editions.
- `vitest.setup.ts` scrubbed 2 of the 5 inputs `detectHostRuntime` reads, so a developer running from Codex still leaked a host — the divergence D8 exists to remove. Now scrubs the override and all four fingerprints.

### Test gaps closed

- Reporter-less `unlocalizedNoticeMessage` path (all three variants were dead to the suite).
- `throwRuntimeUnavailable` with a non-dispatch host.
- Locale copy pinned exactly per locale — `toContain('omp')` passed vacuously in English via "legacy c**omp**atibility".
- Refusal shape asserted exhaustively (`toEqual`) instead of four `not.toHaveProperty` calls against a three-key literal.
- D5's keepalive fail-safe for `omp` (was smoke-run only).
- `OMPCODE` precedence under `CODEX_SANDBOX`, not just `CODEX_THREAD_ID` — inserting the check one line early would misidentify a sandboxed `codex exec` child and keep the suite green.
- `resolveDispatchRoute('zed','codex')`, and the refusal at the spawned-CLI boundary (exit code + stdout/stderr split).
- `skill-templates-parity` baselines refreshed for the four templates edited (verified by 20 unchanged templates hashing to their existing baselines).

## Accepted as-is (rejected findings, with reasons)

- **`--latest --dir D` now refuses.** `--dir` names a location, not a layout — `resolveTranscriptPath` still assumes the Claude tree — so the inference the gate exists to stop is still present. Refusing is more correct, and the refusal names the working escape hatch.
- **`RASEN_AGENT_RUNTIME` accepts `omp` and `zed`.** Deliberate (task 2.4, design D3); the spec scenario says "any registered runtime id".
- **`agent wait` on `omp` reports `runtime-not-gated`,** the same literal as user misconfiguration. Intended (D5); adding a `keepalive.runtimes.omp` key would claim beats are meaningful for a host with no dispatch adapter.
- **The notice fires once per pipeline and renders English on the `validate` path.** Both predate the change for `unknown-host-runtime`.

## Adjacent leak found by running the suite, folded in on the maintainer's call

Bare `pnpm test` on this machine failed 29 tests with nothing to do with the branch — the same local/CI divergence class D8 names, from two other pieces of developer machine state:

- 26 failures — the suite builds fixture repositories in the OS temp directory, which falls outside any `includeIf` scope set for this checkout, so fixture commits do not inherit the identity the checkout itself commits with and fall back to the bare global config. On a machine keeping a separate identity for this fork, that misattributes every fixture commit and signs it under the other identity's `commit.gpgsign`, which fails outright (store bootstrap, worktree identity, learned-skill suites). Signing is the visible half; the identity substitution is the half that matters for a public fork, since anything a fixture records can reach a golden file. A whole-tree hygiene scan confirms nothing has ever leaked into a tracked file.
- 3 failures — `LANG=ja_JP.UTF-8` makes `bootstrap.test.ts` resolve `ja` where it asserts `en`.

Both were confirmed environmental rather than branch-caused by toggling only the environment: the identical checkout passes with the global git config and locale neutralized and fails without, and every failing file is outside this branch's diff. D8's rationale ("one setup-level scrub is smaller than N per-file patches and removes the local/CI divergence instead of encoding it") applies unchanged, so a fourth `vitest.setup.ts` net layer now neutralizes global and system git config — identity moved to `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, which outrank config, and `GIT_CONFIG_GLOBAL` pointed at a never-created path inside the run-scoped machine root so it stays cross-platform — and pins `LC_ALL`/`LC_MESSAGES`/`LANG`. Pinned rather than deleted: deleting would hand the decision to macOS `AppleLocale`, which is machine state too. Every locale-driving test sets `RASEN_LANG` or a config value, both of which outrank the pin.

Result: bare `pnpm test`, no environment overrides, 345/345 files and 6034 passed on this machine.

## Verdict

**DONE.** No open findings. `npx tsc --noEmit` clean, `pnpm lint` clean, full suite green, and the fixed behavior re-smoked from a live `omp` session (refusal on implicit `--latest`, exit-1 hard error on `--limit 0`, unchanged reading with `--runtime claude`).
