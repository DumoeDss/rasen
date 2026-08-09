# Section 8: the actual-Windows kernel gate

Date: 2026-08-07\
Author: implementer (Section 8), single leaf worker\
Host: Windows 11 Pro 10.0.26200.8875, x64, native, no WSL\
Toolchain: `rustc 1.88.0 (6b00bc388 2025-06-23)` / `cargo 1.88.0 (873a06493 2025-05-10)`, target
`x86_64-pc-windows-msvc`. Node `v24.14.0`.

This is task 8.17's gate summary and the row-by-row record for 8.1 through 8.16.

**16 of 17 tasks are ticked. 8.12 is NOT ticked**, because a defect in the production control path
loses the receipt for the one step it needs. That defect is `S8-F1` below and it is reported, not
worked around.

## Bindings

Every receipt below binds crate source digest\
`2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377`.

Rows that execute a binary additionally bind the **packaged** helper\
`2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0`, 258560 B, with the packaged
guardian `d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f`, 254464 B.

`target/release/` was never used. It still holds the superseded `aeb1af91` / `d230f8b0` pair that
embeds the dead `b44c5e25`; nothing here points at it. Every executed helper was produced by
`scripts/build-windows-process-authority.mjs`.

### The freeze held, and `tests/` really is outside it

Verified by falsification rather than by reading the script. A **new** 56189-byte test file was
added under `tests/` and the source digest did not move:

```text
opening measure   node scripts/build-windows-process-authority.mjs --plan -> 2b3fabd9...
closing measure   same command, after all Section 8 work                  -> 2b3fabd9...

tests/windows_authority_kernel.rs      41129 B  2cbf1c24da4ef8ca3713aa18ca45becce4accea028d40cf24b903559842da4fb
tests/windows_guardian_lifecycle.rs    23037 B  81e10a339873b737e32c4690f1f0f600d3c74f4ce51be765bdbab60a4b8afd8c
tests/windows_section8_gate.rs         56189 B  ba540903bdb9ac157303ee3c366cf8ed1a8c9dbf4d6896b23bf31db6a473bb87   <- NEW
```

The first two digests are **byte-identical to the values in `evidence/win-crate-freeze-marker.md`**.
Neither existing test file was modified; all new work went into a new file, so the marker's
test-digest map remains exactly true. The LEAD owes the marker one added line for the third file.

### Build receipts (task 8.1)

Three isolated packaging builds, three distinct temp roots, all byte-identical:

```text
RASEN_WINDOWS_PROCESS_AUTHORITY_TEMP_ROOT=C:/Users/Sayo/AppData/Local/Temp/wpa-s8-tmp    -> 2aebab69 / d571f148
                                          .../wpa-s8-tmp2                               -> 2aebab69 / d571f148
                                          .../wpa-s8-tmp3                               -> 2aebab69 / d571f148
releaseInputSha256 9237b31ebe5c6d978b70df9d904aa9446be4b8851fe718d8e456d221c353c18a  (all three)
```

Manifest verified field by field against the measured bytes: `length` 258560, `sha256` `2aebab69`,
`sourceSha256` `2b3fabd9`, `compiler` `rustc 1.88.0 (6b00bc388 2025-06-23)`, `machine` 34404
(0x8664). Together with the re-freeze worker's three roots this is **six independent build roots
by two agents on this host**; cross-*machine* reproducibility remains open.

## Row-by-row verdicts

Every row states what ran, what it bound, and the mutation that shows the assertion discriminates.
`kernel` = `tests/windows_authority_kernel.rs`, `guardian` = `tests/windows_guardian_lifecycle.rs`,
`gate` = `tests/windows_section8_gate.rs` (new).

