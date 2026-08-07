# Windows crate line-ending fix and re-freeze

Date: 2026-08-07
Author: implementer (win-refreeze), single leaf worker
Host: Windows 11 Pro 10.0.26200, native, no WSL. `rustc 1.88.0` / `cargo 1.88.0`, MSVC.

This closes the OPEN item in `lead2-apply-wave-accounting.md`: the crate was digest-frozen at
`b44c5e25...`, a value that reproduces on no fresh checkout anywhere. It is done before Section 8
opens, so the 21 Section 8 rows bind a digest that survives a clone.

Every recorded value in `lead2-apply-wave-accounting.md` was re-measured here rather than adopted.
Matches and mismatches are both listed.

## 1. The CRLF set, enumerated by measurement

Every file in `native/windows-process-authority` (build output `target/` excluded) was read as raw
bytes and its `0x0D 0x0A` pairs, bare `0x0A` and bare `0x0D` counted. No `grep` was used: it does not
distinguish the two, and this project has already been misled by it once.

`inDigest` is membership of the build script's source-input set, computed from the script itself,
not assumed.

| inDigest | CRLF | bare LF | bare CR | bytes | file |
| --- | --- | --- | --- | --- | --- |
| no | 0 | 1 | 0 | 9 | `.gitignore` |
| YES | 0 | 7 | 0 | 175 | `Cargo.lock` |
| YES | 0 | 28 | 0 | 513 | `Cargo.toml` |
| YES | 0 | 42 | 0 | 1831 | `THIRD_PARTY.md` |
| YES | 0 | 389 | 0 | 14387 | `src/activation.rs` |
| YES | **501** | 0 | 0 | 23093 | `src/attestation.rs` |
| YES | 0 | 18 | 0 | 641 | `src/bin/rasen-windows-process-authority-guardian.rs` |
| YES | 0 | 272 | 0 | 10563 | `src/boot.rs` |
| YES | **936** | 0 | 0 | 36360 | `src/cli.rs` |
| YES | 0 | 231 | 0 | 9186 | `src/construction.rs` |
| YES | 0 | 244 | 0 | 9062 | `src/encoding.rs` |
| YES | 0 | 403 | 0 | 15461 | `src/endpoint.rs` |
| YES | **1536** | 0 | 0 | 62137 | `src/guardian.rs` |
| YES | 0 | 601 | 0 | 23521 | `src/job.rs` |
| YES | 0 | 326 | 0 | 12080 | `src/journal.rs` |
| YES | 0 | 418 | 0 | 16097 | `src/launch.rs` |
| YES | **34** | 0 | 0 | 838 | `src/lib.rs` |
| YES | 0 | 13 | 0 | 328 | `src/main.rs` |
| YES | 0 | 748 | 0 | 25946 | `src/protocol.rs` |
| YES | 0 | 231 | 0 | 8085 | `src/sha256.rs` |
| YES | 0 | 371 | 0 | 15298 | `src/stateroot.rs` |
| YES | 0 | 754 | 0 | 26130 | `src/sys.rs` |
| YES | 0 | 721 | 0 | 24179 | `src/win.rs` |
| no | 0 | 1053 | 0 | 41129 | `tests/windows_authority_kernel.rs` |
| no | **574** | 0 | 0 | 23611 | `tests/windows_guardian_lifecycle.rs` |

**The set is exactly five, and lead-2's claim is confirmed by measurement.** Four are digest inputs
(`src/attestation.rs`, `src/cli.rs`, `src/guardian.rs`, `src/lib.rs`); the fifth,
`tests/windows_guardian_lifecycle.rs`, is not, and is the file the marker records. Every CRLF file is
uniformly CRLF -- no mixed file exists, and no bare CR exists anywhere in the crate.

Counts match lead-2 exactly where lead-2 gave one: `tests/windows_guardian_lifecycle.rs` at 574.

### After normalisation

| file | bytes before | bytes after | CRLF after | bare CR after |
| --- | --- | --- | --- | --- |
| `src/attestation.rs` | 23093 | 22592 | 0 | 0 |
| `src/cli.rs` | 36360 | 35424 | 0 | 0 |
| `src/guardian.rs` | 62137 | 60601 | 0 | 0 |
| `src/lib.rs` | 838 | 804 | 0 | 0 |
| `tests/windows_guardian_lifecycle.rs` | 23611 | 23037 | 0 | 0 |

