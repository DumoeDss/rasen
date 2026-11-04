# Independent review round 1 - session policy and control parity

Change: `ecp-session-policy-and-control-parity`
Reviewer role: FRESH NON-AUTHOR (reviewed the executor this change consumes; zero
involvement in policy-parity's authoring). Branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`, review at HEAD `c37b90b8` (the
policy-parity implementation commits `af88932e..b798fe2a` on top of propose
`53f4559f` are ancestors; my review commits are docs-only). 2026-08-09.

Every verdict below was re-derived on this tree; the load-bearing fault-matrix
discrimination (M6c) and the policy-parity suite were re-run by the reviewer. No
receipt summary was trusted.

## Overall verdict

**CLEAN.** 0 Blocker / 0 Major / 0 Minor. The fault matrix drives the SHIPPED
executor seam (not a parallel fixture), proven by source-label assertions re-run
discriminating under a shipped-executor mutation. The drift gate, face-invariance
harness, and provenance-bearing policy source are sound; safety is limit-
independent; the shipped executor + native crates are untouched. The change is
archive-ready (28/28 tasks; archive dry-run blockers `[]`).

## Item 1 - fault matrix at the SHIPPED seam (load-bearing, anti-theater) - CONFIRMED

`test/core/session-policy-parity/fault-matrix.test.ts` imports the SHIPPED
`dispatchGrantedAction` (`:3`) and the SHIPPED `HostedBackendSeam`/`InToolBackendSeam`
interfaces (`:10-13`). `seamFor(mode)` (`:70-124`) constructs a seam of one of the
shipped kinds for each mode, and `dispatchMode` (`:126-148`) calls
`dispatchGrantedAction` with the shipped `buildExecutionCapabilityMatrix` and the
shipped seam. So every mode flows through the shipped executor - not a parallel
fixture.