| Task | What ran | Binds | Demonstrated failing counterpart | Verdict |
| --- | --- | --- | --- | --- |
| 8.1 | packaging build x3; `helper self-identity` executed from the packaged path; production TS resolver against the packaged tree | `2aebab69` + `2b3fabd9` | resolver REDs: wrong manifest digest, wrong manifest length, wrong manifest source digest, tampered artifact byte -- each rejected, then GREEN again after restore | DONE |
| 8.2 | `kernel::actual_prepare_creates_an_exact_empty_authority_with_no_workload_process` | source | `gate::red_each_prepare_oracle_has_a_configuration_that_makes_it_fail`: `allow_breakaway` moves the mask off `EXPECTED_LIMIT_MASK`; `associate_port_late` makes `port_was_associated_on_an_empty_job()` false; a duplication count of 1 makes `sole_handle_holds()` false | DONE |
| 8.3 | `kernel::actual_root_is_a_member_before_its_first_instruction_and_only_runs_after_the_resume` | source | `kernel::red_a_root_created_without_the_job_list_is_not_a_member_and_fails_its_proof` -- same fixture, `omit_job_list`, membership false and the pre-resume proof incomplete | DONE |
| 8.4 | `kernel::actual_breakaway_is_refused_by_the_operating_system_and_permitted_when_the_limit_allows_it` | source | in-test RED: with `JOB_OBJECT_LIMIT_BREAKAWAY_OK` set the identical attempt reports `breakaway=created` and the created pid is **not** a member of the permissive authority | DONE |
| 8.5 | `gate::actual_detached_new_console_new_group_and_double_forked_descendants_stay_members` | source | `gate::red_descendants_of_a_root_created_outside_the_authority_are_not_members` | DONE |
| 8.6 | `kernel::actual_nested_job_members_stay_inside_the_outer_authority` | source | the membership oracle it uses (`job.contains`) is shown to answer **no** in 8.4's RED and for all four descendants in 8.5's RED | DONE |
| 8.7 | `kernel::actual_root_exit_is_distinct_from_exact_empty_while_a_detached_descendant_lives` | source | `kernel::actual_natural_empty_...` drives the identical drain and **does** observe `ActiveProcessZero` -- so `!saw_zero` is a real discriminator, not a timeout artefact | DONE |
| 8.8 | `kernel::actual_exit_status_is_the_exact_unsigned_value_including_the_still_running_sentinel` and `kernel::actual_authority_forced_termination_sets_the_exact_unsigned_status` | source | `kernel::red_reading_the_status_without_a_completed_wait_cannot_distinguish_live_from_exited_259` | DONE |
| 8.9 | `kernel::actual_natural_empty_comes_from_the_active_process_zero_message_with_a_complete_history` | source | `kernel::red_a_member_that_exits_before_the_port_is_associated_is_lost_and_empty_never_arrives` | DONE |
| 8.10 | `kernel::actual_recursive_termination_converges_while_members_keep_creating_processes` | source | `kernel::deadline_expiry_retains_timeout_and_never_reports_empty` -- expired deadline yields retained `Timeout`, never empty | DONE |
| 8.11 | `guardian::actual_guardian_death_destroys_the_authority_and_terminates_every_member` | `2aebab69` + source | `guardian::red_duplicating_the_job_handle_lets_members_survive_the_guardian` | DONE |
| 8.12 | `gate::actual_controller_replacement_authenticates_rereads_inspects_and_terminates` | `2aebab69` + source | drifted `--guardian-birth` refused with `identity-drift` and the root survives; wrong `--capability` refused and the root survives | **PARTIAL, NOT TICKED** -- see `S8-F1` |
| 8.13 | `gate::actual_identity_drift_mutations_are_refused_before_any_control_is_issued` plus two fresh `probe-identity` processes | `2aebab69` + source | the authentic tuples for both authorities connect successfully in the same test, so none of the five refusals is "nothing works" | DONE |
| 8.14 | `guardian::actual_prepare_is_inert_and_a_prepared_authority_aborts_to_exact_empty`, plus a six-process orchestration over the production ledger | `2aebab69` + source | one byte flipped in the committed entry turns `published-inert` into `authority-uncertain / ledger-malformed`; restoring it restores `published-inert` | DONE |
| 8.15 | 10 real-helper probes, `gate::actual_unavailable_configuration_census_on_this_host`, and the production artifact resolver | `2aebab69` + source | the healthy control `prepare` with the identical command line exits 0 -- and caught a broken harness on the first attempt (below) | DONE |
| 8.16 | `gate::actual_proxied_creation_leaves_the_authority_and_is_neither_claimed_nor_counted` | source | the direct descendant created in the same fixture run **is** a member, so the proxied process's non-membership is a real answer | DONE |
| 8.17 | this file | -- | -- | DONE |