**The conversion is provably content-neutral.** Every committed blob in this crate is already pure LF
(measured: 25 of 25 tracked files, zero CR bytes), because `core.autocrlf=true` normalised them on
`git add`. Each normalised file was therefore compared against its `HEAD` blob and is byte-identical:

```text
src/attestation.rs                    2710ceaef1ff5a15c93aca1b64237485dc07d68a39e2749f1958c77f6b5e7cf7
src/cli.rs                            e73191863ac15cc163ce2caf3561b9e28a34711016bf3cc868983bfbc1b0f3a9
src/guardian.rs                       10dc1b43443426d8d5ae3f062d82b59c528cccd277b01bf6f4f3b93b12d86afa
src/lib.rs                            a49058db9c8694420e3cfb4376f45c80b91a922966d02d5ce75ca303d22e78d2
tests/windows_guardian_lifecycle.rs   81e10a339873b737e32c4690f1f0f600d3c74f4ce51be765bdbab60a4b8afd8c
```

Consequence worth stating plainly: **`git status` reported this crate as clean the entire time.**
Because the blobs are LF and `autocrlf=true` normalises on read, git could not see the CRLF that was
moving the digest. Nothing in the normal git workflow would ever have surfaced this.

## 2. The digest implementation, read rather than recalled

`scripts/build-windows-process-authority.mjs:120-154`. Read in full; not reimplemented from memory.

```text
requiredSourceInputs   Cargo.lock, Cargo.toml            absent -> hard failure
optionalSourceInputs   THIRD_PARTY.md                    included when present, absence reported
plus                   src/** , recursed, path-sorted
EXCLUDED               tests/**, .gitignore, target/**
per file               hash.update(relativePath); hash.update('\0');
                       hash.update(contents);     hash.update('\0')   <- the trailing NUL
input count            22
```

The trailing NUL after *contents* is the trap recorded in lead-2's gotchas. It is present in this
script (`:151`) and in the Linux sibling (`build-linux-process-authority.mjs:125`). All digests below
were computed with it.

## 3. Digests: independently measured against every recorded value

Measured by two independent paths -- (a) transforming the working tree in memory, (b) reading the
committed blobs out of `HEAD` and never touching the working tree at all.

| value | lead-2 recorded | measured here | agree |
| --- | --- | --- | --- |
| digest input file count | 22 | 22 | YES |
| current mixed working tree (the frozen value) | `b44c5e2530...c433b` | `b44c5e253042a4f30669b36e6fa4dba1561dfba8ecf6cd8a0ee8d6f3f85c433b` | YES |
| all-LF | `2b3fabd916...45377` | `2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377` | YES |
| all-CRLF | `dbc9e58efb...04a1d` | `dbc9e58efb6d005fa7fb494472654aada600d8b94a3273337fa5863397004a1d` | YES |

Path (b), the committed blobs, yields `2b3fabd916dd...45377` over 22 files -- i.e. **the re-freeze
target is the digest of the source as committed**, independently of any working tree.

`core.autocrlf` confirmed `true` at both local and global scope. `git check-attr -a` on the crate
returned nothing before this change: no attribute of any kind applied.

## 4. The `.gitattributes` pin, and proof it is load-bearing

Added to `.gitattributes`, following the form of the existing precedent at `:10`:

```text
native/windows-process-authority/Cargo.lock text eol=lf
native/windows-process-authority/Cargo.toml text eol=lf
native/windows-process-authority/THIRD_PARTY.md text eol=lf
native/windows-process-authority/src/** text eol=lf
native/windows-process-authority/tests/** text eol=lf
```

That set is exactly the build script's closed source-input set plus `tests/**`. `sourceFileList()`
cannot grow outside it: the crate-root inputs are a fixed list of three and everything else comes
from `src/`. `.gitignore` is deliberately **not** pinned -- it is neither a digest input nor in the
marker, and pinning it would break the clean justification above for no measured benefit. It is the
one remaining file in the crate whose bytes still depend on the checkout platform, and that is
recorded here rather than left to be discovered.

