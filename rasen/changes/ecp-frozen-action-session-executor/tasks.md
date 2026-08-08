Scope legend: `[WSL-EXTERNAL]` marks real-Linux evidence that MUST run in an external run tree on ext4 with its own isolated node_modules - never the repo checkout (vitest here can wipe dist/, and Windows-installed node_modules fail under WSL). `[THIS-HOST]` marks real-Windows evidence taken on this machine. `[REAL-BACKEND]` marks evidence that requires a real agent backend (Claude or Codex) and therefore may be gated by credentials/account access; a deterministic protocol-replay counterpart MUST also exist and is the correctness gate, the real-backend run is the attribution receipt. Every guard added by this change needs a demonstrated failing counterpart (mutation receipt); an unmutated green guard is not acceptance evidence in this repo. Kernel-enforced exact-cancel or exact-scope-empty proof is explicitly NOT acceptance for any task in this change (locked decision 13).

## 1. Baseline and context

- [x] 1.1 Record the implementation-start HEAD in `evidence/implementation-baseline.md` and re-verify the seams design.md rests on with file:line anchors against the current tree: the Facade surface in `src/core/change-run/facade.ts` (`start | resume | complete | inspect | control`, `RuntimeMutationContext.deliveryMode`, the `record_version_conflict` / `receipt_conflict` / `workspace-scope-mismatch` error codes); `RecordVersion` and `expectedRecordVersion` in `contracts.ts`; the grant path in `internal/facade-runtime.ts`; the EvidenceStore in `internal/evidence-store-fs.ts` and `internal/evidence.ts` and the existing `HostEvidenceWriter` staging in `src/commands/pipeline.ts`; the session-host construction (`router.ts:639`/`:642`, `host.ts:300`, `closeDurableProcess` and its two release paths, the `receiptAuthorizesRelease` gates, the terminal-persistence gate, `toHostedProcessTerminal`); the ProcessScope seam (`process-scope.ts` `receiptAuthorizesRelease`, `TerminationReceipt.state`, `DeclaredUnprovenReceipt`); the hosted selection (`hosted-process-scope.ts`); and exactly-once activation (`process-scope-adapter.ts:181`). Report any drift to the LEAD before writing code.
  - Receipt: `evidence/implementation-baseline.md`. Anchor table with the HEAD sha and the verified line for each seam above. No design-affecting drift, or drift reported before code.
- [x] 1.2 Confirm and record that the frozen authority crates (`native/linux-process-authority/**`, `native/windows-process-authority/**`), the legacy ProcessCapsule, and the durable session-host registry record shape are not modified by this change (the executor writes completion only through the Facade; the registry stays a lifecycle reader). If any edit to those surfaces turns out to be required, stop and flag it to the LEAD before making it.
  - Receipt: `evidence/implementation-baseline.md` "Task 1.2" table. `git diff --stat` for this change touches none of them.
- [x] 1.3 Record the two Step 1 obligations this change owns verbatim (typed `execution-lost` plus committed-frontier resume; the `durable: daemon-lifetime` declaration surfaced through the matrix) and the locked-decision-12/13 scope (transactional not cryptographic; best-effort on all three OSes; kernel-enforced tier not 0.2.0) in `evidence/implementation-baseline.md`, citing `planning-context.md`, target-state decisions 11/12/13, and the slice spec acceptance.
  - Receipt: `evidence/implementation-baseline.md` "Obligations and scope" section.

## 2. Frozen-Action consumption and authority validation

- [x] 2.1 Implement the executor's dispatch entry: consume a granted ActionView from the Facade and validate Run id, Action id, invocation, effect, workspace, profile, adapter authority, and `expectedRecordVersion` against the committed Record before any backend work. Authority is read from the granted ActionView and the Record only; it is never rebuilt from the live Definition, chat, or caller input.
  - Receipt: guard proving a granted Action dispatches with all fields validated against the Record; mutation receipt proving a field rebuilt from caller input is rejected.
- [x] 2.2 Fail closed with typed outcomes for the four illegal-dispatch cases: duplicate dispatch (return recorded in-flight/settled state, no resend), stale Record version (`record_version_conflict`), wrong workspace (`workspace-scope-mismatch`), and a not-currently-executable Action. None executes backend work.
  - Receipt: four guards, one per case; mutation receipts proving each discriminates (e.g. a duplicate-dispatch guard fails when the input is resent, a stale-version guard fails when the mutation proceeds).
