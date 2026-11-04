# Mutation receipts - ecp-session-policy-and-control-parity

Provenance: every guard this change adds was mutated to the defect it names, the
targeted guard run RED, and the mutation reverted byte-exactly. Method per
receipt: apply a behaviour-only mutation (no type changes) via exact-string edit,
run the relevant session-policy-parity suite, capture the RED test(s), revert the
exact edit, confirm the diff is byte-exact (`git diff --numstat` empty against
this change's GREEN commits), and re-run to GREEN. The autocrlf "LF will be
replaced by CRLF" notices are the repo's checkout notice, not stored CRLF;
committed blobs are LF.

The two LEAD-named highest-value targets both have demonstrated RED counterparts:
the drift-prevention gate (receipt M3) and the face-invariance harness (receipt
M7). Every receipt names the property it proves; an unmutated green guard is not
acceptance evidence in this repo.

## Receipt M1 - a placeholder (unset) limit stamped authored (task 4.2)

- Guard: `policy-source.ts` `resolveLimitField` resolves an unset numeric limit
  at `default` provenance, NEVER `authored` (the executor's documented
  placeholder-as-authored hazard, closed by this source).
- Mutation: the default-return line stamps `provenance: 'authored'` instead of
  `'default'` (applied to both numeric + label default returns via replace_all).
- RED (3): `policy-source.test.ts > an unset limit carries default provenance and
  the shipped default value`; `> a per-field unset value keeps default provenance
  even when a sibling is configured`; `> a placeholder (unset) limit is never
  stamped authored (discrimination guard)`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt M2 - a safety-disabling / invalid configured limit accepted (task 4.3)

- Guard: `policy-source.ts` `validateLimit` rejects a non-integer, non-positive,
  or out-of-bound limit (a non-integer could permit an off-by-one silent
  past-limit reuse; an unbounded value would disable the over-limit protection).
- Mutation: `if (!Number.isInteger(raw) || raw < bounds.min || raw > bounds.max)`
  -> `if (false && (...))` (the validation guard disabled).
- RED (4): `policy-source.test.ts > rejects a non-integer handoffTokenLimit`;
  `> rejects a non-positive reuseRoundLimit`; `> rejects an out-of-bound limit`;
  `> rejects a malformed value that escaped the resilient global layer`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt M3 - a divergent face projection accepted (drift gate) (task 2.3)

- Guard: `parity-gate.ts` `assertProjectionBackedByRecord` returns a typed `drift`
  outcome for a runId/actionId/completionState the canonical Record does not back.
- Mutation: the function returns `{ kind: 'backed' }` unconditionally (early
  return before any check).
- RED (3): `parity-harness.test.ts > a divergent runId fails closed with a typed
  drift outcome`; `> a divergent actionId (absent from the Record) fails closed`;
  `> a divergent completionState fails closed`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt M4 - fault-matrix coverage guard disabled (task 3.1)

- Guard: `fault-matrix.ts` `uncoveredFaultModes` returns the set of declared
  modes the harness did not exercise.
- Mutation: the return is sliced to length 0 (`.slice(0, 0)`), so every missing
  mode is reported as covered.
- RED: `fault-matrix.test.ts > adding a fault mode without its harness cell fails
  the coverage guard`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt M5 - fault-matrix typed-outcome-per-mode mapping corrupted (task 3.1)

- Guard: `fault-matrix.ts` `FAULT_MODE_SPECS` maps each mode to the typed outcome
  the shipped executor produces for it; the harness asserts each dispatch matches.
- Mutation: the `daemon-restart` spec's `outcomeKind` changed from
  `'execution-lost'` to `'succeeded'`.
- RED: `fault-matrix.test.ts > every mode dispatches through the shipped
  dispatchGrantedAction and produces its typed outcome`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt M6 - executor recovery invariants neutralised (tasks 3.2 / 3.3 / 3.4)

Four TRANSIENT mutations on the shipped executor module (the same receipt method
the executor change used on its own module). Each was applied, the matching
fault-matrix guard run RED, and the mutation reverted byte-exactly. After all
four reverts, `git diff --numstat -- src/core/frozen-action-executor/` is EMPTY
and the executor's own 82-guard suite passes unchanged (the proof the module is
byte-identical to its shipped state). These are cross-referenced to the executor
change's receipts where they overlap; the fault matrix re-asserts each property
under the seven-mode enumeration.

