# Planner handoff - ecp-frozen-action-session-executor (propose)

For: the implementer and the LEAD. Stage: propose artifacts complete, awaiting implementation-first dispatch.

## Artifacts

- `rasen/changes/ecp-frozen-action-session-executor/proposal.md`
- `rasen/changes/ecp-frozen-action-session-executor/design.md`
- `rasen/changes/ecp-frozen-action-session-executor/specs/frozen-action-session-executor/spec.md`
- `rasen/changes/ecp-frozen-action-session-executor/tasks.md`
- (seed) `rasen/changes/ecp-frozen-action-session-executor/planning-context.md`

## Task count and structure

`tasks.md` has 11 sections / 47 tasks: 1 Baseline and context (3), 2 Frozen-Action consumption and authority validation (3), 3 Capability matrix and never-silently-reroute (4), 4 execution-lost and committed-frontier resume (3), 5 Transactional completion integrity (5), 6 Session reuse/handoff/touch/retire policy (4), 7 Driver-face same-Run parity (3), 8 Real-backend attribution (2), 9 Deterministic guards and mutation receipts (3), 10 Real receipts (5), 11 Verification and ship (4). Scope legend marks `[WSL-EXTERNAL]`, `[THIS-HOST]`, `[REAL-BACKEND]`, and the mutation-receipt rule.

## Design decisions (the five the LEAD asked for)

- **Backend roster shape.** Exactly two declared 0.2.0 tiers in one OS-by-backend matrix: `in-tool` (all three OS; host tool owns the worker; declares durable=false, headless=false, no exact-termination claim; typed `execution-lost` on launcher death) and `hosted` best-effort (all three OS via the shipped tiers - POSIX group on linux/darwin, Job on win32; daemon-lifetime durable, headless, `exactCancel:false`/`scopeEmptyProof:false`, cancel terminal `cancelled / emptiness-unproven`). The kernel-enforced tier is NOT a 0.2.0 backend (decision 13). The dispatch-topology axis (`runtime-adapter-registry`: native/exec-bridge/legacy-fallback) is kept distinct from this process-authority backend axis (Replan 4).
- **Capability-matrix representation.** A computed, queryable `ExecutionCapabilityMatrix` value (not prose), built by enumerating {linux, darwin, win32} x {in-tool, hosted-best-effort} and reading each backend's declaration + current-platform availability. Per cell: declared facts (`durable`, `headlessDriver`, `exactCancel`, `scopeEmptyProof`, `usageAttribution`) + typed availability verdict. It is the sole "when capability allows" oracle every driver face queries (acceptance 6).
- **execution-lost wiring point.** At the executor's Action-outcome reconciliation, NOT in the host or a provider. The host already returns `turn-outcome-unknown`/`interrupted` for a lost generation (host design Decision 5) and the win32 tier latches `transportLost`; the executor composes those into the distinct typed `execution-lost` Action outcome, then resumes via the Facade from the last committed Record frontier with no reattach/no revalidation (decision 11). Run/Record outcome typing belongs to the executor with session-host cooperation (Disagreements item 5).
- **Transactional-integrity mechanism.** Three composable parts on existing machinery: (1) the executor's evidence writer verifies the frozen-Action-authored complete evidence set before publishing to the durable EvidenceStore; (2) the Facade `complete` re-reads + re-verifies (integrity, completeness, binding to Action/invocation/workspace-revision/ActorRef) before any Record mutation, which stays atomic under `expectedRecordVersion` CAS; (3) a mid-publish crash leaves a half-set the re-read completeness check rejects. No signing, no key custody (decision 12); ECP-6 Ed25519 untouched.
- **Session-reuse policy source.** This change is the slice that retires the `ecp-change-run-runtime` placeholder clause. Source = the frozen Action's authored `sessionReuse` (preserved via `sessionReuseAuthored`) resolved against a declared executor policy block with `authored|definition|default` provenance. Reuse constrained to same frozen invocation/role/workspace/backend authority; over-limit/incompatible -> auditable handoff/retire. This is per-Run/per-invocation at the executor seam, distinct from cross-child reuse (`worker-reuse-config`/`worker-reuse-orchestration`, untouched).

## STALE-UNVERIFIED items re-read and resolution

The seed tagged three items `[STALE-UNVERIFIED]`; all three re-read and resolve consistently with the seed, no contradiction surfaced:

