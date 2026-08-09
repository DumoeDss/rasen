# Windows native crate: freeze marker

## AMENDMENT 2026-08-08: the freeze recorded below is SUPERSEDED

Everything below this section is preserved as the 2026-08-07 historical record and is no
longer the current freeze. As of 2026-08-08 the authoritative Windows freeze is:

```text
crate sourceSha256   fc49a7c2c5f9642fa976d16f06e167a39bdbe3c751686f417722273aea891c27   (22 files)
  supersedes         2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377   (recorded below)
packaged helper      367666f6d4151b5092b528abd2c8256d48fd96d73436184b54ae1897e55d8a6b   258560 B
  supersedes         2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0   (recorded below)
```

- The `2b3fabd9` / `2aebab69` pair below was replaced by the LEAD-authorised post-freeze fix
  wave (break once, fix, re-freeze once): Fix 1 landed `S8-F1`/`S9-F1` (the lost termination
  receipt) and Fix 2 landed task 4.8 (the availability transaction). The full record of the
  new freeze - including its own supersedes lineage and the 124/124 native re-bind - is
  `evidence/section-9-oracle-discrimination.md` ("The new freeze"); this amendment closes the
  "owed" marker update its re-bind sweep table listed.
- The crate digest `fc49a7c2` is reproducible from COMMITTED bytes (same convention as below:
  sorted Cargo.lock, Cargo.toml, THIRD_PARTY.md, src/**, each `path NUL bytes NUL`),
  independently verified by the 2026-08-08 upgrade-path asset audit
  (`rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/`
  `session-execution-and-self-hosting/upgrade-path-asset-audit.md`).
- The helper hash is a build-artifact RECEIPT, not a git asset: `dist/` is untracked, and
  cross-machine Windows build reproducibility remains OPEN (recorded below). A restart
  rebuilds through `scripts/build-windows-process-authority.mjs` and re-receipts; it must not
  expect to reproduce `367666f6` byte-identically on another machine.
- Fourth `testFiles` entry, owed by the re-bind sweep and recorded here:
  `native/windows-process-authority/tests/windows_section9_discrimination.rs` =
  `b919bad901b23424ad0a61023a41624a57be3bf3c9ad60a2b6a1bd3aedfad34c` (committed bytes;
  `tests/**` is eol=lf-pinned, so the checkout hash matches). Per the map's own rule, an
  added `testFiles` entry means `tests/` grew; `sourceSha256` is what says whether the
  freeze moved - and it did move, to `fc49a7c2`, for the two src fixes above.
- Decision-13 context: both crates are parked upgrade-path assets; the pair a restart must
  bind is `fc49a7c2` / `367666f6`, as cited by Target State locked decision 13, Architecture
  Replan 6, and the parent roadmap.

Nothing below this line was edited; it is the freeze marker as written on 2026-08-07.

---

Date: 2026-08-07
Written by: implementer (win-refreeze)
Supersedes: the freeze at `b44c5e253042a4f30669b36e6fa4dba1561dfba8ecf6cd8a0ee8d6f3f85c433b`, which
reproduced on no fresh checkout anywhere.

This marker is written to `evidence/` rather than to
`.rasen/changes/ecp-windows-process-authority-provider/ephemera/auto-run.json`, because this worker
must not write run-state. **The LEAD owns transcription into `implementationFreeze`.** The JSON block
below is shaped to be pasted there directly, matching the Linux sibling's marker.

Written **after** the line-ending fix, the re-measurement and every re-take, in that order. Full
working: `evidence/win-crate-lf-refreeze.md`.

## The frozen state

```text
sourceSha256      2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377
sourceFileCount   22        (Cargo.lock, Cargo.toml, THIRD_PARTY.md, src/** -- tests/ EXCLUDED)
reproducibility   pinned to LF in .gitattributes, so it holds on any checkout on any platform
host             Windows 11 Pro 10.0.26200, native, no WSL
toolchain        rustc 1.88.0 (6b00bc388 2025-06-23) / cargo 1.88.0 (873a06493 2025-05-10)
target           x86_64-pc-windows-msvc
```

## Why the test-file map exists

`sourceDigest()` covers `Cargo.lock`, `Cargo.toml`, `THIRD_PARTY.md` and `src/**` only. `tests/` is
outside it -- **verified by falsification, not by reading**: appending a byte to
`tests/windows_authority_kernel.rs` left the digest at `2b3fabd9...` unchanged. A marker recording
only `sourceSha256` would therefore certify nothing about the test files, and test-file churn is what
actually blocked binding on this change. So they are pinned here separately.

Both are covered by the new `.gitattributes` rule, so these digests are reproducible on any checkout.

The nine Windows TypeScript test and fixture files are **deliberately not in this map**. They are LF
in this working tree but are not pinned, so their digests change with the checkout platform.
Recording them would reintroduce, inside the marker, the exact defect this re-freeze removes. See
section 8 of the evidence file.

### Amendment 2026-08-07: a third test file, and why this is NOT a re-freeze

Section 8 added `tests/windows_section8_gate.rs`. Its digest is recorded below.

**This is a completeness fix to the test-digest map, not a moved freeze, and the distinction is
demonstrated rather than asserted.** `sourceSha256` is measured identical before and after that
file existed -- `2b3fabd9...` both times -- which is the same falsification the map's own
justification rests on: `tests/` is outside `sourceDigest()`'s input set, so a new 56189-byte file
there cannot move the crate source digest, and it did not. The two digests already in the map are
byte-identical to their original values, because Section 8 modified neither file; all new test work
went into the new file specifically so that this amendment adds a line and changes none.

A future reader should treat an added `testFiles` entry as evidence that `tests/` grew, and should
look at `sourceSha256` -- not at the size of this map -- to decide whether the freeze moved.
Working: `evidence/section-8-actual-kernel-gate.md`.

## Lineage

```text
15ed93d0  \
fc554069   |  four moves during the TypeScript wave; the source-stability guard fired twice.
8e3878a5   |  Reported by lead-2; those trees no longer exist and this worker did not verify them.
05dbdc6c  /
b44c5e25      frozen, then found to reproduce on NO fresh checkout -- an artifact of which files
              Python's open(path,'w') had written with CRLF in one working tree
2b3fabd9      current. Independently reproduced by two paths: an in-memory all-LF transform of the
              working tree, and a direct read of the committed HEAD blobs.
```

## Run-state block

```json
{
  "frozenAt": "2026-08-07T00:00:00+08:00",
  "frozenBy": "implementer-win-refreeze",
  "wave": "ecp7-platform-providers",
  "position": 2,
  "verdict": "crate source frozen; Change is NOT implementation-frozen and Sections 8, 9, 1 and 11 remain open",
  "frozenDigests": {
    "note": "sourceDigest() covers only Cargo.lock, Cargo.toml, THIRD_PARTY.md and src/** -- tests/ is EXCLUDED, verified by mutating a test file and re-measuring. The test-file hashes are recorded alongside because that churn was the actual binding blocker.",
    "sourceSha256": "2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377",
    "sourceFileCount": 22,
    "supersedes": "b44c5e253042a4f30669b36e6fa4dba1561dfba8ecf6cd8a0ee8d6f3f85c433b",
    "lineage": [
      "15ed93d0 (TypeScript wave, reported by lead-2, unverified here)",
      "fc554069 (TypeScript wave, reported by lead-2, unverified here)",
      "8e3878a5 (TypeScript wave, reported by lead-2, unverified here)",
      "05dbdc6c (TypeScript wave, reported by lead-2, unverified here)",
      "b44c5e25 (reproduced on no fresh checkout anywhere; CRLF artifact of one working tree)",
      "2b3fabd9 (current; reproducible on any checkout via the .gitattributes LF pin)"
    ],
    "testFiles": {
      "native/windows-process-authority/tests/windows_authority_kernel.rs": "2cbf1c24da4ef8ca3713aa18ca45becce4accea028d40cf24b903559842da4fb",
      "native/windows-process-authority/tests/windows_guardian_lifecycle.rs": "81e10a339873b737e32c4690f1f0f600d3c74f4ce51be765bdbab60a4b8afd8c",
      "native/windows-process-authority/tests/windows_section8_gate.rs": "ba540903bdb9ac157303ee3c366cf8ed1a8c9dbf4d6896b23bf31db6a473bb87"
    },
    "testFilesAmended": "2026-08-07, Section 8: windows_section8_gate.rs added (56189 B). A map entry was ADDED and none was changed -- the other two digests are byte-identical to their original values. sourceSha256 re-measured identical before and after, so the freeze did not move; tests/ is outside sourceDigest()'s input set and this is the falsification that shows it.",
    "testFilesExcluded": "The nine Windows TypeScript test and fixture files are not pinned to LF, so their digests are checkout-platform dependent. Recording them would reintroduce the defect this re-freeze removes.",
    "reproducibilityMechanism": ".gitattributes pins Cargo.lock, Cargo.toml, THIRD_PARTY.md, src/** and tests/** of this crate to eol=lf. Demonstrated on a real checkout on this host: without the rule the crate checks out all-CRLF at dbc9e58e...; with it, 2b3fabd9...",
    "verifiedBy": "computed by two independent paths by this worker -- an in-memory all-LF transform of the working tree, and a direct read of the committed HEAD blobs. Both give 2b3fabd9. Not yet reproduced by a second agent."
  },
  "frozenArtifacts": {
    "route": "scripts/build-windows-process-authority.mjs is the authoritative build route. A plain `cargo build --release` produces a DIFFERENT program and must not be bound.",
    "helper": {
      "file": "dist/native/win32-x64/rasen-windows-process-authority-helper.exe",
      "length": 258560,
      "sha256": "2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0",
      "supersedes": "660d83ad4b2d3592abd6d786599aec443fb6c09416f97d876b919c243c69741b",
      "compiledInSourceSha256": "2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377"
    },
    "guardian": {
      "file": "dist/native/win32-x64/rasen-windows-process-authority-guardian.exe",
      "length": 254464,
      "sha256": "d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f",
      "unchangedAcrossRefreeze": true,
      "why": "the guardian embeds no RASEN_WPA_SOURCE_SHA256, and CRLF-to-LF changes no token, so the compiler emitted a byte-identical binary. Confirmed by scanning both binaries for embedded 64-hex strings."
    },
    "releaseInputSha256": "9237b31ebe5c6d978b70df9d904aa9446be4b8851fe718d8e456d221c353c18a",
    "reproducibility": "3 build roots and 3 temp roots on this host: all six packaged output files byte-identical. Same machine, different invoker -- cross-machine reproducibility for Windows remains OPEN.",
    "supersededDoNotBind": {
      "helper": "aeb1af915a8c2bc9ce549bb81a8a4a419bfc66a2913b900f3eb7072217c13673",
      "guardian": "d230f8b0fb1785446e34c5eb8a569ad128e189cf277a266812deed4ab6ea48d0",
      "note": "still present in native/windows-process-authority/target/release/ and still embedding the dead b44c5e25. gitignored build output, left in place."
    }
  },
  "receiptsRebound": {
    "nativeSuite": "112 tests, 0 failed, 0 ignored (91 lib + 15 windows_authority_kernel + 6 windows_guardian_lifecycle) at 2b3fabd9",
    "section8Seam": "5 binary-executing rows executed the PACKAGED helper via RWPA_HELPER_BINARY: executedSha256 == selfMeasuredArtifact == 2aebab69, sourceSha256 == 2b3fabd9",
    "arm64CrossCheck": "cross-build-non-runtime at 2b3fabd9; sourceSha256After identical",
    "typescriptSuites": "8 files, 168 passed -- not bound to this digest, re-run as insurance"
  },
  "stillOpen": [
    "10.4 arm64 cross-LINK and package shape: VS Build Tools ARM64 component absent. PARTIAL, unticked.",
    "11.2 cargo fmt --check: rustfmt is not installed for 1.88.0-x86_64-pc-windows-msvc. Verified first-hand. Row OPEN, not passed.",
    "Cross-machine reproducibility of the Windows packaged artifacts.",
    "Non-author reproduction of the 17-mutation matrix.",
    "The Linux crate carries the same unpinned line-ending exposure: 087d87a5 does NOT reproduce on a Windows checkout (measured: 442e8743). windows-process-authority-package-ci.test.ts asserts it and the authored workflow runs on windows-latest. Out of this worker's grant; LEAD decision."
  ],
  "tasksTicked": "none -- the re-freeze is a precondition for Section 8, not a task in the ledger",
  "nextAction": "Section 8 may now open. Its 21 rows bind sourceSha256 2b3fabd9 and, for the 5 binary-executing rows, artifact 2aebab69. Build before the matrix, and point RWPA_HELPER_BINARY at the packaged helper."
}
```

## What this marker does NOT assert

- **It is not an implementation freeze for the Change.** It freezes the crate source only. Sections
  1, 8, 9 and 11 are untouched; 57 of 104 tasks remain unticked.
- It does not assert cross-machine reproducibility, only same-host reproducibility across three build
  roots and three temp roots.
- It does not assert that any Section 8 or Section 9 oracle has run. None has.
- The four earliest lineage entries are lead-2's record, carried forward unverified: those trees no
  longer exist.
