## 1. Reasoning-Effort Configuration

- [x] 1.1 Define one exported leaf-effort vocabulary (`low`, `medium`, `high`, `xhigh`, `max`) and use it in pipeline definitions, project/global config schemas, and command validation while retaining the low-level Codex builder's compatibility clamp outside first-class dispatch.
- [x] 1.2 Add `efforts.default` and `efforts.roles.<role>` to global/project/store config parsing, the config-key registry, serialization, and resilient invalid-leaf diagnostics using the existing role constants.
- [x] 1.3 Add `pipelines.<name>.efforts.<stage>` to scoped pipeline config parsing and stage-override resolution, using explicit stage lookup rather than pattern matching.
- [x] 1.4 Implement project/store/global effort layers and the documented precedence in `resolveStageRuntimeConfig()`, including an independent `effortSource` on CLI, execution-plan, management API, and UI-facing resolved views.
- [x] 1.5 Add focused config and pipeline-registry tests for every precedence edge, invalid resilient-layer fallback, authored-value rejection, absent runtime default, independent model/effort provenance, `gpt-5.6-luna` + `max`, `gpt-5.6-terra` with a different supported effort, and an arbitrary non-empty model id.

## 2. Codex Bridge Result and Process Primitives

- [x] 2.1 Add Codex success/failure receipt types and parsers with stable failure kinds, exact thread identity, canonical cwd, selected sandbox/model/effort, invocation warnings, optional rollout transcript, and shared typed leaf/evaluate results.
- [x] 2.2 Extract the Claude diagnostic redaction/truncation and bounded UTF-8 capture logic into runtime-neutral helpers, preserving Claude behavior and adding Codex secret-redaction and byte-bound tests.
- [x] 2.3 Extend the Codex invocation boundary with a spawn-safe stdin prompt form that reuses the fully assembled prompt/flat guard while omitting multiline prompt text from argv; preserve existing argv and shell-rendering consumers.
- [x] 2.4 Add explicit temporary schema and last-message file management using `os.tmpdir()` plus `path.join()`, byte-bound the returned file before parsing, and clean only the named scratch files/directory with Windows lock-tolerant cleanup reporting.
- [x] 2.5 Implement the Codex runner on the shared agent CLI launcher: write the bounded prompt once, close stdin, capture JSONL/stdout/stderr without leakage, parse thread events, validate the last-message contract, locate the rollout when available, and return exactly one receipt.
- [x] 2.6 Enforce timeout and capture limits in the runner, terminate the complete process tree on setup failure/timeout/overflow, wait for child close, clear timers, and retain a captured thread id in failure diagnostics when available.

## 3. Exact-Thread Ownership and Resume

- [x] 3.1 Back Codex resume ownership with durable cross-process thread state derived from the existing Claude process-tree claim pattern, including atomic claim, worker-PID binding before prompt release, idempotent release, and dead-tree-only recovery.
- [x] 3.2 Integrate exact `codex exec resume <threadId>` into the runner, omit the unsupported sandbox flag, preserve structured result/model/effort flags, reject a conflicting emitted thread id, and surface the creation-time sandbox warning.
- [x] 3.3 Add unit tests for same-process and cross-process duplicate claims, independent-thread concurrency, release/reclaim, and bridge-parent death while the Codex worker tree survives.
- [x] 3.4 Add fresh-to-resume end-to-end fixture coverage proving that a new Rasen CLI process resumes the exact recorded thread id with the same structured contract and never selects a latest thread.

## 4. CLI Dispatch Integration

- [x] 4.1 Refactor `AgentCommand.dispatch()` so shared prompt/cwd/timeout/contract validation runs once and runtime-specific validation narrows cleanly to the existing Claude branch or the new Codex branch without changing Claude receipts.
- [x] 4.2 Resolve Codex through `RASEN_CODEX_BIN` or `codex`, accept optional non-empty model and canonical leaf effort, invoke the runner for fresh/resume calls, and keep all invalid input inside the single-receipt/non-zero-exit contract.
- [x] 4.3 Add a fake Codex CLI fixture that emits configurable JSONL, thread ids, last-message contents, errors, oversized output, held processes, and EOF evidence; provide a Windows `.cmd` shim and POSIX executable entry using native path construction.
- [x] 4.4 Extend `test/cli-e2e/agent-dispatch.test.ts` (or a focused Codex sibling) across Luna, Terra, and arbitrary non-empty model pass-through; success; evaluate; missing identity; missing/malformed/contract-invalid last message; non-zero exit; timeout; output limit; unavailable runtime; and no child-stream leakage, proving no model discovery or allow-list is consulted.
- [x] 4.5 Add platform transport tests with paths containing spaces and multiline CJK/quotes/metacharacters, asserting prompt bytes travel through stdin and EOF is observed on POSIX, Windows native-executable preparation, and the Windows `.cmd` shim.

## 5. Orchestration and Durable Worker Metadata

- [x] 5.1 Update the orchestration playbook's Codex exec-bridge section to invoke `rasen agent dispatch --runtime codex`, parse only `ok: true` receipts, record exact thread/transcript/model/effort metadata, and resume through the same CLI bridge.
- [x] 5.2 Update Codex-native guidance to pass any resolved non-empty model id and independent effort, use `fork_turns: "none"` whenever either override is selected, explicitly seed required change artifacts, and forbid claiming a model switch on a full-history fork or special-casing Luna/Terra families.
- [x] 5.3 Teach batching of consecutive no-intermediate-result instructions on one warm process thread while preserving one-writer-per-thread and independent-thread parallelism; keep ordinary same-host stages native and retain `exec-bridge` as the only process dispatch mode.
- [x] 5.4 Extend Codex worker-record construction and orchestration/run-state tests for the receipt's exact thread id, canonical cwd where surfaced, transcript, sandbox, model, and effort without making archived optional fields mandatory.
- [x] 5.5 Recompute only the affected generated workflow/template golden hashes and run the template parity suite to prove no unrelated template moved.

## 6. Cross-Platform Verification

- [x] 6.1 Run focused unit and end-to-end suites for config resolution, pipeline resolution, Codex invocation/events/contracts/lifecycle, agent process launching, CLI dispatch, run-state, and orchestration templates.
- [x] 6.2 Run `pnpm lint`, `pnpm build`, and the full `pnpm test` suite; record and triage any pre-existing unrelated failure separately rather than weakening the new assertions.
- [ ] 6.3 Verify the focused dispatch and process-tree tests on Windows CI in addition to the existing macOS/Linux coverage, including `.cmd` shim launch, hidden windows, native separators, spaces in paths, EOF, timeout teardown, and lock-tolerant scratch cleanup.
- [x] 6.4 Perform an opt-in real Codex smoke test with `gpt-5.6-luna` and `max`: fresh structured dispatch, exact-thread resume from a second process, two independent concurrent threads, and bounded completion with stdin closed; do not make network/account availability a mandatory CI gate.
