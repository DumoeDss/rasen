# Verification Report: `ecp-durable-agent-session-host`

Date: 2026-08-04\
Round: 1 delta re-verification\
Verifier: `/root/ecp7_host_verifier_1`\
Mode: dispatched, report-only

## Outcome

Round 1 resolves most ordinary-path defects, and every fresh static/focused gate
passes. Independent boundary probes still reproduce five Major findings and one
Minor finding. The Change therefore remains blocked and tasks 9.8/9.9 cannot be
checked. Task 9.10 remains intentionally pending until a clean independent
review.

- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`
- Reviewed product-scope binary diff:
  `b9aee13004e745fb84536cd35443988d3f34d756`
- Tasks: 80/88 checked. The eight unchecked items are the blocked review and
  post-review delivery tail, not eight missing apply tasks.

## Fresh gates and discriminators

| Gate | Result |
| --- | --- |
| `pnpm run build` | PASS |
| `pnpm run lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | PASS (`valid`) |
| Focused host/registry/ownership/protocol/Management/daemon/built-CLI command recorded below | PASS, 14 files / 86 tests |
| Scoped `git diff --check` over the 20-file product manifest | PASS; cumulative LF/CRLF notices only |
| `git diff -- src/commands/config.ts test/commands/config-editor.test.ts` | Empty (V11 resolved) |
| Built missing-prompt CLI probe | Expected exit 1; one `invalid-input` JSON receipt (V7 resolved) |

Independent read-only probes additionally established:

- V1 distinct wakes now produce one success, one `session-busy`, and one stdin
  write; both cancel/retire invocation orders preserve the command that wins
  CAS. A separate retire/shutdown ordering still reopens `retiring` as `idle`.
- V2 a stream omitting optional `accepted` becomes durably `sent` without an
  acceptance fact.
- V3 forced close-observer-read/terminal-settlement-write ordering leaves a
  settled idle record with the detached transport's stale PID.
- V5 an exact child bridge claimed, spawned a detached worker, and exited before
  bind; reaping returned `live-or-uncertain`, signalled nothing, and the worker
  remained alive until the verifier cleaned the exact PID.
- V6 shutdown returned while an admitted execute was blocked in backend open;
  after release it succeeded with a live PID and zero termination attempts.
- V8 a never-settling acceptance promise stayed prepared/unsettled for more
  than three times its overall deadline with zero termination.

## V1-V11 disposition

| ID | Status | Canonical severity | Reason |
| --- | --- | --- | --- |
| V1 | OPEN, partially fixed | Major | Revision CAS fixes wake and cancel/retire, but shutdown tail can overwrite `retiring`. |
| V2 | OPEN | Major | Neutral acceptance fence remains optional. |
| V3 | OPEN, downgraded residual | Minor | Idle recovery works; observer CAS loss leaves stale durable PID. |
| V4 | RESOLVED | — | Startup never normalizes `retiring` to executable state. |
| V5 | OPEN, displaced boundary | Major | Pre-spawn fake authority and post-spawn/pre-bind orphan remain. CSO native HIGH, confidence 9/10. |
| V6 | OPEN, partially fixed | Major | Known transports drain concurrently; in-flight opens are absent from the shutdown snapshot. |
| V7 | RESOLVED | — | Filesystem/backend/timeout input maps to typed `invalid-input` before daemon contact. |
| V8 | OPEN, partially fixed | Major | Three event clocks work only after unbounded acceptance resolves. |
| V9 | RESOLVED | — | Duplicate same-id init reaches and is rejected by the reducer. |
| V10 | RESOLVED | — | Bloom/root-gate planning facts are current and distinguish task 9.10. |
| V11 | RESOLVED | — | Unrelated config-editor diff removed. |

The CSO V5 is the same finding as verification/review V5 and is counted once.

## Requirement coverage

