# Independent Review Report: teacher-consultation-dev-integration

**Reviewer:** Claude Code subagent (general-purpose, fresh context —
author ≠ verifier)
**Date:** 2026-08-10
**Subject:** merge commit `c7221341` (Teacher `914c836a` x dev `96452f5c`)
plus the seven integration source/test files
**Verdict:** CLEAN (ship-ready), 0 findings

The reviewer was dispatched with the design claims to verify and was
instructed NOT to trust any prior report; it read proposal/design, ran its
own commands, and reasoned adversarially. Summary of what it independently
confirmed:

## Merge structure

- Parents `git log -1 --pretty=%P c7221341` => `914c836a 96452f5c`
  (Teacher-first).
- `3c595019`, `f6d6854c`, `914c836a` all ancestors of the merge.
- No unmerged paths remain.

## Conflict resolutions

- Seven of eight conflict files differ from BOTH parents (`git diff
  --numstat` against each). The eighth, `frozen-action-session-executor/
  spec.md`, equals the Teacher parent; dev's only merge-base-relative
  change there was removing one trailing newline (`0 1`), so no
  requirement or scenario was dropped — cosmetic, not a side pick.

## Integration code points (logic verified, not just presence)

- `src/commands/agent.ts`: `(codex, consultable-leaf)` returns typed
  `invalid-input` before binary resolution and spawn; no reroute or
  downgrade.
- `runtime-context.ts` `trustedTaskLoopProjectRoot`: throws typed
  `StoredRuntimeContextError` on missing host and on Action/Invocation/
  role/workspace/backend/cwd/digest/consultation disagreement;
  `StoredRuntimeContextInput` has NO cwd field.
- `server.ts` `stopServer`: reusable + ordinary + optional exact +
  path-chooser drained via `Promise.allSettled`; failure surfaced only
  after `await drain`; reusable owner shutdown is the sole
  `supervisor.shutdownAll` caller (no second direct call).

## Discriminating-test verification (mutation reasoning)

The reviewer confirmed the new authority-guard test and the Codex
no-spawn test are genuinely discriminating by reasoning about the
mutation:

- Missing-host case: removing the `host === undefined` throw would make
  `taskLoopSourceSession(record, undefined)` throw `TypeError`, not
  `StoredRuntimeContextError`; the `instanceof` assertion would fail.
- Mismatched-authority case: removing the cwd-digest throw would let
  `resume()` proceed without throwing; the expected-throw assertion would
  fail.
- Codex rejection: removing the guard would surface a missing-binary
  `runtime-unavailable` failure, not `invalid-input`; the `failure.kind`
  assertion would fail.

So none of these guards is theater.

## Independent re-run

- `pnpm exec tsc --noEmit` — exit 0.
- `pnpm exec vitest run` (worker-contracts, server-shutdown,
  exact-teacher-session-lane) — 3 files, 8 tests, all pass.
- `consultation-facade-journey.test.ts` — 28 tests, all pass.
- `node ./bin/rasen.js validate teacher-consultation-dev-integration
  --strict --json` — `valid: true`.
- `git diff --check 914c836a c7221341` — exit 0; no new whitespace/BOM
  (the inherited BOM in `skill-templates-parity.test.ts` is pre-existing
  from dev).

## Observation (not a finding)

The multi-owner shutdown's "one-lane failure does not skip the others"
guarantee rests on `Promise.allSettled` language semantics plus the
code-verified drain array, not on a single three-live-lane test. This is
acceptable; flagging only as context.
