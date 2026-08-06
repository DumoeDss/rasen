## 1. Declaration layer (`src/core/runtime-adapters.ts`, leaf — no new runtime imports)

- [x] 1.1 Declare the four contracts as types only: `SessionStore`, `ContextReader`, `AuditReader`, `DispatchAdapter`, with `SessionStore.recognizes({ path, firstLine })`, `SessionStore.locateLatest`, and `DispatchAdapter.{bridge,cliLabel,installHint,binaryEnvVar,defaultBinary,probeAvailability,buildInvocation,spawn,childEnv}` (design D3, D6, D7)
- [x] 1.2 Convert `detectHostRuntime`'s if-chain to an ordered `HOST_FINGERPRINTS` table carrying the existing precedence rationale, preserving resolution order and results exactly (design D10)
- [x] 1.3 Replace `KNOWN_DISPATCH_ROUTES` with the derivation rule plus an empty `ROUTE_EXCEPTIONS` map, keeping `DispatchMode`'s `'unsupported'` member (design D5)
- [x] 1.4 Add `SNIFF_FALLBACK_RUNTIME = 'claude'` as a named, documented constant (design D4)
- [x] 1.5 Verify `test/core/runtime-adapters.test.ts:161-171`'s route `it.each` table passes byte-unchanged — the oracle for 1.3

## 2. Implementation registry (`src/core/runtimes/registry.ts`, new)

- [x] 2.1 Create the registry module importing the existing implementations from their current paths; do not move `src/core/claude/`, `src/core/codex/`, `src/core/token-audit/`, or `src/core/agent-context.ts` (design D9)
- [x] 2.2 Register `SESSION_STORES` for claude, codex, and zed `satisfies Record<RuntimeAdapterId, SessionStore>` — extract each store's recognition from the current sniff and extension checks without changing what any existing target resolves to
- [x] 2.3 Register `CONTEXT_READERS` for claude and codex `satisfies Record<ProbeRuntime, ContextReader>`, wrapping `computeContextFromTranscript` and `computeContextFromRollout` unchanged
- [x] 2.4 Register `AUDIT_READERS` for claude, codex, and zed `satisfies Record<AuditRuntime, AuditReader>`, wrapping `runClaudeAudit`, `runCodexAudit`, and `runZedAudit` unchanged
- [x] 2.5 Register `DISPATCH_ADAPTERS` for claude and codex `satisfies Record<DispatchRuntime, DispatchAdapter>`, moving `cliLabel`, `installHint`, `binaryEnvVar`, `defaultBinary`, and the availability probe onto the adapters
- [x] 2.6 Add a build-enforcement test asserting all four maps compile against their derived unions, covering both directions (missing implementation → `TS1360`, undeclared implementation → `TS2353`) per the verified probe at `<ephemeraDir>/research/satisfies-probe.ts` (design D2)

## 3. Retire the branch sites

- [x] 3.1 Replace `sniffTranscriptKind`/`detectTranscriptKind` (`agent-context.ts:192-233`) with the single-read first-match loop over `SESSION_STORES` terminating in `SNIFF_FALLBACK_RUNTIME`
- [x] 3.2 Replace `resolveTranscriptPath`'s codex/claude arms (`agent-context.ts:453-465`) and the occupancy computation selection with `CONTEXT_READERS` lookups
- [x] 3.3 Convert the `runtimeOrCwd === 'claude' || runtimeOrCwd === 'codex'` sentinel (`agent-context.ts:513-517`) to `hasRuntimeCapability(runtimeOrCwd, 'canProbeContext')`, so a non-probe runtime can no longer leak into the `cwd` argument
- [x] 3.4 Replace `resolveRuntimeKind` and the `runAudit` if-chain (`token-audit/audit.ts:150-155,188-190`) with `SESSION_STORES` recognition plus an `AUDIT_READERS` lookup, and derive the usage string from `AUDIT_RUNTIMES`
- [x] 3.5 Replace the three implicit-else-is-Zed sites in `token-audit/management.ts` (report validation, the hand-built `discoverers` tuple, `resolveNativeAuditTarget`) with `AUDIT_READERS` lookups
- [x] 3.6 Replace the three binary bridge ternaries in `pipeline-registry/execution-validation.ts` (`:141`, `:152`, `:321-324`) with `DISPATCH_ADAPTERS[target]` field reads, and add a `probe` injection seam per adapter alongside the existing `probeCodex`/`probeClaude` options
- [x] 3.7 Replace the hand-written `['claude','codex'] as const` keepalive loop in `project-config.ts:1346` with an iteration over the derived tuple, so an unlisted runtime key is no longer dropped without a warning
- [x] 3.8 Confirm no `=== '<runtime literal>'` comparison over a runtime id remains in `src/` except the two deliberate `'unknown'` distinctions (`agent-context.ts:613`, `execution-validation.ts:267`)