- [x] 2.3 Source-scan guard: the executor module rebuilds no authority from chat history, caller self-report, or the live Definition; the granted ActionView is the sole authority source.
  - Receipt: source-scan guard plus a mutation receipt proving it fails when an authority field is derived from a non-granted source.

## 3. Capability matrix and never-silently-reroute

- [x] 3.1 Implement the computed `ExecutionCapabilityMatrix`: enumerate {linux, darwin, win32} x {in-tool, hosted-best-effort}, read each backend's declaration and current-platform availability, and expose per cell the declared facts (`durable`, `headlessDriver`, `exactCancel`, `scopeEmptyProof`, `usageAttribution`) and a typed availability verdict (`available | authority-unavailable | <typed reason>`). The matrix is queryable before any Run starts.
  - Receipt: guard asserting the matrix matches the live declarations on each host; mutation receipt proving a hand-edited matrix divergence is rejected.
- [x] 3.2 The `hosted` best-effort cell reports `exactCancel: false` / `scopeEmptyProof: false` on all three OSes; `in-tool` reports durable false, headless false, and no exact-termination claim; no cell advertises kernel-enforced authority.
  - Receipt: matrix-content guard over the six cells; mutation receipt proving a cell that claims kernel-enforced authority or proven-empty fails.
- [x] 3.3 Never-silently-reroute: a `hosted` request the platform cannot serve returns typed `authority-unavailable`; `in-tool` is selected only by explicit request or an explicit pre-start-visible default. No code path selects `in-tool` as an automatic response to hosted unavailability.
  - Receipt: guard proving hosted-unavailable returns `authority-unavailable` and starts no in-tool backend; mutation receipt proving a reroute path fails the guard. Plus a guard that an in-tool selection is traceable to an explicit request or pre-start default.
- [x] 3.4 On a platform with only `in-tool`, the matrix reports the absence of a headless driver as a declared boundary visible before start.
  - Receipt: guard asserting the headless-absent cell carries the declared-boundary verdict and is queryable pre-start.

## 4. execution-lost and committed-frontier resume

- [x] 4.1 Implement Action-outcome reconciliation: map the session host's lost-generation/`turn-outcome-unknown`/`interrupted` outcome (hosted backend) and launcher-process disappearance (in-tool backend) to a typed `execution-lost` outcome on the Action. `execution-lost` is distinct from generic uncertainty and from workload failure.
  - Receipt: guards proving (a) hosted daemon death yields `execution-lost`, (b) in-tool launcher death yields `execution-lost`; mutation receipts proving a normally-completed Action is not `execution-lost` and a generic-uncertainty outcome is not labelled `execution-lost`.
- [x] 4.2 Resume only from the last committed Record frontier via the Facade: no reattach to a dead scope, no identity revalidation across the death, no resend of an input whose commitment is unknown. Already-committed invocations and effects are not re-executed.
  - Receipt: guard proving resume re-drives only the uncommitted frontier; mutation receipt proving a re-send of a committed invocation is rejected.
- [x] 4.3 The executor does not modify the host's outcome vocabulary or the ProcessScope seam; it composes them. The mapping from host outcome to Action outcome is documented in the handoff.
  - Receipt: `git diff --stat` showing no edit to `src/core/session-host/` outcome vocabulary; handoff states the mapping.

## 5. Transactional completion integrity

- [x] 5.1 The executor's evidence writer verifies the complete evidence set required by the frozen Action is present and well-formed before publishing any of it to the durable EvidenceStore; a partial set is not published as if complete.
  - Receipt: guard proving a partial set blocks publish; mutation receipt proving a partial-set publish fails the guard.
- [x] 5.2 The Facade `complete` mutation re-reads the evidence set from the durable EvidenceStore and re-verifies integrity, completeness, and binding (Action, invocation, workspace revision, ActorRef) before any Record mutation; the Record mutation stays atomic under the Record-version compare-and-swap.
  - Receipt: guard proving `complete` re-reads and re-verifies before mutating; mutation receipt proving a Record mutation without the re-read fails the guard.
- [x] 5.3 A crash between publish and Record mutation leaves a partial evidence set that the re-read completeness check rejects, so a later completion never treats it as complete.
  - Receipt: fault-injection guard (inject a crash after partial publish) proving the next `complete` re-read fails the completeness check; mutation receipt proving a half-set accepted as complete fails the guard.
