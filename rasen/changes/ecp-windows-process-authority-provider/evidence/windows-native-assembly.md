# The Windows native assembly: closing the gap 9.7 and `S8-F7` named

Date: 2026-08-07\
Author: implementer (native assembly), single leaf worker\
Host: Windows 11 Pro 10.0.26200, x64, native, no WSL. Node `v24.14.0`.

`src/core/session-host/process-authority/windows/native-assembly.ts` did not exist. Because it did
not, the production factory wired `unavailableNativeAssembly()` with the placeholder digests
`'e'.repeat(64)` / `'f'.repeat(64)`, and every receipt in Sections 8 and 9 reached the kernel
through the helper CLI or the crate library rather than through anything this package ships.

It exists now, the production factory is wired to it, and **the shipped TypeScript path prepares,
publishes, inspects, terminates, aborts and recovers a real Job-object authority on this kernel**.
Activation and the runtime bridge do not, for a reason that is stated precisely below and is a
property of the frozen helper's command surface, not of this layer.

## Bindings

```text
crate source          fc49a7c2c5f9642fa976d16f06e167a39bdbe3c751686f417722273aea891c27
                      re-measured by `node scripts/build-windows-process-authority.mjs --plan`
                      at the end of this unit; unchanged, no byte written under native/**
packaged helper       367666f6d4151b5092b528abd2c8256d48fd96d73436184b54ae1897e55d8a6b   258560 B
packaged guardian     d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f   254464 B

src/.../windows/native-assembly.ts   32814 B  38ab2041733af978094740927593ec1c70cf29585ecfd9db4e4c9e9922d34eb0
src/.../windows/provider.ts          36294 B  a3ea10ae2b23117a513d3d6ebce394b28716efeb8ea7538884037f3330632a23
test/.../windows-process-authority-provider.test.ts
                                     36887 B  12dd0e8acc63def8ae1ad6b03e81e9288b70295c3ca18a65d0d58a61e84f266e
```

Artifact byte length is not a change signal on this change family (`F-L2-14`); every identity above
is a SHA-256.

### The package root every runtime receipt below was taken against

`S8-F2` says a TypeScript build wipes `dist/native/**` and resets the generated build-authority
table, so nothing here builds into the repository. A complete package root was assembled **outside**
the repository from byte-identical copies of the packaged pair and the generated table, with the
sources compiled into a scratch output directory:

```text
tsc --outDir <scratch>/wna-build --declaration false --declarationMap false --sourceMap false
<scratch>/wna-pkg/package.json                     {"type":"module"}
<scratch>/wna-pkg/dist/**                          <- the scratch compile
<scratch>/wna-pkg/dist/core/.../build-authority.js <- copied from dist/, pins 367666f6 / fc49a7c2
<scratch>/wna-pkg/dist/native/win32-x64/**         <- copied from dist/, verified byte-identical
```

`createWindowsNativeAssembly` derives its package root from `import.meta.url` exactly as the Linux
sibling does, so from that tree the **production** resolver -- not the `...ForTesting` twin -- binds
the packaged helper. The repository's own `dist/` was read from and never written to.

## What the assembly does, and how it maps to the Linux sibling

Same shape: resolve the packaged helper once, then run it as a short-lived process per verb and
translate its output into the closed outcome vocabulary. Three differences are forced by the two
helpers' surfaces.

| Concern | `linux/native-assembly.ts` | `windows/native-assembly.ts` |
| --- | --- | --- |
| artifact pin | inherited descriptor, `spawn('/proc/self/fd/3', ...)` | Windows cannot execute from a descriptor. The pin is the resolver's before/after device-inode-digest check **plus** the helper hashing its own image (`cli.rs:measure_own_artifact`) and `createPreparedReference` refusing any attestation whose `artifactSha256` differs. The binding is closed by the program that ran, not only by the file inspected |
| wire | binary frames on the helper's stdio | the helper's CLI prints lines: `RWA1-ATTESTATION canonical <json>`, `RWA1-PROBE <key=value>...`, `RWA1-OBSERVATION <hex>` |
| completion | `close` can be held open by a lifetime-bound grandchild, so Linux waits on `exit` plus stream ends | the guardian is launched with an explicit two-handle inherit list (`cli.rs:spawn_guardian`), so it never holds the helper's stdout. `close` is exact, and `S8-F5`'s inherited-handle trap has no counterpart here |
| runtime bridge | `open-runtime` copies frames verbatim | **refused** -- see below |