## The rows that needed new work

### 8.5 -- four descendant shapes

A fixture inside the authority creates four long-lived descendants with different creation flags
and exits. All four outlive it.

```text
detached            DETACHED_PROCESS
new console         CREATE_NEW_CONSOLE
new process group   CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
double-forked       a middle process that creates the grandchild and exits immediately
```

Each is held by an open handle taken while it is definitely alive, so the death check afterwards
cannot be fooled by identifier reuse. All four are members (`job.contains` against the authority's
own handle -- the only trustworthy form of the question). The middle process is asserted to have
exited, otherwise the fourth row would be testing an ordinary grandchild. Authority-wide force
then converges on `ExactEmpty` and all four are gone; **no descendant identifier is passed to the
product** -- `terminate_until_empty` takes an exit status and nothing else.

RED: the identical fixture launched with `omit_job_list`. All four descendants exist, all four are
alive, and `job.contains` answers **false** for every one; accounting reports 0 active.

One result worth stating because the obvious guess is wrong: that RED authority does **not** report
a false exact-empty. A Job that never had a member cannot emit `ACTIVE_PROCESS_ZERO`, so the
transition never happens and the authority retains `Timeout`. That is fail-closed and correct. The
RED's content is the membership answers, not a fabricated receipt.

### 8.12 -- controller replacement (PARTIAL)

Every step is a separate real process running production code. The test orchestrates and asserts;
it never opens the endpoint itself.

```text
process 1  helper prepare ...                                   -> attestation, guardian 45960
process 2  helper control --verb run ...                        -> "activated root=<pid>", then KILLED
           root survives its controller                          -> asserted
process 3  helper control --verb terminate --guardian-birth <wrong>  -> identity-drift, root still alive
process 4  helper control --verb inspect --capability <wrong>        -> refused, root still alive
process 5  helper probe-identity --stage pre-open                -> state=authority-present endpointPresent=true
process 6  helper probe-identity --stage post-open               -> state=authority-present
                                                                    endpointAuthentication=authenticated
                                                                    endpointServerProcessId=45960
                                                                    guardianCreationTime=134305648936778771
process 7  helper control --verb inspect                         -> RWA1-OBSERVATION, phase=2 (not prepared-inert)
process 8  helper control --verb terminate                       -> FAILS: "unexpected frame root-exited"
           root exits anyway within the deadline                 -> asserted
```

Established: a fresh process authenticates the guardian's birth identity and the endpoint owner,
performs the mandatory post-open reread through the handles it opened, and inspects the same live
authority. Not established: a replacement controller obtaining an exact-empty **receipt** for
termination. See `S8-F1`.

### 8.13 -- five identity-drift mutations against live authorities

Two authorities, A and B, both live and both correctly serving, so every refusal is a refusal
against something real.

```text
1 reused guardian identifier   A's scope + B's live pid + A's birth
                               -> identity-drift: guardian process id is occupied by a different process
2 drifted birth identity       A's scope + A's pid + corrupted birth
                               -> identity-drift: guardian process id is occupied by a different process
3 endpoint served by another   A's scope + B's ENTIRELY AUTHENTIC pid, birth and owner
                               -> identity-drift: the endpoint is served by a different process
4 wrong endpoint owner         A's tuple + S-1-5-21-0-0-0-500
                               -> identity-drift: the endpoint owner differs from the reference
5 tuple change between reads   probe pre-open (present) -> guardian killed -> probe post-open
```

Cases 1 and 2 reach the same branch from two directions and are recorded as such rather than as two
independent proofs. Case 3 is the one that cannot be faked: both halves are authentic and live, and
only the binding between them is wrong.

GREEN counterpart: the authentic tuples for A and B both connect in the same test. Non-interference:
guardian B, and an unrelated `ping` started outside both authorities, are asserted alive after every
refusal and after A is destroyed. No destructive operation reached either.

Case 5 produced two distinct classifications and both are recorded, because the difference is not
obvious:

```text
guardian killed, our handle still open   -> state=control-loss     endpointAuthentication=rejected
same probe after releasing the handle    -> state=authority-absent endpointPresent=false terminalRecord=null
```