- [x] 5.4 A completion claim whose binding does not match the granted ActionView fails closed (`receipt_conflict`).
  - Receipt: guards for Action/invocation/workspace-revision/ActorRef mismatch, each returning `receipt_conflict` with no Record mutation; mutation receipts.
- [x] 5.5 No signing path: the executor and Facade completion surfaces accept, store, and return no signing private key or producer credential (decision 12). ECP-6's archived Ed25519 is untouched.
  - Receipt: source-scan guard over the executor module mirroring the host's no-signing-key guard; mutation receipt. `git diff --stat` showing no edit to the archived ECP-6 signing implementation.

## 6. Session reuse, handoff, touch, and retire policy

- [x] 6.1 Implement the authoritative reuse policy source: derive from the frozen Action's authored `sessionReuse` (via `sessionReuseAuthored`) resolved against a declared executor policy block with `authored | definition | default` provenance; expose traceable source and default for every resolved `handoffTokenLimit`, `reuseRoundLimit`, `sessionReuse`, and touch/retire value. This retires the `ecp-change-run-runtime` placeholder clause.
  - Receipt: guard proving resolved values carry provenance; mutation receipt proving a placeholder value enforced as authored fails the guard.
- [x] 6.2 `never` forbids reuse; `same-invocation` permits reuse only within the same frozen invocation, role, workspace, and backend authority. An over-limit or authority-incompatible reuse produces an auditable handoff or retire, never a silent reuse.
  - Receipt: guards for `never` (no reuse), same-authority reuse (permitted), cross-invocation/role/workspace/backend mismatch (auditable retire); mutation receipts.
- [x] 6.3 Records created before this change carry placeholder limit values; the executor treats them as `default`-provenance and applies its own authoritative policy on top, never enforcing a placeholder as authored. This does not modify the `ecp-change-run-runtime` requirement heading or scenarios.
  - Receipt: guard proving a placeholder is treated as `default` and the authoritative policy is applied; reference (not modification) to the `ecp-change-run-runtime` placeholder clause.
- [x] 6.4 This reuse is per-Run/per-invocation at the executor seam; `worker-reuse-config` and `worker-reuse-orchestration` (cross-child reuse) are not modified.
  - Receipt: `git diff --stat` showing no edit to those two specs' surfaces; handoff states the distinction.

## 7. Driver-face same-Run parity

- [x] 7.1 Unify the interactive launcher, bare CLI, Management API, Canvas, and daemon on one shared projector and one shared control contract; each face resolves the same RunId/ActionId and creates no duplicate Run or Session truth.
  - Receipt: guard proving two faces address the same Run through the shared projector; mutation receipt proving a face that maintains a second truth fails.
- [x] 7.2 Each face consults the capability matrix (Section 3) for start/resume/cancel/inspect availability; "when capability allows" is the matrix verdict, not a documentation assertion. Each driver x backend x platform combination is either available with a real receipt or returns a typed unavailable reason.
  - Receipt: guard proving a face honours the matrix verdict; mutation receipt proving a face that asserts availability the matrix does not report fails.
- [x] 7.3 The headless driver does not depend on the interactive launcher surviving; launcher exit does not end a hosted Run.
  - Receipt: guard proving a hosted Run survives launcher exit when driven by the headless/daemon face.

## 8. Real-backend attribution

- [ ] 8.1 At least one real agent backend executes a granted frozen Action and attributes the complete fact set (Session identity, host/backend/model, real canonical cwd, ActorRef, start/end times, structured events, usage/cost, result, stderr/diagnostics, evidence) to the same Run/Action; the canonical Record receives the completion.
  - Receipt: `evidence/real-backend-attribution.md` with the attributed fact set for one real backend run.
- [x] 8.2 The session-host registry holds host lifecycle facts and request/result digests only; it contains no completion truth, result body, or evidence duplicating the canonical Record.
  - Receipt: guard proving the registry record contains lifecycle facts only; mutation receipt proving a completion field written to the registry fails the guard.

## 9. Deterministic guards and mutation receipts (any OS; non-acceptance)

- [x] 9.1 Protocol-replay/deterministic counterparts for every real-backend path: frozen-Action dispatch, execution-lost on injected death, transactional completion (including mid-publish crash), reuse-policy enforcement, and authority-unavailable. These are the correctness gates; the real-backend runs are the attribution receipts.
  - Receipt: deterministic guard suite green; each guard named with its real-backend counterpart.
