# Windows provider apply wave — LEAD #2 accounting

Date: 2026-08-07
Status: apply wave in progress. This file records what has been ticked, on what evidence, and what
each receipt does **not** establish. It is not a completion claim.

## Ticked: 47 of 104

| Section | Ticked | Source |
| --- | --- | --- |
| 2. Provider Contract and RED Tests | 8 of 8 | TypeScript implementer |
| 3. Windows Native Artifact and Closed Protocol | 4 of 8 | native implementer |
| 4. Job Authority Prepare and Availability | 7 of 9 | native implementer |
| 5. Suspended Assign-Before-Run Activation | 4 of 7 | native implementer |
| 6. Guardian Lifecycle, Membership Events, Exact Empty | 6 of 8 | native implementer |
| 7. Recovery, Inspect, Abort, Terminate, Durable Publication | 12 of 12 | TypeScript + native (7.8 jointly) |
| 10. Build, Package, Cross-Architecture Evidence | 6 of 7 | TypeScript implementer |
| 8. Actual-Windows Kernel Gate | 0 of 17 | not started — see precondition below |
| 9. Oracle Discrimination and Anti-Vacuity Gate | 0 of 10 | not started |
| 1, 11 | 0 of 18 | not started |

**Deliberately not ticked**, on the implementers' own reporting: 3.5, 3.7, 4.9, 5.4, 6.7, 6.8
(PARTIAL); 3.6, 3.8 (NOT DONE); 10.4 (PARTIAL); **5.5 and 5.7** — the native half is done but both task
texts span TypeScript as well, and 5.7 says "native **and TypeScript** tests" explicitly. **4.8 is
TypeScript and is currently assigned to nobody** — tracked as an assignment gap, not an omission.

**7.8 was ticked, unticked, and re-ticked.** It was first ticked on the TypeScript receipt; the TS
implementer then flagged that the bounded re-terminate loop had moved to the guardian, so their
evidence no longer covered it and I unticked rather than bank a relayed claim; the native
implementer's first-hand receipt restored it. It is now jointly satisfied, with the loop's receipt on
the native side.

## OPEN — the frozen crate digest reproduces NOWHERE, and normalising alone will not fix it

Found by the LEAD at the final integrity check; diagnosed further by the native implementer, whose
analysis is more severe than the original reading and supersedes it.

### The measurements

```text
files in digest input                  22
current working tree (mixed CRLF/LF)   b44c5e253042a4f30669b36e6fa4dba1561dfba8ecf6cd8a0ee8d6f3f85c433b   <- the frozen value
all-LF   (fresh Linux checkout)        2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377
all-CRLF (fresh Windows checkout)      dbc9e58efb6d005fa7fb494472654aada600d8b94a3273337fa5863397004a1d
```

`core.autocrlf = true`, local and global, verified. A fresh checkout therefore converts LF blobs to
CRLF in the working tree for **every** text file — not only the five that are CRLF today.

**So `b44c5e25…` is not reproducible on a fresh checkout anywhere, including this machine.** It is an
artifact of which files happened to be written by which tool in this particular working tree. Commit
and re-clone here and you get `dbc9e58e…`; on Linux, `2b3fabd9…`. An earlier version of this entry
said it reproduced "only on a Windows checkout" — that was wrong and understated the problem.

### Cause: authoring accident, identified and owned

Not `.gitattributes` (no `*.rs` rule exists; `git check-attr` reports `text: unspecified`), not an
editor default, not a generator. **Python's `open(path, 'w')` on Windows uses universal-newlines mode
and translates every `\n` to `\r\n` on write.** Inline Python patch scripts were used for edits too
structural for the Edit tool, and the correlation is exact:

```text
CRLF  src/attestation.rs  src/cli.rs  src/guardian.rs  src/lib.rs      <- Python-patched
CRLF  tests/windows_guardian_lifecycle.rs                              <- Python-patched
LF    the other 17 digest-input files, and tests/windows_authority_kernel.rs
```

### A fifth file — outside the digest, but inside the marker

`tests/windows_guardian_lifecycle.rs` carries **574 CRLF**. It is not in the digest input set, so it
does not affect `b44c5e25…` — **but it is exactly the file a freeze marker would record**, following
the Linux convention of pinning test-file digests. It is also the file providing provenance for the 5
shipped-artifact rows. Writing a Windows marker now would bake the same defect into the test-digest
map.

### Normalising is necessary but NOT sufficient

Normalising the five files and re-freezing at `2b3fabd9…` holds **in this working tree only**. Once
the crate is committed and checked out on Windows, `autocrlf=true` converts everything to CRLF and the
digest becomes `dbc9e58e…` again. The re-freeze would break silently at the next clone — and would do
so while carrying a freeze marker asserting reproducibility, which is worse than the current state.