A retained handle keeps the terminated process object resolvable with its original creation time,
so the pre-open identity check passes and the failure surfaces one step later at the endpoint. Both
are fail-closed; a reviewer who assumed `authority-absent` in the first case would be wrong. This is
`S8-F6`.

### 8.14 -- both publication crash windows, across real processes

The ledger is only ever touched through the production module
(`dist/core/session-host/process-authority/windows/publication-ledger.js`), and the reference is
built from a **real prepare attestation on this kernel** -- not from the fixture constants the
existing suite uses.

```text
prepare (real helper)            workloadProcessExists=false
node driver: prepared            lookup -> {"state":"prepared-inert"}
node driver: commit-then-crash   ledger.commit(...) then process.exit(9): no acknowledgement ever produced
node driver: lookup  (FRESH)     -> {"state":"published-inert"}, requirePublished -> published-inert
node driver: lookup-tampered     one byte of the committed entry flipped
                                 -> {"state":"authority-uncertain","diagnosticCode":"ledger-malformed"}
                                 restored -> published-inert
journal A activation records     []            <- no workload root was ever created

prepare (real helper)            workloadProcessExists=false
node driver: publish-then-crash  full production publisher, acknowledgement produced, then exit(9)
                                 acknowledgement keys: preparationOperationId, publicationVersion,
                                 referenceDigest, schema
node driver: lookup  (FRESH)     -> {"state":"published-inert"}
journal B activation records     []

helper control --verb abort      exit 0, RWA1-OBSERVATION 0404...
terminal record B                RWJ1 2 exact-scope-empty never-activated active=0 total=0
journal B after abort            []
ledger after abort               still published-inert
```

Published abort therefore returns exact empty from the authority's own report, with the durable
terminal record reading `never-activated`, and no workload root has ever existed in either window.

Note the abort verb succeeds where terminate fails: an authority with no root emits
`ExactScopeEmpty` with no preceding `RootExited`, which isolates `S8-F1` to the live-root case.

The durability shortfall is reported by the production module itself and is recorded here rather
than left implied:

```text
temporaryInSameDirectory true   flushFileBuffersOnFileHandle true   moveFileExReplaceExisting true
moveFileExWriteThrough  FALSE   flushFileBuffersOnDirectoryHandle FALSE   postRenameReopenAndFlush true
```

### 8.15 -- the unavailable-configuration census

**The first attempt at this row was invalid and the control caught it.** Written as a bash script,
every probe -- including the healthy control -- failed with `argument error: unexpected positional
argument B:/`, because `--arg "exit /b 0"` was word-split and MSYS rewrote `/b` as a path. Without
a healthy control row, ten identical typed failures would have looked like ten receipts. Rewritten
with an argv list.

Reachable on this host, each driven through the real packaged helper:

| Enumerated cause (`design.md:204`) | Probe | Observed |
| --- | --- | --- |
| trusted state root reached through a reparse point | `--state-root <NTFS junction>` | exit 70, `reference-invalid` |
| trusted state root wrongly owned | `--state-root C:\Windows\System32` | exit 70, `reference-invalid` |
| trusted state root missing / uncreatable | `--state-root Z:\no-such-volume\...` | exit 70, `native-uncertain` |
| resolved artifact fails its identity check | production TS resolver, 4 mutations | rejected with exact messages, GREEN restored |
| adjacent artifact absent | helper copied without its guardian | exit 70, raw OS error 2 -- see `S8-F3` |

Not reachable without mutating the machine, with the reason and what was enumerated first:

| Cause | Why unreachable | Enumerated before the verdict |
| --- | --- | --- |
| host inside an ambient Job that refuses nesting | **measured, not assumed**: this process IS inside an ambient Job (`IsProcessInJob(self, NULL)` = true) and the entire authority still constructs inside it -- Job created, exact mask `0x00002000` read back, port associated on an empty Job. 8.6 additionally shows a member creating a *nested* Job whose child stays in the outer authority. Nested Jobs are supported here, so the cause cannot be reached | the membership bit, then the full construction, then 8.6's nested-Job run -- deliberately not a single probe |
| Job creation denied by policy or token restriction | requires a machine-wide policy or a restricted token; no unprivileged route. Refused to mutate the operator's machine | `JobAuthority::create()` succeeds under this token; the injected `job-creation` checkpoint stands in for the reconciliation path |
| completion-port association unavailable | no documented way to deny it to a process that can create the Job; it succeeds here | attestation records `port_was_associated_on_an_empty_job` = true; injected `completion-port-association` checkpoint stands in |
| boot-identity source unobtainable | **both** enumerated candidates are obtainable on this host | `nt-system-boot-environment-information` -> obtainable (selected); `nt-system-time-of-day-boot-time` -> obtainable. Rejected tick derivations recorded: `GetTickCount64`, `QueryUnbiasedInterruptTime`, `QueryPerformanceCounter`, `GetSystemTimeAsFileTime` |
| pipe name cannot be created as a first instance | the scope id is generated inside the guardian, so no external caller can pre-create the name; injected `control-endpoint-creation` stands in | `endpoint.rs` unit test already covers the name-taken-twice case in-process |

Injected construction checkpoints, all through the real helper and all labelled **injected, not
environmental**: `boot-identity-acquisition`, `job-creation`, `job-limit-configuration`,
`completion-port-association`, `control-endpoint-creation`, `final-revalidation` -- every one exits
70 with `native-uncertain`.

### 8.16 -- the proxied-creation boundary

A member asks the WMI provider host -- a service that was already running and is not a descendant
of this authority -- to create a process.

```text
fixture inside the authority: powershell -NoProfile -NonInteractive -Command
  "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create
        -Arguments @{CommandLine='C:\Windows\System32\ping.exe -n 90 127.0.0.1'}; ..."
-> proxy rc=0 pid=39676 direct=13836

direct descendant  13836  is a member      -> the membership question can still answer yes
proxied process    39676  is NOT a member  -> and it is alive when asked
terminate_until_empty -> ExactEmpty, active_processes = 0, direct descendant dead
proxied process 39676 alive after exact-scope-empty: true
```

The provider neither claims nor counts the proxied process, and its exact-empty receipt stays exact
for its actual members -- which is what 8.16 asks for. It is also the Windows instance of the Linux
sibling's `F-L2-17`: `exact-scope-empty` is reported while a process the workload caused to exist is
still running. Recorded as `S8-F4`; the operator decision on `workload-non-escape`'s wording that
lead-2 already raised now has a receipt on both platforms.

## Findings

### `S8-F1` (Major, blocks 8.12) -- a replacement controller cannot obtain a termination receipt

`cli.rs:643`: the `abort` / `terminate` control verb writes its frame and then reads **exactly one**
frame, accepting only `ExactScopeEmpty` or `Failure`. Terminating a *live* authority necessarily
kills the root first, so the guardian emits `RootExited` before `ExactScopeEmpty` and the verb
returns `unexpected frame root-exited` on a termination that **actually converged** (asserted: the
root exits). `run_workload` in the same file drains in a loop; `terminate` does not.

Consequence: any controller replacing a crashed one retains uncertainty for an authority that is in
fact empty. The prepared/published-abort path never sees this because there is no root to kill,
which is why the mature suites are green -- `windows_guardian_lifecycle.rs`'s abort row and every
in-process row use `activation::terminate_until_empty` or drive frames directly, and neither goes
through this verb.

**Not fixed here.** The fix is in `src/cli.rs` and would break the `2b3fabd9` freeze and every
receipt bound to it. The gate test asserts the current behaviour explicitly so it cannot silently
change shape, with an inline note to restore the positive assertion when it is fixed.

This is the **third** Blocker-class defect on this change family found by running production code
against a real kernel rather than by any test.

#### Severity: Major now, Blocker on arrival of a Windows native assembly

The question that decides the grade is whether the broken verb is on the shipped path. Answered by
reading the callers, not by reasoning about intent:

```text
grep createWindowsProcessAuthorityProviderBundle over src/   -> ZERO callers outside its own
                                                                module and the barrel export
grep for any src/ code that executes the Windows helper      -> none; the only textual hit is the
                                                                reference SCHEMA string constant
windows/provider.ts:746   const assembly = unavailableNativeAssembly();
windows/provider.ts:689   unavailableNativeAssembly(): prepare -> authority-unavailable,
                          activate/inspect/terminate/abort -> retained authority-unavailable,
                          artifactIdentity -> 'e'.repeat(64) / 'f'.repeat(64)
linux/provider.ts:1042    assembly = createLinuxPrimaryNativeAssembly(runtimeRoot)
linux/native-assembly.ts:506  spawn('/proc/self/fd/3', ...)   <- Linux really does spawn its helper
src/core/session-host/process-authority/windows/  has NO native-assembly.ts
```

**So the answer is neither of the two the question offered: there is no shipped path.** The Windows
production factory is wired to a permanent-unavailable stub, so production cannot terminate because
production cannot *prepare*. `cli.rs:643` is reached today by exactly two callers: an operator or
agent invoking the helper CLI directly -- which is what every Section 8 row, the `dogfood` verb and
the authored CI workflow do -- and nothing else.

That rules out the Blocker argument as posed: the verb is not the thing production invokes to
cancel, so it cannot be making production report a false or lost cancellation today. It does not
make the grade benign either. The counter-argument stands on its own merits and is the stronger
half: the verb **fails closed**. It returns uncertainty, never a false clean sweep, and it does so
after the authority has genuinely converged. Under the Record-must-not-lie invariant an honest
`uncertain` is a far smaller sin than a fabricated `empty`, and `activation::terminate_until_empty`
converges correctly for any in-process caller.

**Verdict: Major.** Two conditions attach, and both belong in the ledger rather than in a reviewer's
memory:

1. It becomes a **Blocker the moment a Windows `native-assembly.ts` is written**, because that
   assembly's `terminate` has exactly one control transport available to it and this is it. Whoever
   writes it must not build on `control --verb terminate` unchanged; the fix is to drain frames in a
   loop as `run_workload` already does, not to special-case `RootExited`.
2. It is **live Major today for the CLI callers that do exist** -- Section 8's own rows, `dogfood`,
   and the CI workflow authored under 10.5, which has never executed. Any of those that terminates a
   live authority will fail on a successful termination.

#### The finding underneath it

`S8-F7`, surfaced by that caller trace and worth more than the grading question that found it:
**the Windows provider's production entry point is a stub that can never become available.**
`createWindowsProcessAuthorityProviderBundle` validates its state root, builds a real publication
ledger, and then wires `unavailableNativeAssembly()` -- a frozen object whose `prepare` returns
`authority-unavailable / prepare-unavailable` and whose declared artifact identity is the literal
placeholder `'e'.repeat(64)` / `'f'.repeat(64)`. It has no callers anywhere in `src/`.

Consequence for how this evidence file should be read: **no receipt in it describes anything the
TypeScript production factory can do.** Everything here reached the kernel through the helper CLI
and the crate library. This is the same shape as `S8-F2` and as the Linux sibling's
`createLinuxPrimaryNativeAssembly` finding -- a production entry point that differs from the
exercised one -- for the fourth time on this change family, and this instance is the starkest,
because the production entry point is not merely unexercised, it is inert by construction.

Whether that is a defect or the honest current state of an unfinished change is a planner call, not
this worker's: task 7.1's text says "without registering it as a production ProcessScope default",
and task 4.8 -- the TypeScript availability transaction that would make the provider available at
all -- is unimplemented. Recorded so the review wave grades it deliberately instead of discovering
it.

### `S8-F2` (Major) -- a TypeScript build silently disarms production artifact resolution

`resolveWindowsProcessAuthorityArtifact` (the production entry point, as opposed to its
`...ForTesting` twin) reads `WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES` from
`dist/core/session-host/process-authority/windows/build-authority.js`, which **only the packaging
script writes**. The checked-in `src/.../build-authority.ts` is a placeholder exporting an empty
array. Compiling TypeScript therefore overwrites the generated table with the placeholder, and
clearing `dist/` removes `dist/native/**` entirely.

Observed twice today, not theorised: a concurrent session in this worktree ran the TypeScript build
at 16:20 and again at 16:34. The first run deleted the packaged native artifacts mid-Section-8 and
turned a matrix row into `ERROR_PATH_NOT_FOUND`; both runs reset `build-authority.js` to the empty
placeholder. After either, production resolution can never succeed and the shipped helper is absent.