## 4. Live defect fixes

- [x] 4.1 Register the Oh My Pi `SessionStore` with recognition only — no `ContextReader`, no `AuditReader`, no capability flag change (design D8)
- [x] 4.2 Make `agent context --transcript <recognized, no reader>` exit non-zero with a message naming the harness, and make `tryContextEstimate` return absence rather than an estimate for the same input
- [x] 4.3 Make `agent audit <recognized, no auditor>` exit non-zero naming the harness, refusing before any report file is written
- [x] 4.4 Merge `DispatchAdapter.childEnv` over the inherited environment in `src/core/claude/runner.ts:199` for every rasen-owned spawn, and declare `childEnv: { RASEN_AGENT_RUNTIME: 'claude' }` on the Claude adapter (design D7)
- [x] 4.5 Add `opus-5` to the 1M match list in `src/core/model-presets.ts:45-57` (design D14)
- [x] 4.6 Verify `test/core/config-keys.test.ts:475` and the derived-tuple assertions in `test/core/runtime-adapters.test.ts:49-53` are unchanged — a diff there means a capability was flipped by mistake

## 5. Tests

- [x] 5.1 Add recognition tests: an Oh My Pi session file resolves to `omp`; a Claude transcript, a Codex rollout, and a Zed database each resolve as before; an unclaimed file resolves to the declared fallback
- [x] 5.2 Add probe refusal tests for an explicit `--transcript` naming an Oh My Pi file (non-zero, harness named, no occupancy fields) and for the opportunistic estimate returning absence rather than zero
- [x] 5.3 Add audit refusal tests for an Oh My Pi target (non-zero, harness named, no report file written)
- [x] 5.4 Add a bridge-child identity test asserting a Claude worker spawned with Codex fingerprints in its parent environment resolves host runtime `claude`
- [x] 5.5 Add `resolveModelLimit` cases for `claude-opus-5` and `anthropic/claude-opus-5` returning 1000000
- [x] 5.6 Add a bridge-diagnostics test asserting the unavailability message names the failing bridge's own tool and install advice, and that the availability check performed is that bridge's own
- [x] 5.7 Set and restore `OMPCODE` inside any new host-sensitive suite — `vitest.setup.ts` scrubs it so the default host is `unknown`, matching CI

## 6. Copy, prompts, and docs

- [x] 6.1 Update the three locale catalogs for any wording the derivation or the refusals falsify, keeping placeholder sets identical across `en`, `ja`, and `zh-cn`
- [x] 6.2 Update the shipped playbook sentences that state the route matrix or the probe refusal as invariants (`templates/workflows/_orchestration.ts`, `auto.ts`, `handoff.ts`, `goal-command.ts`, `audit.ts`)
- [x] 6.3 Recompute the affected SHA-256 baselines in `test/core/templates/skill-templates-parity.test.ts` and re-run the skill freshness gate
- [x] 6.4 Update the published route matrix and precedence list in `docs/artifact-workflow-guide.md` and `docs/zh/artifact-workflow-guide.md` to describe the derivation rather than the enumerated table