The durable fix is a `.gitattributes` rule pinning the crate's digest inputs to LF, so the working
tree is LF on every platform and the digest is `2b3fabd9…` everywhere. **The repository already uses
this mechanism** — `.gitattributes:10`, `test/fixtures/management-api/session-fake-cli.mjs text
eol=lf` — so there is precedent and a shape to copy.

### Scheduled order — one re-bind instead of two

1. add the `.gitattributes` rule for the crate's digest inputs;
2. normalise the five files to LF;
3. re-freeze at `2b3fabd9…` and re-take the receipts currently bound to `b44c5e25…`;
4. only then write the freeze marker.

**This must happen before Section 8 opens.** Section 8 adds 21 rows of receipts, and every one taken
against `b44c5e25…` would need re-taking. Nothing has been normalised and nothing re-frozen — all
measurements above were read-only, in-memory transforms.

## Native crate: source frozen; authoritative artifact CORRECTED

**Source digest is frozen and independently confirmed by two implementations of the digest
convention** — the crate's own and the packaging script's:

```text
crate sourceDigest   b44c5e253042a4f30669b36e6fa4dba1561dfba8ecf6cd8a0ee8d6f3f85c433b
host                 Windows 10.0.26200.8875 x64, native, no WSL
toolchain            rustc 1.88.0 / cargo 1.88.0, target x86_64-pc-windows-msvc
```

**The artifacts first reported as frozen were the wrong ones, and Section 8 must not bind them.**

```text
AUTHORITATIVE (packaging route, reproducible, ships)
  helper      258560 bytes  660d83ad4b2d3592abd6d786599aec443fb6c09416f97d876b919c243c69741b
  guardian    254464 bytes  d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f

SUPERSEDED (plain `cargo build --release`, not reproducible, does not ship)
  helper      258560 bytes  aeb1af915a8c2bc9ce549bb81a8a4a419bfc66a2913b900f3eb7072217c13673
  guardian    254464 bytes  d230f8b0fb1785446e34c5eb8a569ad128e189cf277a266812deed4ab6ea48d0

TEST PROFILE (what the existing kernel receipts actually executed)
  helper      699904 bytes  4c15b7f7f2521e44043338c9fab13e9b7d6c6008e268933b0107250d4aaf93b6
```

Evidence, measured on this host and verified independently by the LEAD:

- The superseded binaries did **not** go through the packaging path. `native/windows-process-authority/target/`
  contains `debug`, `release` and `aarch64-pc-windows-msvc` but **no `x86_64-pc-windows-msvc/`** — so
  the build ran without `--target`, without `/Brepro`, and outside the isolated environment.
- They are **a different program**, not a metadata variant: 22384 bytes differ across 3066 runs.
  Identical length is PE section padding absorbing the difference — `F-L2-14` for the third time.
- They are **not stale**: the compiled-in `RASEN_WPA_SOURCE_SHA256` extracted from both reads
  `b44c5e25…`. Same source, different build command.
- The packaging route **is** reproducible at the frozen source: two separate build roots produced
  byte-identical helper and guardian. Isolated as its own measurement, removing `/Brepro` makes them
  differ by exactly 20 bytes (COFF `TimeDateStamp`, its three debug-directory copies, the CodeView
  GUID) at identical length.

**Why this was urgent rather than cosmetic.** The helper measures its own hash at prepare, so every
Section 8 receipt would have faithfully reported `aeb1af91…` — a value **nobody can re-derive from
source**, because the command that produced it is neither the packaging command nor reproducible. The
receipts would have been internally consistent and externally unverifiable, while the binary that
actually ships — the one the manifests, the build-authority table and the package tree describe —
would be `660d83ad…`, *a different program from the one all the kernel evidence described*. That is
`F-L2-15`'s consequence reappearing on Windows, in the artifact, after the Linux side had just closed
it.

**No tick is affected.** The existing kernel receipts bind the **test-profile** artifact
(`4c15b7f7…`), not the superseded release build, so nothing already ticked rests on `aeb1af91…`.
Correcting the authoritative artifact now costs nothing; correcting it after Section 8 would have cost
the entire kernel matrix.

**Ruling: the packaging script is the authoritative build route.** Section 8 rows bind
`660d83ad…` / `d571f148…`. This resolves the second precondition below in favour of its stated
preference.

## Section 8 seam: CLOSED by measurement, before the matrix rather than during it