Mitigation used here: the packaged pair and a package snapshot were copied outside the repository
(`C:/Users/Sayo/AppData/Local/Temp/rasen-s8-artifacts`, `.../rasen-s8-pkg`) and every row was bound
against those. Byte-identical to `dist/`, so the identity is unchanged.

For CI and for task 10.5 this is an ordering hazard: packaging must run **after** the TypeScript
build, or the workflow ships a tree whose provider cannot resolve its own artifact.

### `S8-F3` (Minor) -- the enumerated unavailability causes do not produce `authority-unavailable`

`design.md:202` and `:204` say a denied or unsupported prerequisite returns typed
`authority-unavailable`. **No probe on this host produced that code.** Measured instead:
`reference-invalid` (reparse point, wrong owner), `native-uncertain` (uncreatable root, all six
injected checkpoints), and a raw localized OS error with `(os error 2)` for the absent adjacent
guardian -- not a typed diagnostic at all.

The mapping to typed unavailable belongs to task 4.8, the TypeScript availability transaction. **That
task is unimplemented, unticked, and `lead2-apply-wave-accounting.md` records it as assigned to
nobody** -- "tracked as an assignment gap, not an omission". So this is a hole with an owner problem
as well as a code problem: the design states a guarantee, no code produces it, and no worker is on
the hook for it. An unimplemented task with no owner is how a documented promise quietly becomes a
false one, and it stays invisible precisely because nothing fails.

8.15 therefore records real observed behaviour, and that behaviour does not match the design's
stated mapping. The row is ticked because the task is to run and record every reachable cause and
justify every unreachable one, which was done in full -- **not** because unavailability behaves as
designed. It does not.

### `S8-F4` (contract-level, needs an operator decision) -- Windows `F-L2-17`

Demonstrated above: a member reaches a pre-existing out-of-authority service, a process is created
outside the authority, and `exact-scope-empty` is reported for the authority while that process
runs. Both platforms now have a kernel receipt for this. It is the behaviour 8.16 specifies, and it
is simultaneously the limitation the `workload-non-escape` semantic needs to be honest about.

### `S8-F5` (method) -- inherited handles make end-of-file useless in Windows fixtures

`std::process::Command::spawn` creates children with `bInheritHandles = TRUE` and no explicit
handle list, so every long-lived descendant a fixture creates inherits the fixture's inheritable
stdout handle and holds the report pipe open for its whole lifetime. A parent that reads to
end-of-file therefore returns only **after every descendant has died**, and every liveness and
membership assertion downstream then asks about processes that no longer exist.

This cost a full debugging pass and it produced a row that looked plausible and measured nothing:
the fixture reported five valid identifiers and every `OpenProcess` on them failed. The fix is to
read to a needle, not to end-of-file, and to verify liveness through a retained handle. The
pre-existing suite avoids it by accident in `start_fixture_in`; `run_fixture_in` there is safe only
because its fixtures create nothing long-lived.

### `S8-F6` (behaviour, minor) -- a retained handle changes the recovery classification

Recorded above under 8.13 case 5. `probe-identity --stage post-open` against a killed guardian
returns `control-loss` while any handle to the dead process remains open, and `authority-absent`
once the last handle is released. Both fail closed. Anyone writing a recovery expectation against
"the guardian is gone" needs to know which of the two they will get.

## Contradictions found

1. **`lead2-apply-wave-accounting.md` self-contradicts on the Section 8 split**, as the dispatch
   warned. It says both `6 bind shipped-artifact identity, 15 bind source identity only` and
   `5 rows execute a helper binary / 16 rows execute no binary`. **Measured: 5 of the 21
   pre-existing integration tests execute a binary.** The 6/15 sentences are stale; the 5/16
   correction is right. With this session's new file the split is now:

   ```text
   integration tests        29   (15 kernel + 6 guardian + 8 gate)
   execute a helper binary   7   (5 guardian + 2 gate)
   execute no binary        22
   ```

2. **`design.md` Decision 3's stated mechanism still does not reproduce**, as the previous wave
   recorded. Not re-litigated here; `kernel::actual_late_port_association_still_announces_members_that_are_currently_alive`
   remains the receipt.