The decisive anti-theater evidence is the source-label assertions
(`fault-matrix.test.ts:261,270,279`): daemon-restart -> `source === 'daemon-death'`,
host-restart -> `source === 'lost-generation'`, worker-process-loss -> `source ===
'launcher-disappearance'`. These source values are minted ONLY by the shipped
`reconcileActionOutcome` (verified in the executor's `action-outcome.ts:131-141,172-
178`). A parallel fixture would have to replicate that exact logic; asserting the
labels proves the production reconciliation ran. An explicit anti-theater guard
(`:160-167`) asserts each execution mode's seam is one of `['hosted','in-tool']`.

**M6c re-run by reviewer:** the shipped `action-outcome.ts` daemon-death branch was
mutated (`'daemon-death'` -> `'host-turn'`); the fault-matrix test RED'd exactly on
`> daemon-restart (hosted) composes execution-lost with the daemon-death source`
(`expected 'host-turn' to be 'daemon-death'`). Byte-exact restore
(`9c6782af...` before and after; `git status` clean). This is the load-bearing
discrimination: the fault matrix genuinely depends on the shipped executor's output.
Receipts M6a/M6b/M6d (committed-invocation re-exec, unprovable-completed, double-
settle) are the same transient-mutation-then-revert class on the shipped executor,
each attributed to its fault-matrix guard; the executor's own 89-guard suite passes
unchanged after all reverts (the byte-identity proof).

## Item 2 - drift gate (M3) - CONFIRMED

`parity-gate.ts` `assertProjectionBackedByRecord` (`:94-`) returns `{kind:'backed'}`
or a typed `{kind:'drift', field, projected, canonical}` after checking `runId`
(`:98`), `actionId` (committed membership, `:107`), and `completionState`. A face
projecting a Run/Action/completion fact not backed by the canonical Record fails
closed with the typed drift outcome. Receipt M3 (always-return-`backed`) REDs the 3
divergent-projection guards; the structure makes that discrimination direct (each
field is an independent check returning drift).

## Item 3 - face-invariance (M7) - CONFIRMED

`face-invariance.test.ts` 5.1 asserts every face resolves the byte-equal policy and
yields the identical decision from one configured block (`:54,64,86`); 5.2 asserts
`resolveSessionPolicySource` is face-agnostic (one resolution point, no face
parameter, `:112`) and that cross-authority retirement is identical on every face
(`:122`). Receipt M7 (per-face policy injection) REDs the 3 5.1 guards while the 5.2
cross-authority safety guard stays GREEN - confirming safety is face-invariant and
limit-independent. Reuse policy is resolved once (one resolution point) and is the
same for all faces.

## Item 4 - policy config source + 4.3 safety - CONFIRMED

`policy-source.ts` `resolveSessionPolicyBlock` (`:226-265`) walks project > store >
global > `DEFAULT_EXECUTOR_POLICY_BLOCK`, stamping each field `authored` (configured)
or `default` (unset) with the layer source. `validateLimit` (`:148-164`) rejects
non-integer / `< min` / `> max` values; `validateRetireReasonLabel` (`:166-175`)
bounds the label length. Receipt M2 (validator disabled) REDs 4 guards.

**Limit-independent safety (the critical 4.3 property):** the resolver produces the
`ExecutorPolicyBlock` (VALUE) that feeds the shipped `resolveReusePolicy`/`decideReuse`
UNCHANGED - the resolver signature and the `decideReuse` safety decisions (never /
cross-authority / over-limit) are byte-identical. A maximally permissive valid config
(e.g. `handoffTokenLimit` at the max bound) still retires cross-authority reuse,
because `decideReuse` checks cross-authority BEFORE the limit (executor
`reuse-policy.ts:245`). Configured limits govern only same-authority over-limit
behavior; the cross-authority safety decision is independent of the configured value.
CONFIRMED.

## Item 5 - the 3 flagged items - all sound / acceptable

(a) **Resolver's hardcoded `default` numeric-limit provenance, corrected by THIS
change's source.** SOUND. The executor's `resolveReusePolicy` stamps numeric limits
`default` unconditionally (the documented "no authoring surface yet" gap). This
change does NOT modify the resolver; `resolveSessionPolicySource` (`:286-322`) builds
the `ResolvedReusePolicy` from the resolver then overrides ONLY the numeric-limit
PROVENANCE with the source's authoritative per-field provenance (`:303-314`). The
values, the `sessionReuse` scope provenance, and `retireReasonLabel` come straight
from the resolver. This is the faithful reading of "signature and safety decisions
unchanged" + "a configured limit carries authored provenance": this source IS the
authority that knows whether a value was configured, so it is the correct bearer. A
future resolver change is not required.

(b) **`definition` provenance reserved, not fabricated.** ACCEPTABLE. The vocabulary
includes `definition` (a future node-nature derivation), but this change's config
surface produces only `authored`/`default`; it does not fabricate a `definition`
derivation. The provenance guard asserts the vocabulary and that configured values
carry `authored`. Reserving an unused vocabulary slot for a named future derivation
is honest, not a gap.

(c) **M6a-d as transient executor mutations (receipted + reverted).** ACCEPTABLE.
This matches the executor change's own receipt practice (transient mutation on the
module under test, RED captured, byte-exact revert). I re-ran M6c and confirmed the
discrimination + byte-exact restore; the executor's own 89-guard suite passes
unchanged (byte-identity proof). Cross-referencing the executor's own receipts where
they overlap is appropriate; re-mutating the shipped executor to prove the matrix's
executor-mechanism guards discriminate is the stronger evidence and is acceptable.

## Item 6 - additivity - CONFIRMED

`git diff --numstat 53f4559f..HEAD -- src/core/frozen-action-executor/ native/` is
EMPTY: the shipped executor module and the frozen authority crates are untouched.
The 4 transient M6 mutation edits to `action-outcome.ts`/`authority.ts` were
reverted byte-exactly (verified: executor's 89-guard suite green; `git status` on
the executor clean after my M6c re-run + restore). The two config files +
`config-diagnostics.ts` are additively modified (`global-config.ts` +16/0,
`project-config.ts` +107/0, `config-diagnostics.ts` +5/0 - zero deletions), mirroring
the `runs`/`handoff` config precedent; 135 config + executor + policy-parity tests
pass.

## Item 7 - scope - CONFIRMED

No self-hosting toy-Change design: `SELF_HOSTING_PROOF_SEAM` lives in
`frozen-action-executor/executor.ts`, which is untouched (verified: empty diff).
Real-OS / real-agent-backend receipts for the parity, fault-matrix, and face-
invariance properties are explicit ECP-8 known gaps (`evidence/ecp8-deferred-
receipts.md`) with deterministic counterparts named as the 0.2.0 gate - not defaulted
to pass. Acceptance 7 (self-hosting proof) is operator-owned and untouched.

## Item 8 - spec delta + projection - CLEAN

`## ADDED Requirements` for one new capability; no scenario rename, no heading
rename. `rasen archive ecp-session-policy-and-control-parity --dry-run --json`:
specSync `blockers: []`, and the top-level `blockers: []` too (28/28 tasks ticked;
no task-incompleteness gate). The change is archive-ready from the projection's view.

## Item 9 - gates - CLEAN

- `validate --strict`: passed. `tsc --noEmit`: 0 errors. `eslint` over
  `src/core/session-policy-parity/`: clean.
- Whitespace: `git diff --check 53f4559f..HEAD` clean; no trailing whitespace in the
  change directory.
- Policy-parity suite: 53/53 (4 files). Targeted regression (executor +
  session-policy-parity + effective-config + project-config + config-loading): 135
  passed / 0 failed (12 files). The executor's 89-guard subset passes unchanged -
  the byte-identity proof after the transient M6 reverts.

## Findings

None (0 Blocker / 0 Major / 0 Minor).

## Ship-readiness

CLEAN. This is the last implementation child; the LEAD may ship + archive
policy-parity. The deterministic fault-injection + mutation guards are the 0.2.0
gate; the real-OS/real-backend receipts defer to ECP-8 as explicit named gaps. No
code change was made by this review; only this evidence file was added.
