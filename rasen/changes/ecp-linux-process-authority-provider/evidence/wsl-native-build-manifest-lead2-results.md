# Task 7.2 — recorded results

Companion to `wsl-native-build-manifest-lead2.md`. Split out so that the procedure's
"compute before you read" ordering is enforced by file boundary rather than by an instruction the
reader is asked to honour on the same page (`F-L2-20`).

**If you are executing the procedure: stop. Finish Step 7 first.** Then compare, and diagnose any
difference rather than reconciling it.

Boundary, expectations and the what-binds / what-does-not statement all live in the receipt. Nothing
here is a claim on its own.

## Build

```text
evidenceClassification  package-integrity-non-runtime
sourceSha256            087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
releaseInputSha256      14f041c71aae25322469d9af7d90f1f252d8ad461108e4c7780cde2e5ed35ca8
privilegedBrokerIncluded  false
```

`releaseInputSha256` reproduced identically across both builds below, because both used the same host
linker wrapper path. It still varies if your wrapper lives elsewhere — see the receipt.

## Artifact, computed first-hand from the file on disk

```text
length                     578312
sha256                     4835b1bbb54be9c7c186a75ad2ee4c190316f0c402f911cf87132245c8eac309
mode                       0755
regular file, not symlink  true
```

**This hash is now expected to match.** See the reproducibility proof below.

Sibling broker client, for completeness: `620104` bytes,
`e5b2e5404817a8498af12598d3443152f504e422a0decab1db9b2f4f5c45e751`.

## Reproducibility proof

Two builds of the frozen source `087d87a5`, into roots with **deliberately different name lengths**
so that both the determinism axis and the path-length axis are exercised:

```text
/home/sayo/.local/share/rasen-build/repro-a
/home/sayo/.local/share/rasen-build/repro-b-with-a-much-longer-root-name

helper sha256, build A   4835b1bbb54be9c7c186a75ad2ee4c190316f0c402f911cf87132245c8eac309
helper sha256, build B   4835b1bbb54be9c7c186a75ad2ee4c190316f0c402f911cf87132245c8eac309
verdict                  byte-identical
```

The embedded paths are now stable logical names, and no `mkdtemp` random survives in the binary:

```text
/rasen-linux-process-authority/crate/src/protocol.rs
/rasen-linux-process-authority/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/...

grep -c "source-snapshot|cargo-home-|authority-target-"   ->  0
```

## Relationship to the previously recorded hash

The earlier revision of this receipt recorded `94002604…` at 578312+128 = 578440 bytes. **That value
will not reproduce under the fixed build, and that is expected rather than a regression.** It was
produced by the pre-fix script, whose artifact embedded the per-build absolute paths; the new binary
is smaller because the logical prefixes are shorter than the real ones. The frozen source digest is
unchanged at `087d87a5` in both, so nothing bound to the freeze moved.

## Manifest verification — reparsed, not taken from the build output

```text
reserialized === file bytes       true
schema                            rasen-linux-process-authority-artifact/1
platform                          linux
arch                              x64
mode                              user-pidns
providerId                        rasen.linux.user-pidns
capabilityId                      rasen-recursive-process-scope/1
protocolVersion                   1
providerReferenceVersion          1
artifactFile                      rasen-linux-process-authority-helper
executableMode                    0755          (matches the real mode)
length                            578312        (matches first-hand)
sha256                            4835b1bb…     (matches first-hand)
compiler                          rustc 1.88.0 (6b00bc388 2025-06-23)
sourceSha256                      087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
ALL MANIFEST FIELD CHECKS PASSED  true
```

Provider manifest `dist/native/linux-process-authority/providers-linux-x64.json` also re-serializes
byte-identically and references `dist/native/linux-x64/rasen-linux-process-authority-helper` exactly,
with `commonContractVersion 1` and the ten frozen semantics.

## ELF shape

```text
file(1)   ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), static-pie linked, stripped
Class     ELF64
Type      DYN (Position-Independent Executable file)
Machine   Advanced Micro Devices X86-64
```

## Same-kernel execution

Invocation: the staged helper with argv `rasen-unknown-operation` and no stdin.

```text
process status   70
signal           null
stdout hex       525041310001ff0000000003000109
```

Decoded from the wire format:

```text
magic                RPA1
protocol version     1
frame kind           0xff   (failure)
reserved             0
payload length       3
payload version      1
failure code         9      -> authority-uncertain / native-state-retained
```

Identical to the pre-fix artifact's behaviour, which is the point: the remapping changes embedded
path strings, not conduct.

## Behavioural non-regression of the reproducibility fix

The three actual-kernel product oracles were re-run against this reproducible helper:

```text
 ✓ actual_wsl_published_inert_abort_keeps_workload_closed 191ms
 ✓ commit-before-ack: actual_wsl_replacement_recovers_commit_before_ack_as_published_inert 1906ms
 ✓ ack-before-activate: actual_wsl_replacement_recovers_ack_before_activate_as_published_inert 1636ms
 Test Files  1 passed (1)      Tests  3 passed (3)
```

A `--remap-path-prefix` change ought to be cosmetic, but "ought to be" is not evidence; this is.

## Source digest after all steps

```text
087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59   unchanged
```

---

## Appendix — generated build-authority.js

**Not part of what the receipt binds, and not covered by the independent artifact verification**,
which was scoped before this was added. Recorded so `F-L2-19` has a concrete starting point rather
than only a description.

```text
path      dist/core/session-host/process-authority/linux/build-authority.js
size      1106 bytes    mode 0644
sha256    ce043419eb3f914c2092e973b06a9c5d0bf11a9578e7030c8d0e3b7d93ebe306
```

Its two pinned identities are internally consistent with the artifact manifests verified above
(`4835b1bb…` for the helper, `e5b2e540…` for the broker client, both bound to `087d87a5`).

What changed for `F-L2-19`: those two pinned hashes are now **derivable** — anyone can rebuild and
confirm them. The remaining gap is narrower than before: the receipt still does not itself verify
this generated file, and its verification remains owed to someone other than the author.