**Normalising alone would not have been sufficient, and this is demonstrated rather than argued.** A
throwaway repository was created on this host with `core.autocrlf=true`, the crate committed into it,
and the crate then checked out twice -- once without the rule, once with it, from identical blobs:

```text
A. fresh checkout, NO rule (today's committed state)
   CRLF-carrying files: 25 of 25     total CRLF pairs: 10452
   sourceDigest       : dbc9e58efb6d005fa7fb494472654aada600d8b94a3273337fa5863397004a1d

B. same blobs, same host, WITH the rule
   CRLF-carrying files: 1 (.gitignore)   total CRLF pairs: 1
   sourceDigest       : 2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377
```

A is exactly the recorded all-CRLF control. So the frozen `b44c5e25...` reproduced on **no** fresh
checkout, and a re-freeze without the pin would have been carrying a marker asserting reproducibility
while breaking at the next clone. B is the re-freeze target. The rule changes the outcome, on a real
checkout, on this host.

## 5. Guards: falsified before being relied on

Three properties the marker rests on. Each was made to fail first. Every mutation was restored and
each restoration asserted byte-exact against the original SHA-256.

| # | property | mutation | result |
| --- | --- | --- | --- |
| 1 | the frozen `sourceSha256` discriminates | append one byte to `src/main.rs` | digest moved to `8b24bb1b...`, off the frozen value |
| 2 | `tests/` really is outside the input set | append one byte to `tests/windows_authority_kernel.rs` | digest **unchanged** at `2b3fabd9...` |
| 3 | the build script's source-stability guard fires | edit live `src/main.rs` 2500 ms into an in-flight build | build **exit 1**, `source digest changed before/after the isolated build`, stdout empty -- no receipt emitted |

Result 2 is the reason the marker records a test-file digest map at all: a marker carrying only
`sourceSha256` would certify nothing about the files whose churn was the actual binding blocker.

Result 3 matters because the guard is the only thing standing between a concurrent edit and a
mis-bound Section 8 receipt. It is now known to discriminate on this crate, not assumed to.

## 6. Receipts bound to the old digest: re-take table

| receipt | was bound to | re-taken | result |
| --- | --- | --- | --- |
| Authoritative packaged helper | `660d83ad...` @ `b44c5e25` | YES | `2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0`, 258560 B, @ `2b3fabd9` |
| Authoritative packaged guardian | `d571f148...` @ `b44c5e25` | YES | `d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f`, 254464 B -- **byte-identical, unchanged** |
| Packaging reproducibility | 3 build roots / 2 temp roots | YES | 3 build roots **and** 3 temp roots, all six output files byte-identical |
| Section 8 seam: shipped = executed = attested | `660d83ad` self-measure | YES | 5 rows: executed `2aebab69...` == self-measured `2aebab69...`, source `2b3fabd9...` |
| Native crate suite | 112 tests @ `b44c5e25` | YES | **112 tests, 0 failed, 0 ignored** (91 lib + 15 kernel + 6 guardian-lifecycle) |
| `RASEN_WPA_SOURCE_SHA256` compiled in | `b44c5e25` | YES | helper embeds `2b3fabd9...`; guardian embeds none (see below) |
| arm64 `cargo check` cross-build | @ `b44c5e25` | YES | `cross-build-non-runtime`, `sourceSha256` and `sourceSha256After` both `2b3fabd9...` |
| arm64 cross-**link** / package shape | never taken | NO | unchanged pre-existing block: VS Build Tools ARM64 component absent. 10.4 stays PARTIAL and unticked. |
| `cargo fmt --check` | never passed | NO | verified first-hand: `'cargo-fmt.exe' is not installed for the toolchain '1.88.0-x86_64-pc-windows-msvc'`. Task 11.2's fmt row stays **open**. |
| Windows TypeScript suites | not bound to this digest | re-run anyway | 8 files, **168 passed** |

### The guardian did not change, and that is checkable