## 7. Verification

- [x] 7.1 Run `npx tsc --noEmit` and `pnpm lint`
- [x] 7.2 Run the full test suite and confirm no serialized-surface assertion changed
- [x] 7.3 Smoke test from this Oh My Pi session: `rasen agent context --transcript <omp jsonl>` refuses by name, `rasen agent audit <omp jsonl>` refuses and writes nothing, and `rasen agent context --latest` still reports the existing `unsupported-host` result
- [x] 7.4 Smoke test that `rasen pipeline show --for-execution` reports the same routes, modes, and bridges as before the change

## 8. Sequencing and cleanup

- [x] 8.1 Archive `detect-omp-host-runtime` before archiving this change, so this change's `MODIFIED` requirements layer on its delta instead of reverting it (design D13)
- [x] 8.2 Record the follow-on order in the change's evidence: Oh My Pi `locateLatest` + `ContextReader`, then `AuditReader`, then `DispatchAdapter` with the keepalive decision (design D12)
- [x] 8.3 Record the two typecheck-free mirrors as declared follow-ups of the audit capability change: relax `packages/ui/src/api/types.ts:341` first, and replace `viewer/audit.html`'s allow-list with a schema-tag check plus an explicit unknown-runtime render arm (design D11)
- [x] 8.4 After this change ships in `v0.1.7` and the fixed behavior has been observed in real use, retire the temporary `omp-session-file-fabricated-zeroes` learned skill with `rasen knowledge retire` (design D15) — gated on observation, not on merge

## 9. Review round (`evidence/review-report.md`)

- [x] 9.1 Make the worker identity TARGET-SCOPED, not sticky: `childEnv` required on every dispatch adapter and typed `RuntimeIdentityEnv<Id>` so a wrong id fails the build; `bridgeChildEnv` merges unconditionally; `CodexExecInvocation.env` + `formatShellInvocation` carry it to the playbook-owned spawn; the orchestration playbook states it as an invariant (design D7, amended twice)
- [x] 9.2 Split `MODEL_PRESETS` so Opus 4.0/4.1/4.5 resolve to their real 200k window while 4.6+ and 5 keep 1M, with a regression test over both directions (design D14, amended)
- [x] 9.3 Bound recognition's read: regular-file gate plus a 64 KiB prefix, so `agent audit /dev/zero` (or a FIFO) fails actionably instead of hanging — reachable only because unified recognition dropped the audit path's `.jsonl` gate (design D4's third exception)
- [x] 9.4 Restore `.claude/skills/rasen-npm-pack/`, deleted in the worktree by no decision of this change
- [x] 9.5 Enforce `RECOGNITION_ORDER` completeness at build time — a registered runtime missing from it was silently never consulted and its targets fell to `SNIFF_FALLBACK_RUNTIME`; verified the assertion fires (`TS2344`)
- [x] 9.6 Ignore `rasen/.learned-skill-materializations.json`: per-checkout state, untracked and un-ignored, beside its already-ignored sibling ledger
- [x] 9.7 Fix the stale references the extraction left: `runtime-adapters.ts`'s header naming a `registry.ts` that never shipped, `token-audit/audit.ts`'s header naming the deleted `detectTranscriptKind` (which `verification-report.md` claimed was already rewritten), the unused `session` binding and the dedented `try`/`finally` in `token-audit/management.ts`, and the published route rules that stated the `ROUTE_EXCEPTIONS` check last when the code applies it before `native`
- [x] 9.8 Deferred, recorded in `evidence/review-report.md`: the `installHint`/`cliLabel` role inversion at `commands/agent.ts:405` (F6), the availability probes' duplicate binary facts (F7), `commands/validate.ts`'s one-key probe stub (F8), task 3.3's overstated claim plus the unused `isRuntimeAdapterId` (F9), the un-MODIFIED baseline `cli-agent-context` detection sentence (F10), the unpinned audit workflow template (F11), and the recognition tests living in the wrong mirror file (F12)