```text
shipped helper on disk        660d83ad4b2d3592abd6d786599aec443fb6c09416f97d876b919c243c69741b
self-measured artifactSha256  660d83ad4b2d3592abd6d786599aec443fb6c09416f97d876b919c243c69741b   EQUAL
compiled-in sourceSha256      b44c5e253042a4f30669b36e6fa4dba1561dfba8ecf6cd8a0ee8d6f3f85c433b
guardian                      d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f
```

The packaging route reproduced the authoritative hashes from the frozen source on a **third
independent build root**. **Shipped = executed = attested** is now measured on the native side; with
the TypeScript manifest chaining already proven, the full loop is closed.

**A caveat closed, and its replacement stated precisely.** The build-reproducibility receipt was
originally author==verifier; the native implementer independently ran the packaging script from the
frozen source and reproduced `660d83ad…` / `d571f148…` byte-for-byte, so that caveat is gone.

**But this is same-machine reproducibility.** Both workers ran on the same Windows host: a *different
invoker*, not a *different machine*. It is genuine non-author verification and it is **weaker than the
Linux receipt**, which spanned two agents *and* varied build roots *and* varied host-linker wrapper
paths. **Cross-machine reproducibility for Windows remains open** and is a legitimate ask for the
review wave. Raised by the worker whose own result it qualifies.

**Q1 was proven by execution, not by reasoning**: the packaged helper's `self-identity` resolved the
guardian to `dist\native\win32-x64\rasen-windows-process-authority-guardian.exe` — the packaged one,
by adjacency, automatically — and the subsequent `prepare` spawned it successfully. **Zero seam
cost.** The freeze held throughout: crate digest still `b44c5e25…`, `src/**` untouched, the run
produced only `dist/`.

**Q2: no row needs the test profile**, enumerated per class rather than surveyed:

