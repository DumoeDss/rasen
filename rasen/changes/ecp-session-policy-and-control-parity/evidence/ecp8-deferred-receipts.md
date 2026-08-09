# ECP-8-deferred environment-gated receipts - ecp-session-policy-and-control-parity

The 0.2.0 correctness gate for this change is exhaustive deterministic
fault-injection over the executor's injectable `HostedBackendSeam` /
`InToolBackendSeam` plus mutation-proven guards (Section 6). These do not require
credentials, network, or a specific OS. The real-OS / real-agent-backend receipts
that prove the SAME properties on an actual operating system and a real session
host are environment-gated and are recorded here as explicit ECP-8 known gaps.
None is defaulted to pass.

## Deferred to ECP-8 (environment-gated real receipts)

| Property | Deterministic counterpart (0.2.0 gate) | ECP-8 real receipt needed |
| --- | --- | --- |
| Cross-driver same-Run parity | `parity-harness.test.ts` - all 6 faces x 5 ops through `dispatchGrantedAction` to the same Run/Action; matrix-driven availability; drift gate (M3). | Each real driver face (real Claude/Codex launcher, real CLI, real Management API, real Canvas, real daemon) routing a real Run through the contract on a real OS. |
| Cancel/restart/ack-loss fault recovery | `fault-matrix.test.ts` - 7 named modes (8 cells) at the shipped seam; execution-lost composition with the daemon-death / lost-generation / launcher-disappearance source labels (M6a-d). | A real host-process restart, real daemon restart, real worker-process loss, and a real ack-loss/duplicate on a real agent backend on each OS. Locked-decision-13 note: Windows proves zero-orphan daemon-death teardown via the cutover's Job `KILL_ON_JOB_CLOSE` chain; on linux/macOS the orphan risk is a declared known limitation and the matrix entry proves `execution-lost` typing plus uncommitted-frontier integrity (NOT zero orphans). |
| Face-invariant policy | `face-invariance.test.ts` - one resolution point, identical policy + decision across faces (M7); the policy-config source resolves project > store > global > default with provenance. | A real operator-configured `sessionPolicy` block read from a real project/store/global config on each OS, end-to-end through a real Run. |
| Policy-config on-disk wiring | `policy-source.ts` `readSessionPolicyLayers` reads the layers via the existing `readProjectConfig`/`getGlobalConfig` chain; the resolver is exercised deterministically with injected layers (M1/M2). | A real hand-edited `sessionPolicy` block round-tripped through the config editor / `rasen config set` on each OS (the additive schema block is in place; the interactive-editor surface for the new key is an ECP-8 follow-up). |

## Operator-owned (not this change, not ECP-8-defaulted)

- **Acceptance 7 (self-hosting toy-Change proof).** Operator-owned
  `ecp-session-self-hosting-vertical-proof`. The executor's
  `SELF_HOSTING_PROOF_SEAM` (`src/core/frozen-action-executor/executor.ts:185-189`)
  is left untouched by this change (`git diff --numstat -- src/core/frozen-action-executor/executor.ts` empty).

## Note on the deterministic gate's anti-theater posture

The fault matrix's anti-theater guard (task 3.1) asserts each execution mode is
injected at the shipped `HostedBackendSeam` / `InToolBackendSeam` (the same
interface the real session host satisfies) and that the reconciled outcome
carries the SPECIFIC source label only the shipped `reconcileActionOutcome` mints
(`daemon-death` / `lost-generation` / `launcher-disappearance`). A parallel
fixture could not produce these labels. The ECP-8 real receipts will prove the
same composition on a real host; the deterministic gate proves the contract here.
