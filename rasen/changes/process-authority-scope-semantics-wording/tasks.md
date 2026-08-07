## 1. Baseline and the decision falsifier

Section 1 runs before any file is edited. Task 1.2 can stop the Change.

- [ ] 1.1 Record the current bytes of `RECURSIVE_PROCESS_SCOPE_SEMANTICS`, `RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID`, and `PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION`, the two `FROZEN_COMMON_INPUTS` hash pairs, and the Linux `087d87a5` crate source digest, without normalizing unrelated worktree state.
- [ ] 1.2 Run the three field checks that the version-hold decision depends on and record each result verbatim: no published package tarball ships a process-authority `providers.json`; no released version installs a `dist/native/**` provider manifest; no persisted run-state or session-host record carries an authority reference whose capability id is `rasen-recursive-process-scope/1`. If any check finds a field instance, stop and escalate for a `/2` bump decision instead of proceeding.
- [ ] 1.3 Confirm from the current tree that the only native crate occurrence of any of the three retired tokens is the historical doc comment at `native/windows-process-authority/src/cli.rs:741`, which stays untouched, so no crate re-freeze is entailed; and confirm the Windows crate re-freeze in flight touches none of this Change's files.
- [ ] 1.4 Produce the complete consumer list by grepping the whole tree for `workload-non-escape`, `replacement-recovery`, and `publish-before-activate`, classify each hit as recursive-scope derived, recursive-scope hand-written, legacy-ProcessCapsule (MUST NOT change), receipt, or historical evidence, and record it. The legacy-ProcessCapsule class must contain exactly `src/core/session-host/process-capsule/resolver.ts:13`, `scripts/build-process-capsule.mjs:56`, and `test/core/session-host/process-capsule-package.test.ts:17`. Any hit not on the design's enumerated list is a finding, not a silent addition.

## 2. RED contract tests

- [ ] 2.1 Add a RED test asserting the capability enumerates exactly eight semantics in the exact expected order with `forked-descendant-non-escape` at index 0 and neither `replacement-recovery` nor `publish-before-activate` present.
- [ ] 2.2 Add a RED test asserting that a runtime descriptor advertising the retired ten-element array, any retired token, or the retired ordering is rejected at registry construction before any preparation, observation, or control dispatch.
- [ ] 2.3 Add a RED test asserting that a packaged provider manifest carrying the retired array fails closed at manifest validation under the same unchanged capability id, and that no provider is prepared as a result.
- [ ] 2.4 Verify the two length-relative mutation tests still bite after the index shift: confirm `process-authority-manifest.test.ts:112` (`.slice(1)`, which now drops `forked-descendant-non-escape`) and `process-authority-registry.test.ts:130` (`.slice(0, -1)`, which still drops `event-completeness` since the last element does not change) each fail against the pre-fix production code and pass after, rather than assuming a slice remains a meaningful mutation when the array shortens to eight.

## 3. The constant and its hand-written copies

- [ ] 3.1 Rename `workload-non-escape` to `forked-descendant-non-escape` and remove `replacement-recovery` and `publish-before-activate` in `src/core/session-host/process-authority/types.ts`, leaving eight frozen elements and changing nothing else in that file.
- [ ] 3.2 Update the independent literal copy in `scripts/build-linux-process-authority.mjs` to match the constant exactly, including order.
- [ ] 3.3 Update the independent literal copy in `scripts/build-windows-process-authority.mjs` to match the constant exactly, including order.
- [ ] 3.4 Update the asserted literal arrays in `test/core/session-host/linux-process-authority-package-ci.test.ts` (both provider entries) and `test/core/session-host/windows-process-authority-contract.test.ts`.
- [ ] 3.5 Confirm by reading, not by assumption, that the Linux primary, Linux broker, and Windows descriptors, the registry validator, the manifest validator, and the deterministic test provider all derive from the constant and therefore need no edit.
- [ ] 3.6 Confirm that no edit in this section touched `src/core/session-host/process-capsule/resolver.ts`, `scripts/build-process-capsule.mjs`, or `test/core/session-host/process-capsule-package.test.ts`: the identical `publish-before-activate` token there belongs to the legacy `rasen-process-capsule-manifest/1` contract, which is never converted and whose files are hash-pinned by `LEGACY_PROCESS_CAPSULE_INPUTS`.

## 4. Shared conformance harness and the frozen-input guards

- [ ] 4.1 Rename the conformance case `preserves %s during replacement recovery` in `test/helpers/process-authority-provider-conformance.ts` to name what its body asserts, which is inert-phase preservation through the same coordinator, changing no assertion, no fixture, and no control flow.
- [ ] 4.2 Re-derive the new `test/helpers/process-authority-provider-conformance.ts` hash from the edited file and update it in both `test/core/session-host/linux-process-authority-boundary-guards.test.ts` and `test/core/session-host/windows-process-authority-package-ci.test.ts`, in the same commit as 4.1 so the tree is never knowingly left red. Do not touch the spec hash here; it is not knowable until archive.

## 5. Retained-safety and no-drift verification