Coverage includes proposal/design obligations, not only named happy-path
scenarios. Seven of 14 requirements are complete; seven remain partial.

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Stable hosted identity across bounded turns | PASS | Create/wake and replacement driver paths pass. |
| Exact ownership and canonical cwd | PASS | Revision CAS and path matrix pass. |
| Atomic machine-local registry | PASS | Atomic/corrupt/revision/privacy gates pass. |
| Exact recovery without ambiguous replay | PARTIAL | Optional acceptance, close-observer PID, and unbound worker gaps remain (V2, V3, V5). |
| Generation-exact cancel/restart/retire | PARTIAL | Sequential and cancel/retire cases pass; shutdown can erase terminal intent (V1). |
| Bounded deterministic injection-safe protocol | PARTIAL | Framing/limits/injection pass; acceptance is outside all wall clocks (V8). |
| One-receipt resident Session CLI | PASS | Normal and invalid-input built CLI E2E pass. |
| No execution/trust authority | PASS | Static/API boundary remains clean. |
| Deterministic cross-platform lifecycle replay | PARTIAL | Existing matrix passes but has no pre-bind or in-flight-shutdown discriminator (V5, V6). |
| Sessions observable during/after execution | PARTIAL | Ordinary views pass; an idle record can retain a closed transport PID (V3). |
| Server remains reader/launcher | PASS | No canonical Run/trust mutation. |
| Resident daemon owns supervision | PASS | Driver/terminal/readiness paths pass. |
| Daemon shutdown reaps sessions honestly | PARTIAL | Known transports drain; admitted in-flight opens escape the snapshot (V6). |
| Startup reconciles lifecycle before readiness | PARTIAL | Ordinary idle/retired/corrupt cases pass; missing worker token is permanently uncertain (V5). |

## Named scenario coverage

All 54 scenarios are mapped below. Fifty pass their exact named conditions;
four are partial or blocked. V2, V3, and V8 are additional requirement/design
gaps not fully expressed by a named scenario.

### `durable-agent-session-host` (34)

| Scenario | Status | Evidence / gap |
| --- | --- | --- |
| Create and wake reuse one hosted Session | PASS | Focused host/CLI tests. |
| A replacement driver reattaches logically | PASS | Resident two-driver E2E. |
| Unsupported backend is rejected before launch | PASS | Negative backend gate. |
| Concurrent wake is rejected without duplicate input | PASS | Fresh CAS probe and regression. |
| Different cwd cannot resume the Session | PASS | Ownership tests. |
| Windows aliases preserve exact cwd identity | PASS | Injected Windows path matrix. |
| Removed checkout fails closed | PASS | Ownership/store tests. |
| Idle and retired Sessions remain inspectable after restart | PASS | Reconstruction tests. |
| Crash at a registry publication boundary exposes no partial state | PASS | Registry fault matrix. |
| Concurrent registry mutation has one winner | PASS | Revision/process-generation contention tests. |
| Corrupt registry fails closed | PASS | Registry/readiness tests. |
| Registry records lifecycle rather than sensitive execution content | PASS | Schema/security inspection. |
| Idle Session resumes after daemon restart | PASS | Exact-resume tests. |
| Active crash does not replay input | PASS | Ambiguity/no-replay tests; V2 remains a pre-acceptance classification design gap. |
| Crash before backend identity is known is not guessed | PASS | Missing-identity recovery test. |
| Unattachable surviving tree is cleaned before recovery | BLOCKED | A spawned but unbound worker has no root PID the reaper can signal (V5). |
| Cancel reaps a resistant process tree | PASS | Real process-tree test. |
| Restart opens a new exact generation | PASS | Restart test. |
| Live owner blocks restart | PASS | Ownership/control test. |
| Retired Session never wakes again | PARTIAL | Completed retirement is terminal; concurrent shutdown can prevent completion by reopening durable intent (V1). |
| Fragmented multibyte protocol succeeds | PASS | Protocol decoder tests. |
| Malformed or oversized event fails safely | PASS | Protocol/output bound tests. |
| Duplicate terminal result is not double-settled | PASS | Reducer and production adapter tests. |
| Metacharacters and multiline input remain data | PASS | Real Windows/injected POSIX wrappers. |
| Fresh exec and wake return stable receipts | PASS | Built CLI E2E. |
| Invalid input starts nothing | PASS | Built invalid-input E2E and independent probe. |
| Caller exit does not end hosted Session | PASS | Resident daemon E2E. |
| Successful turn leaves canonical Run unchanged | PASS | Authority inspection. |
| Signing material has no host path | PASS | Shape/static scan. |
| Replay produces same lifecycle | PASS | Replay normalization tests. |
| Current-host gates exercise real OS behavior | PASS | Windows process/registry gates. |
| Non-host branches remain deterministic/explicit | PASS | Injected platform cases. |
| Portfolio delivery closes real platform matrix | PASS | Correctly assigned to ECP-8. |
| Network absence does not skip gates | PASS | Offline fixtures. |