- **M6a - a committed invocation re-executed / an unknown-commitment input resent
  (3.2):** `action-outcome.ts` `isCommittedInvocation` -> `return false`. RED (2):
  `fault-matrix.test.ts > no-resend / no-reexecute: a committed invocation is
  guarded from re-drive`; `> a committed invocation survives a daemon restart
  untouched`.
- **M6b - an unprovable state silently completed (3.2):** `action-outcome.ts`
  `reconcileActionOutcome` `turn === undefined` branch returns `kind: 'succeeded'`
  instead of `'uncertain'`. RED (2): `> fail-closed-on-unprovable: an unprovable
  in-flight turn is uncertain, never silently completed`; (cascade) `> every mode
  dispatches ... produces its typed outcome` (cancel-before-start).
- **M6c - execution-lost source relabelled (3.3, anti-theater):** `action-outcome.ts`
  daemon-death `deathOutcome` source `'daemon-death'` -> `'host-turn'`. RED:
  `> daemon-restart (hosted) composes execution-lost with the daemon-death source`.
  (The source label is minted ONLY by the shipped reconciliation; asserting it is
  the proof the production path ran, not a parallel fixture.)
- **M6d - a duplicate/double-settle accepted (3.4):** `authority.ts`
  `inFlight.has(...)` check disabled (`if (false && ...)`). RED: `> a duplicate
  dispatch is caught as typed duplicate (no double-settle)`.

Combined RED run for M6: **6 tests**. All four reverted byte-exactly; executor
diff empty; executor suite green.

## Receipt M7 - a per-face policy source (face-invariance) (task 5.1)

- Guard: `face-invariance.test.ts` asserts every face resolves the byte-equal
  policy and yields the identical decision from one configured block.
- Mutation: the `resolvePolicyForFace` helper injects a face-specific block for
  one face (`canvas` -> handoffTokenLimit 99), modelling a per-face policy source.
- RED (3): `face-invariance.test.ts > every face resolves the identical policy
  from one configured block`; `> every face yields the identical ... decision`;
  `> the decision is face-invariant across permitted, handoff, retire, and
  cross-authority outcomes`. The 5.2 cross-authority safety guard correctly
  stayed GREEN (cross-authority retire is limit-independent - the mutation
  breaks limit-based face-invariance, not authority-based safety).
- Revert: byte-exact; `git diff --numstat` empty.

## Discrimination summary

| Guard (task) | RED count | Byte-exact revert |
| --- | --- | --- |
| placeholder stamped authored (4.2) | 3 | yes |
| safety-disabling / invalid limit accepted (4.3) | 4 | yes |
| divergent face projection accepted - drift gate (2.3) | 3 | yes |
| fault-matrix coverage disabled (3.1) | 1 | yes |
| fault-matrix typed-outcome mapping corrupted (3.1) | 1 | yes |
| committed invocation re-executed / unknown resent (3.2) | 2 | yes (transient executor) |
| unprovable state silently completed (3.2) | 2 | yes (transient executor) |
| execution-lost source relabelled (3.3) | 1 | yes (transient executor) |
| duplicate / double-settle accepted (3.4) | 1 | yes (transient executor) |
| per-face policy source (5.1) | 3 | yes |
| **total RED** | **21** | |

The "at minimum" list from task 6.2 is covered: a divergent face projection (M3);
a face asserting availability the matrix does not report (parity-harness
matrix-availability guard, exercised GREEN over all six faces); a matrix entry
exercised against a parallel fixture (M6c source-label + the seam-kind anti-
theater guard); a committed invocation re-executed (M6a); an unknown-commitment
input resent (M6a); an unprovable state silently completed (M6b); a duplicate /
double-settle (M6d); a safety-disabling config accepted (M2); a placeholder
stamped authored (M1); a per-face policy source (M7).
