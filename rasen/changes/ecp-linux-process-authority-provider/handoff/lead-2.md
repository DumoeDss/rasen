# Handoff: ECP-7 platform providers — LEAD #2

Date: 2026-08-07

## Original intent

Drive the ECP-7 portfolio's `session-execution-and-self-hosting` slice under the user's
implementation-first policy: each Change runs planner -> implementer only, then the LEAD advances.
Verify/review-loop/ship/archive are batched into a unified review wave after all non-deferred
Changes are implementation-frozen. Linux and Windows are serial, not parallel.

User instructions specific to this session: dispatch and drive to completion autonomously; use Claude
Code subagents only, **never dispatch codex**; parallelise where genuinely possible.

## Position

`ecp-linux-process-authority-provider` — **implementation-frozen at 75/93**, Change is
**NON-TERMINAL**. Freeze marker in
`.rasen/changes/ecp-linux-process-authority-provider/ephemera/auto-run.json` under
`implementationFreeze`; `stages.apply.status = done`.

```text
frozen sourceSha256   087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59  (26 files)
lineage               826fa048 (never matched an artifact) -> a568f53b -> 087d87a5
test-file digests     recorded in the freeze marker, because sourceDigest() EXCLUDES tests/
```

`ecp-windows-process-authority-provider` — propose stage in flight (its change directory was empty).

Unticked 18: `9.1-9.7` (environment gate, unreachable by construction) and `11.1-11.11` (deferred to
the unified review wave; `11.9` ship and `11.10` archive are additionally blocked by their own
preconditions while Section 9 is open).

## Done this session

Ticked with bound receipts: **4.7, 5.8, 7.8, 7.9, 7.10**. Task 7.2's receipt re-emitted against the
frozen digest (`evidence/wsl-native-build-manifest-lead2.md`), superseding the stale round-5 receipt
and closing Minor `PKG-P5`.

Evidence written this wave, all LF / no trailing whitespace / CI whitespace-gate clean:
- `evidence/wsl-native-focused-suites-lead2.md` — 4.7 and 5.8
- `evidence/wsl-ts-oracles-lead2.md` — 7.8, 7.9, 7.10
- `evidence/section-9-broker-cgroup-gate-availability-lead2.md` — gate determination
- `evidence/section-9-broker-gate-run-lead2.md` — real-kernel run, Blocker proof, security property
- `evidence/wsl-native-build-manifest-lead2.md` — 7.2 re-emit
- `evidence/lead2-implementation-wave-findings.md` — **F-L2-01 .. F-L2-15**, the authoritative
  findings record for this wave

## Linux side: closed out

All Linux work is complete. Ten `lead2`/`f-l2` evidence files plus this handoff, all CI
whitespace-gate clean. Findings `F-L2-01` .. `F-L2-22`.

Closed after the freeze, without breaking it (`scripts/` is outside `sourceDigest()`):

- **`F-L2-15` RESOLVED** — the build is byte-reproducible. `--remap-path-prefix` on all three private
  roots, set inside the script via `CARGO_ENCODED_RUSTFLAGS`, with
  `rejectBuildEnvironmentOverrides()` untouched. Verified by a **non-author**: byte-identical artifacts
  across **4 distinct build roots and 2 distinct `cc` wrapper paths, by 2 independent agents**. The
  `mkdtemp` randomness is still present and simply no longer reaches the binary — the isolation was
  kept, not traded for the fix. Evidence: `f-l2-15-reproducible-build-verification.md`.
- **`F-L2-17` DEMONSTRATED on Linux, unprivileged** — a workload inside a namespace faithful to the
  real authority reached the host `systemd --user` over the session bus and had a process spawned
  outside the authority: different PID namespace, host user-manager cgroup, parented by the host
  manager. **The authority would report `exact-scope-empty` while it runs**, because `ECHILD` is
  evaluated in the guardian's namespace where the escapee was never a child. Six falsifiers checked.
  Evidence: `f-l2-17-linux-escape-demonstration.md`.
- **7.2 re-emitted** against the frozen digest with split results, and `PKG-P5` closed.

## Windows side: apply wave, 47 of 104, native crate frozen

**Crate source frozen at `b44c5e253042a4f30669b36e6fa4dba1561dfba8ecf6cd8a0ee8d6f3f85c433b`**,
independently confirmed by two implementations of the digest convention. `tests/` is outside the
input set (verified by editing test files post-freeze and re-measuring), so Sections 8 and 9 test work
cannot move it — the freeze is cheap to hold.