### `session-supervision` (9)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Live session appears in listing | PASS | Management API test. |
| Hosted lifecycle facts are additive | PASS | API/schema tests. |
| Run-state joined for targeted change | PASS | Existing join test. |
| Ended session remains observable | PASS | Ended/retired listing tests; V3 concerns a recoverable idle transport fact. |
| Hosted session survives reconstruction | PASS | Recovery/API test. |
| Unknown session id | PASS | API negative test. |
| Session activity writes bounded lifecycle only | PASS | Static/security boundary. |
| Pipeline truth survives registry | PASS | Authority inspection. |
| Host lifecycle cannot complete a run | PASS | No trusted completion path. |

### `daemon-residency` (11)

| Scenario | Status | Evidence / gap |
| --- | --- | --- |
| Sessions survive launching terminal | PASS | Real daemon E2E. |
| Replacement driver uses resident transport | PASS | Two-driver E2E. |
| Start returns only on readiness | PASS | Convergence tests. |
| Foreground form for debugging | PASS | Daemon tests. |
| Stop reaps live sessions | BLOCKED | An admitted open can become live after the shutdown snapshot and receive no termination (V6). |
| Clean stop preserves recoverable identity | PASS | Ordinary idle clean-stop path. |
| Forced daemon death is reported without replay | PARTIAL | Published workers pass; pre-bind worker has no recoverable root authority (V5). |
| Idle record becomes lazily recoverable | PASS | Startup recovery. |
| Retired record remains terminal | PASS | Startup retired/retiring tests; V1 is concurrent clean shutdown. |
| Old live tree is not adopted by PID alone | PASS | Exact-owner mismatch tests. |
| Registry failure does not produce false readiness | PASS | Corrupt-registry readiness. |

## Open finding locations

- Major V1: `src/core/session-host/host.ts:1123-1134`.
- Major V2: `src/core/session-host/backend.ts:25-28`,
  `src/core/session-host/host.ts:631-635`.
- Major V5: `src/core/session-host/host.ts:358-379`,
  `src/core/claude/session-state.ts:273-279,673-675`.
- Major V6: `src/core/session-host/host.ts:367-395,1105-1138`.
- Major V8: `src/core/session-host/host.ts:176-245,631`.
- Minor V3: `src/core/session-host/host.ts:436-465`.

## Next gate

Route the five Major findings and one Minor to a non-author fixer. Required new
regressions are: retire vs shutdown with independent termination completion;
mandatory/missing acceptance; observer CAS loss after valid terminal result;
crash-before-spawn and crash-after-spawn-before-bind; shutdown during held
backend open; and an acceptance promise that exceeds overall timeout. After the
delta is fixed, repeat independent review and CSO confirmation. Do not run task
9.10 or the ship/archive tail yet.

```text
TEST EVIDENCE
scope: Round 1 ECP-7 child-1 product delta; focused host/registry/ownership/protocol/Management/daemon/built-CLI suites plus independent CAS, terminal, acceptance, close-observer, ownership-crash, shutdown-open, and clock probes
rationale: re-review every V1-V11 disposition on the fixer fingerprint; full root/UI gates remain task 9.10 after a clean review
commands: pnpm run build; pnpm run lint; pnpm exec tsc --noEmit; node bin/rasen.js validate ecp-durable-agent-session-host --strict; pnpm exec vitest run test/core/session-host test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1; scoped git diff --check; built missing-prompt CLI probe; seven inline built-product discriminators recorded in review-cycle-report.md
result: pass
tree: 58489c46633a209d2c1761c2a4b684ad8b95cb48
diff: b9aee13004e745fb84536cd35443988d3f34d756
note: static/focused gates pass; verification is blocked by reproduced semantic counterexamples
```

VERIFY VERDICT: BLOCKED — Blocker:0 Major:5 Minor:1 Trivial:0

## Round 2 independent confirmation

- Exact reviewed delta-state SHA-256:
  `1c24cfcdb1d2b6e5506b72df7a878f1101abf12c991961cb1e6f6bbaa8cc9527`.
