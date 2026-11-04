# Linux process-authority TypeScript implementation evidence 1

## Scope and baseline

- Worktree: `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- Implementation start HEAD: `81d0ea37770979c0b58b0e54735585fef3280e64`
- Owned implementation surface: `src/core/session-host/process-authority/linux/**`
- Owned tests: `test/core/session-host/linux-process-authority-*.test.ts` and `test/helpers/linux-process-authority-*`
- No task checkbox, common provider module, legacy ProcessCapsule, native helper, host/closure, package/release, broker installation, Windows, or macOS file was edited by this work unit.
- Accepted common inputs after the supporting Change was review-clean and archived:
  - `rasen/specs/process-authority-provider/spec.md`: `05257eb1860aa40ce06a2289b63348e21a81187f4df4fd4aff346e7e8ac57d5a`
  - `test/helpers/process-authority-provider-conformance.ts`: `2e952cde167a72e195e437e45cfa870c5130e29de2cd09c8341ca5c0b93f8b60`
- The Linux byte-for-byte guard also freezes the seven recorded legacy ProcessCapsule protocol/build/resolver/package inputs from the implementation baseline; its semantic assertions retain protocol v2 `pidfd + process-group` as legacy behavior and prohibit either Linux provider id from entering that helper.

## Implemented boundaries

1. Exact primary and broker descriptors and manifest entries for protocol/reference version 1.
2. A closed, bounded canonical private-reference codec for primary and broker authority, including native-owned one-use generation/scope/control capabilities, immutable launch digest, helper artifact and source digests, boot/process/PID-namespace identity, and broker install/key/lease/cgroup extensions. The outer SHA-256 is used only for canonical integrity/corruption detection, not signer authority.
3. Closed native-outcome mapping into the frozen common state vocabulary, including exact code XOR signal root exit and fail-closed malformed-result handling.
4. A trusted publication ledger and authentic common publisher that reconstruct the canonical common reference internally, validates the exact tuple/generation/operation/launch binding, stores no capability secret, atomically renames a sibling temporary entry, fsyncs the record/entry/root before acknowledgement, reconciles bounded UUID-shaped partial entries, and retains malformed/conflicting/untrusted state.
5. An injected primary/broker provider bundle with immutable launch snapshot/digest, exact native attestation validation, native-owned capability preservation, typed prepare unavailability, ledger-only prepared/published phase mapping, publication proof inside activation, no hidden publication side effect, and private runtime opening.
6. An adjacent artifact-manifest resolver for Linux x64/arm64 primary/broker helpers with closed canonical schema, platform/mode/provider/protocol/reference, file type/mode/length/hash/source/compiler checks, and explicit rejection of PATH, shell, download, runtime compiler, symlink, escape, and legacy fallback.
7. A Linux fixture importing the provider-neutral conformance suite without a production wrapper. It uses the production primary provider, production ledger, and production publisher. Native test transport uses the closed RPA1 diagnostic-code vocabulary.

## TDD evidence

- Contract/reference/outcome tests were authored before the corresponding Linux modules and initially failed module resolution and behavior assertions.
- Publication tests were expanded from missing-record/commit behavior through crash windows and first exposed a non-recoverable final-directory-first write order. The implementation was changed to a sibling temporary-entry protocol and the suite closed at 8/8.
- Provider capability-ownership tests initially assumed TypeScript-generated capabilities. Architecture arbitration made native authoritative; the test was changed first and failed until the request stopped carrying capabilities and the provider validated/encoded the native attestation exactly.
- Typed prepare-unavailability tests were changed first and produced two focused RED failures (direct provider rejection and coordinator `control-loss`). Returning the new common typed union closed both; provider tests then passed 9/9.
- Linux conformance was introduced first with a missing fixture (RED), then ran 27/28. The remaining RED proved the shared test had already durably published before demanding `prepared-inert`. The supporting common Change corrected the setup to prepare-only vs prepare+publish; the real Linux provider then passed 28/28 without ledger deletion or a provider wrapper.
- The common suite originally asserted arbitrary fixture diagnostic text byte-for-byte. The supporting Change retained the safety property (state/reference, non-empty bounded diagnostic, no exact-empty release) while allowing the Linux adapter's closed native diagnostic vocabulary.

## Focused and final receipts

- `pnpm exec vitest run test/core/session-host/linux-process-authority-provider.test.ts` -> 9/9 passed after typed-unavailable GREEN.
- Interim supporting-seam receipt before its final review delta: Linux conformance + common conformance + typed prepare-unavailable -> 78/78 passed; the final post-archive counts are recorded below.
- `pnpm exec vitest run test/core/session-host/linux-process-authority-boundary-guards.test.ts -t "keeps the legacy"` -> legacy ProcessCapsule hash/semantic guard passed (1 passed, common guard intentionally skipped).
- `pnpm exec tsc --noEmit --pretty false` -> passed.
- Focused ESLint over the Linux product/tests/fixture -> passed.
- `rasen validate ecp-linux-process-authority-provider --strict --no-interactive` -> `Change 'ecp-linux-process-authority-provider' is valid`.

After the accepted common hashes were installed, the final parallel aggregate gate produced:

- all six Linux test files -> 6 files, 71/71 passed, including both common/legacy byte guards and the production-ledger conformance fixture;
- common conformance plus focused typed prepare-unavailable tests -> 2 files, 51/51 passed;
- TypeScript `--noEmit` -> passed with no diagnostics;
- focused Linux ESLint -> passed with no diagnostics;
- strict Change validation -> valid.
- explicit accepted-hash check -> both common inputs matched exactly;
- targeted `git status --short` -> only the owned Linux product directory, six Linux tests, Linux fixture, and this work unit's evidence/handoff paths were listed for this unit.

The final aggregate receipts below were run only after the supporting prepare-unavailability Change was review-clean, archived, and the accepted common-input hashes above were supplied by LEAD.

## Open integration and platform gates

- The native helper owns capability generation, guardian authentication, reopen/revalidation, activation, inspect, terminate, abort, and actual-kernel proof. This TypeScript work consumes that attestation/transport seam; it does not substitute for native receipts.
- The expected helper artifact identity is an explicit provider-factory input. Package/build/host integration must pass the exact resolver result; no production default registration was added here.
- Broker reference and factory boundaries exist, but authenticated broker client/service/install/lease/cgroup behavior and privileged cgroup-v2 evidence remain separate open gates.
- WSL actual-kernel, package matrix, ProcessScope default/closure, and ECP-8 release truth remain open and cannot be closed by these unit/conformance receipts.
- Task 6.2's authored wording says TypeScript creates random capabilities. The reconciled implementation meaning is: the native helper creates fresh random one-use generation/scope/control capabilities inside the authority construction boundary; TypeScript validates their exact size and native attestation binding, preserves them in the closed private reference, and never generates or backfills them. This is the only interpretation consistent with the guardian authentication design and the native/TypeScript seam.
