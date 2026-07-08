# Ship Log: fork-phase1-telemetry-client

**Date:** 2026-07-08
**Mode:** local
**Branch:** dev-harness
**Commit:** 962712a05a230459d2ad93b677e8ead1c92831f6
**Tree:** 735588a94bcac2bd170fb608bf98cac5f27e53aa
**Status:** Committed (delivery deferred to portfolio/parent level)

> Note: the Commit/Tree above identify the content commit for this change.
> A ship log cannot embed the hash of the commit that contains it, so this log
> was finalized into the delivered `dev-harness` HEAD by a follow-up `--amend`;
> the exact delivered HEAD hash is reported to the portfolio LEAD. The recorded
> **Tree** is the content-addressed fingerprint for the test-evidence gate.

> Portfolio CHILD of the `fork-phase1` parent (B-chain). Depends on the already
> shipped+archived `fork-phase1-telemetry-backend` (B1) — the client points at
> B1's deployed Worker. Per the portfolio delivery policy, a child ships in LOCAL
> mode (commit only) — no push, no PR, no tag. The portfolio delivers ONCE at the
> parent level after ALL children complete.

## Pre-Flight Results
- Verification: **pass** — `review-report.md` present; verdict **APPROVE, spec
  delta MET** with **0 Blocker / 0 Major / 0 Minor** (2 Trivial/informational
  only: T1 inFlightSend keeps only latest send — harmless; T2 `node:https` does
  not honor `HTTP(S)_PROXY` — consistent with silent-failure design, not a
  regression vs undici). All 7 telemetry requirements implemented; client matches
  the B1 Worker contract exactly; every privacy/opt-out/silent-failure guarantee
  preserved.
- Tasks: **15/15 complete** — every task in `tasks.md` marked `[x]`.

## Test Gate
- Tests: **skipped — green at `review-report.md` (reviewer-b1 independent run on
  this exact tree).**
  - Recorded passing evidence for the delivered B2 delta: `pnpm build` green;
    **20/20** telemetry tests (`test/telemetry/index.test.ts`, mocking the real
    `node:https` transport — opt-out all 3 vars incl. no-id-written, exact payload
    keys, PII-field absence, single-request/no-retry, endpoint/method/headers +
    `agent:false`, silent failure incl. sync-throw and real-guard-timer stall,
    notice once/truthful/no-posthog/precedes-send, shutdown safety);
    `pnpm install --frozen-lockfile` consistent with **0 posthog references**
    (dependency + lockfile pruned); live B1 Worker returned **202** on the exact
    client payload; `cli-e2e/basic.test.ts` **16/16** green with telemetry enabled
    (implementer's run, confirming the ~11s→~1.8s exit fix); `openspec validate`
    valid.
  - Re-run deliberately NOT performed: the LEAD authorized citing this evidence.
    Note the B2 diff IS the only uncommitted content now, so this commit's tree
    matches the tree reviewer-b1 verified.

## Design Deviation (documented, reviewer-JUSTIFIED)
Design D1 specified native `fetch`; the implementation uses `node:https`
(`sendEvent`, `src/telemetry/index.ts`). Rationale (in `notes.md` + the module
header comment): native `fetch`/undici leaves a reffed keep-alive socket/connect
timer in its pool that held the event loop ~10s after the 1s abort, measurably
violating the spec's "Shutdown never blocks exit" + "~1 second timeout"
requirements (measured 11s → 1.8s CLI exit). `node:https` with `agent:false` (no
keep-alive pool) + a `clearTimeout`-ed guard timer closes the socket promptly and
guarantees `done()` within ~1s. The **spec text is authoritative over a design
transport detail**, and the spec is satisfied; the reviewer judged the deviation
correct, not a shortcut. The CLI (`src/cli/index.ts`) is unmodified and no
`process.exit` is used.

## What Shipped
Rewrite of the telemetry client to target the maintainer-owned B1 Worker and
drop PostHog:
- **`src/telemetry/index.ts`** — `node:https` fire-and-forget POST to the B1
  Worker endpoint with `agent:false` + ~1s guard timer; anonymous-UUID
  distinctId; command/version/os/node_version payload only; opt-out short-circuit
  (`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI auto-off) before any network/id
  work; truthful first-run notice (no PostHog / no `edge.openspec.dev`);
  `shutdown()` that never blocks exit.
- **`package.json` / `pnpm-lock.yaml`** — `posthog-node` removed (dependency +
  lockfile pruned; no new runtime dependency; telemetry now uses the Node
  built-in).
- **`test/telemetry/index.test.ts`** — 20 tests exercising the real `node:https`
  transport (see Test Gate).
- **Change artifacts** — proposal, design, tasks, notes, review-report, 1 delta
  spec (6 MODIFIED + 1 ADDED to the `telemetry` capability), and this ship log.
  (`auto-run.json` is git-ignored run-state — `.gitignore:163` — intentionally
  NOT committed.)

## Scope Hygiene
Staged EXPLICITLY and ONLY B2's file set: `src/telemetry/index.ts`,
`package.json`, `pnpm-lock.yaml`, `test/telemetry/index.test.ts`, and the change
dir. Left UNSTAGED (pre-existing / other siblings): the other
`openspec/changes/fork-phase1*` child dirs (A3 browse-removal is about to start),
`openspec/handoff/`, and `openspec/office-hours/`.

## Deployment
N/A — local mode. Delivery (push / tag / release) is deferred to the
`fork-phase1` portfolio parent once ALL children complete. Archive is run
separately as a follow-up commit.