- `pnpm run build`: PASS.
- Exact focused command named in the Round 2 fixer report: PASS, 16 files and
  118/118 tests.
- `pnpm run lint`: PASS.
- `pnpm exec tsc --noEmit`: PASS.
- `node bin/rasen.js validate ecp-durable-agent-session-host --strict`: PASS
  (`valid`).
- Full root and UI suites were intentionally not run; task 9.10 remains the
  post-review final gate.

### Current finding closure

| ID | Current status | Independent evidence |
| --- | --- | --- |
| V1 | PASS | Retirement remained monotonic through the adverse shutdown-tail ordering. |
| V2 | PASS | Missing acceptance failed pre-acceptance as `backend-protocol-failed`. |
| V3 | PASS | Observer CAS retry cleared the stale PID without regressing settlement. |
| V5 | BLOCKED | Matching stale PID was signalled after reuse; a real Windows supervisor crash left a detached descendant alive after root cleanup. |
| V6 | BLOCKED | Late-open `closed:false` and throw paths released the claim and cleared process authority while the process remained live. |
| V8 | PASS | Acceptance timeout settled/terminated once; late fence resolution had no second effect. |

### Named-scenario impact

- `Unattachable surviving tree is cleaned before recovery`: **BLOCKED** by
  V5 descendant containment.
- `Registry PID has been reused`: **BLOCKED** by V5's absence of an OS
  process-instance fingerprint.
- `Stop reaps live sessions`: **BLOCKED** for V6's unobserved late-open close.
- `Forced daemon death is reported without replay`: **PARTIAL** because
  request non-replay remains correct but the admitted descendant may escape
  recoverable containment.
- Mandatory acceptance, terminal retirement, and close-observer lifecycle
  scenarios now pass their Round 2 discriminators.

Tasks 9.8 and 9.9 remain unchecked. Task 9.10 remains pending. Verification
cannot become CLEAN until V5 and V6 have fresh regressions, fixes, and a new
independent re-review/CSO confirmation.

```text
TEST EVIDENCE
scope: Round 2 exact 15-file durable-host delta plus report-excluded independent probes
rationale: re-review only V1/V2/V3/V5/V6/V8 and new regressions; reserve full root/UI for task 9.10
commands: pnpm run build; exact 16-file focused Vitest command from review-cycle-report.md; pnpm run lint; pnpm exec tsc --noEmit; node bin/rasen.js validate ecp-durable-agent-session-host --strict; built inline V1/V2/V3/V5/V6/V8 discriminators
result: focused static gates pass; semantic verification blocked by V5 and V6 counterexamples
tree: 58489c46633a209d2c1761c2a4b684ad8b95cb48
diff: 1c24cfcdb1d2b6e5506b72df7a878f1101abf12c991961cb1e6f6bbaa8cc9527
```

VERIFY VERDICT: BLOCKED - Blocker:0 Major:2 Minor:0 Trivial:0

## Strategy attempt 1 — independent verification (2026-08-04)

| Contract / gate | Result | Independent evidence |
| --- | --- | --- |
| Historical R3-V5-A: Windows controller death closes the full detached tree | PASS | Real Windows controller-death test plus duplicate-handle and early-activation mutations passed (4/4 native tests) |
| Historical R3-V5-B: exact remaining-POSIX identity | FAIL | Linux uses boot/start ticks + pidfd, but macOS passes a 40-byte struct where XNU requires 56 bytes; cross compile is not a runtime identity proof |
| Death matrix: backend root exits while descendants remain | FAIL | Real Windows probe resolved `closed` while `inspect(ref)` was live/controllable and the detached child remained alive |
| Replacement cleanup of positively identified POSIX trees | FAIL | One-shot path signals controller only; POSIX containment has no controller-death reaper and Drop only closes pidfd |
| Every process-control fault path is bounded | FAIL | Native `activate` and `abort` waits have no `controlTimeoutMs` race |
| Package placement, protocol/capability/hash verification | PASS | Negative resolver suite passed; dry-run pack included the current manifest/helper and independent length/SHA matched |
| Source-identical helper build reproducibility | WARN | Adjacent manifest is self-consistent, but repeated clean-target builds yielded different binary SHA-256 values |
| Focused behavior regression suite | PASS | 21 files / 140 tests, including 3/3 CLI E2E |
| Static/native quality gates | PASS | build, lint, TypeScript, Rust fmt/clippy, Linux/macOS target checks, strict Change validation |

