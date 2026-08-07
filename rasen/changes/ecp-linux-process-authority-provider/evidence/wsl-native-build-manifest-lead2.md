# WSL current-source native build and manifest receipt — LEAD #2 freeze

Date: 2026-08-07
Supersedes: `wsl-native-build-manifest-round-5.md`, whose `sourceSha256 49c327ca…` is four revisions
stale against the frozen tree.
Recorded results: **`wsl-native-build-manifest-lead2-results.md`** — a separate file, deliberately.
Do not open it until you have finished Step 7.

## Boundary

Closes **Task 7.2** and the Minor `PKG-P5` (stale implementation-evidence source digest) only.

Makes **no** claim about: any Section 7 mutation row, Section 9 installed-broker / cgroup-v2 authority,
package install support, distribution or the packaging matrix, production default provider selection,
`ProcessScope` / `SessionHost` integration, Change closure, `11.3`, or ECP-8 release truth.

**The artifact hash is reproducible.** `F-L2-15` has been fixed: two builds of the frozen source into
differently-named roots now produce byte-identical artifacts, and the command that demonstrates it is
in Step 8. An earlier revision of this receipt correctly recorded the hash as unverifiable; that
caveat no longer applies and the recorded value has changed accordingly. What this receipt binds and
does not bind is stated exactly at the end. See `F-L2-15`, `F-L2-18`, `F-L2-19`, `F-L2-20`.

## Frozen coordinates this receipt binds to

```text
sourceSha256 (26 files)   087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
```

Measured immediately before the build and again after the last verification step, unchanged.

## Environment

```text
WSL distribution    Ubuntu 24.04.1 LTS
kernel              Linux 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64
node                /usr/bin/node v22.21.0
rustc               rustc 1.88.0 (6b00bc388 2025-06-23)
cargo               cargo 1.88.0 (873a06493 2025-05-10)
RUSTUP_HOME         /home/sayo/.local/share/rasen-rustup-1.28.2
CARGO_HOME          /home/sayo/.local/share/rasen-cargo-1.28.2
host build-script linker  a private zig `cc` wrapper — see Step 1
final musl linker   the pinned Rust sysroot's rust-lld
target              x86_64-unknown-linux-musl
package root        /home/sayo/.local/share/rasen-build/track-b-pkg-r4
worktree            /mnt/e/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle
```

All build, temp, target and staging roots are on WSL ext4. None is on `/mnt/e`, whose DrvFS does not
preserve exact `0755`. **The source worktree itself stays on `/mnt/e` and does not need to move** —
the build script snapshots the source into its own temp root before compiling.

---

# Procedure — written to be executed by someone with no exposure to this change

## READ THIS FIRST — compute before you read

Recorded results live in a **separate file**, `wsl-native-build-manifest-lead2-results.md`. That is
deliberate: an instruction not to look ahead is unenforceable when the answers are on the same page.
Finish Step 7 before opening it.

Classify every fact you use into one of three buckets and say which bucket each came from:

| Bucket | Meaning | Allowed use |
| --- | --- | --- |
| **first-hand** | you computed or observed it yourself, in this run, before reading any stated value | the only bucket that can verify anything |
| **receipt-provided** | you read it from these documents | may be *compared against* a first-hand value, never substituted for one |
| **prior-knowledge** | you were told it in conversation or carry it from an earlier round | must be declared and set aside; the bucket most likely to produce false agreement |

**If a comparison disagrees, diagnose the disagreement and report your diagnosis. Do not reconcile
it. Never adjust an expected value so that a check passes.** A disagreement is information.

## Step 0 — record the environment

```sh
uname -a
cat /etc/os-release | head -3
/usr/bin/node --version
```

## Step 1 — pinned toolchain, and the missing host linker

This WSL has **no host C linker**: `cc`, `gcc`, `clang` and `musl-gcc` are all absent and there is no
`crt1.o`. A native build otherwise dies at `linker cc not found`. The unprivileged remedy is a private
wrapper **outside the repository** delegating to the pinned Zig at
`/home/sayo/.local/share/zig-x86_64-linux-0.16.0/zig`.

**Create your own wrapper directory** rather than reusing anyone else's:

```sh
W=/home/sayo/.local/share/rasen-build/<your-own-cc-dir>
mkdir -p "$W"
printf '#!/bin/sh\nexec /home/sayo/.local/share/zig-x86_64-linux-0.16.0/zig cc "$@"\n' > "$W/cc"
printf '#!/bin/sh\nexec /home/sayo/.local/share/zig-x86_64-linux-0.16.0/zig c++ "$@"\n' > "$W/c++"
chmod 0755 "$W/cc" "$W/c++"
```