```text
unwinding panic (should_panic / catch_unwind / panic::)   grep over tests/  -> none
symbol names (backtrace / symbol / RUST_BACKTRACE)        grep over tests/  -> none
#[cfg(test)] in src/                                      16, ALL of them `mod tests {`
```

And a structural argument stronger than the survey: **integration tests cannot see `#[cfg(test)]`
items at all** — the attribute applies only when compiling the crate's own unit-test harness, and all
21 Section 8 rows live in `tests/`. A `cfg(test)` dependency there is *unexpressible*, not merely
absent. The one deliberate `panic!` is the fixture's unknown-role guard and nothing depends on it
unwinding rather than aborting.

**Q3: nothing to export, and the export was declined.** The fixture re-executes `current_exe()`,
which inside the harness is the test binary; it never references the helper or guardian. The two
oracles using it are in the 15-row in-process category regardless, so shipping the test binary would
enlarge the package for zero evidentiary gain. Stated as a declined decision rather than a silent
non-event, per the ruling.

### The env override must not default to the test binary

The proposed override defaulted to `CARGO_BIN_EXE_*` when unset. **That default was rejected**, and the
reasoning is the reasoning for this entire correction: an unset variable silently falling back to the
test-profile binary is the *wrong-artifact-passes-quietly* shape — exactly what produced the
superseded-artifact problem in the first place.

**Adopted design instead:** name it `RWPA_HELPER_BINARY`, and have those 5 rows **record the SHA-256
of whatever helper they actually executed** into the receipt. A misconfigured run then cannot claim
the shipped artifact, because the hash it prints will not be `660d83ad…`. This converts a silent
fallback into a **self-describing receipt** and needs no gate — which matters, because a gate here
would have been the skip-when-unmet shape ruled against repeatedly this wave.

Remaining work to open Section 8: that override plus the hash recording. `tests/`-only,
digest-neutral, roughly ten minutes, plus a build-before-matrix ordering rule. Nothing on the
TypeScript side, nothing in the build script, no package-shape change.

### Two previously-unguarded cross-component invariants, now guarded

Both surfaced by the seam answers rather than by an assignment.

**`M19` — the guardian filename.** Resolution keys on the guardian's name; packaging preserves it and
the crate declares it, in **two files with different owners, agreeing by nothing but coincidence**. A
test now reads `GUARDIAN_EXECUTABLE` out of `src/cli.rs` and asserts the packaging name matches, so a
rename breaks the **build** rather than the runtime. The existing failure direction was already the
safe one — a rename yields "not a regular file" rather than silently loading something else — but
breaking at build time beats breaking correctly at runtime.

**`M20` — the provider can never reach a mutation switch.** This one upgrades a record entry: the
mitigation listed above as *"the TypeScript layer never sets them"* was **an assertion with nothing
enforcing it**. It is now enforced by a guard that fails if `provider.ts` so much as references
`--mutate` or `duplicate-job-into-root`. Task 11.5 should still ask about the shipping switch — but it
can now be answered with a guard rather than a promise.

Windows suites now **169 asserting** (was 166), mutation matrix **20, all RED**.

## Section 8 binding: 5 rows bind the shipped artifact, 16 bind source identity only

### Correction to the labelling axis — the LEAD's rule would have mislabelled 16 rows

The ruling said to label rows by *"does it depend on the test profile"*. On that axis all 21 rows come
out as shipped-artifact rows, and **15 of them would be wrong** — they run under the test profile for
an unrelated reason: they are in-process library tests with **no binary to execute**.

The axis that actually discriminates is **does this row execute a binary at all**:

```text
 5 rows   execute a helper binary   -> bind shipped-artifact identity
16 rows   execute no binary         -> bind sourceSha256 only
```

Same conclusion as already recorded, reached by a criterion that will not mislabel. Label on this
axis.

Established in code before the matrix opened, not assumed:

```text
tests/windows_guardian_lifecycle.rs    6 tests   spawn a real helper BINARY (CARGO_BIN_EXE_…)
tests/windows_authority_kernel.rs     15 tests   drive the LIBRARY in-process; no helper binary involved
```

The 16 in-process rows hold a `JobAuthority` and call `activation::*` directly, because the
load-bearing question cannot be asked from outside the process that owns the handle: *"is this pid a
member of **my** Job"* requires that handle, and asking from inside answers a different question —
`IsProcessInJob(h, NULL)` reports membership of *any* Job, and the test runner itself sits in an
ambient one. That was hit during the wave and the check was moved to the parent.

So the **shipped = executed = attested = manifested** chain closes for **5 rows**. For the other 16
there is no shipped artifact to execute; their binding is `sourceSha256`, which is identical to the
shipped artifact's and is the binding that carries the meaning. That is what in-process kernel testing
*is*, not a defect.

**But a Section 8 summary reading "all rows bind the shipped artifact" would be an over-claim.** The
matrix must state which rows are which: **6 bind shipped-artifact identity, 15 bind source identity
only.** Raised by the implementer before the rows were taken, precisely so it would be set as an
expectation rather than found in review.

A helper-path env override will let the 6 execute the packaged binary. `tests/` is outside the
source-digest input set, so the crate digest does not move and `src/**` is untouched — the freeze is
unaffected either way.

Two harness questions are answered and cost nothing: `guardian_path()` resolves **adjacent to
`current_exe()`** and nothing else, so the packaged helper picks up the packaged guardian for free;
and `RWPA_FIXTURE` re-executes the **test binary**, never the helper, so packaging carries nothing
extra for it.

## Disclosed security trade-off: mutation switches are runtime flags in a shipping binary

Disclosed by the implementer unprompted, ahead of task 11.5's independent security review, rather than
left to be discovered there.

The mutation switches are **runtime flags in the prepare frame, not `cfg(test)`**. That is deliberate
and load-bearing: it is what lets the 9.1 / 9.2 / 9.3 REDs run against the **shipped artifact**
instead of a test-only twin — precisely the `F-L2-11` failure shape this change family has been
fighting all wave.

**The cost is real: the shipped helper accepts `--mutate duplicate-job-into-root`, a live switch that
deliberately breaks the sole-handle invariant** — the invariant whose failure fabricates
`exact-scope-empty` for a live workload.

Mitigations, stated as such rather than as a dismissal: the legacy capsule already carries exactly
this switch (`native/process-capsule/src/main.rs:651`); Decision 4 explicitly calls for the mutation;
the TypeScript layer never sets them — **now enforced by guard `M20`, not merely asserted**; and an
unrecognised `--mutate` name enables nothing, with a test proving it.

### Reachability: traced, and the bound is tighter than first recorded

An earlier version of this entry said only that *the helper's argv comes from the controller that
launches it, not from the workload it contains*. True, but it understates the guarantee. Traced
through the code and **verified independently by the LEAD**, because a correction that makes a
security posture look *better* deserves more scrutiny than one that makes it look worse:

```text
enters      cli.rs:313        mutation_bits: mutations_from(options).encode()   <- helper's own argv, ONE production site
carried in  guardian.rs:263   PrepareRequest.mutation_bits — the struct documented as
                              "carried to the guardian over its inherited stdin"
consumed    guardian.rs:458   GuardianMutations::decode(request.mutation_bits)
                              — the FIRST line of construct(), ONE production site
control     Attest / OpenRuntime / Activate / Inspect / Abort / Terminate / Input / CloseInput
            -> no frame parses or carries mutation bits
```

(The other `mutations_from` / `GuardianMutations` hits in the grep are `#[cfg(test)]` unit tests.)

**So mutations are an authority-creation-time parameter, consumed exactly once inside `construct()`,
before the control endpoint exists at all.** They are not settable on a *live* authority by anyone —
including the controller that created it.

Why that matters to 11.5 rather than being a nicety: "the owner can weaken it" invites the questions
*when* — mid-flight? after publication? against an authority someone else prepared? The answer to all
three is no. An attacker who compromises a controller **after** prepare cannot reach the switch; they
would have to prepare their own authority, at which point they own it anyway and the switch buys them
nothing.

**It is still not harmless, and both halves belong in the record**: a shipping binary contains a code
path that deliberately breaks the sole-handle invariant, and whoever controls helper *invocation* can
use it. 11.5 should evaluate the traced boundary rather than a conservative paraphrase of it.

**LEAD ruling: keep the runtime switches for now, and route the decision to 11.5.** Gating them behind
a build feature would put every one of those REDs back onto a non-shipped variant, which is the exact
defect that made a Blocker invisible on the Linux sibling for an entire review history. The
independent security review is the right forum to weigh a live weakening switch against test-only
twins, and it now has the trade stated in full rather than a surprise. Changing it is a `src/**`
change and must not be made without an explicit decision.

## The `F-L2-09` audit question applied self-critically, and it found something

Prompted by the finding rather than by an assignment: **every artifact-resolver test had fed a
hand-built PE stub, so the production parser had never seen a real rustc/MSVC binary.** Same shape as
"every broker test drives `FixtureKernel`" — a parser exercised only by the fixture it was written
against.

With a real packaged artifact now existing, the **production** resolver was driven at it directly:

```text
helper    inspect -> package-integrity, machine 0x8664, 258560 B
                     sha256 660d83ad…  sourceSha256 b44c5e25…
          resolve -> actual-windows-runtime, device/inode present
guardian  inspect -> package-integrity, machine 0x8664
```

Both accepted. The detail that makes this a real check rather than a formality: **the fixture places
the PE header at `0x80`; the real binaries place it at `0xe8`.** The parser handled a genuinely
different layout — exactly where a baked-in fixture assumption would have surfaced. It did not.

Two limits stated by its author, both of which stand:

- **This is a one-off manual verification, not a regression test.** The packaged tree lives in a temp
  directory outside the repo, so a permanent test would require either checking in a binary or adding
  an environment gate — and a gate here would be the exact skip-when-unmet shape ruled against
  repeatedly this wave. Reported as verified-once rather than converted into a test that silently
  passes when the artifact is absent. That is the right trade.
- **Author == verifier.** The resolver's author ran the check.

What it does establish: the **TypeScript half of the manifest-chaining seam works end to end** —
manifest read, bytes verified against it, identity resolved, `sourceSha256` matching the freeze. The
unproven half is native-side: that the helper's **self-measured** `artifactSha256` equals `660d83ad…`
when the packaged binary actually executes. The seam's remaining risk is therefore narrower than it
was, and is precisely what the harness override addresses.

## Reproducibility: the first test was weak, and its author said so

The initial two-build check varied only the **output** root. But the packaging script compiles from a
snapshot directory named **deterministically from the source digest**, under the temp root — so the
output root never touches compilation. In the author's own words, *"that test proved almost nothing."*

The real test relocates the **temp** root, which moves the snapshot directory, the cargo home and the
target directory together. Build C did that and produced byte-identical helper and guardian. Final
standing: **three build roots, two temp roots, identical artifacts** — the build path does not reach
the binary.

This is the same family as `F-L2-13` in a distinct shape: not a vacuous assertion, but a test that
**varied the wrong variable**. It would have passed identically against a completely unfixed build.
Recorded because "we built twice and it matched" is exactly the sentence that hides it.

### The Windows fix is not the Linux fix, and the residual risks differ

| | Linux | Windows |
| --- | --- | --- |
| Mechanism | `--remap-path-prefix` | deterministic snapshot directory name |
| Residual | the path still varies and is scrubbed | nothing needs scrubbing |
| Extra evidence | strings sweep shows 0 surviving `mkdtemp` suffixes | direct binary scan shows **no absolute `.rs` path is embedded at all** under `strip="symbols"` + `panic="abort"` on MSVC |

The Windows scan result is why relocating the temp root changes nothing there. Do not assume either
platform's approach transfers — the causes were already known to differ (`mkdtemp` path in panic
metadata vs link-time COFF/CodeView), and now the remedies differ too.