Verb by verb:

- **prepare** runs `prepare --operation --state-root --executable --cwd [--arg]* [--env]*
  [--verbatim-arguments]`, parses the canonical attestation line, and returns
  `{ state: 'inert', attestation }`. A non-zero exit maps through a closed table onto the eight
  enumerated prerequisites of task 4.8; anything unrecognised is a loud rejection, never a quiet
  "prerequisites unavailable".
- **probeIdentity** runs `probe-identity --stage <stage>` and translates the flat line into the
  object `parseWindowsAuthorityIdentityProbe` consumes. This is the adapter 9.8's fourth observation
  named as missing: before it, the only producer of that object anywhere was the test fixture.
- **inspect / terminate / abort** run `control --verb ...` and decode
  `guardian.rs:encode_observation` field by field. A terminating verb returns
  `exact-scope-empty` only when the decoded payload carries phase 4 **and** the flag the guardian
  sets only from the authority's own `ACTIVE_PROCESS_ZERO` message with a complete history.
- **attemptGraceful** returns `{ state: 'not-observed' }`. There is no verb that closes the root's
  standard input, and the graceful interval is delivered natively instead -- `terminate` passes
  `--grace-ms` and the guardian waits it out. The provider discards this result either way, so
  reporting a quiet interval as an observation would add a claim with nothing behind it.
- **activate** and **openRuntime** are refused. See "What is deliberately not implemented".

## The defect this unit found by running production code

### `S10-F1` (Blocker, fixed here) -- the two launch digests used different domain separation

`provider.ts:digestWindowsAuthorityLaunch` prefixed its preimage with `RPW1`.
`launch.rs:canonical_bytes` prefixes with `RWL1`, and `guardian.rs:524` digests the launch it was
actually given. `createPreparedReference` requires the attested `launchDigest` to equal the one the
provider computed, so **no attestation any real helper can produce could ever have been accepted**:
production `prepare` would have thrown
`Windows process-authority prepare attestation identity binding differs.` on every healthy host.

Every field after the four magic bytes already agreed -- the length prefixes, the field order, the
verbatim flag byte, and the environment ordering (`BTreeMap<String, String>` is byte-lexicographic
on UTF-8, and `snapshotLaunch` sorts with `Buffer.compare` on the UTF-8 bytes). Only the prefix
differed.

**No test could find this.** Every existing assertion on the launch digest computes its expected
value with the same function it is testing (`windows-process-authority-provider.test.ts:127`,
`:209-212`, `:618`, `:635`, `:655`), so both sides moved together. The two producers had never been
compared because nothing had ever produced both. It is the fourth Blocker-class defect on this
change family found by running production code against a real kernel and the first found on the
TypeScript side.

Fixed by aligning the TypeScript constant to the frozen crate, which is the only possible direction.
RED/GREEN below (`M1`).

## Findings that are recorded, not fixed

### `S10-F2` (Major) -- the helper and the attestation render the boot identity differently

`cli.rs:probe_identity` prints `bootIdentity=<32 plain hex characters>`.
`attestation.rs:to_canonical_json` projects the same 16 bytes as dashed GUID text, and the private
reference carries that. `classifyWindowsAuthorityRecovery` compares the probe's rendering against
the reference's **first**, before any identifier is compared, so passing the probe value through
unchanged makes every healthy authority read as boot drift.

The assembly converts the probe rendering to the reference rendering. Both are lossless renderings
of the same bytes, so a genuinely different boot identity still compares unequal -- `M2` below shows
the conversion is load-bearing and not cosmetic. The durable fix belongs in the crate: one producer,
one rendering.

### `S10-F3` (Major) -- `recovery.ts`'s probe model cannot express two things the helper says

