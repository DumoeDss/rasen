# win32 early-return triage against locked decision 13

Status: TRIAGE, not closure. No test file was edited. Classification (b) items, if any, become
tasks in the cutover/closure waves; (a)/(c) dispositions are proposals awaiting a LEAD decision.

Source obligation: handoff `lead-6.md` next-action item 3 records "ten win32 early-returns in the
Linux TypeScript suite (six in package-ci alone), each reporting as a passing test having asserted
nothing". This document is the authoritative per-site enumeration (grep of every
`test/core/session-host/linux-process-authority-*.test.ts` for platform guards, 2026-08-07, worktree
HEAD b3edf5bc). True count: exactly ten in-body early-return sites. Two additional platform gates
use the honest `describe.skip` form and are listed as context, not counted.

Classification lens (post-decision-13): the Linux kernel-enforced provider is parked to the upgrade
path; 0.2.0 takes no further receipts against it. An early-return inside a parked-provider-only
suite is acceptable-if-DECLARED; one guarding still-shipping 0.2.0 surface is a live hole.

## Enumeration table

| # | Site | Guard | Asserted surface (skipped on this host) | Class | Disposition |
| --- | --- | --- | --- | --- | --- |
| S1 | `linux-process-authority-package-ci.test.ts:259` | `if (process.platform === 'win32') { expect(() => assemble(item)).toThrow(...); return; }` | Full assembly: helper/broker bytes, 0755 mode, both artifact manifests, `providers-linux-x64.json` content, `build-authority.js` hash embedding, reassembly byte-determinism, export staging, `release-input.json` | (a) | Declare via explicit skip; split win32-refusal assertion into its own `runIf` test |
| S2 | `linux-process-authority-package-ci.test.ts:459` | `if (process.platform === 'win32') return;` | Staging rejection: empty helper, missing broker client, cross-build provenance | (a) | Declare via explicit skip |
| S3 | `linux-process-authority-package-ci.test.ts:487` | `if (process.platform === 'win32') return;` | Release-input hash binding, tampered-byte rejection, foreign ELF machine rejection | (a) | Declare via explicit skip |
| S4 | `linux-process-authority-package-ci.test.ts:530` | `if (process.platform === 'win32') return;` | arm64-only and dual-architecture manifest emission | (a) | Declare via explicit skip |
| S5 | `linux-process-authority-package-ci.test.ts:565` | `if (process.platform === 'win32') return;` | Stale privileged inventory removal from owned assembly/export trees (`broker`, `broker.key`, foreign-arch roots) | (a) | Declare via explicit skip; note packlist backstop below |
| S6 | `linux-process-authority-package-ci.test.ts:674` | `if (process.platform === 'win32') return;` | Fail-closed when live source mutates after the immutable snapshot starts (sh-script fake toolchain) | (a) | Declare via explicit skip |
| S7 | `linux-process-authority-artifact-resolver.test.ts:153` | `if (process.platform !== 'linux') return;` | fd-pinned helper bytes survive a post-verification pathname swap | (a) | Declare via explicit skip |
| S8 | `linux-process-authority-artifact-resolver.test.ts:171` | `if (process.platform !== 'linux') return;` | setuid/setgid/sticky helper mode bits rejected, not masked | (a) | Declare via explicit skip |
| S9 | `linux-process-authority-provider.test.ts:309` | `if (process.platform === 'win32') return;` | Writable/special-mode state-root ancestors rejected (POSIX mode/ownership walk) | (c) | Declare via explicit skip; Linux coverage receipted |
| S10 | `linux-process-authority-publication-ledger.test.ts:332` | `if (process.platform === 'win32') return;` | Exact private mode (0700) required for an existing ledger root | (c) | Declare via explicit skip; Linux coverage receipted |

Counts: (a) parked-with-providers = 8, (b) live-hole = 0, (c) legitimately-platform-gated = 2.

## Why (b) is zero

Each site's subject was checked against still-shipping 0.2.0 surface (legacy capsule pins,
best-effort scope, semantics contract, package manifests):

- S1-S6 assert the parked provider's assembly/staging/packaging machinery
  (`scripts/build-linux-process-authority.mjs`, its manifests, its CI trust boundary). That
  machinery is invoked only by the dedicated `build:linux-authority` npm script and the dedicated
  `.github/workflows/linux-process-authority.yml` workflow - NOT by `scripts/build.js`, `pnpm run
  build`, `ci.yml`, or `release.yml` (verified by grep). The default build/release therefore ships
  no assembled Linux-provider artifacts, and decision 13 says 0.2.0 takes no further receipts
  against this machinery.
- S7-S8 assert the parked provider's production artifact resolver
  (`src/core/session-host/process-authority/linux/artifact-resolver.ts`) - never constructed by the
  production hosted path (the registry was never wired; that fact triggered decision 13). S7 is
  additionally TOCTOU path-race hardening, which locked decision 12 removed from acceptance.
- S9-S10 assert POSIX mode/ownership semantics of parked-provider state roots; the mechanics are
  genuinely meaningless on win32 (`chmod`/mode-bit semantics do not exist there).