## Minor: a build root near `MAX_PATH` fails at assembly

`ENAMETOOLONG: mkdtemp …`, reproduced by deliberately choosing an absurd root name. Same class as the
Linux sibling's `F-L2-12` — a path-length ceiling surfacing during a build — but **strictly better
behaved: it names its own cause** rather than presenting as an unrelated timeout in a different test.
Not engineered around; recorded so nobody spends an hour on it later.

## Integration defect found by the re-take, fixed

The crate reads `RASEN_WPA_SOURCE_SHA256` at compile time and the packaging script **did not set it**.
An artifact built by the packaging path would therefore have compiled with no source digest, its
attestation would have omitted the key, and the consuming codec would have failed closed at prepare —
**the packaged helper would have been non-functional**, surfacing only when someone ran it.

Fixed: the script now sets it from its own computed digest, records it in build provenance as
`compiledInSourceDigest`, and **rejects a caller-supplied `RASEN_WPA_SOURCE_SHA256`** as a
build-environment override, since an external value would let a binary compile in provenance it does
not have.

`artifactSha256` is **measured** — the helper hashes its own executable at prepare, so it cannot
disagree with the file that ran. `sourceSha256` is compiled in; when absent the key is **omitted
entirely** rather than emitted empty, so a development helper fails the consuming codec closed instead
of producing an unbindable receipt. Every actual-kernel receipt below was re-taken after that landed.