1. **`state=identity-drift`.** The helper decides that the referenced guardian identifier is
   occupied by a different process, and prints no observed birth identity. `WindowsAuthorityIdentityProbe`
   has no `identity-drift` member, and an `authority-present` object could only be built by inventing
   the tuple. The assembly reports `control-loss` carrying the `identity-drift` diagnostic code, so
   the cause survives into the receipt while nothing is fabricated. **The contract's `identity-drift`
   state is therefore unreachable through this transport** until `recovery.ts` adds that member to
   the probe union and to `PROBE_RETAINED_KEYS`'s accepted states. That is a one-member change and it
   was deliberately not made here.
2. **`terminalRecord`.** The helper's durable record is
   `RWJ1 <sequence> exact-scope-empty <detail>` (`journal.rs`), carrying no scope id, generation,
   boot identity or sole-handle attestation. `classifyWindowsAuthorityRecovery` compares all four
   against the reference before accepting a `durable-terminal-record` receipt, so filling them from
   the reference would make that comparison vacuous and manufacture `exact-scope-empty`. The
   assembly reports `null`, which leaves the corroborated last-handle rule as the only route to an
   empty receipt -- strictly the more conservative of the two, and measured working below.
   Consequence: the `durable-terminal-record` basis and the `event-gap / ledger-conflict` branch are
   both unreachable through this transport.

### `S10-F4` (boundary, measured) -- `pre-open` cannot carry the full tuple, and no handle can span two reads

The helper's `pre-open` verb deliberately opens no handle, so it reports the guardian half and the
endpoint's mere existence -- not `endpointServerProcessId`, `endpointOwnerSid` or
`endpointAuthentication`, all three of which `recovery.ts` requires of a present probe:

```text
pre-open   RWA1-PROBE state=authority-present stage=pre-open bootIdentity=... bootIdentitySource=...
           soleHandleAttestation=... guardianProcessId=47760 guardianCreationTime=134305800648341538
           endpointPresent=true
post-open  RWA1-PROBE state=authority-present stage=post-open bootIdentity=... bootIdentitySource=...
           soleHandleAttestation=... guardianProcessId=47760 guardianCreationTime=134305800648341538
           endpointServerProcessId=47760 endpointOwnerSid=S-1-5-21-... endpointAuthentication=authenticated
```

So the pre-open stage is the pre-open verb proving the guardian's birth identity with no handle
open, followed by a second helper process that opens the endpoint and reads the rest. Every value
still comes from the kernel; none is completed from the reference.

What that does **not** reproduce is Decision 9's literal ordering, in which one process holds its
handles across both reads. It cannot: each helper process closes its handles when it exits, so no
handle can span two invocations of a short-lived CLI. The ordering that does hold is the one the
helper enforces inside `control`, which connects, rereads the complete tuple through its own open
handles, and refuses to issue anything on a difference (`cli.rs:606`). Anyone reading the two
TypeScript probes as the mandatory reread of task 7.4 would be reading them wrong.

### `S10-F5` (boundary, measured) -- the classification right after a terminal receipt is timing-dependent

Three rounds of prepare, abort through the production provider, then repeated production `inspect`:

```text
round 0 abort=exact-scope-empty inspects=[326ms:control-loss 557ms:control-loss 808ms:exact-scope-empty
                                          1010ms:exact-scope-empty 1213ms:exact-scope-empty 1418ms:exact-scope-empty]
round 1 abort=exact-scope-empty inspects=[280ms:exact-scope-empty ... 1275ms:exact-scope-empty]
round 2 abort=exact-scope-empty inspects=[243ms:exact-scope-empty ... 1270ms:exact-scope-empty]
```

This is `S8-F6` reproduced through the TypeScript path: while the exited guardian's process object
is still resolvable, the pre-open probe answers `authority-present`, the completing post-open probe
cannot connect, and the provider retains `control-loss`; once the object is released the probe
answers `authority-absent` and the corroborated last-handle rule yields `exact-scope-empty`. Both
answers fail closed and neither fabricates a receipt, but a caller that re-inspects immediately
after a terminal receipt will sometimes get uncertainty about an authority that is provably empty.

