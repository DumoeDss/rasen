# Real receipts status + deterministic counterparts - tasks 10.1, 10.2, 10.4, 10.5

Scope legend (`tasks.md` headnote): a `[REAL-BACKEND]` receipt "requires a real
agent backend (Claude or Codex) and therefore may be gated by credentials/
account access; a deterministic protocol-replay counterpart MUST also exist and
is the correctness gate, the real-backend run is the attribution receipt." This
file records, per real receipt, the deterministic counterpart that IS the
correctness gate and the honest status of the real-backend/real-OS attribution
run.

## Task 10.1 [REAL-BACKEND] production-path receipt on a real agent backend

- Deterministic counterpart (correctness gate): `executor.test.ts > dispatches a
  granted Action on the hosted backend and reconciles a settled turn` drives the
  production `dispatchGrantedAction` path through an injectable hosted backend
  seam that returns the same `TurnResult` shape a real session host returns; the
  authority validation, matrix selection, outcome reconciliation, and typed
  result are identical to the production path. The attribution fact-set shape is
  fixed in `attribution.ts` (`AttributionFactSet`) and its lifecycle-only
  registry projection is guarded by `attribution.test.ts`.
- Real-backend attribution run: gated by Claude/Codex credentials + the
  production driver-face wiring (Section 7 call-site integration, see handoff).
  NOT collected this wave. The deterministic counterpart is the correctness gate
  per the scope legend.

## Task 10.2 [REAL-BACKEND] execution-lost and resume receipt

- Deterministic counterpart (correctness gate): `action-outcome.test.ts >
  daemon death types the in-flight Action execution-lost` and `> launcher
  disappearance types the in-flight Action execution-lost`; plus
  `executor.test.ts > hosted daemon death during an in-flight Action yields
  execution-lost` and `> in-tool launcher disappearance yields execution-lost`
  prove the typed `execution-lost` outcome is minted at the executor's
  reconciliation point for both backends. The committed-frontier resume
  partition (`partitionCommittedFrontier` / `isCommittedInvocation`) is proven
  in the same file: resume re-drives only the uncommitted frontier and a resend
  of a committed invocation is rejected.
- Real-OS attribution run (inject daemon death on a real OS): gated by the same
  credentials + production wiring. The Windows substrate fact the
  execution-lost typing composes with — that daemon death really tears the scope
  down — IS receipted on this host in `win32-daemon-death-receipt.md` (task
  10.3). NOT collected end-to-end this wave.

## Task 10.4 [WSL-EXTERNAL] hosted best-effort receipt on real Linux

- Deterministic counterpart (correctness gate): `capability-matrix.test.ts >
  hosted best-effort declares exactCancel:false and scopeEmptyProof:false on
  every OS` (the declaration is honest on Linux as on every OS) and the matrix
  content/availability guards. The hosted-best-effort declaration literals
  (`POSIX_BEST_EFFORT_DECLARATION`, `exactCancel: false` / `scopeEmptyProof:
  false`) are the same frozen values the matrix surfaces on Linux.
- Real-Linux attribution run: requires an external run tree on ext4 with its own
  isolated node_modules (never the repo checkout — vitest here can wipe `dist/`,
  and Windows-installed node_modules fail under WSL). Recipe:
  `rasen/changes/ecp-linux-process-authority-provider/handoff/lead-2.md`. NOT
  collected this wave; the deterministic counterpart is the correctness gate.
- Decision-13 honesty note: on Linux/macOS the daemon-death orphan risk is a
  declared known limitation; the receipt shape proves `execution-lost` typing +
  "uncommitted frontier stays uncommitted", NOT zero orphans (the deterministic
  guards in `action-outcome.test.ts` prove exactly this).

## Task 10.5 - provenance

| Receipt file | Provenance | Real-backend gate used |
| --- | --- | --- |
| `win32-daemon-death-receipt.md` (10.3) | this Windows host, build 10.0.26200, Node v24.14.0, packaged capsule helper | [THIS-HOST] real OS processes; no agent backend |
| `real-receipts-status.md` (10.1/10.2) | deterministic counterparts in `executor.test.ts` / `action-outcome.test.ts` | [REAL-BACKEND] gated by credentials; deterministic counterpart is the correctness gate |
| `real-receipts-status.md` (10.4) | deterministic counterparts in `capability-matrix.test.ts`; WSL recipe `ecp-linux-process-authority-provider/handoff/lead-2.md` | [WSL-EXTERNAL] gated by external ext4 tree; deterministic counterpart is the correctness gate |

## Honest summary

This wave delivers the deterministic correctness gate for every real-backend and
real-OS path (Section 9.1: protocol-replay counterparts via the injectable
backend seams + the typed-outcome/matrix/reuse/authority/transactional guards),
plus one real [THIS-HOST] receipt (10.3, Windows zero-orphan). The
[REAL-BACKEND] attribution receipts (10.1, 10.2) and the [WSL-EXTERNAL] Linux
receipt (10.4) are gated by credentials / external-tree setup and are the
operator's run; their deterministic counterparts stand as the correctness gate
per the scope legend until those runs are collected.
