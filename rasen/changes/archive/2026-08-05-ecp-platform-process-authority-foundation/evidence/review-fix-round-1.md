# Review fix round 1

Date: 2026-08-05

Scope: atomic non-author fix of the 4 security and 9 code/spec findings from
round 1, deduplicated to 11 product gaps. This receipt records deterministic
common-contract evidence only. It does not claim Linux, Windows, macOS,
ProcessCapsule closure, packaging, or release support.

## RED evidence

The first coherent RED group ran the public surface, registry, outcomes, and
deadlines files. It exited 1 with 4 expected failures and 34 passes:

- raw-provider coordinator construction was accepted;
- a non-empty registry without a manifest was accepted;
- a retired provider reference could be prepared again;
- a fulfilled inspect result after the monotonic deadline was accepted when the
  scheduler callback was withheld.

The second coherent RED group ran lifecycle, outcomes, reference, deadlines,
and ProcessScope-adapter files. It exited 1 with 15 expected failures and 50
passes. The discriminators reproduced unbounded durable publication, mutable
prepare/termination dispatch, hostile input rejection escaping the typed seam,
loss of inert recovery state, statusless root exit, runtime-bridge failure after
activation, collapsed prepare control loss, and the replayable full-reference
diagnostic view.

## Finding closure

| Finding | Fix and discriminator |
| --- | --- |
| SEC-PA-001 / B-002 | Active and retired references share a fixed 1,024-entry non-evicting lifecycle tombstone ledger. Collision fails before publication/activation; capacity exhaustion fails before provider dispatch. The deterministic fixture now mints a generation reference by default and the unchanged mutation harness contains `reference-reuse`. Retired- and active-reuse plus capacity tests are green. |
| B-001 / SEC-PA-003 | Every non-empty registry requires exact manifest binding. The public coordinator no longer has a `providers` option and rejects a runtime raw-provider property. All operational conformance paths use the manifest-bound registry; the only convenience constructor is test-only. No-manifest tests assert zero provider dispatch. |
| B-003 | `bounded(...)` compares injected monotonic time with the stored deadline at fulfillment and aborts/quarantines settlement on or after the deadline even if the timer callback is delayed. Focused coverage exercises prepare, publish, activate, inspect, terminate, abort, and exact-empty observation. |
| B-004 | The unchanged provider suite now covers manifest-gated operational preparation, publication mismatch, prepared and published broken abort, inert recovery, canonical/tampered/future recovery, natural exact empty, every bounded phase, real late control, duplicate activation, and fresh-generation reference behavior. |
| SEC-PA-002 | The ProcessScope adapter opens and validates the runtime bridge while authority is `published-inert`. Bridge failure performs one bounded published abort before activation. Activation timeout/control loss performs one exact-reference termination/reconciliation and disposes the bridge; only authentic exact empty releases authority. |
| SEC-PA-004 | Full references are documented as sensitive replayable control capabilities. `toProcessAuthorityReferenceView` returns only a redacted schema/provider tuple and a SHA-256 digest of the full reference; it contains no replayable reference or reversible provider bytes. |
| M-001 | Common outcomes now preserve `prepared-inert` and `published-inert` with the exact reference. The compatibility adapter maps both to retained/controllable legacy prepared state so exact-reference termination remains available. |
| M-002 | `ProviderControlOutcome` requires root-exit `code` and `signal`. Closed-shape normalization rejects statusless root exit as control loss on observation and control paths. |
| M-003 | `PreparedProcessAuthority.publish` now accepts the trusted durable publisher callback and executes it under the common publish operation id, monotonic deadline, and `AbortSignal`. The former bounded no-op was removed. |
| M-004 | Pre-reference timeout and control loss retain their exact state and phase `prepare`; the ProcessScope adapter maps them to `process-control-timeout` and `process-control-lost`. |
| M-005 | Selection, prepare input, termination intent, and abort reason are bounded and hostile-accessor safe. Prepare and termination values are copied/frozen once, and the same immutable snapshot supplies operation identity and provider dispatch. Invalid values return typed failures with zero provider dispatch. |

The Change design and delta spec were updated to freeze these rules. Tasks
9.9-9.14 remain unchanged and unchecked; a fresh reviewer must decide closure.

## GREEN gates

- Exact task-9.1 12-file focused command with single workers and dot reporter:
  exit 0; **12 files, 156 tests passed**.
- Specified surrounding host/management/daemon/CLI regression command:
  exit 0; **32 files, 267 tests passed, 4 skipped**.
- `pnpm run build`: exit 0; TypeScript and source-owned ProcessCapsule win32-x64
  build completed.
- `pnpm run lint`: exit 0.
- `pnpm exec tsc --noEmit --pretty false`: exit 0.
- `node bin/rasen.js validate ecp-platform-process-authority-foundation --strict`:
  exit 0; Change valid.
- Foundation-owned per-file whitespace/diff audit: recorded after this document;
  no whitespace errors.

## Boundary

No Direction, portfolio, `.rasen`, runstate, OS-provider Change, native
ProcessCapsule contract, Mac/MMAC decision, stash, retained temp output, commit,
push, ship, or archive action was taken. The cumulative shared dirty worktree was
preserved.