## What is deliberately not implemented, and why

**`openRuntime` throws and `activate` returns typed `authority-unavailable / control-unavailable`.**

The only verb that sends an `Activate` frame is `control --verb run`, which also opens the runtime
bridge and then de-multiplexes the workload's output onto the helper's own stdout and stderr, mixed
with its own `RWA1-OBSERVATION` and `root-exited` lines. A bridge over it would have to recover the
receipt from bytes the workload can also write, so **a workload that printed
`RWA1-OBSERVATION 0404...` could forge an exact-scope-empty receipt** -- the one failure the
Record-must-not-lie invariant forbids outright. The verb also never forwards standard input, so the
bridge could not be exact even if the receipts were safe.

Per the dispatch's instruction, this is reported rather than worked around, and **no byte was
written under `native/windows-process-authority/**`**. What the crate needs is the Linux sibling's
shape: a verb that copies protocol frames verbatim between the authenticated endpoint and its own
stdio, leaving de-multiplexing to this layer. That is also what task 5.5 asks for and what would
make 9.8's Leg D complete.

## Mutation receipts

Every claim below owes a demonstrated failing counterpart. Each row mutates one line of the shipped
source, rebuilds the out-of-repo package root, re-runs the identical scenario, and restores the
source byte-exactly. The restored digests are the ones recorded under Bindings.

Baseline, and the GREEN restored at the end of the matrix (identical both times):

```text
prepare=ok guardian=37264 launchDigest=ef9d6c56
inspect-prepared=prepared-inert
publish=rasen-process-authority-publication/1
inspect-published=published-inert
abort=exact-scope-empty
prepare-b=ok
terminate=exact-scope-empty
guard-empty-argument=THROW ... cannot carry a launch argument through the helper command line.
guard-double-dash-argument=THROW ... cannot carry a launch argument through the helper command line.
```

| # | Claim | Mutation | Measured RED |
| --- | --- | --- | --- |
| M1 | the two launch digests agree, and that agreement is what lets a real attestation bind | `RWL1` back to `RPW1` in `digestWindowsAuthorityLaunch` | `prepare=THROW Windows process-authority prepare attestation identity binding differs.` for both authorities; every downstream row disappears |
| M2 | the boot-identity rendering conversion is load-bearing | `guidTextFromHex` joins with `''` instead of `'-'` | `inspect-prepared`, `inspect-published`, `abort`, `terminate` all become `identity-drift` on a healthy authority |
| M3 | the exact-empty receipt is read from the decoded payload, not from the exit status | `PHASE_EXACT_SCOPE_EMPTY` 4 to 9 | `abort=control-loss`, `terminate=control-loss` while the helper still exits 0 |
| M4 | the pre-open tuple completion is what makes any control verb reachable | force the pre-open branch to return the untranslated probe | `inspect-prepared`, `inspect-published`, `abort`, `terminate` all become `control-loss`; `prepare` still succeeds |
| M5 | the untransportable-launch guard prevents a silently different launch | `transportable()` returns its input unchecked | both guard rows change from a refusal before spawning to `THROW ... prepare attestation identity binding differs.` -- the helper accepted the command line and the guardian digested a **different** launch |

`M4` is not a hypothetical: it is the state this assembly was actually in on its first run against
the kernel. Every control verb returned `control-loss` while `prepare` succeeded, and the raw helper
output is what showed the pre-open line was missing three fields. The mutation reproduces that
measured failure rather than inventing one.

Two further discriminators live in the suite rather than in the matrix:

- the rewritten `binds the resolved artifact identity rather than a placeholder` row flips one byte
  of the resolved image and requires `hash differs from its manifest`, so the declared identity is
  bound to those bytes and not merely to a manifest that claims them;
- `retains on every control verb and never answers with a lifecycle receipt` asserts the retained
  outcome is never `exact-scope-empty`, `live`, `root-exited`, `prepared-inert` or
  `published-inert`, which is the contract rather than the wiring.

## What now crosses a real Windows kernel through the TypeScript production path

Driven by a plain Node driver whose only job is to call `createWindowsProcessAuthorityProviderBundle`
and print what it returned. No vitest, no fixture, no injected transport, no recording stand-in.