3. **The design's `authority-unavailable` mapping is not what the code produces** -- `S8-F3`.

## Counts, bound to the digests above

```text
native suite (all targets)   120 passed, 0 failed, 0 ignored
                             91 lib + 15 windows_authority_kernel + 6 windows_guardian_lifecycle
                             + 8 windows_section8_gate
asserting                    118
gated entry points           2, both named: fixture_entrypoint (RWPA_FIXTURE) and
                             s8_fixture_entrypoint (RWPA_S8_FIXTURE). Both early-return when unset,
                             both panic on a set-but-unrecognised role, both excluded from the
                             asserting count. Their consumers assert on fixture OUTPUT, so a fixture
                             that never runs fails its consumer loudly.
```

Artifact byte length is not a change signal on this change family (`F-L2-14`, three recorded
instances). Every identity above is a SHA-256.

## Commands

```text
node scripts/build-windows-process-authority.mjs                    # x3, distinct temp roots
node scripts/build-windows-process-authority.mjs --plan             # opening and closing digest
RWPA_HELPER_BINARY=<packaged helper> cargo test \
  --manifest-path native/windows-process-authority/Cargo.toml --locked -- --nocapture --test-threads 1
python .../s8_unavailable.py                                        # 8.15 helper probes
python .../s8_publication_run.py                                    # 8.14, six processes
node   .../s8-resolver.mjs                                          # 8.1 / 8.15 production resolver
<packaged helper> self-identity
```

Scratchpad drivers used for 8.14, 8.15 and the resolver probes live outside the repository at
`C:/Users/Sayo/AppData/Local/Temp/claude/.../scratchpad/`. They are orchestration, not product, and
are deliberately not added to the repository; every product path they touch is a production entry
point.

## What Section 8 does NOT establish

- **8.12 is not closed.** A replacement controller can authenticate, reread and inspect. It cannot
  obtain a termination receipt (`S8-F1`). The authority does terminate; the receipt is lost.
- **No Section 9 work was done.** The RED/GREEN pairs recorded here were produced because a green
  assertion with no failing counterpart closes nothing -- they are not a claim on 9.1 to 9.10.
  9.6 (every declared foreign item exercised by a real call), 9.7 (the fixture/`ForTesting` audit
  per module) and 9.8 (`dogfood`) are untouched, though `S8-F2` is direct input to 9.7 and the
  `dogfood` verb exists and was not run.
- **arm64 runtime and arm64 cross-link stay open.** 10.4 remains PARTIAL: the VS Build Tools ARM64
  component is absent. Nothing here changes that.
- **Distribution and install are not exercised.** The package tree was read from a private snapshot;
  no install, no npm artifact, no cross-machine transfer.
- **The packaging matrix is not closed.** One target, `x86_64-pc-windows-msvc`, on one host.
- **Closure and ECP-8 gates are untouched** and remain explicitly open.
- **Cross-machine reproducibility remains open.** Six build roots by two agents, one machine.
- **`cargo fmt --check` still cannot run** -- rustfmt is not installed for
  `1.88.0-x86_64-pc-windows-msvc`. Task 11.2's fmt row stays open. Verified again this session.
- **Author == verifier for everything in this file, without exception.** One worker wrote the new
  tests, wrote the mutations that falsify them, ran them, graded the findings and wrote this record.
  Nothing here has been reproduced by a second agent. That includes the four severity grades, the
  caller trace behind `S8-F1`'s verdict, and every "the RED did not reproduce" assertion -- each of
  which is exactly the kind of claim that is cheapest to get wrong when the same person holds both
  roles. A non-author reproduction is owed, and it is owed **on top of** the one already outstanding
  for the 17-mutation TypeScript matrix, not instead of it.
- **No claim here about the TypeScript production factory.** See `S8-F7`: it is wired to a
  permanent-unavailable stub with a placeholder artifact identity and has no callers in `src/`.
  Every receipt above reached the kernel through the helper CLI or the crate library.
- **The TypeScript suites were not re-run here.** They are unchanged and are not bound to these
  receipts.
- **Nothing was committed, pushed, or written under `.rasen/**`.** No file under `src/**` of either
  native crate was modified; the only repository change from this unit is the new test file and this
  evidence file.