A sibling `c++` wrapper is present in the directory this receipt's build used. It is not invoked by
this build; it exists for parity and is documented so its presence is not mistaken for a second
toolchain.

> **This path is build-affecting.** `hostLinkerPath` feeds `environmentSha256`, which feeds
> `releaseInputSha256`. A wrapper at a different path yields a different `releaseInputSha256` even
> from identical source. See Step 5's expectations.

```sh
export RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2
export CARGO_HOME=/home/sayo/.local/share/rasen-cargo-1.28.2
export PATH="$W:$CARGO_HOME/bin:$PATH"
rustc --version
cargo --version
```

Zig is only the **host build-script** linker. The final musl link uses the pinned Rust sysroot's
`rust-lld`. No `sudo`, no package installation, no profile or system configuration change.

## Step 2 — network

**The build requires working network access**: cargo fetches the locked dependency set on a cold
`CARGO_HOME`. It is not an offline build.

The inherited Windows proxy `127.0.0.1:7890` stalls inside WSL after CONNECT, so unset it **in the
build shell only**; never edit a profile or system network configuration:

```sh
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
```

Direct WSL access to crates.io works.

## Step 3 — compute the source digest first-hand

Replicate `sourceDigest()` from `scripts/build-linux-process-authority.mjs`.

**The source root is `native/linux-process-authority`, not the repository root**
(`build-linux-process-authority.mjs:11`, `const crate = path.join(root, 'native', 'linux-process-authority')`).
The repository root also contains a `src/`, so rooting the walk there produces a plausible but wrong
digest.

Within that crate the input set is exactly `Cargo.lock`, `Cargo.toml`, `THIRD_PARTY.md` and every file
under `src/`, sorted by relative POSIX path. Each file contributes, in order: its relative path, a NUL,
its contents, and **another NUL**.

> Two traps, both of which produce a plausible wrong value rather than an error:
> - the trailing NUL after the file contents (`build-linux-process-authority.mjs:115`) is easy to omit;
> - the digest is over **bytes on disk**. A CRLF working tree would change it. This repository's blobs
>   are LF and the worktree here is LF for these files.

Record your value. Expect 26 files.

## Step 4 — build

```sh
B=/home/sayo/.local/share/rasen-build/<your-own-fresh-dir>
rm -rf "$B" "$B-tmp"; mkdir -p "$B" "$B-tmp"; chmod 0755 "$B"
export RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT="$B"
export RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT="$B-tmp"
cd /mnt/e/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle
node scripts/build-linux-process-authority.mjs --target x86_64-unknown-linux-musl
```

Constraints the script enforces, so you do not lose time to them:

- `RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT` must be **outside** the worktree, or the build refuses.
- Build-affecting environment overrides are refused with
  `build-affecting environment override is forbidden`: `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`,
  `CARGO_BUILD_RUSTFLAGS`, `CARGO_TARGET_DIR`, `CC`, `CFLAGS`, `CXX`, `CXXFLAGS`, `LD`, `LDFLAGS`,
  `AR`, and any `CARGO_TARGET_*_{LINKER,RUNNER,RUSTFLAGS}`. Unset them before building.
- Do **not** set `RASEN_LINUX_PROCESS_AUTHORITY_STAGING_DIR` or `..._RELEASE_INPUT`. Mixing mutable
  staged input with the source-owned release input is refused by design.

Capture the whole stdout JSON; it is the build's own canonical receipt.

Then normalise modes, because umask and DrvFS can leave group/other-write, which the product's
`validateOwnedPath` rejects:

```sh
find "$B" -type d -exec chmod 0755 {} +
find "$B" -type f -exec chmod 0644 {} +
chmod 0755 "$B"/dist/native/linux-x64/rasen-linux-process-authority-helper
chmod 0755 "$B"/dist/native/linux-x64/rasen-linux-process-authority-broker-client
```

## Step 5 — verify the manifest independently

Do **not** trust the build's own JSON output. Reparse from disk and:

1. require `JSON.stringify(parsed) + "\n"` to equal the manifest file text byte-for-byte;
2. compute the artifact's length, sha256 and mode yourself from the file on disk;
3. compare every manifest field against those first-hand values and against the contract constants
   below;