```text
descriptor            rasen.windows.job-object / rasen-recursive-process-scope/1 / protocol 1

A prepare             ok. guardian=41628 birth=134305802293038940
                      bootIdentitySource=nt-system-boot-environment-information
                      jobLimitMask=8192  activeProcessCountAtPortAssociation=0
                      launchDigest=ef9d6c56a3c4844afa9b4bbca6527bf67ef23a81808d1b1ec685111f8978018d
                      artifactSha256=367666f6...  sourceSha256=fc49a7c2...
A inspect (prepared)  {"state":"prepared-inert"}
A publish             {"schema":"rasen-process-authority-publication/1", ...}
A inspect (published) {"state":"published-inert"}
A activate            {"state":"authority-unavailable", "diagnostic":"... (control-unavailable)."}
A openRuntime         throws: native runtime bridge is unavailable
A abort               {"state":"exact-scope-empty"}
B prepare             ok
B terminate graceMs=250  {"state":"exact-scope-empty"}
C prepare             ok
C inspect             {"state":"prepared-inert"}
C abort               {"state":"exact-scope-empty"}
```

Raw helper receipts underneath those lines, taken in the same session:

```text
control inspect  RWA1-OBSERVATION 0100000000000000000000000000000000000000000000000000000000000000
                 phase=1 prepared-inert, flags=0
control abort    RWA1-OBSERVATION 0404000000000000000000000000000000000000000000000000000000000000
                 phase=4 exact-scope-empty, flags=0x04 may_emit_exact_empty
scope directory  journal.log  sole-handle.attestation  terminal.record
journal.log      "RWJ1 1 prepared inert" / "RWJ1 2 exact-scope-empty never-activated active=0 total=0"
```

So, module by module, what changed for the TypeScript side:

| Module | Before this unit | Now |
| --- | --- | --- |
| `provider.ts` (production) | crossed by three tests, all asserting it does nothing | prepares, publishes, inspects, terminates, aborts a real authority on this kernel |
| `artifact-resolver.ts` (production entry) | crossed by exactly one test, which asserts it fails | resolves the packaged helper and hands it to the assembly that executes it |
| `private-reference.ts` | one real attestation, via a Section 8 driver | mints and decodes a reference from every production prepare |
| `recovery.ts` | fixture probe strings only | classifies real `RWA1-PROBE` output from the kernel on every control verb |
| `outcomes.ts` | hand-written literals only | maps real decoded `encode_observation` payloads |
| `publication-ledger.ts` | production module across real processes (8.14) | unchanged, now driven by the production provider's own prepare and activate paths |
| `native-assembly.ts` | did not exist | is the thing that executes the helper |
| `build-authority.ts` | inert `[]` in-repo | still inert in-repo; the generated table was used from an out-of-repo package root |

## 9.7's aggregate sentence, restated

Section 9 wrote:

> on the TypeScript side, no production entry point below `contracts.ts` and the pure codecs has
> ever been crossed by anything that reached a Windows kernel, because the only thing that could --
> the native assembly -- does not exist.

Post-change, the true sentence is:

**On the TypeScript side, every production entry point below `contracts.ts` has now been crossed by
something that reached a Windows kernel, except the runtime bridge and activation, which no
production entry point can reach because the frozen helper exposes no frame-preserving runtime
verb. The crossing is bound to an out-of-repo package root, because `build-authority.ts` is `[]` in
a source checkout by construction, so in the repository tree itself the production factory still
resolves nothing and still returns typed unavailable.**

## Tasks

**No task is ticked by this unit**, and each near-miss is named rather than rounded up:

- **9.8** stays unticked. Its Leg D is now reachable and was run for prepare, publish, inspect,
  terminate, abort and recovery, but the task's text names `activate`, and activation through the
  TypeScript production path remains impossible. Closing 9.8 on a lifecycle missing its middle would
  be exactly the narrower-receipt-closing-a-broader-gate failure task 1.7 forbids. What changed is
  the *reason* it is open: it was "structurally impossible, no code path exists"; it is now "one
  helper verb away".