- [x] 9.2 Mutation receipts in `evidence/mutation-receipts.md`, each showing its guard RED against the defect it names, reverted byte-exactly afterward. At minimum: authority rebuilt from non-granted source; stale-version/duplicate/wrong-workoff dispatch accepted; silent reroute to in-tool; mis-typed execution-lost; half-set completion accepted; completion-binding mismatch accepted; placeholder enforced as authored; cross-authority reuse permitted; a second Run/Session truth; a completion field written to the registry.
  - Receipt: `evidence/mutation-receipts.md` with RED counts and byte-exact reverts (`git diff --numstat` empty).
- [x] 9.3 Regression: the existing session-host, ProcessScope, Facade, EvidenceStore, runtime-adapter-registry, and worker-reuse suites pass unchanged.
  - Receipt: regression suite counts before/after, 0 new failures.

## 10. Real receipts

- [ ] 10.1 [REAL-BACKEND] Production-path receipt: a granted frozen Action runs through the production executor path on a real agent backend; the receipt shows the complete fact set attributed to the same Run/Action and the transactional completion. A deterministic counterpart exists (task 9.1) and is the correctness gate if credentials/account access are unavailable.
  - Receipt: `evidence/real-backend-attribution.md`.
- [ ] 10.2 [REAL-BACKEND] execution-lost and resume receipt: inject daemon death (hosted) or launcher exit (in-tool) during an in-flight Action on a real OS; the receipt shows typed `execution-lost` and resumption from the committed frontier without reattach or identity revalidation.
  - Receipt: `evidence/execution-lost-receipts.md`.
- [x] 10.3 [THIS-HOST] Windows zero-orphan daemon-death teardown receipt: a hosted workload that spawns a descendant, the daemon killed without cancelling, and the whole workload Job dies via the `KILL_ON_JOB_CLOSE` handle-close chain; restart reports the stale record honestly with no reattach. Consume the cutover's receipted chain; re-prove on this tree, do not re-derive.
  - Receipt: `evidence/win32-daemon-death-receipt.md`. If any link fails, record the finding instead of widening the declaration.
- [ ] 10.4 [WSL-EXTERNAL] Hosted best-effort receipt on real Linux: pre-start `exactCancel: false` / `scopeEmptyProof: false` declaration visible and an honest `cancelled / emptiness-unproven` terminal; the daemon-death orphan risk recorded as a declared limitation, not a zero-orphan gate.
  - Receipt: `evidence/linux-hosted-receipt.md`, provenance table with external ext4 tree, distro, kernel, Node version.
- [x] 10.5 Label every Section 10 evidence file with provenance (host, OS build, Node version, external-tree isolation statement for Linux) and the real-backend gate used.
  - Receipt: provenance tables in each Section 10 file.

## 11. Verification and ship

- [x] 11.1 `rasen validate --strict ecp-frozen-action-session-executor` green; whitespace gate verified on committed bytes (LF-only, no trailing whitespace, no trailing blank line at EOF) for every file this change adds or edits.
  - Receipt: validate output and the whitespace-gate result on `git show HEAD:<file>` bytes (committed, not working-tree, because `core.autocrlf=true` rewrites the working tree).
- [x] 11.2 Confirm the DAG: this change depends on `ecp-native-process-capsule-closure` (archived) and `ecp-durable-agent-session-host`; it blocks `ecp-session-policy-and-control-parity` and leaves the seam for `ecp-session-self-hosting-vertical-proof`; no edge to/from the parked provider changes; the frozen crates are untouched by this change's diff.
  - Receipt: portfolio DAG read from `.rasen/.../portfolio-run.json`; `git diff --stat -- native/` empty.
- [x] 11.3 typecheck (`tsc --noEmit`), lint (`eslint` over changed paths), and root suites green on this host; all new paths built with `node:path`.
  - Receipt: command exit codes and suite counts.
- [x] 11.4 Record the seam left for `ecp-session-self-hosting-vertical-proof` (the executor is what that proof drives) and explicitly do not select or design the toy Change; record that acceptance 4's cancel/restart/ack-loss fault matrix and acceptance 7's self-hosting proof are downstream children.
  - Receipt: handoff `planner-1.md` "Seam and downstream ownership" section.
