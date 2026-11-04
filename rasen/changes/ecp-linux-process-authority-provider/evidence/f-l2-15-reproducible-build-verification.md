# F-L2-15 — independent verification that the Linux helper build is byte-reproducible

Date: 2026-08-07
Verifier: `track-a-native` (non-author). The fix was written by `track-b-ts-oracle`.

## Verdict

**VERIFIED.** Two builds of the frozen source `087d87a5`, into roots whose names differ by 41
characters, produced **byte-identical** helper artifacts. The same holds for the sibling broker
client. Both artifacts execute correctly on this WSL kernel, and no per-build path survives in either
binary.

This is the first independently-verified reproducible build on this change. Before the fix, no
shipped Linux artifact could be confirmed to correspond to its claimed source by anyone other than
the machine that built it.

## Boundary

This receipt verifies **reproducibility of the artifact bytes**, plus the manifest, ELF shape,
compiler identity and same-kernel protocol behaviour of the artifacts I built. It closes no task.

It does **not** verify clean-room reproducibility of Track B's written procedure from scratch — that
half was a separate agent's assignment — and it does not verify the generated
`dist/core/session-host/process-authority/linux/build-authority.js`, which remains `F-L2-19`.

`scripts/` is outside `sourceDigest()`, so this work did not touch the freeze. No file under
`native/linux-process-authority/**` was modified; verified by mtime and by digest.

## Environment

```text
uname -a   Linux Sayo 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64
distro     Ubuntu 24.04.1 LTS
node       v22.21.0
rustc      1.88.0 (6b00bc388 2025-06-23)
cargo      1.88.0 (873a06493 2025-05-10)
RUSTUP_HOME /home/sayo/.local/share/rasen-rustup-1.28.2
CARGO_HOME  /home/sayo/.local/share/rasen-cargo-1.28.2
host cc     /home/sayo/.local/share/rasen-build/ta-verify-cc   (my own, created per Step 1)
target      x86_64-unknown-linux-musl
```

Unprivileged throughout. No package install, no profile or system change. Proxy variables unset in
the build shell only.

## Frozen digest — checked before, during and after

```text
before any build      087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59   26 files
Step 3 (first-hand)   087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
Step 7 (recompute)    087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
after all checks      087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
```

Unchanged at every checkpoint. No file under the crate has an mtime later than 01:30, well before
this verification began.

## The two builds

```text
build ONE  /home/sayo/.local/share/rasen-build/tv1                                    root name length 39
build TWO  /home/sayo/.local/share/rasen-build/tv-second-root-deliberately-much-longer-name
                                                                                      root name length 80
gap        41 characters
```

Both roots are my own and **neither matches Track B's** (`repro-a`,
`repro-b-with-a-much-longer-root-name`), so this is an independent reproduction rather than a repeat
of the same two paths.

### Result

```text
helper sha256, build ONE   4835b1bbb54be9c7c186a75ad2ee4c190316f0c402f911cf87132245c8eac309
helper sha256, build TWO   4835b1bbb54be9c7c186a75ad2ee4c190316f0c402f911cf87132245c8eac309
helper length              578312   (both)   mode 0755 (both)
cmp                        IDENTICAL — 0 differing bytes

broker-client, build ONE   e5b2e5404817a8498af12598d3443152f504e422a0decab1db9b2f4f5c45e751   620104 bytes
broker-client, build TWO   e5b2e5404817a8498af12598d3443152f504e422a0decab1db9b2f4f5c45e751   620104 bytes
```

### Why this is a strong result rather than a coincidence

The two builds genuinely took **different random paths**. From the compiler's own output:

```text
build ONE  .../tv1-tmp/rasen-linux-authority-source-snapshot-EFs5UX/crate
build TWO  .../tv-second-root-...-name-tmp/rasen-linux-authority-source-snapshot-xN2jHp/crate
```