- **5.5** (provider runtime bridge) stays unticked, and this unit records why it cannot be done
  without a crate change.
- **11.1** stays unticked. The TypeScript typecheck and the eight Windows suites were run; the
  native helper suite, the package matrix and the failure-mutation matrix were not.

## Counts and commands

```text
npx tsc --noEmit                                          clean
npx eslint <the three touched files>                      clean
npx vitest run <8 Windows TypeScript suites>              181 passed, 0 failed, 0 skipped
                                                          (Section 9 recorded 161 over 7 files, so
                                                          the two counts are not comparable; this
                                                          unit adds exactly one `it` block)
node bin/rasen.js validate ecp-windows-process-authority-provider --strict   valid
node scripts/build-windows-process-authority.mjs --plan   sourceSha256 fc49a7c2 (unchanged)
```

Gated entry point added, named per 9.10: `itOnWindows` in
`test/core/session-host/windows-process-authority-provider.test.ts`. It skips off win32 or off
x64/arm64 because `resolveWindowsProcessAuthorityArtifact` refuses to become an authority outside an
actual Windows runtime. Its rows assert on values the resolver produced, so skipping removes an
assertion rather than weakening one. It executes no helper: resolution reads and hashes the image,
it does not run it, so that row is package-integrity evidence and not actual-runtime evidence.

Scratchpad drivers used for the runtime receipts live outside the repository at
`C:/Users/Sayo/AppData/Local/Temp/claude/.../scratchpad/`. They are orchestration, not product;
every product path they touch is a production entry point.

## One pre-existing failure observed, not caused and not fixed

`test/core/windows-hide-guard.test.ts` fails: `linux/native-assembly.ts:538` calls
`execFileSync('mkfifo', ['-m', '600', fifo], { stdio: 'ignore' })` with no `windowsHide`. That line
arrived in commit `6285339f wip(ecp7): FIFO daemon-lifetime wiring -- NOT receipted, activate is
RED` from the concurrent Linux worker. The Windows assembly passes `windowsHide: true` on its only
spawn and is not among the offenders. Reported here so it is not mistaken for fallout from this
unit; the Linux tree is not this Change's to edit (task 10.7).

## What this unit does NOT establish

- **Nothing about activation or the runtime bridge.** They are refused, and the refusal is the
  claim. No workload process has ever been started through the TypeScript production path.
- **Nothing about the repository tree's own production factory.** In a source checkout
  `WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES` is `[]`, so resolution fails and the factory still
  falls back to typed unavailable. Every runtime receipt here is bound to the out-of-repo package
  root described under Bindings. A shipped install has the generated table and would behave as
  measured, but **that has not been demonstrated from an actual install**.
- **The `identity-drift` retained state is unreachable** through this transport (`S10-F3`), so no
  receipt here shows the provider returning it. The refusals that produce it inside the helper were
  measured by 8.13; they arrive at this layer as `control-loss` with the `identity-drift` code.
- **The `durable-terminal-record` recovery basis and the `event-gap / ledger-conflict` branch are
  unreachable** through this transport (`S10-F3`). Only the corroborated last-handle rule was
  measured producing an empty receipt on recovery.
- **No timeout, event-gap or partial-construction path was driven end to end.** The closed
  diagnostic table that maps them is written and reviewed but only its `native-transport-lost`
  default was exercised, by `M3` and `M4`.
- **No proof that the `attemptGraceful` no-op is harmless in a live-root termination**, because a
  live root cannot be created through this path. `--grace-ms` was passed and honoured for a prepared
  authority only, where there is nothing to be graceful to.
- **One machine, one architecture, one session.** No arm64 runtime, no cross-machine transfer, no
  install, no CI execution.
- **Author == verifier for everything in this file.** One worker wrote the assembly, wrote the
  mutations that falsify it, ran them and graded them. The `S10-F1` diagnosis in particular is a
  single agent's reading of two encoders plus one measured RED; a non-author reproduction is owed.
- **Nothing was committed, pushed, or written under `.rasen/**`.** The repository changes from this
  unit are one new source file, two edited files, and this evidence file.