1. **Linux provider Step 1 obligation routing** (`evidence/step1-obligation-tasks.md`, `step1-task-ledger-retier.md`, `handoff/lead-4.md`). Files exist under `rasen/changes/ecp-linux-process-authority-provider/`. The two obligations are quoted verbatim in the seed and match target-state decision 11; their routing into this change (matrix surface + execution-lost) is as the seed states. Resolution: obligations stand verbatim; routed to this change as designed.
2. **Linux Section 12 pipe-EOF daemon-death teardown wave.** Explicitly parked context: the Linux namespace/zero-orphan machinery left 0.2.0 with the parked crate. The surviving daemon-death teardown receipt is the cutover's Windows `KILL_ON_JOB_CLOSE` receipt. Resolution: this change's obligation-1 receipt shape is Windows zero-orphan + Linux/macOS declared-orphan-risk-with-execution-lost-typing, exactly the seed's "SUPERSEDED receipt shape" note.
3. **Closure re-grade rows 9.10 / 11.16 / 11.17** (`archive/2026-08-08-ecp-native-process-capsule-closure/evidence/step1-scope-reconciliation.md`, read with `decision13-regrade.md`). All three NARROW under decision 13: the authority gates reshape into the OS x backend matrix; Linux/Windows add zero-orphan daemon-death + `execution-lost` receipts; macOS = in-tool + best-effort honesty. Resolution: the matrix + execution-lost are this change's surface, confirmed by the archived re-grade. Note: the closure's `decision13-regrade.md` SEC-001/RC-005 residuals are owned by those archived changes' review records, NOT by this change; this change only consumes the shipped honest-terminal structure.

## Code anchors the design rests on (re-verified at HEAD 5f33457a)

Facade `src/core/change-run/facade.ts` (`start|resume|complete|inspect|control`, `deliveryMode`, error codes `record_version_conflict`/`receipt_conflict`/`workspace-scope-mismatch`); `RecordVersion`/`expectedRecordVersion` `contracts.ts:16/436/792`; `deliveryState` `contracts.ts:601`; grant path `internal/facade-runtime.ts:214-420`; EvidenceStore `internal/evidence-store-fs.ts` + `internal/evidence.ts`; `HostEvidenceWriter` staging `src/commands/pipeline.ts:1871/1975/2060`; host `createSessionHost` `host.ts:300`, `closeDurableProcess` `:696` (release paths `:711-714`/`:715-721`), `receiptAuthorizesRelease` gates `:490/:573/:717/:1446`, terminal-persistence gate `:767`, `toHostedProcessTerminal` `:652`; seam `receiptAuthorizesRelease` `process-scope.ts:222-228`, `TerminationReceipt.state` `:142-143`, `DeclaredUnprovenReceipt` `:116`; selection `hosted-process-scope.ts:22-31`; exactly-once activation `process-scope-adapter.ts:181`; construction `router.ts:639/642`. The seed's `0f7eda09` anchors still hold at this HEAD; nothing in the closure-archive/host-review commits altered these seams.

## Validate output

`node dist/cli/index.js validate ecp-frozen-action-session-executor --strict` -> `Change 'ecp-frozen-action-session-executor' is valid`, exit 0. (Not vitest; does not touch dist/.)

## Risks flagged for reviewer attention

- The Linux/macOS execution-lost receipt-without-zero-orphan must be read as decision-13 honesty, not a regression (seed obligation-1 "SUPERSEDED receipt shape").
- The host `turn-outcome-unknown`/`interrupted` vocabulary and the executor `execution-lost` Action outcome are different layers; the mapping is explicit in design D4 and must not be conflated.
- The transactional half-set guard and the never-reroute guard are the two highest-value mutation targets; both must have demonstrated RED counterparts.

## Seam and downstream ownership

- This change owns acceptance 1, 2, 3, 5, 6 and the execution-lost/committed-frontier half of acceptance 4.
- `ecp-session-policy-and-control-parity` (downstream) owns acceptance 4's full cancel/restart/ack-loss fault matrix and deeper control-plane parity.
- `ecp-session-self-hosting-vertical-proof` (downstream, operator-owned) owns acceptance 7. This change leaves the seam (the executor is what that proof drives) and does NOT select/design the toy Change or pre-empt open decision 2 (which backend/platform the proof uses).

## Open decisions not settled here

- The exact default numbers for the reuse round limit and handoff token limit derive at apply time from the same resolution chain as `worker-reuse-config` (model presets / scheme bindings); this change owns the source/provenance/enforcement contract, not specific numbers.
- The cutover SEC-001 verdict and closure RC-005 residual stay owned by those archived changes; not re-litigated here.

## Commit

This handoff is committed together with the propose artifacts in one narrow-pathspec commit: `git commit -F <msg> -- rasen/changes/ecp-frozen-action-session-executor`, message `docs(ecp7): propose ecp-frozen-action-session-executor` (+ body + the required Co-Authored-By trailer). The sha is the resulting propose commit on `wip/ecp-shared-bounded-loop-lifecycle-resume`.