`d571f148...` is byte-identical before and after the re-freeze. The reason is verifiable: the helper
embeds `RASEN_WPA_SOURCE_SHA256` and the guardian does not. Scanning both binaries for 64-character
hex strings finds `2b3fabd9...` in the helper and, in the guardian, only the three SHA-256 test-vector
constants that are present in both.

So the helper's whole delta is the digest string plus what `/Brepro` derives from content. Diffed
byte for byte against the retained old helper -- **128 differing bytes in 12 runs, at identical
length 258560, and no code bytes among them**:

```text
0x000f0  4 B    COFF TimeDateStamp (content-derived under /Brepro)
0x31a0f  6 runs the embedded 64-char source digest: b44c5e25... -> 2b3fabd9...
0x37c14  4 B  \
0x37c30  4 B   |  four debug-directory copies of the timestamp
0x37c4c  4 B   |
0x37c68  4 B  /
0x37d68 16 B    CodeView signature GUID
0x380e8 32 B    CodeView GUID + timestamp tail
```

This is the third recorded instance of `F-L2-14` on this change family: two different programs at
identical byte length. Length remains useless as a change signal.

### What the 5 binary-executing rows now print

`RWPA_HELPER_BINARY` was pointed at the packaged helper, so those rows executed the shipping artifact
rather than the test-profile binary. Each row is self-describing:

```text
ROW abort | capability | death | drift | duplicate
  helperPathSource      = RWPA_HELPER_BINARY
  executedSha256        = 2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0
  selfMeasuredArtifact  = 2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0
  sourceSha256          = 2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377
```

`executedSha256 == selfMeasuredArtifact` is a real oracle, not bookkeeping: it compares the hash the
*test* took of the file it invoked against the hash the *helper* took of its own executable at
prepare. The chain **shipped = executed = attested = source-bound** is re-established at the new
digest.

### Stale artifacts still on disk, reported not deleted

- `native/windows-process-authority/target/release/` still holds the **superseded** pair
  `aeb1af91...` / `d230f8b0...`, and the superseded helper still embeds the now-dead `b44c5e25...`.
  It is `target/` build output, gitignored, and is another worker's; it is left alone. Anyone pointing
  a Section 8 row at `target/release` rather than the packaged tree will bind an unbindable source.
- The repo's `dist/native/win32-x64/` **was** carrying the old `660d83ad...` helper. That would have
  been a live trap for Section 8, so the packaging script was re-run without a build-root override and
  the tree now holds `2aebab69...` / `d571f148...` with matching manifests. `dist/` is gitignored
  (`.gitignore:85`) so this cannot reach the PR diff. The old helper is retained at
  `C:/Users/Sayo/AppData/Local/Temp/wpa-old-helper.exe` for the byte-diff above.
- The test-profile helper is now `4f09a294...` at 699904 B, where lead-2 recorded `4c15b7f7...` at
  the same 699904 B. This is **not** a mismatch to investigate: the test profile is not built through
  the packaging script, so it gets no `/Brepro`, and every relink changes its timestamp and CodeView
  GUID. That recorded hash was never stable across builds and should not be treated as an identity.

## 7. Mismatches and contradictions against the recorded values

Every digest and artifact hash lead-2 recorded reproduced exactly. These are the discrepancies found,
none of which changes a conclusion:

1. **Arithmetic.** `lead2-apply-wave-accounting.md` says `LF the other 17 digest-input files`. There
   are 22 digest inputs and 4 are CRLF, so it is **18**.
2. **The Section 8 split is contradicted inside one file.** The accounting says both
   `tests/windows_guardian_lifecycle.rs 6 tests spawn a real helper BINARY` / `6 bind shipped-artifact
   identity, 15 bind source identity only`, and, later, `5 rows execute a helper binary / 16 rows
   execute no binary`. **Measured: 5.** That file has 6 `#[test]` functions, but the sixth,
   `every_declared_foreign_item_that_this_suite_reaches_is_named_in_the_declared_list`
   (`:551`), executes no binary and says so in its own receipt
   (`ROW declared-foreign-items / helper = <none: this row executes no binary>`). lead-2's handoff
   correction to **5 / 16** is the right one; the 6/15 sentences in the accounting file are stale.