Useful for holding the freeze: **`tests/` is outside the source-digest input set** (`Cargo.lock`,
`Cargo.toml`, `THIRD_PARTY.md`, `src/**`), verified by editing two test files post-freeze and
re-measuring — digest unchanged. Test-side work in Sections 8 and 9 therefore cannot move the crate
digest.

## Native test totals — corrected

**112 tests, 111 asserting, 1 gated.** An earlier figure of 105 was from mid-wave and is superseded.

The single gated entry point is `fixture_entrypoint` in `tests/windows_authority_kernel.rs`, gated on
`RWPA_FIXTURE`. It exists so the test binary can be re-executed **as a workload inside the Job**, the
only way a member can attempt a breakaway or create a nested Job. Its behaviour differs by path, and
the middle case is **demonstrated rather than argued**:

1. Gate unset (normal suite run): returns and passes asserting nothing. That is a skip; exclude it
   from any asserting count.
2. Its consumers fail loudly — `actual_breakaway_is_refused_…` and
   `actual_nested_job_members_stay_inside_the_outer_authority` assert on the fixture's *output*, so if
   it never runs they fail on an empty string. This actually happened earlier in the wave, before
   `--nocapture` was added, and the consuming assertions caught it.
3. Gate set but role unrecognised was the one genuinely silent path — it exited 0 having done nothing.
   Changed to `panic!` while the report was being written.

`stateroot::a_reparse_point_on_the_target_is_refused` is **conditionally** asserting — it skips if
directory-symlink creation is denied — and the assertion branch was verified to have actually run on
this host.

## Blocker-class defect found by running production code against the real kernel

**The guardian could destroy its own authority by logging.** `eprintln!` panics when its write fails;
the guardian's stderr is a pipe to the short-lived helper; so the first diagnostic emitted after that
helper exits aborted the guardian — closing the Job's only handle under `KILL_ON_JOB_CLOSE` and
killing a live scope. It surfaced only as "a rejected capability returns a closed endpoint instead of
the typed `reference-invalid` frame".

Two further defects from the same route, both fixed: the control endpoint was a **synchronous** handle,
so a blocking `ReadFile` in the session loop serialised against the event reader's `WriteFile` on the
same handle and `root-exited` / `exact-scope-empty` never left (fixed with `FILE_FLAG_OVERLAPPED` on
both ends); and the controller **treated end-of-stream as an exact-empty receipt**, returning `Ok(())`
on EOF and printing an exact-empty line off a bare pipe close (now `control-loss`). Also:
`DisconnectNamedPipe` discarding unread data and destroying typed failure frames in flight;
`root-exited` delivered twice; an empty environment block written as one NUL where the kernel requires
two — with a unit test that had asserted the shape the code produced rather than the shape the contract
requires.

**This is the second Blocker on this change family found by running production code against a real
kernel rather than by any test** — the Linux sibling's `place_guardian` defect was the first. Past
coincidence; recorded as a method finding for the review wave.

## Design correction: Decision 3's stated mechanism does not reproduce

Decision 3 states that associating the completion port after a member exists "silently loses that
member's `NEW_PROCESS` message". **On this kernel it does not** — associating to a Job with live
members announces each of them at association time. Recorded as
`actual_late_port_association_still_announces_members_that_are_currently_alive`.

**The requirement survives for a different, proven reason**: a member that exits *before* association
is lost permanently, and the zero-transition it caused has already happened, so exact-empty can never
fire for that authority. Conclusion stands; stated mechanism does not. Routed to the planner, because
otherwise someone will cite the mechanism as established.

## Also open, not claimed — from the native implementer

- **`cargo fmt --check` cannot run** — `rustfmt` is not installed for `1.88.0-x86_64-pc-windows-msvc`.
  Task 11.2's fmt row is **open, not passed**.