4. reparse `dist/native/linux-process-authority/providers-linux-x64.json` the same way and confirm it
   references the exact helper path.

Contract constants for the primary helper, so you do not need any recorded result to check them.
Their sources: `providerId`, `capabilityId`, `protocolVersion`, `providerReferenceVersion` and
`commonContractVersion` come from `LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR` in
`src/core/session-host/process-authority/linux/contracts.ts`; the manifest `schema` string is
`LINUX_PROCESS_AUTHORITY_ARTIFACT_SCHEMA` in
`src/core/session-host/process-authority/linux/artifact-resolver.ts:19`; the emitter is
`build-linux-process-authority.mjs:426-447`.

```text
schema                    rasen-linux-process-authority-artifact/1
platform                  linux
arch                      x64
mode                      user-pidns
providerId                rasen.linux.user-pidns
capabilityId              rasen-recursive-process-scope/1
protocolVersion           1
providerReferenceVersion  1
commonContractVersion     1        (provider manifest only)
artifactFile              rasen-linux-process-authority-helper
executableMode            0755
compiler                  rustc 1.88.0 (6b00bc388 2025-06-23)
```

Also establish the ELF shape yourself with `file` and `readelf -h`.

## Step 6 — execute that exact ELF on this kernel

The invocation used by this receipt was exactly:

```sh
"$B"/dist/native/linux-x64/rasen-linux-process-authority-helper rasen-unknown-operation
```

with **no stdin** (an immediately-closed pipe; `< /dev/null` is equivalent) and no other arguments.
Any unrecognised operation name reaches the same argv-validation arm, but only this one was executed
for this receipt — if you use a different name, say which.

**Record the process status and the full response frame as hex before reading anything further.**
Then decode the frame yourself from the wire format rather than matching it against a stored string:

```text
bytes 0-3    ASCII magic
bytes 4-5    u16 BE protocol version
byte  6      frame kind (0xff = failure)
byte  7      reserved
bytes 8-11   u32 BE payload length
payload      u16 BE version, then one byte failure code
```

Map the failure code through `failureOutcome()` in
`src/core/session-host/process-authority/linux/native-assembly.ts:482-500`.

## Step 7 — recompute the source digest

Repeat Step 3. If it moved, the receipt is unbindable; say so rather than reporting it as bound.

## Step 8 — prove reproducibility yourself

Repeat Step 4 into a **second root with a deliberately different name length**, then compare the two
helper artifacts:

```sh
B2=/home/sayo/.local/share/rasen-build/<a-noticeably-longer-second-dir-name>
rm -rf "$B2" "$B2-tmp"; mkdir -p "$B2" "$B2-tmp"; chmod 0755 "$B2"
RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT="$B2" \
RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT="$B2-tmp" \
  node scripts/build-linux-process-authority.mjs --target x86_64-unknown-linux-musl

sha256sum "$B"/dist/native/linux-x64/rasen-linux-process-authority-helper \
          "$B2"/dist/native/linux-x64/rasen-linux-process-authority-helper
```

The two hashes must be identical. Differing name lengths matter: the historical defect was sensitive
to path *content* while artifact length was not, so equal-length roots would have under-tested it.

You can also confirm no per-build path survives in the binary:

```sh
strings -a "$B"/dist/native/linux-x64/rasen-linux-process-authority-helper \
  | grep -c "source-snapshot\|cargo-home-\|authority-target-"
```

Expect `0`.

## What you should expect to match

**Now open `wsl-native-build-manifest-lead2-results.md`** and compare. You should expect these to
match:

- the **source digest**;
- the **artifact sha256 and length** — these are now reproducible, which is the whole point of
  Step 8;
- **manifest self-consistency** — canonical re-serialization, and every field against the artifact on
  disk;
- the **contract constants** above;
- the **ELF shape**;
- the **compiler identity**;
- the **protocol behaviour** — process status and the decoded frame.

You should **not** expect this to match:

- the **`releaseInputSha256`**, *if* your host linker wrapper lives at a different path than the one
  this receipt used. It incorporates `environmentSha256`, which records `hostLinkerPath` — and that
  is deliberately not remapped, because provenance should say which linker actually ran. Two builds
  sharing a wrapper path do reproduce it identically.

If anything differs, that is in-scope and interesting: **diagnose why before concluding anything**,
and report your diagnosis rather than a bare mismatch.