**The authoritative ARTIFACT was corrected before Section 8 opened, and this is the part that matters
for whoever picks it up:**

```text
AUTHORITATIVE (packaging route, reproducible, ships)
  helper    660d83ad4b2d3592abd6d786599aec443fb6c09416f97d876b919c243c69741b  258560 B
  guardian  d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f  254464 B
SUPERSEDED (plain `cargo build --release` — not reproducible, does not ship)
  helper    aeb1af91…  guardian d230f8b0…
TEST PROFILE (what existing kernel receipts executed)
  helper    4c15b7f7…  699904 B
```

The superseded pair never went through the packaging path — `target/` has no
`x86_64-pc-windows-msvc/`, so the build ran without `--target`, without `/Brepro`, outside isolation.
They are **a different program**, not a metadata variant: 22384 bytes across 3066 runs, at identical
length (PE padding — `F-L2-14` a third time). They are not stale: both carry compiled-in
`RASEN_WPA_SOURCE_SHA256 = b44c5e25…`.

**Why it was urgent.** The helper measures its own hash at prepare, so every Section 8 receipt would
have reported a value **nobody can re-derive from source**, while the shipping binary was a different
program — `F-L2-15`'s consequence reappearing on Windows in the artifact, an hour after Linux closed
it. **No tick was affected** (kernel receipts bind the test-profile artifact), so the correction was
free; after Section 8 it would have cost the entire kernel matrix.

Also found by that re-take and fixed: the packaging script **did not set** `RASEN_WPA_SOURCE_SHA256`,
which the crate reads at compile time — a packaged helper would have compiled with no source digest,
omitted the key, and failed closed at prepare. **The shipped artifact would have been non-functional,
surfacing only when someone ran it.**

Native totals: **112 tests, 111 asserting, 1 gated** (`fixture_entrypoint`, gated on `RWPA_FIXTURE`,
which re-executes the test binary *as a workload inside the Job*). Its consumers fail loudly rather
than skip — demonstrated live in this wave, not argued.

**A second Blocker was found by running production code against a real kernel rather than by any
test**: the guardian could destroy its own authority by logging — `eprintln!` panics on a failed
write, its stderr is a pipe to the short-lived helper, so the first diagnostic after that helper exits
aborted the guardian, closing the Job's only handle under `KILL_ON_JOB_CLOSE` and killing a live
scope. The Linux sibling's `place_guardian` defect was the first. Two Blockers, both invisible to
mature suites, both found the same way.

**A design claim was refuted and the requirement re-established on sounder ground**: Decision 3's
"late port association silently loses that member's `NEW_PROCESS` message" does **not** reproduce —
association announces live members. The requirement survives because a member that exits *before*
association is lost permanently and its zero-transition has already happened. Routed to the planner.

Details, caveats and the full not-claimed list:
`rasen/changes/ecp-windows-process-authority-provider/evidence/lead2-apply-wave-accounting.md`.

## Windows side: earlier TypeScript wave (superseded by the numbers above)

Propose accepted (`rasen validate --strict` clean, 4/4 artifacts, 104 tasks in 11 sections).
Accounting and caveats: `rasen/changes/ecp-windows-process-authority-provider/evidence/lead2-apply-wave-accounting.md`.

Ticked: Section 2 (8/8), Section 7 (12/12), Section 10 (6/7). `10.4` stays PARTIAL — arm64
cross-**link** is open because the VS Build Tools ARM64 component is absent, in addition to the
pre-existing arm64 runtime gate.

**What those 26 do not establish:** no actual-kernel Windows behaviour at all — every Windows suite
drives an injected transport, the authored CI workflow has never executed, and **author == verifier
throughout** (17 mutations, none reproduced by anyone else). Sections 8 and 9 are untouched.

**Hard precondition, adopted from the TypeScript implementer:** *Section 8 does not open until the
Windows crate is digest-frozen.* The crate moved four times during their wave and their
source-stability guard fired twice; opening the actual-kernel gate against a moving crate would bind
every receipt to a digest that no longer exists. Linux paid for that lesson with two re-bind cycles.

**Open cross-track question:** who owns the post-open reread. It is currently a TypeScript invariant
proven by mutation `M5`. If it relocates to the native crate, **task 9.5's RED must relocate with it**
or the gate is left silently open.