- **arm64 fails at link, not compile** — the target is installed; Git Bash's `link` coreutil shadows
  MSVC's `link.exe`. Needs an MSVC-native shell. No runtime claim either way.
- **9.6 is evidenced, not discharged** — all 56 declared foreign items have reachable call sites on
  tested paths (audited mechanically, none without), but execution of each was not instrumented. The
  audit did catch one real instance of the debt: `PostQueuedCompletionStatus` sat inside a
  `wake_poller` that had **no callers**, so the declaration would never have run. Closed with a real
  call.
- **The crate-side post-open reread is implemented but unproven.** TypeScript owns 9.5's RED; the
  crate performs the same reread independently inside `ControlEndpointClient::connect` as a
  precondition of obtaining a control channel, and no RED has been produced for it.

Test receipts backing the 26:

```text
Windows suites          Test Files 8 passed (8)      Tests 165 passed (165)
                        zero skipped, zero gated entry points, zero early-returning entry points,
                        zero env-var gates, zero it.skip/it.todo — verified by scan, not by intent.
                        165 headline == 165 asserting.
wider session-host       Test Files 43 passed | 1 skipped (44)
                         Tests 571 passed | 7 skipped (578)
                         all 7 skips enumerated, all pre-existing non-Windows platform gates, none
                         belonging to this change
npx tsc --noEmit         exit 0
npx eslint (new sources and tests)  exit 0
```

A 17-oracle mutation matrix was applied to the **product**, each suite re-run, each mutation restored
in a `finally` with restoration asserted, and all suites green afterwards. Every RED carries real
assertion text.

## What these 26 receipts do NOT establish

**No actual-kernel Windows behaviour is proven by any of them.** Every Windows suite drives an
injected transport. The only real-kernel contact in the TypeScript scope is the artifact resolver's
`actual-windows-runtime` path plus the native build itself. Sections 8 and 9 are entirely
unaddressed, and the CI workflow authored under 10.5 has **never executed** — it is
authored-and-contract-tested, which must not be read as "CI passes".

**Author == verifier throughout.** All 17 mutations were produced by the same worker against its own
product and tests, and **none has been reproduced by anyone else**. Mutation pairs are materially
stronger than bare green, but they are not a second pair of eyes. A non-author reproduction of the
matrix is owed in the unified review wave. Disclosed by the implementer unprompted.

## 10.4 is PARTIAL and stays unticked

`cargo check --target aarch64-pc-windows-msvc` passes and is recorded as `cross-build-non-runtime`.
The **linked** artifact cannot be produced on this host: `error: linker 'link.exe' not found … the
msvc targets depend on the msvc linker` — the VS Build Tools **ARM64** component is absent.

So arm64 cross-**link** is now open in addition to the pre-existing arm64 runtime gate, and arm64
package-shape evidence does not exist. Do not soften either.

Environment change made and flagged by the implementer: `rustup target add aarch64-pc-windows-msvc`.
Local and reversible; recorded rather than silently absorbed.

## Precondition: Section 8 does not open until the Windows crate is digest-frozen

The native crate moved four times during the TypeScript wave, producing build receipts at source
digests `15ed93d0…`, `fc554069…`, `8e3878a5…` and `05dbdc6c…`, and the implementer's source-stability
guard fired twice against live concurrent edits. The guard means no receipt can be *silently*
mis-bound — but it also means none of those receipts is stable.

Section 8 binds actual-kernel receipts. Opening it against a moving crate would bind every one of them
to a digest that no longer exists. The Linux sibling paid for that lesson with two full re-bind
cycles; this wave will freeze first. Re-taking the build receipt at the frozen digest is a two-minute
job the implementer has already scoped.

### Second precondition: decide which artifact Section 8 receipts bind, before taking them

Raised by the native implementer *before* the rows were taken, specifically to avoid the expensive
half of a re-bind.

Their existing actual-kernel receipts carry a populated `artifactSha256` — but it is the hash of the
**test-profile** binary, because `CARGO_BIN_EXE_*` points at `target/debug`:

```text
debug helper    (what the kernel tests actually executed)   699904 bytes  4c15b7f7f2521e44043338c9fab13e9b7d6c6008e268933b0107250d4aaf93b6
release helper  (what a build script would ship)            258560 bytes  aeb1af915a8c2bc9ce549bb81a8a4a419bfc66a2913b900f3eb7072217c13673
```

Same source digest, different artifact. The receipt is honest — it names the build that actually ran —
but **the artifact hash in those receipts does not match the shipped artifact**, and a reviewer
comparing them finds a mismatch that looks like tampering and is not. The `sourceSha256` binding is
unaffected and is the one that carries the meaning.

