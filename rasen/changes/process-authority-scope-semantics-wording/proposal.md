# Change: Narrow the recursive process-scope semantics contract to what 0.2.0 actually does

## Why

Two entries in the frozen `RECURSIVE_PROCESS_SCOPE_SEMANTICS` contract no longer describe the system. `workload-non-escape` overclaims: `evidence/f-l2-17-linux-escape-demonstration.md` on the Linux provider Change demonstrates, with three independent kernel facts and six checked falsifiers, that a workload inside the authority namespace can ask the host `systemd --user` to start a unit that lives outside the authority's PID namespace and cgroup and is invisible to its `ECHILD` emptiness oracle. That is not a defect and is not being fixed: the process authority is a janitor, not a sandbox, and a user who asks for a dev server should get one. What the implementation measures, and all that is needed, is that descendants the workload itself forks cannot escape. `replacement-recovery` is criterion 4, which Direction Step 1 locked decision 11 moved to the upgrade path; 0.2.0 daemon death is scope death, the in-flight action is typed `execution-lost`, and there is no reattach and no identity revalidation across daemon lifetimes. A frozen contract that still advertises both is advertising what this release deliberately does not do.

`publish-before-activate` goes with them, by LEAD decision resolving this Change's original open question. The same re-tier that moved criterion 4 moved the durable publication machinery that gave the semantic its purpose (rows 2.7, 6.9, 6.10, 6.11, 7.10 all grade `MOVES-UPGRADE-PATH`, and row 2.5 assigns the published phase to the three-phase protocol), and the macOS provider's design already declares the semantic `Not claimed` for exactly this reason. Exactly-once explicit activation is not this semantic and stays: it is enforced by the adapter itself at `process-scope-adapter.ts:181` before any publication call, and the delta spec retains it as its own requirement.

All three entries live in the same frozen array, whose per-element positional identity is enforced by the registry and manifest validators and is emitted verbatim into the shipped `providers.json` for every platform provider. Changing them separately would re-emit that manifest repeatedly and re-bind the same dependent receipts each time, so they are one Change.

## What Changes

- **BREAKING (contract text and emitted manifest, not behaviour)**: rename the semantic `workload-non-escape` to `forked-descendant-non-escape` so the token itself carries the narrowed claim into `providers.json`, where prose does not travel.
- **BREAKING (contract text and emitted manifest, not behaviour)**: remove `replacement-recovery` and `publish-before-activate` from `RECURSIVE_PROCESS_SCOPE_SEMANTICS`, leaving eight semantics. The implementations stay in git on the upgrade path; nothing is deleted, no history is rewritten, and the coordinator's prepare-publish-activate mechanics keep running unchanged as implementation, no longer as an advertised capability semantic.
- Hold `RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID` at `rasen-recursive-process-scope/1` and `PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION` at `1`, on the recorded finding that no shipped release registers a process-authority provider and no durable reference in the field binds that capability id. The decision carries a stated falsifier and a task that must run it before the constant is edited.
- Record, in the main capability spec, that replacement recovery is deferred to the upgrade path rather than silently dropped.
- **Explicitly retain**, and name in the spec so a mechanical removal cannot take them: the versioned opaque reference envelope, reopen-and-revalidate before every control verb, and the `identity-drift` refusal to signal. Every control verb is a fresh helper process that consumes the private reference and revalidates before acting, so that machinery is simultaneously the retained per-operation destructive-target-safety path and the criterion-4 reattach path. Only the cross-daemon-lifetime resume purpose leaves.
- **Explicitly retain, as a second standalone requirement**: exactly-once explicit activation and workload inertness before activation. Removing `publish-before-activate` must not take them, because they are enforced independently of publication: the adapter refuses a second activation at `process-scope-adapter.ts:181` before it ever calls publish, and the coordinator settles activation exactly once.
- **Do not touch the legacy ProcessCapsule capability list**, which reuses the identical `publish-before-activate` token string under a different contract (`rasen-process-capsule-manifest/1`): `src/core/session-host/process-capsule/resolver.ts:13`, `scripts/build-process-capsule.mjs:56`, `test/core/session-host/process-capsule-package.test.ts:17`. Those files are hash-pinned by `LEGACY_PROCESS_CAPSULE_INPUTS` and the legacy path is never converted by the archived additive-migration requirement.
- Update the four hand-written copies of the semantics array (two build scripts, two package/contract tests) that do not derive from the constant, and rename the conformance case whose label claims replacement recovery while its body only asserts inert-phase preservation within one coordinator.
- Rebaseline the two `FROZEN_COMMON_INPUTS` guards that pin the byte hash of the main capability spec and the shared conformance helper, following the sequencing the sibling `process-authority-prepare-unavailability-outcome` Change established.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `process-authority-provider`: the recursive process-scope capability enumerates eight semantics; non-escape is scoped to descendants the workload forks, replacement recovery and the publish-before-activate semantic are declared deferred to the upgrade path, and per-operation reference revalidation, drift refusal, exactly-once explicit activation, and pre-activation workload inertness are retained independently of them.

## Impact

- Affected product code: `src/core/session-host/process-authority/types.ts` only. The Linux and Windows descriptors, the registry validator, and both manifest builders read the constant and follow automatically.
- Affected build scripts: `scripts/build-linux-process-authority.mjs` and `scripts/build-windows-process-authority.mjs`, which each hold an independent literal copy of the array that is emitted into `providers.json`.
- Affected tests: `test/core/session-host/linux-process-authority-package-ci.test.ts`, `test/core/session-host/windows-process-authority-contract.test.ts`, `test/helpers/process-authority-provider-conformance.ts`, and the two frozen-input guards in `test/core/session-host/linux-process-authority-boundary-guards.test.ts` and `test/core/session-host/windows-process-authority-package-ci.test.ts`.
- Affected receipts: the Linux ledger rows and WSL gate rows whose claim is phrased against the three old semantics, and the Windows task 9.8 replacement-recovery sequence. Enumerated with their disposition in `design.md`.
- Explicitly NOT affected: the legacy ProcessCapsule contract files named above, the `durable-process-scope-authority` spec that names the publish-before-activate discriminator for that legacy contract, and all native crate source. The only native occurrence of any retired token is a historical doc comment at `native/windows-process-authority/src/cli.rs:741`, which stays, so neither the Linux `087d87a5` freeze nor the Windows crate freeze is broken and no re-freeze is required.
- No provider behaviour, no namespace or mount change, no masking of `/run/user/<uid>`, no `pivot_root`, and no release claim.