> Historical note, now only of forensic interest: before the fix, artifact **length** was insensitive
> to build-path length (identical at root-name lengths 16, 18 and 20, absorbed by ELF section
> padding) while the **hash** was not. So under the old build a matching length with a differing hash
> was the expected outcome. Under the fixed build both match.

---

# What this receipt binds

- The frozen source digest `087d87a5`.
- Manifest self-consistency and canonical form, verified by reparse.
- Adjacent-manifest identity: the manifest describes the artifact that sits next to it.
- Compiler identity and target.
- ELF shape: static-PIE ELF64 x86-64, stripped.
- Same-kernel executable truth: that exact binary ran on this WSL kernel and answered the closed
  protocol correctly.
- The artifact length and sha256, **reproducibly** — rebuilding `087d87a5` anywhere with this
  toolchain yields the same bytes.

## What this receipt does not bind

- **`releaseInputSha256` across differing linker paths.** It incorporates `environmentSha256`, which
  records `hostLinkerPath`. That path is deliberately *not* remapped: provenance should record which
  linker actually ran. Two builds sharing a wrapper path reproduce it identically; a wrapper
  elsewhere changes it.
- **The generated `build-authority.js`.** This receipt verifies the artifact manifests but does not
  verify the generated
  `dist/core/session-host/process-authority/linux/build-authority.js`, which is the file that
  actually pins build authority into the shipped program. Recorded as `F-L2-19` — narrowed but not
  closed by the reproducibility fix: the hashes it pins are now derivable, but this receipt still
  does not verify the file itself.

## The reproducibility fix (`F-L2-15`, closed)

`scripts/build-linux-process-authority.mjs` now passes `--remap-path-prefix` for each of its three
private roots — the source snapshot, the private cargo home, and the target directory — mapping them
to stable logical names.

Of those three, **only two are load-bearing, and that was measured rather than assumed.** Counting
embedded occurrences in the pre-fix artifact: source snapshot 1, private cargo home 1, target root
**0**. The target root was never embedded, so remapping it changes nothing today; it is kept as cheap
insurance in case a future change makes `OUT_DIR` or debug paths reachable, and is recorded here as
deliberate-but-inert rather than left to look like it is doing work. Remapping was chosen over deterministic directory names because
deterministic names would reintroduce collision and TOCTOU risk between concurrent builds; the
`mkdtemp` roots stay fresh, unguessable and `0700`, and only the *embedded strings* become stable.

The flags are set inside the script via `CARGO_ENCODED_RUSTFLAGS` (the encoded form, so private roots
containing spaces are safe). `rejectBuildEnvironmentOverrides()` is **unchanged** and still refuses an
inherited `RUSTFLAGS`/`CARGO_ENCODED_RUSTFLAGS` from a caller — the fix is inside the trusted script,
not a hole opened in the guard.

This does not move the freeze: `sourceDigest()` covers only
`native/linux-process-authority/{Cargo.lock,Cargo.toml,THIRD_PARTY.md,src/**}`, and `scripts/` is
outside that set. `087d87a5` is unchanged, verified before and after the change, and
`native/linux-process-authority/**` was not touched.

## Correction to an earlier statement in this receipt

An earlier revision said the pinned `sha256` lives in
`src/core/session-host/process-authority/linux/build-authority.ts`. **That is wrong.** That source
file is `Object.freeze([])` and pins nothing; its own comment says build-pinned authority is generated
by packaging. The hashes exist only in the **generated** `dist/.../build-authority.js`. The correction
matters because it is the difference between "a committed constant a reviewer can read" and "a build
output nobody can re-derive".

## Known provenance gaps in the build script (not defects in this build)

- **`F-L2-18`** — the script records `hostLinkerKind: 'cc'` because the wrapper is *named* `cc`, so
  machine-readable provenance never records that Zig performed the host link, and
  `linker.executableSha256` fingerprints the 75-byte shell wrapper rather than the Zig binary it
  delegates to.
- **`F-L2-19`** — as above, the generated `build-authority.js` is unverified by this receipt.

# Verification split

- **Independent artifact verification** — re-hash the exact staged binary at
  `/home/sayo/.local/share/rasen-build/track-b-pkg-r4`, re-execute it on this kernel, and confirm the
  receipt binds `087d87a5`. This verifies the same bytes rather than a rebuild.
- **Clean-room execution** — run the procedure above from scratch with no prior exposure to this
  change, and report what matches, what does not, and the diagnosis of any difference.

The author of this receipt is not its verifier for either half.