**Decide before Section 8 opens, not after.** Two admissible resolutions:

1. **Preferred** — take the Section 8 rows against the **build-script-produced** artifacts rather than
   `cargo build --release` or the test profile, so the artifact hash in each receipt is the shipped
   one and both bindings agree. This requires the build script to emit binaries the test harness can
   point at, which is a TypeScript-side question; the crate stays frozen either way.
2. **Acceptable** — keep the test-profile artifact, but every receipt must **state plainly** that
   `artifactSha256` is the test-profile binary and not the shipped one. Silence here costs someone an
   investigation.

Re-taking actual-kernel rows is the expensive half, which is why this is a precondition rather than a
review-wave note.

## Open cross-track question: who owns the post-open reread

The TypeScript side implemented the post-open reread as a TS invariant, with a differing reread
returning `identity-drift` and **no control issued** — asserted by transport call counts rather than
by return value alone, and proven discriminating by mutation `M5`.

If the native crate should own that ordering instead, the code move is cheap: the classification table
is a pure total function over two probes and does not care which layer produced them. **What must move
with it is task 9.5's RED.** If the guarantee relocates and its demonstration does not, the gate is
left silently open — the exact failure shape this change family keeps producing. Recorded here so it
cannot be lost in a handover.

## Design defects found during apply, routed to the planner

1. **Decision 10's Win32 durability recipe is unreachable from Node.** `fs.renameSync` provides
   `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`, but no Node API requests `MOVEFILE_WRITE_THROUGH`,
   and directory `FlushFileBuffers` requires `FILE_FLAG_BACKUP_SEMANTICS`. The ledger's crash-window
   guarantees therefore rest on metadata durability the TypeScript layer cannot force. Closing it
   needs the native FFI. A `WINDOWS_PUBLICATION_DURABILITY_BARRIER` export was added so the shortfall
   lands in receipts rather than in prose.
2. **Decision 9's third recovery row is vacuous as written.** "Exact-empty from the last-handle rule
   with the sole-handle attestation *present*" is always true, because the codec requires the
   attestation in every valid reference — the condition could never fail. The implementation instead
   carries `soleHandleAttestation: string | null` meaning **corroborated by the trusted state root**,
   and mutation `M7` proves that version discriminates. **The design text should say corroborated, not
   present.**
3. **Node cannot read Windows owner SIDs or DACLs at all** (`stat.uid` is 0). Every owner-SID and DACL
   check in Decisions 5, 6 and 10 is therefore native-side only — those checks exist in the crate or
   they do not exist. Documented in code rather than implied as covered.

## Findings raised from this wave against the FROZEN Linux sibling

Both verified independently by the LEAD and recorded in the Linux change's findings file:

- **`F-L2-21`** — the Linux conformance fixture returns `destructiveControls: 0` as an unconditional
  literal while the shared suite asserts `=== 0`, so the `identityDriftRetained` and
  `eventGapRetained` rows of the Linux mutation snapshot cannot fail.
- **`F-L2-22`** — removing the ledger gate from `activate` leaves the **shared** conformance suite
  green. Anyone citing that suite as evidence for publish-before-activate is over-reading it.

## Reproducibility: the Windows cause is not the Linux cause

`F-L2-15` reproduces on Windows for an entirely different reason. Two builds of identical source at
identical length 201216 differed by exactly **20 bytes**: the COFF `TimeDateStamp` at 0xf0, three
copies in the debug-directory entries, and the 16-byte CodeView GUID at 0x2b768. No code bytes.

Fixed with `-Clink-arg=/Brepro` written into the isolated `CARGO_HOME` config — not `RUSTFLAGS`, which
the build script rejects. Re-measured: two independent builds at source `fc554069…` both produced
`ae47c00d5bc9dded3c838a7dc9920c2722d86c19f20ffeeae914905cd86885cc`, byte-identical.

**The Linux fix does not cover Windows and the Windows fix does not cover Linux.** A deterministic
snapshot directory name — the obvious Linux-shaped remedy — made the snapshot path identical across
both Windows builds and the artifacts still differed. Do not let one fix be assumed to close both.

## Boundary verification

The Linux tree remained frozen throughout. `native/linux-process-authority` recomputes to
`087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59`, verified by the LEAD and
additionally guarded inside `windows-process-authority-package-ci.test.ts` so it re-checks on every
run. The common contract is consumed unchanged, hash-guarded, and green.

Two files were created outside the implementer's original grant and are approved as required by tasks
10.1 and 10.5: `scripts/build-windows-process-authority.mjs` and
`.github/workflows/windows-process-authority.yml`, plus two added `package.json` script lines.