The `mkdtemp` randomness that caused `F-L2-15` is **still present** — the roots remain fresh,
unguessable and `0700`, so the collision and TOCTOU properties they exist for are preserved. It
simply no longer reaches the binary. That is the correct shape for this fix, and it is only visible
by looking at the build's own path output rather than at the hashes alone.

## Three checks beyond hash equality

The bare check specified for this verification was "build twice, compare hashes". Three additions
were proposed and approved before the run, because hash equality alone cannot see certain failures.

### 1. Execution — guards against "reproducible but broken"

A fix that makes builds reproducible while breaking the binary passes a pure hash comparison
perfectly: two identical, identically-broken artifacts. Path remapping touches what the compiler
embeds, so this is a live risk rather than a hypothetical one.

Both artifacts were executed on this kernel with argv `rasen-unknown-operation` and no stdin:

```text
build ONE   exit=70   len=15   stderr=[]   hex=525041310001ff0000000003000109
build TWO   exit=70   len=15   stderr=[]   hex=525041310001ff0000000003000109
cmp of the two response frames: IDENTICAL
```

Decoded from the wire format independently, not matched against a stored constant: magic `RPA1`,
protocol version 1, frame kind `0xff` (failure), reserved 0, payload length 3, payload version 1,
failure code 9 → `StateRetained` / native-state-retained. **Reproducible and still correct.**

### 2. Embedded-path scan — establishes *why* it matches

```text
strings -a <helper> | grep -c "source-snapshot\|cargo-home-\|authority-target-"
build ONE  0
build TWO  0
```

What is embedded instead is the stable logical prefix `/rasen-linux-process-authority`.

### 3. The pass-for-the-wrong-reason check

The failure mode a bare hash comparison structurally cannot see: **hashes matching while a build path
is still embedded**, which would mean the two roots collided in some normalised form rather than the
path being eliminated. Checked directly:

```text
pattern [tv1]                          build ONE 0   build TWO 0
pattern [tv-second-root-deliberately]  build ONE 0   build TWO 0
pattern [ta-verify-cc]                 build ONE 0   build TWO 0
pattern [/home/sayo]                   build ONE 0   build TWO 0
```

No host absolute path of any kind survives in either binary. The paths are genuinely eliminated, so
the match is for the right reason.

## An axis Track B could not establish