**Design defects routed to the planner:** Decision 10's Win32 durability recipe is unreachable from
Node (needs native FFI; a `WINDOWS_PUBLICATION_DURABILITY_BARRIER` export makes the shortfall land in
receipts); Decision 9's third recovery row is **vacuous as written** — "attestation *present*" is
always true because the codec requires it, and should read "corroborated by the trusted state root";
and Node cannot read Windows owner SIDs or DACLs at all, so every such check is native-side only.

## In flight at handoff time

1. **`win-native`** — the Windows Rust crate, Sections 3-6. Actively writing (a 58 KB `guardian.rs`
   and two crate test files as of 03:20). Has not yet reported.
2. **`win-ts`**, **`track-a-native`**, **`track-b-ts-oracle`**, **`track-c-broker-gate`**,
   **`windows-planner`**, **`cleanroom-verifier`** — all complete and standing by. Build roots
   retained.

## Key decisions (and why)

- **Fixed the `place_guardian` Blocker *before* freezing** rather than deferring it. Freezing a broker
  whose prepare path cannot succeed on any real kernel would bake the defect into the frozen digest
  and into every receipt bound to it. Cost was one re-bind cycle; worth it.
- **Refused to install a privileged broker on the operator's daily machine.** The gate provably cannot
  complete there, so a partial receipt would have been bought with a real machine mutation.
- **Refused to thread `_until` seams through the control path** to fix `inspect`/`open-runtime`/
  `terminate` deadline discarding. That would be a second deadline implementation, which the
  invariants forbid, and deadline semantics must be resolved as one piece when `BRK-R2-B06` is
  addressed. Recorded as known-defective, **not** signed off.
- **Split the 7.2 verification** rather than accept an author==verifier receipt or a contaminated
  verifier. Track A disclosed unprompted that Track B had already told them the helper hash and size,
  so step 1 went to a fresh agent and steps 2-4 stayed with Track A.
- **Freeze marker records test-file digests alongside `sourceSha256`**, because `sourceDigest()`
  excludes `tests/` and the test-file churn was the actual binding blocker.
- **Task titles must not overclaim.** Retitled the Section 9 task after a worker pointed out that
  `completed` against "实跑 9.1-9.7" would read downstream as "the gate ran". It did not.

## Dead ends & gotchas

- **The WSL Rust install has no host C linker** (`cc`/`gcc`/`clang`/`musl-gcc` absent, no `crt1.o`).
  Builds die at `linker cc not found`. Cleared unprivileged with a private `cc` wrapper outside the
  repo delegating to `/home/sayo/.local/share/zig-x86_64-linux-0.16.0/zig`. Do not install packages.
- **Node's `node_modules` is Windows-only** (`@esbuild+win32-x64`, `@rollup+rollup-win32-x64-msvc`).
  vitest under WSL dies with `Cannot find module @rollup/rollup-linux-x64-gnu`. An isolated ext4
  install exists at `/home/sayo/.local/share/rasen-build/ts-oracles-nm`. Never touch the shared
  Windows `node_modules`.
- **The WSL oracle test is gated** by `process.platform === 'linux' && RASEN_ACTUAL_WSL_ORACLE === '1'`.
  Running `npx vitest` from Windows silently skips everything and proves nothing. A prior handoff
  listed the Windows command.
- **`sourceDigest()` has a trailing `hash.update('\0')` after each file's contents**
  (`scripts/build-linux-process-authority.mjs:115`). Omitting it produces a plausible-looking wrong
  digest. This cost the LEAD a false mismatch against two workers who were both right.
- **`cargo fmt` must run from the crate directory or with `--manifest-path`** — there is no workspace
  `Cargo.toml` at the repo root. The handoff-reported fmt failure was an artefact of this.
- **`TMPDIR` length matters**: `linux_broker_service_contract` composes unbounded Unix socket paths, so
  a long `TMPDIR` exceeds `SUN_LEN` (108) and surfaces as a *sibling test's timeout*.
- Three stale claims from the LEAD #1 handoff did **not** reproduce: the `pinnedall`/`pinnedement`
  test failure, the `cargo fmt` failure, and the implied Windows-side oracle command.

## Eliminated hypotheses