- The one test in these suites that DOES guard still-shipping surface - `package-ci.test.ts:412`
  "keeps npm/package installation unprivileged and rejects implicit fallback seams" (package.json
  `files`, postinstall hygiene, resolver source hygiene, npm packlist exclusion of broker
  secrets) - is NOT an early-return: its assertions all run on win32. Only its line-414
  `if (process.platform !== 'win32') assemble(item);` conditionally skips an `assemble` call whose
  outputs the test's assertions never read (the packlist assertions build their own synthetic
  package root). No assertion is lost on this host. Additionally, `package.json:44-45` excludes
  broker binaries from `files` as a static backstop for the S5 concern.

## Per-site detail

### S1 - package-ci:259 (partial early-return)

The only site of the ten that asserts something real on win32 before returning: it proves
`assemble()` REFUSES to run on Windows (`toThrow(/POSIX|0755|authoritative assembly/i)`), the
cross-target honesty gate. What never runs on this host is the entire positive assembly surface
(lines 263-410). lead-6's "asserted nothing" is accurate for S2-S6/S9-S10 and slightly overstates
S1. Fix shape: split into two tests - `it.runIf(win32)` for the refusal, `it.skipIf(win32)` for the
assembly - so both report truthfully.

### S2-S6 - package-ci pure returns

Bare `return` at the top of the test body; on this host each reports "passed" with zero
assertions executed. The historical receipt `evidence/implementation-package-ci-1.md` records
"27 passed, 0 failed, 0 skipped" for this suite run on Windows PowerShell - the exact
verification-theater shape lead-6 flagged: a green ledger entry that proves only that the guard
fired. No actual Linux run receipt of this suite exists in the change's evidence (the WSL
supporting-suite run in `evidence/wsl-ts-oracles-lead2.md` did not include package-ci). Coverage of
adjacent claims exists but is partial: `evidence/wsl-native-build-manifest-lead2.md` reparsed
`providers-linux-x64.json` from a real WSL assembly, which overlaps S1's providers.json assertions
but none of S2-S6.

### S7-S8 - artifact-resolver `!== 'linux'` returns

Skip on both win32 AND darwin. Subject is the parked resolver, so (a) applies without needing a
Linux receipt. Incidental real-Linux evidence exists that the resolver's ownership/mode validation
family works (`evidence/wsl-ts-oracles-lead2.md:196-204`: `validateOwnedPath` correctly rejected a
DrvFS 0777 tree during oracle staging), but the specific fd-pinning (S7) and setuid-rejection (S8)
assertions have no named Linux run; if this suite's subject ever returns to 0.2.0 scope, these two
must be re-run on Linux before any green claim.

### S9-S10 - provider/publication-ledger win32 returns, Linux-covered

Named receipt: `evidence/wsl-ts-oracles-lead2.md`, "Supporting TypeScript suites (Linux, but not
actual-kernel oracles)": `linux-process-authority-provider.test.ts` (15 tests) and
`linux-process-authority-publication-ledger.test.ts` (13 tests) ran to green under WSL Linux, where
neither win32 guard fires - so S9/S10's assertions demonstrably executed on a real Linux kernel.
The gated mechanics (ancestor mode/ownership walks, exact 0700 root modes) are genuinely
POSIX-only. Their subjects are additionally parked under decision 13, so they are acceptable on two
independent grounds.

## Context: the honest gate form already in these suites

`linux-process-authority-daemon-lifetime.test.ts:20-22` and
`linux-process-authority-wsl-oracles.test.ts:40-42` gate with
`const describeActualWsl = ACTUAL_WSL ? describe : describe.skip;` - skipped work reports as
SKIPPED, not passed. This is the form all ten sites should adopt.

## Proposed fix shape (proposal only; no edits made)

One batch conversion, all ten sites: replace the in-body early-return with
`it.skipIf(<same condition>)(...)` (S1 additionally split per its detail above), plus a one-line
comment at each site citing locked decision 13 ("parked-provider suite; skipped-not-passed by
design"). None of these four test files is byte-pinned (the pin lists cover
`process-capsule-package.test.ts` and `process-capsule-posix-replacement.test.ts` only), so the
conversion trips no freeze guard.

Absorbing wave: NOT `ecp-hosted-best-effort-cutover` (it deliberately does not touch
parked-provider suites, preserving its no-rebaseline guarantee and scope). Recommended: fold the
batch conversion into the closure wave's bookkeeping (it already owns the findings re-grade against
the new tier), or the same residual-bookkeeping slot that Replan 6 assigned the
`process-authority-scope-semantics-wording` parking residuals. Since (b) = 0, nothing blocks the
cutover on this triage.

## Re-triage trigger (owed to ECP-8)

Main CI (`ci.yml`) runs the FULL vitest suite on `ubuntu-latest` (node 20 and node 24 jobs), where
none of the ten guards fire - so the 0.2.0 unified PR's CI will execute all ten sites' assertions
on Linux automatically. That is a future structural backstop, not a present receipt: this branch
has never been through remote CI. ECP-8 must re-check two conditions when it runs the release
truth audit: (1) the unified-PR ubuntu jobs actually ran these suites green; (2) the release
pipeline still does NOT invoke `build-linux-process-authority.mjs`. If (2) ever changes - assembled
provider artifacts shipping in the package again - S1-S6 upgrade from (a) to (b) and the skip
declarations must be revisited.