Section 5 is the guard against a mechanical removal taking destructive-target safety with it. It is verification, not implementation.

- [ ] 5.1 Grep the whole tree for all three retired tokens and confirm the only remaining hits are historical evidence and handoff documents (deliberately not rewritten), the `cli.rs:741` doc comment, and the three legacy-ProcessCapsule contract files (deliberately unchanged). Any other hit in product code, build scripts, tests, or the main specs is a defect.
- [ ] 5.2 Rebuild or dry-run both provider build scripts and confirm the emitted `providers.json` carries the eight-element array for every provider entry and is otherwise byte-identical in shape to the previous manifest.
- [ ] 5.3 Verify that the versioned opaque reference envelope, the reopen-and-revalidate ordering before any destructive control, the `identity-drift` refusal to signal, the adapter's exactly-once activation refusal (`process-scope-adapter.ts:181`, before any publication or provider dispatch), and the coordinator's exactly-once activation settlement are all still present in product code and still asserted by a test after every edit in sections 3 and 4, and record where each is asserted. If adapter-level exactly-once has no existing test, add one.
- [ ] 5.4 Confirm the Linux crate source digest is unchanged from the 1.1 baseline and that `git status` shows no file under `native/**` modified.
- [ ] 5.5 Confirm no file under `.rasen/**` was written at any point in this Change.
- [ ] 5.6 Confirm `src/core/session-host/process-capsule/resolver.ts`, `scripts/build-process-capsule.mjs`, and `test/core/session-host/process-capsule-package.test.ts` are byte-identical to the 1.1 baseline and that the `LEGACY_PROCESS_CAPSULE_INPUTS` guard passes unmodified.

## 6. Receipt disposition

Receipts stand as taken. This section records disposition; it does not rewrite evidence.

- [ ] 6.1 Record the disposition of each receipt whose claim is phrased against `workload-non-escape`, distinguishing those that remain valid under the narrowed wording because they exercise forked descendants, including the Linux task 7.4 detached double-fork recursive-kill oracle and task 7.5 `setpgid` orphan oracle, from `f-l2-17-linux-escape-demonstration.md`, which becomes the justification for the narrowing rather than an open defect.
- [ ] 6.2 Record the disposition of each receipt whose claim is phrased against `replacement-recovery`, including the Linux ledger rows graded `MOVES-UPGRADE-PATH` (2.7, 6.9, 6.10, 6.11, 7.10), the narrowed rows (2.3, 6.2, 6.3, 6.4, 7.7), the WSL primary gate round-4 row for 7.7, and the Windows crate task 9.8 replacement-recovery sequence. State for each whether it is retired with criterion 4, retained because it covers the intra-lifetime half, or split.
- [ ] 6.3 Record the disposition of each receipt whose claim is phrased against `publish-before-activate`, including the split rows 2.5 (published-phase mapping leaves, retained-state mapping stays) and 6.6 (prepared abort stays, published abort leaves with WSL-R4-M04), the publication rows already listed in 6.2 that carry both phrasings, the 7.8 published-abort row, and the Linux broker task 8.6 phrasing that moves with the broker. Note that the coordinator-level publication receipts from the archived foundation remain valid because the mechanics they attest are retained unchanged.
- [ ] 6.4 State explicitly which receipts must be re-taken because their claim named a semantic that no longer exists, and which need only a disposition note because their assertion is unchanged.

## 7. Gates

- [ ] 7.1 Run the focused RED tests from section 2 and confirm each is RED before the section 3 edits and GREEN after.
- [ ] 7.2 Run the complete process-authority test suite, TypeScript no-emit, build, and lint with no new failure.
- [ ] 7.3 Verify whitespace-gate compliance on the bytes of every file this Change touches: LF only, no trailing whitespace, no trailing blank line at end of file. The change directory is not covered by `git diff --check` while untracked, so measure it directly.
- [ ] 7.4 Run `rasen validate --strict` and record the result.
- [ ] 7.5 Obtain an independent code and spec review and resolve every Blocker and Major. The review must check specifically that no retained destructive-target-safety mechanism and no activation-discipline mechanism was removed, that the delta spec lost no scenario other than the two replacement-controller scenarios named in the design, and that the legacy ProcessCapsule files are untouched.

## 8. Lifecycle and dependents

- [ ] 8.1 Ship with a path-scoped commit that touches no unrelated retained file and no run-state file.
- [ ] 8.2 Archive through the authoritative engine and sync the delta into `rasen/specs/process-authority-provider/spec.md`.
- [ ] 8.3 Verify against the archived main spec that the enumeration sentence names eight semantics, that both replacement-controller scenarios are gone, that every other scenario survived the MODIFIED blocks including all seven ordering scenarios, and that both ADDED requirements (revalidation and activation discipline) are present.
- [ ] 8.4 As the first post-archive act, re-derive the `rasen/specs/process-authority-provider/spec.md` hash from the archived bytes and update it in both frozen-input guard files, then confirm both guards are GREEN.
- [ ] 8.5 Notify the dependent macOS provider Change that the contract is no longer mid-flight, and record the archived eight-semantic array as the version its capability declaration must be written against.