The implementation is not spec-complete despite all automated suites passing:
the suite lacks discriminators for the four Major paths above. Tasks 9.8 and
9.9 remain unchecked and task 9.10 must not start as the final post-review gate.
No product/test/tasks/run-state/ship/archive state was changed by this
verification.

VERIFY VERDICT: BLOCKED - Blocker:0 Major:4 Minor:1 Trivial:0

## Round 3 independent confirmation

Verification was repeated against HEAD
`050fc84332b26a75a07f441efd6b235842f89e1e`, tree
`58489c46633a209d2c1761c2a4b684ad8b95cb48`, and exact Round 3 manifest
SHA-256 `df1d7bf6ac444a334969dac7e68c4e4ab3df0f8bf448fb00a4801512164ceaca`.
The Change remains 80/88 tasks complete: 9.8, 9.9, 9.10, and the delivery tail
remain pending.

### Artifact and implementation verification

- The required host, registry, ownership, management-server, daemon, docs,
  evidence, and test surfaces are present and internally consistent.
- Process claims now bind bridge and worker process-instance identities, and
  Windows/Linux reuse discriminators pass.
- Late-open failed termination retains live authority; retry, server stop, and
  daemon behavior compose correctly. V6 is resolved.
- Windows Job containment is established before backend activation, but a real
  controller-death discriminator leaves both root and detached descendant
  alive. The V5 containment requirement remains blocked.
- Remaining POSIX hashes second-resolution `ps lstart` output. That is not an
  exact process instance, and its production branch has no reuse regression.
  The V5 exact-identity requirement remains blocked.

### Named-scenario disposition

| Scenario / invariant | Round 3 result | Evidence |
|---|---|---|
| Detached descendants remain contained if the controller dies | BLOCKED | Exact PowerShell controller killed; root and detached descendant remained live for six seconds. |
| Registry PID has been reused | BLOCKED on remaining POSIX | Windows/Linux injected probes pass, but the fallback identity aliases same-second starts. |
| Failed late-open termination retains authority | PASS | `closed:false` and throw retain claim/process facts; retry releases once. |
| Management/daemon stop cannot claim clean shutdown early | PASS | Server stop remains retryable and daemon retains state on failure. |
| Prompt-owned execution and authority boundaries remain unchanged | PASS | Negative authority/injection scans and static review. |

### Fresh gate evidence

```text
TEST EVIDENCE
scope: exact Round 3 20-file durable-host manifest plus report-excluded real controller-death probes
rationale: independent V5/V6 confirmation; full root/UI remains reserved for task 9.10
commands: pnpm run build; pnpm exec vitest run test/core/session-host test/core/agent-cli-process.test.ts test/core/claude/runner.test.ts test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1; pnpm run lint; pnpm exec tsc --noEmit; node bin/rasen.js validate ecp-durable-agent-session-host --strict; git diff --check
result: build PASS; focused Vitest PASS 16 files 125/125; lint PASS; typecheck PASS; strict validation PASS; diff check PASS; semantic verification blocked by two V5 counterexamples
tree: 58489c46633a209d2c1761c2a4b684ad8b95cb48
manifest: df1d7bf6ac444a334969dac7e68c4e4ab3df0f8bf448fb00a4801512164ceaca
delta-state: 8742602b1918e17c73d49ccf74833a14901bce5c08ad5dc218498fca9e498202
content: 335cc0b265014bd96ce6efc6e3d0c558aabc418b5a4bfa77b2dc27842a55fe89
```

Tasks 9.8 and 9.9 remain unchecked. Task 9.10 remains pending. The Change
cannot advance to the full post-review gate until both V5 findings are fixed
and independently confirmed.

VERIFY VERDICT: BLOCKED - Blocker:0 Major:2 Minor:0 Trivial:0

## Current authoritative verification verdict (strategy attempt 1)

The fresh independent verification supersedes the historical Round 3 tail:
the strategy remains blocked by four Major and one Minor finding even though
all fresh automated gates passed.

VERIFY VERDICT: BLOCKED - Blocker:0 Major:4 Minor:1 Trivial:0