- *"Section 9 just needs isolation relaxed"* — no. The broker hard-requires the `pids` cgroup-v2
  controller (`broker_cgroup.rs:16-20`), this host binds `pids` to cgroup-v1, and
  `required_controllers: []` is rejected as malformed, so it **cannot be waived by configuration**.
  Unreachable by construction, not by policy.
- *"`wsl -u root` unblocks Section 9"* — it unblocks root authority and every cgroup interface
  operation, but not the controller requirement or the hardcoded install layout on a read-only tmpfs.
- *"The design doc settles what the broker needs"* — it does not. `design.md:134-136` names only core
  interface files; the code additionally demands `pids`. Read the consuming code, not the prose.
- *"Artifact length identifies a binary"* — no. Two builds of identical source differ in bytes at
  identical length (`F-L2-15`), and two different sources produced identical length (`F-L2-14`).

## The one pattern that matters most

Three findings share a shape and it is the systemic issue on this change: **production code exercised
only through a stand-in.** `FsCgroupKernel` (~580 lines, what the shipped daemon uses) has zero test
references; `createLinuxPrimaryNativeAssembly` (the production TS factory) has zero test references
while only its `...ForTesting` twin is exercised; and `linux_broker_cgroup_contract` reports
`9 passed` identically **before and after** the Blocker fix because all nine drive `FixtureKernel`.

A Blocker that made the broker unable to prepare a lease on any real kernel survived every prior
review round for exactly this reason. It was found by running production code against the real
kernel, not by any test.

The review wave should treat *"which production entry points are exercised only through a fixture or a
testing-only variant?"* as a first-class audit question, and should not stop at these three.

Related: `F-L2-13` — four separate guard tests in this single wave turned out not to test what they
named, and three were caught only because someone chose to mutate rather than accept green. **On this
codebase an unmutated guard test should be assumed non-discriminating.**

## LEAD errors, recorded deliberately

Two wrong Section 9 environment verdicts, in opposite directions: first "unavailable" from probing
only `sudo` without enumerating privilege entry points; then "available" from validating against
design prose instead of the code's fail-closed probe. The second nearly authorised installing a
privileged root broker and a systemd unit on the operator's daily machine for a gate that provably
cannot complete. Also a `sourceDigest()` replication error that falsely contradicted two correct
workers, and one task title that overclaimed until a worker challenged it.

Weight LEAD-authored environment and accounting claims on this change accordingly.

## Next action

1. Collect `win-native`'s report on Sections 3-6.
2. **FIRST, before Section 8: fix the Windows crate's line endings and re-freeze.** The frozen digest
   `b44c5e25…` **reproduces on no fresh checkout anywhere, including this machine** — it is an
   artifact of which files happened to be written by which tool in this working tree. Measured:
   current mixed tree `b44c5e25…`, all-LF `2b3fabd9…`, all-CRLF `dbc9e58e…`, with
   `core.autocrlf = true` local and global. Cause identified and owned: Python's `open(path, 'w')` on
   Windows translates `\n` to `\r\n`, and the five Python-patched files are exactly the CRLF ones.
   **Normalising alone is not sufficient** — it would hold in this working tree only, break at the
   next clone, and do so while carrying a marker asserting reproducibility. Order, for one re-bind
   instead of two:
   1. add a `.gitattributes` rule pinning the crate's digest inputs to LF (precedent exists at
      `.gitattributes:10`);
   2. normalise the five files, including `tests/windows_guardian_lifecycle.rs` (574 CRLF — outside
      the digest but **inside** any freeze marker's test-digest map, and the provenance file for the
      5 shipped-artifact rows);
   3. re-freeze at `2b3fabd9…` and re-take the receipts bound to `b44c5e25…`;
   4. only then write the marker.
   Section 8 adds 21 rows of receipts; doing this after would mean re-taking all of them.
3. The Section 8 harness seam is **already closed by measurement** — `RWPA_HELPER_BINARY` landed,
   `tests/`-only, and the 5 binary-executing rows print the SHA-256 of whatever helper they actually
   executed, so a misconfigured run cannot over-claim. The fallback is loud, not silent. Note the
   split is **5 shipped-artifact rows / 16 source-identity-only**, corrected from 6/15.
4. Settle the post-open reread ownership explicitly, and move task 9.5's RED with it if it relocates.
   The crate performs the reread independently inside `ControlEndpointClient::connect` but has
   produced **no RED for it**; TypeScript owns 9.5's RED today.