Both of Track B's builds shared one host linker wrapper path, so their two-build proof was
**structurally incapable** of showing invariance to it. Mine was at a different path
(`ta-verify-cc`, created per Step 1's instruction to use your own) and the artifact hash still
matched theirs exactly.

The artifact is therefore invariant to the **host linker wrapper path** as well as to the build root.
Combined across both agents, the artifact now reproduces across **4 distinct roots and 2 distinct
wrapper paths, verified by 2 independent agents**.

## `releaseInputSha256` — the carve-out, corroborated rather than accepted

```text
mine     42e88421863c15a6cfcfcca5a036b4a1af52dac7736a70f8ea6bdc0442b4b001   identical across MY two builds
theirs   14f041c71aae25322469d9af7d90f1f252d8ad461108e4c7780cde2e5ed35ca8   identical across THEIR two builds
```

It differs **between** us and is stable **within** each of us. That is precisely the signature of a
value determined by `hostLinkerPath` — which feeds `environmentSha256`, which feeds
`releaseInputSha256` — and not of residual nondeterminism. The cross-agent difference is therefore
positive evidence for their stated attribution rather than an unexplained mismatch.

This is the documented carve-out, not a discrepancy. Track B deliberately did **not** remap
`hostLinkerPath`, on the grounds that provenance should record which linker actually ran; remapping
it would trade a real fact for a cosmetic match. That reasoning is sound and I did not challenge it.

Confirmed as asked: the carve-out is stated **in the receipt itself**, in *What you should expect to
match* and again in *What this receipt does not bind*, plus a third note in the results file — not
only in a message.

## Manifest, ELF and compiler

Reparsed from disk rather than taken from the build's own JSON. On **both** builds:
`ALL MANIFEST FIELD CHECKS PASSED: true` — canonical reserialization byte-equal to the file text;
`length`, `sha256` and `executableMode` each equal to the first-hand values computed from the file;
artifact a regular non-symlink; and every contract constant matching (`schema`, `platform`, `arch`,
`mode`, `providerId`, `capabilityId`, `protocolVersion`, `providerReferenceVersion`, `artifactFile`,
`executableMode`, `compiler`). The provider manifest also re-serializes byte-identically, references
`dist/native/linux-x64/rasen-linux-process-authority-helper` exactly, and carries
`commonContractVersion 1`.

```text
file(1)   ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), static-pie linked, stripped
Class     ELF64      Type  DYN (Position-Independent Executable file)
Machine   Advanced Micro Devices X86-64
```

Compiler identity read from the **artifact bytes**, not the manifest:
`rustc/6b00bc3880198600130e1cf62b8f8a93494488cc` and `1.88.0`.

## Relationship to the previously recorded hash

`94002604…` at 578440 bytes does not reproduce under the fixed build, and that is **expected, not a
regression**. 578440 − 578312 = 128 bytes, the difference between the real absolute paths and the
shorter logical prefixes. The frozen source digest is `087d87a5` in both, so nothing bound to the
freeze moved.

## Procedure quality — no defect

**I needed to ask the author nothing.** Steps 0-8 were self-contained, including every trap that
would otherwise have cost time: the source root being the crate rather than the repository root, the
trailing NUL in `sourceDigest()`, the refused build-affecting environment overrides, `TEMP_ROOT`
having to be outside the worktree, and the mode normalisation `validateOwnedPath` requires.

Track B's decision to split recorded results into a **separate file**, so that compute-before-read
ordering is enforced by file boundary rather than by an honour-system instruction on the same page,
is the right design. It worked as intended for the clean-room verifier.

## Disclosure — the compute-before-read control was defeated, and not by its author

Track B's file-boundary control worked. **It was then defeated in the dispatch channel it could not
reach:** the LEAD's GO message contained Track B's helper hash, the artifact length, and "surviving
mkdtemp randoms: 0" before I had built anything. So my values, though computed by actually running
two builds, were not derived in ignorance of the expected answer.

The contamination is **inert in this specific case**, because knowing a target hash cannot make a
compiler emit it — I either produce two identical digests or I do not, and the check is mechanical.
That is a reason the result stands, **not** a reason the ordering claim is intact. It is weaker here
than in the Task 7.2 verification, where the same verifier declared prior exposure before starting
and the LEAD split the work in response.

Recorded because the general lesson survives this instance being harmless: a verification protocol
enforced inside a document can be destroyed by an orchestrator being helpful in the dispatch. Relay
*what to check*, not *what the answer is*. Tracked as `F-L2-20`.

## Reproduction

```sh
W=/home/sayo/.local/share/rasen-build/ta-verify-cc            # own wrapper, per Step 1
export RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2
export CARGO_HOME=/home/sayo/.local/share/rasen-cargo-1.28.2
export PATH="$W:$CARGO_HOME/bin:$PATH"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS CARGO_BUILD_RUSTFLAGS CARGO_TARGET_DIR \
      CC CFLAGS CXX CXXFLAGS LD LDFLAGS AR

for B in /home/sayo/.local/share/rasen-build/tv1 \
         /home/sayo/.local/share/rasen-build/tv-second-root-deliberately-much-longer-name; do
  rm -rf "$B" "$B-tmp"; mkdir -p "$B" "$B-tmp"; chmod 0755 "$B"
  RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT="$B" \
  RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT="$B-tmp" \
    node scripts/build-linux-process-authority.mjs --target x86_64-unknown-linux-musl
done

sha256sum */dist/native/linux-x64/rasen-linux-process-authority-helper   # must be identical
```

Both `dist` outputs retained at the two roots; the large temp/snapshot roots were removed.
