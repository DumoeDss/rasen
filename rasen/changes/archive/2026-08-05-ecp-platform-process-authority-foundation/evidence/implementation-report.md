# Implementation report: platform process-authority foundation

## Evidence boundary and current state

This report covers only the platform-neutral `ProcessAuthorityProvider` common module, its deterministic provider/conformance harness, the opt-in `ProcessScope` compatibility adapter, and legacy-preservation tests. All code and runtime assertions below are **deterministic/common evidence**. Actual Linux, Windows, and macOS provider escape, owner-death, recovery, natural-empty, recursive-kill, unavailable, packaging, authentication, and support receipts are **UNEXECUTED and out of scope**.

The final-verifier run used worktree `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`, branch `wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD `050fc84332b26a75a07f441efd6b235842f89e1e`, and HEAD tree `58489c46633a209d2c1761c2a4b684ad8b95cb48`. The current target implementation/test manifest contains 20 files (8 common product files, 9 authority-focused tests, 3 test helpers) with aggregate SHA-256 `e55c11f461734ab9aa332c81f54ffe24642428e255eceff6dbe5a3d5afa833cd` (`tree-identity.json`).

Raw receipts are under:

`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\_verification-receipts\ecp-platform-process-authority-foundation-final-verifier-20260805-070223`

## Command legend and final-verifier results

- **F** — exact 12-file focused command with `--maxWorkers=1 --minWorkers=1 --reporter=dot`: exit 0; **12 files / 186 tests passed** (`9.1-focused.log`).
- **R** — prescribed complete Session-host plus Management/daemon/CLI regression command: exit 0; **32 files / 298 passed / 4 skipped** (`9.2-regression.log`).
- **S** — `pnpm run build`, `pnpm run lint`, `pnpm exec tsc --noEmit`, and `git diff --check`: all exit 0; diff check emitted only cumulative-worktree LF-to-CRLF notices (`9.3-*.log`).
- **T** — initial complete `pnpm test`: **exit 1; 2 files failed / 468 passed; 5 tests failed / 7163 passed / 38 skipped** (`9.4-pnpm-test.log`). A standalone config remediation then received a CLEAN non-author review; the supplemental normal-environment complete `pnpm test` exited `0` in `1186.3s` (`final-verification-supplement.md`). The required repository gate is now PASS.
- **U** — UI typecheck/test/build: all exit 0; tests **59 files / 651 passed**; build transformed 550 modules (`9.5-ui-*.log`).
- **V** — strict Change validation: exit 0; Change valid (`9.6-strict-validation.log`). Status/instructions report 72/76 tasks complete before task 9.11 evidence is consumed.
- **P** — `npm pack --dry-run --json --ignore-scripts`: exit 0; **952 entries**, exactly **16** common authority `.js`/`.d.ts` entries, no target test/Change/temp leak; outside-production-import, sensitive-export, forbidden-scope, secret, git-boundary, and safety-stash audits recorded under `9.8-*`.
- **C3/S3** — fresh round-3 code/spec and CSO reports: PASS/CLEAN at 0 Blocker / 0 Major / 0 Minor / 0 Trivial before this post-fix rerun. Their public discriminators are included in F.

All source paths below are relative to `src/core/session-host/process-authority/`; all tests are relative to repository root. F is the scenario-level deterministic command unless another command is also named.

## Requirement and scenario map — 8 requirements / 52 scenarios

### 1. Exact process-authority provider selection — 5/5 mapped

| # | Scenario | Exact public code | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 1.1 | Exact provider tuple is registered | `registry.ts:119-224`; `types.ts:41-67` | `test/core/session-host/process-authority-registry.test.ts:85` | F PASS |
| 1.2 | Duplicate or ambiguous registration | `registry.ts:85-191` | registry test `:98` and `:136` | F PASS |
| 1.3 | Registry provenance is forged | `registry.ts:17,225-254`; `coordinator.ts:969-970,1264-1267` | public-surface test `:81` | F PASS; zero forged selector/provider dispatch |
| 1.4 | No exact provider is available | `registry.ts:200-223`; `reference-resolution.ts:25-45` | registry test `:155`; public-surface test `:147` | F PASS; no fallback |
| 1.5 | Capability subset would weaken authority | `types.ts:21-38`; `registry.ts:85-117` | registry test `:114` | F/S PASS |

### 2. Versioned opaque authority-reference envelope — 6/6 mapped

| # | Scenario | Exact public code | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 2.1 | Known canonical reference is reopened | `reference-codec.ts:150-178,235-300`; `reference-resolution.ts:25-45` | reference test `:77` | F PASS |
| 2.2 | Opaque reference is tampered or malformed | `reference-codec.ts:84-95,180-298` | reference mutation matrix `:102` and closed-schema case `:144` | F PASS; original bytes retained, zero dispatch |
| 2.3 | Unknown future envelope version | `reference-codec.ts:235-263` | reference test `:168`; manifest test `:145` | F PASS; byte-preserving refusal |
| 2.4 | Platform-native fields do not cross the seam | `types.ts:4-165`; `index.ts:1-76` | public-surface test `:36`; reference test `:189` | F/S/P PASS |
| 2.5 | Diagnostic projection cannot replay authority | `reference-codec.ts:310-336`; `index.ts:48-51` | reference test `:189` | F/P PASS; no full ref/provider bytes exported |
| 2.6 | Integrity is not treated as signer authority | `reference-codec.ts:149-178`; `reference-resolution.ts:25-45` | reference tests `:77` and `:102` | F PASS; corruption identity only |

### 3. Bounded prepare, publish, and activate ordering — 7/7 mapped

| # | Scenario | Exact public code | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 3.1 | Prepare remains inert | `coordinator.ts:964-1111`; `types.ts:123-127` | lifecycle test `:103`; conformance helper `test/helpers/process-authority-provider-conformance.ts:104` | F PASS |
| 3.2 | Exact publication enables activation | `coordinator.ts:564-608,1112-1174` | lifecycle test `:103`; adapter test `:106` | F/R PASS |
| 3.3 | Durable publication callback does not settle | `coordinator.ts:790-961,1117-1139` | deadlines test `:223` and seven-phase matrix `:321` | F PASS; timeout/control-loss retained |
| 3.4 | Runtime bridge fails before activation | `process-scope-adapter.ts:145-279` | adapter test `:218`; activation reconciliation test `:243` | F/R PASS |
| 3.5 | Activate before publication | `coordinator.ts:144-165,1112-1175` | lifecycle test `:283`; conformance helper `:104`; mutation catalog helper `:19-31` | F PASS; no workload start |
| 3.6 | Publication identity does not match preparation | `coordinator.ts:564-608,1112-1140` | lifecycle matrix `:297`; conformance helper `:117` | F PASS; capability consumed |
| 3.7 | Duplicate activation or late publication | `coordinator.ts:1068-1175` | lifecycle tests `:328`, `:349`, `:376` | F PASS; one semantic settlement |

### 4. Exact lifecycle observations remain distinct — 11/11 mapped

| # | Scenario | Exact public code | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 4.1 | Backend root exits while authority remains live | `types.ts:83-120`; `coordinator.ts:493-522,1187-1218` | outcomes test `:113`; conformance helper `:138` | F/R PASS |
| 4.2 | Exact natural scope empty | `coordinator.ts:623-684,1187-1218` | outcomes test `:300`; conformance helper `:176` | F PASS; authentic receipt only |
| 4.3 | Provider reference is reused | `coordinator.ts:706-788,984-1059` | outcomes test `:142` and recovered matrix `:230` | F PASS; stale receipt not replayed |
| 4.4 | Replacement first observes a recovered generation | `coordinator.ts:777-788,1187-1261` | outcomes tests `:230` and `:257` | F PASS; registration precedes dispatch |
| 4.5 | Reference tombstone retention is exhausted | `coordinator.ts:766-788,984-1059` | deadlines tests `:826`, `:846`, `:879`, `:924` | F PASS; fixed 1,024 bound |
| 4.6 | Replacement observes inert authority | `coordinator.ts:493-522,1187-1218` | outcomes matrix `:176`; conformance helper `:224` | F PASS; inert state retained |
| 4.7 | Root-exit status is incomplete | `types.ts:99-120`; `coordinator.ts:493-522` | outcomes tests `:189`, `:207`; adapter test `:170` | F PASS; null/null fails closed |
| 4.8 | Authority becomes unavailable after publication | `coordinator.ts:493-522,1187-1261` | outcomes matrix `:158`; conformance helper `:184` | F PASS; exact ref retained |
| 4.9 | Authority truth is uncertain | same common outcome/observation seam | outcomes matrix `:158`; conformance helper `:184` | F PASS; no optimistic release |
| 4.10 | Identity drift forbids control | `types.ts:83-98`; `coordinator.ts:493-522,623-683` | outcomes matrix `:281`; conformance measured probe `:528` | F PASS; zero destructive control |
| 4.11 | Event completeness has a gap | same common outcome/control seam | outcomes matrix `:281`; conformance measured probe `:534` | F PASS; no exact-empty claim |

### 5. Bounded control retains authority after ambiguity — 8/8 mapped

| # | Scenario | Exact public code | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 5.1 | Provider call exceeds its deadline | `coordinator.ts:790-961` | deadlines tests `:186`, `:223`; seven-phase matrices `:321`, `:415` | F PASS |
| 5.2 | Scheduler callback is delayed | `coordinator.ts:890-923` | deadlines test `:297`; fulfillment/rejection matrices `:321`, `:415` | F PASS; monotonic settlement wins |
| 5.3 | Runtime operation input is hostile or mutable | `coordinator.ts:343-456,964-1013,1221-1251` | lifecycle tests `:154`, `:265`; outcomes tests `:383`, `:422` | F PASS; single frozen snapshot/zero invalid dispatch |
| 5.4 | Provider preparation capability is mutable | `coordinator.ts:465-491,1027-1059,1068-1175` | lifecycle test `:218` | F PASS; reference/callable each read once |
| 5.5 | Adapter authority is lost | `coordinator.ts:790-961`; `process-scope-adapter.ts:194-279` | deadlines tests `:574`, `:598`; adapter tests `:194`, `:243` | F/R PASS; authority retained |
| 5.6 | Provider resolves after timeout | `coordinator.ts:866-960` | deadlines tests `:255`, `:504`, `:629`; conformance helper `:365` | F PASS; late result diagnostic-only |
| 5.7 | Provider emits duplicate or conflicting outcomes | `coordinator.ts:709-750,790-961` | deadlines tests `:662`, `:691`, `:731`, `:759`, `:791` | F PASS; one dispatch/typed conflict |
| 5.8 | Abort or terminate is not observed closed | `coordinator.ts:623-684,1068-1103,1221-1261` | outcomes matrices `:158`, `:281`, release predicate `:300`; conformance abort matrix `:260` | F PASS; no forged release |

### 6. Closed capability, protocol, and manifest negotiation — 6/6 mapped

| # | Scenario | Exact public code | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 6.1 | Provider identity mismatch | `manifest.ts:88-161`; `registry.ts:119-191`; `reference-resolution.ts:25-45` | manifest matrix `:84`; reference mutation matrix `:102` | F PASS |
| 6.2 | Capability identity mismatch | same exact descriptor/manifest/codec seam | registry test `:114`; manifest matrix `:84` | F PASS |
| 6.3 | Protocol or provider-reference mismatch | `reference-codec.ts:235-298`; `manifest.ts:88-161` | reference test `:168`; manifest matrix `:84` | F PASS |
| 6.4 | Closed manifest does not match runtime descriptor | `manifest.ts:11-161`; `registry.ts:123-191` | manifest tests `:67`, `:99`, `:129` | F/S PASS |
| 6.5 | Non-empty registry has no manifest | `registry.ts:123-190`; `coordinator.ts:690-699` | registry test `:78`; public-surface test `:58` | F PASS; zero dispatch |
| 6.6 | Rollback encounters a newer durable reference | `reference-codec.ts:235-263`; `reference-resolution.ts:25-45` | manifest test `:145`; reference test `:168`; capsule migration test `:84` | F/R PASS; no rewrite/downgrade |

### 7. Reusable deterministic provider conformance harness — 5/5 mapped

| # | Scenario | Exact public code/support | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 7.1 | Deterministic foundation run | `test/helpers/process-authority-provider-conformance.ts:87-398`; deterministic fixture `test/helpers/deterministic-process-authority-provider.ts:17-123` | conformance test suite registration `test/core/session-host/process-authority-conformance.test.ts:11` | F PASS; common-only |
| 7.2 | Shared abort and replay matrix | conformance helper `:117-305,443-600` | positive abort `:237`, negative abort `:260`, tamper `:288`, measured mutation test `process-authority-conformance.test.ts:19` | F PASS |
| 7.3 | Platform provider consumes the unchanged suite | exported fixture/suite contracts `test/helpers/process-authority-provider-conformance.ts:34-87` | import-only contract `process-authority-conformance.test.ts:34` | F/S PASS as compile/import evidence only |
| 7.4 | Mutation sensitivity is demonstrated | mutation catalog/measurement helper `:19-31,443-600` | mutation test `process-authority-conformance.test.ts:19` | F PASS; every named mutation internally RED, default GREEN |
| 7.5 | Actual platform evidence remains separate | empty production registry `registry.ts:256-258`; test-only fixture paths above | public-surface test `:147`; package/import audit P | Common evidence PASS; actual OS **UNEXECUTED** |

### 8. Additive migration without platform or release claims — 4/4 mapped

| # | Scenario | Exact public code/artifact | RED-to-GREEN discriminator | Command/result |
|---|---|---|---|---|
| 8.1 | Foundation is installed before providers | empty registry `registry.ts:256-258`; opt-in adapter `process-scope-adapter.ts:145-297` | public-surface test `:147`; adapter test `:106`; outside-import audit P | F/R/P PASS; no default wiring |
| 8.2 | Legacy ProcessScope reference is encountered | adapter `process-scope-adapter.ts:50-55,301-313`; unchanged legacy seam | adapter test `:301`; capsule migration tests `:54`, `:84`; ProcessScope contract `:16` | F/R PASS; bytes not promoted |
| 8.3 | Foundation reaches local completion | all common modules and tests above; round-3 PASS/CLEAN reports; tasks `9.11-9.14` | F/R/S/U/V/P pass; supplemental complete root gate T passes | **PASS** for verified common implementation; local ship/archive remain lifecycle steps 9.12-9.14 |
| 8.4 | A dependent provider is considered runnable | empty registry/import boundary plus unchecked local ship/archive lifecycle | public-surface test `:147`; P; task state 72/76 | PASS boundary: no dependent provider is runnable or claimed |

## Coverage and truth conclusion

- Requirements mapped: **8/8**.
- Current delta-spec scenarios mapped: **52/52**.
- Exact focused deterministic/common assertions: **186/186 passed**.
- Surrounding prescribed regression assertions: **298 passed / 4 skipped**.
- Round-3 independent security and code/spec verdicts: **0 Blocker / 0 Major** before this post-fix rerun.
- Required complete-root repository gate: initial failure preserved; standalone config remediation reviewed CLEAN; supplemental normal-environment run **PASSED** with exit `0` in `1186.3s`.
- Actual-OS provider evidence: **UNEXECUTED and out of scope**.

The implementation/scenario mapping and task 9.11 verification are complete. The clean common foundation may proceed to local ship/archive, but no Linux, Windows, macOS, native ProcessCapsule closure, packaging/signing/installer/VM, Action/signer/Run authority, or release-support conclusion follows from the deterministic common evidence.