5. Run Sections 8 and 9. Section 8 carries an inline header that **no task in it may be closed on
   environment-unavailability grounds** — this is a Windows host, so the Linux sibling's "environment
   absent" exit does not exist. Section 9's opening line is that every task produces a RED/GREEN pair
   and a green assertion with no demonstrated failing counterpart does not close its gate.
5. After Windows is implementation-frozen, start the unified review wave: the pre-existing 11 findings
   plus `F-L2-01 .. F-L2-22`, then `11.1-11.11`. Owed non-author reviews to schedule there: the three
   Linux TypeScript oracles, and the Windows 17-mutation matrix.
6. Two operator decisions are outstanding and neither blocks the work above:
   - **`F-L2-17`'s contract semantics.** Both platforms now have a kernel receipt. Either tighten
     `workload-non-escape` — which lands on both providers and possibly the archived common contract —
     or accept the limitation and require it be recorded as demonstrated evidence rather than
     described as absolute containment. Consequence-wise it is Blocker-shaped: `exact-scope-empty` can
     be reported while a proxied workload process is alive.
   - **Broker to 0.3.0.** The operator has decided it; the Direction replan input is written and
     waiting at `evidence/direction-replan-input-broker-to-0-3-0.md`. Note the carve-out it names:
     `BRK-R2-B06` must not move whole, because its primary-path analogue must stay in 0.2.0.
5. **One blocker remains above this work, not two**: provisioning a unified-cgroup-v2 self-hosted
   runner, if Section 9 is ever to close. The macOS blocker is gone — see below.

## Direction update 2026-08-07 (Architecture Replan 4) — supersedes what this handoff first said

The macOS gate is **removed from 0.2.0**. Execution backends are now graded into `in-tool` and
`hosted`; macOS durable process authority moves out of this Slice entirely and is registered as a
0.3.0 research item. macOS in 0.2.0 is declared `in-tool` support plus a declared, typed `hosted`
unavailability, both requiring real macOS run evidence. Endpoint Security, VM, silent-unsupported,
minimum macOS version and Apple entitlement/signing remain **unapproved** — moved to research, not
granted.

**The only cut edge is `ecp-macos-process-authority-provider -> ecp-native-process-capsule-closure`.**
Closure's acceptance narrows to closing the hosted backend on the two OSes that have kernel-enforced
authority. Everything downstream — closure, host, executor, policy/control parity, self-hosting — is
unblocked. Run-state was updated at 02:17:26 and independently checked: the macOS child is `skipped`
with `statusRaw: moved-out-to-0.3.0`, closure's `dependsOn` is `[linux, windows]`, `deferred` is
empty with a new `movedOutOfScope` entry, and the DAG prose is updated.

**This Replan relaxes no gate.** Linux's implementation-first policy, its 11 pre-existing open
findings, the task ledger, and the Section 9 cgroup-v2 environment gate are all explicitly unchanged.
The 75/93 freeze and the NON-TERMINAL verdict stand. Windows still starts serially after Linux is
implementation-frozen.

### Correction to this handoff's original text

An earlier version of item 5 stated that keeping a labelled non-authoritative legacy path would
conflict with the plan's "delete/hard-disable PGID claim/fallback" instruction and therefore need a
plan amendment. **That was wrong**, and it conflated two axes the Direction has now separated and
which were verified in code:

| Axis | Values | Defined in | Consumers |
| --- | --- | --- | --- |
| Dispatch topology | `native` / `exec-bridge` / `legacy-fallback` | `src/core/pipeline-registry/run-state.ts` | the LEAD in `_orchestration.ts` |
| Process authority | `ProcessScope` + `ProcessAuthorityProvider` | `src/core/session-host/` | **only** `src/core/management-api/router.ts` |

`createSessionHost` and `createNativeProcessScope` are constructed nowhere in `src/` except
`src/core/management-api/router.ts`, and `_orchestration.ts` contains **zero** references to
`ProcessScope` or `session-host`. Host-native Tier A dispatch — where the host's own tooling starts
workers and rasen owns no process — never enters ProcessScope. So deleting PGID authority does not
touch the in-tool execution path, and closure's PGID-deletion obligation stands unrevised.

Note also the same-name trap: run-state's `legacy-fallback` is a **dispatch routing** compatibility
value for an unknown host; ProcessCapsule's "PGID fallback" is the **process authority** retreat that
review disproved. The prohibition on silent degradation targets the second only.