3. **TypeScript suite count.** The accounting records `Tests 165 passed (165)` in one place and
   `Windows suites now 169 asserting` in another. Running the same 8 files here gives
   **168 passed (168)**. Reported as measured; not reconciled.
4. **The `/Brepro` field census does not transfer between binaries.** lead-2 records
   `the COFF TimeDateStamp at 0xf0, its three copies in the debug-directory entries, and the 16-byte
   CodeView GUID at 0x2b768`, totalling 20 bytes on a 201216-byte artifact. The current 258560-byte
   helper has **four** debug-directory copies plus `0xf0`, and its CodeView-shaped runs sit at
   `0x37d68` and `0x380e8`. Not a contradiction -- a different binary with a different debug directory
   -- but the "three copies / 20 bytes / 0x2b768" figures are specific to that one artifact and must
   not be quoted as a constant.
5. **A framing nit.** The accounting's heading `A fifth file -- outside the digest, but inside the
   marker` is correct about that file but can read as "there are five digest inputs affected". There
   are four.

## 8. Finding: the same defect is live on the Linux crate, and it is not fixed here

Measured, not inferred. The Linux crate is all-LF **in this working tree** (47 files scanned, zero
CRLF), which is why `087d87a5...` holds here. But it carries no `.gitattributes` pin either, so a
Windows checkout converts it exactly as it converts the Windows crate. Checked out into a throwaway
repository on this host with `core.autocrlf=true`:

```text
Linux crate, fresh checkout on Windows   442e87438e7153ac511e4a8e0245a8c01ab466450f545b36292e9de13a50b46d
frozen marker value                      087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
reproduces on a Windows checkout         NO
```

This is not academic. `test/core/session-host/windows-process-authority-package-ci.test.ts:295-300`
asserts `crateSourceDigest('native/linux-process-authority', ...) === 087d87a5...`, and
`.github/workflows/windows-process-authority.yml` runs that exact test with `runs-on: windows-latest`.
If that runner has `core.autocrlf=true` -- the Git for Windows default -- the assertion fails, and the
workflow has never executed, so nobody has observed it either way.

**Not fixed here, deliberately.** The grant for this unit is explicit that the Linux crate and its
evidence are not to be touched, and the Linux Change is implementation-frozen with its own review
wave. The remedy is one line of the same shape, and it modifies no file under
`native/linux-process-authority/**`:

```text
native/linux-process-authority/** text eol=lf
```

That is a LEAD decision, not this worker's. Flagged because it will otherwise surface as a CI failure
whose cause looks like tampering with a frozen tree.

The same exposure applies to the nine Windows TypeScript test and fixture files: all are LF here, none
is pinned. That is why they are **excluded** from the freeze marker's test-digest map -- recording a
digest that changes with the checkout platform would reintroduce, inside the marker, the exact defect
this work removes.

## 9. Boundary verification

- `native/linux-process-authority` recomputes to
  `087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59` over 26 files, unchanged. No file
  under `native/linux-process-authority/**` or
  `rasen/changes/ecp-linux-process-authority-provider/**` was modified.
- No file under `.rasen/**` was written. The LEAD owns run-state; the marker is delivered as evidence
  for the LEAD to transcribe.
- Nothing was committed or pushed. `.gitattributes` was briefly staged as a side effect of
  `git update-index --refresh` and was restored with `git restore --staged`, leaving the index exactly
  as found (nothing staged).
- `git diff --check` over `.gitattributes` and `native/windows-process-authority`: **clean, exit 0**.
- `git diff` for `native/windows-process-authority` against both index and `HEAD`: **empty**. The
  normalisation produces no diff at all, because it restores the files to their committed bytes. The
  entire tracked change of this unit is `.gitattributes`, +13 / -0.

## 10. What this does NOT establish

- **No actual-kernel Section 8 or Section 9 work was done.** Sections 8 and 9 remain untouched, and
  this unit deliberately stops at the marker.
- **No task in `tasks.md` was ticked.** The re-freeze is a precondition for Section 8, not a task in
  the ledger; no task text describes it. Ticking one would have been an overclaim.
- **The 112 native tests and 168 TypeScript tests are the same suites as before**, re-run at a new
  digest. They are a re-binding, not new coverage, and they carry every caveat already recorded
  against them -- above all that author == verifier for the 17-mutation matrix, which still owes a
  non-author reproduction.
- **Reproducibility remains same-machine.** Three build roots and three temp roots on one Windows
  host is a different invoker, not a different machine. Cross-machine reproducibility for Windows is
  still open and is still a legitimate ask for the review wave.
- The demonstration in section 4 shows the rule works on **this** host's git. It does not prove
  anything about a GitHub runner's configuration, which is exactly why section 8 is phrased
  conditionally.

## 11. Commands

```text
node scripts/build-windows-process-authority.mjs                       # 3x, distinct BUILD_ROOT/TEMP_ROOT
node scripts/build-windows-process-authority.mjs --check-only --target aarch64-pc-windows-msvc
cargo test --manifest-path native/windows-process-authority/Cargo.toml --locked -- --nocapture
    with RWPA_HELPER_BINARY=<repo>/dist/native/win32-x64/rasen-windows-process-authority-helper.exe
npx vitest run test/core/session-host/windows-process-authority-*.test.ts
cargo fmt --check --manifest-path native/windows-process-authority/Cargo.toml     # tool absent
git diff --check -- .gitattributes native/windows-process-authority              # clean
```

Build roots used: `C:/Users/Sayo/AppData/Local/Temp/wpa-a`, `.../wpa-b`, and the repository root.
Temp roots: `.../wpa-a-tmp`, `.../wpa-b-tmp`, `.../wpa-c-tmp`. The session scratchpad was not used as
a build root: its path is long enough to risk the `MAX_PATH` assembly failure already recorded as a
Minor on this change.

## 12. Addendum: the Linux crate pinned too (grant extended by the LEAD)

Section 8 above escalated this rather than fixing it. The LEAD extended the grant, making explicit
that a `.gitattributes` line modifies no file under `native/linux-process-authority/**` and was
therefore never outside scope. Nothing inside that crate was edited; its working tree is untouched
and still recomputes to `087d87a5...` over 26 files.

Safety check first, because `text eol=lf` corrupts a binary: all 47 tracked files in the crate were
scanned for NUL bytes. **Zero binary files**, so the blanket rule is safe.

Added to `.gitattributes`:

```text
native/linux-process-authority/** text eol=lf
```

Broader than the Windows rule deliberately. The Windows crate needed an enumerated set because the
freeze marker distinguishes digest inputs from `tests/`; here there is no such distinction to
preserve, and `**` closes the whole crate including any file added later.

### Demonstrated on real checkouts, same harness as section 4

Crate committed into a throwaway repository on this host with `core.autocrlf=true`, then checked out
twice from identical blobs:

```text
A. no rule    26 files   442e87438e7153ac511e4a8e0245a8c01ab466450f545b36292e9de13a50b46d
B. with rule  26 files   087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
```

A is the value measured in section 8; B is the frozen marker value, exactly.

### The consequence that mattered

`test/core/session-host/windows-process-authority-package-ci.test.ts:295-300` asserts
`crateSourceDigest('native/linux-process-authority', ...) === 087d87a5...`, and
`.github/workflows/windows-process-authority.yml` runs that test with `runs-on: windows-latest`.

Result B **is** `087d87a5...`, so that assertion now holds on a fresh Windows checkout under the
Git-for-Windows default `autocrlf=true`. Before this rule it would have failed on the workflow's
first ever execution, reporting a digest mismatch against a frozen tree that nobody had touched --
a failure that reads as tampering and would have cost an investigation.

Caveat unchanged from section 10: this is measured against **this** host's git, not against a GitHub
runner. It proves the rule produces `087d87a5` under `autocrlf=true`; it does not prove what a
runner's config is. What it does remove is the failure mode being dependent on that config at all --
with `eol=lf` the digest is `087d87a5` whatever `autocrlf` is set to.

### Still not done, and correctly so

The nine Windows TypeScript test and fixture files remain unpinned and remain excluded from the
freeze marker's test-digest map. The LEAD confirmed that exclusion stands. They are not asserted
against any recorded digest by any test, so they carry no equivalent failure.
